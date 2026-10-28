
import { NextResponse, connection } from "next/server";
import { getDb, clientPromise } from "@/lib/mongodb";
import rooms from "@/data/rooms.json";
import {
    jsonError,
    readJsonBody,
    assertSameOrigin,
    enforceRateLimit,
    getClientIp,
    getOrCreateSession,
    readSession,
    attachSession,
    deriveTempId,
    hasBearerSecret,
    RequestError,
} from "@/lib/security";
import { validateStay } from "@/lib/validation";

const HOLD_DURATION_MS = 10 * 60 * 1000;
const AVAILABILITY_COLLECTION = "room_availabilty";
const TEMP_COLLECTION = "temp_books";
// One IP can't lock up the whole property (CGNAT-friendly margin).
const MAX_ACTIVE_HOLDS_PER_IP = 6;

function isActiveHold(hold) {
    const expiry = new Date(hold?.expiresAt).getTime();

    return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Remove expired temp_books records and their corresponding
 * room-specific temporary_holds entries.
 */
async function cleanExpiredHolds(db) {
    const tempCollection = db.collection(TEMP_COLLECTION);
    const availabilityCollection = db.collection(AVAILABILITY_COLLECTION);
    const client = await clientPromise;

    const expiredHolds = await tempCollection
        .find({ expiresAt: { $lte: new Date() } })
        .toArray();

    for (const hold of expiredHolds) {
        const session = client.startSession();

        try {
            await session.withTransaction(async () => {
                const currentHold = await tempCollection.findOne(
                    {
                        _id: hold._id,
                        expiresAt: { $lte: new Date() },
                    },
                    { session }
                );

                if (!currentHold) return;

                await tempCollection.deleteOne(
                    { _id: currentHold._id },
                    { session }
                );

                for (const date of currentHold.stayDates || []) {
                    await availabilityCollection.updateOne(
                        { date },
                        {
                            $pull: {
                                temporary_holds: {
                                    TempID: currentHold.TempID,
                                    roomId: currentHold.roomId,
                                },
                            },
                        },
                        { session }
                    );
                }
            });
        } finally {
            await session.endSession();
        }
    }
}

/**
 * Find an active hold by another TempID that overlaps at least one
 * night of this requested stay.
 *
 * The temp_books query is authoritative for active temporary holds.
 * This also catches conflicts if a temporary_holds entry is missing
 * from room_availabilty.
 */
async function findConflictingHold(
    tempCollection,
    { TempID, roomId, stayDates },
    session
) {
    const conflicts = await tempCollection
        .find(
            {
                roomId,
                TempID: { $ne: TempID },
                expiresAt: { $gt: new Date() },
                stayDates: { $in: stayDates },
            },
            {
                ...(session ? { session } : {}),
                projection: {
                    _id: 0,
                    TempID: 1,
                    roomId: 1,
                    stayDates: 1,
                    expiresAt: 1,
                },
            }
        )
        .toArray();

    return conflicts.find(
        (hold) =>
            hold.TempID !== TempID &&
            isActiveHold(hold) &&
            (hold.stayDates || []).some((date) => stayDates.includes(date))
    );
}

export async function POST(request) {
    let session;

    try {
        const blocked = assertSameOrigin(request);
        if (blocked) return blocked;

        const body = await readJsonBody(request, 2048);
        const { roomId, checkIn, checkOut } = body;

        if (typeof roomId !== "string" || !rooms.some((room) => room.id === roomId)) {
            return jsonError("Invalid temporary booking details.");
        }
        const stayDates = validateStay(checkIn, checkOut);

        // Identity comes from the HttpOnly cookie, never from the body.
        const { sid } = getOrCreateSession(request);
        const TempID = deriveTempId(sid, body.TempID);
        const ip = getClientIp(request);

        const db = await getDb();
        const tempCollection = db.collection(TEMP_COLLECTION);
        const availabilityCollection = db.collection(
            AVAILABILITY_COLLECTION
        );
        const client = await clientPromise;

        const limited = await enforceRateLimit(db, request, "hold", 30, 10 * 60 * 1000);
        if (limited) return limited;

        await cleanExpiredHolds(db);

        const activeForIp = await tempCollection.countDocuments({
            ip,
            expiresAt: { $gt: new Date() },
        });
        if (activeForIp >= MAX_ACTIVE_HOLDS_PER_IP) {
            return jsonError(
                "Too many rooms are on hold from your network. Please complete or cancel an existing booking first.",
                429
            );
        }

        // First, detect a conflicting hold stored in temp_books.
        const conflictingHold = await findConflictingHold(tempCollection, {
            TempID,
            roomId,
            stayDates,
        });

        if (conflictingHold) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "This room is temporarily held by another customer for some or all of those dates. Please choose another room or dates.",
                },
                { status: 409 }
            );
        }

        // Allow an existing hold for this same room and exact date range
        // to be reused without extending its expiry.
        const existingRoomHolds = await tempCollection
            .find({
                TempID,
                roomId,
                expiresAt: { $gt: new Date() },
            })
            .toArray();

        const existingHold = existingRoomHolds.find(
            (hold) =>
                hold.checkIn === checkIn &&
                hold.checkOut === checkOut &&
                isActiveHold(hold)
        );

        if (existingHold) {
            return attachSession(NextResponse.json({
                success: true,
                roomId,
                checkIn,
                checkOut,
                expiresAt: existingHold.expiresAt,
                remainingSeconds: Math.max(
                    0,
                    Math.ceil(
                        (new Date(existingHold.expiresAt).getTime() -
                            Date.now()) /
                            1000
                    )
                ),
                message: "Your room is already temporarily held.",
            }), sid);
        }

        // One TempID cannot hold the same room for a different date range.
        if (existingRoomHolds.length > 0) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "This room is already held for different dates in your temporary booking.",
                },
                { status: 409 }
            );
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + HOLD_DURATION_MS);

        session = client.startSession();

        await session.withTransaction(async () => {
            // Recheck the authoritative temporary-hold collection
            // inside the transaction to reduce race conditions.
            const transactionConflict = await findConflictingHold(
                tempCollection,
                { TempID, roomId, stayDates },
                session
            );

            if (transactionConflict) {
                throw new Error("ROOM_UNAVAILABLE");
            }

            // Check each night for confirmed bookings, admin blocks,
            // and active holds written to the daily availability records.
            for (const date of stayDates) {
                const record = await availabilityCollection.findOne(
                    { date },
                    { session }
                );

                const bookedRooms = Array.isArray(record?.booked_rooms)
                    ? record.booked_rooms
                    : [];

                const blockedRooms = Array.isArray(record?.blocked_rooms)
                    ? record.blocked_rooms
                    : [];

                const temporaryHolds = Array.isArray(
                    record?.temporary_holds
                )
                    ? record.temporary_holds
                    : [];

                const heldByAnotherCustomer = temporaryHolds.some(
                    (hold) =>
                        hold.roomId === roomId &&
                        hold.TempID !== TempID &&
                        isActiveHold(hold)
                );

                if (
                    bookedRooms.includes(roomId) ||
                    blockedRooms.includes(roomId) ||
                    heldByAnotherCustomer
                ) {
                    throw new Error("ROOM_UNAVAILABLE");
                }
            }

            // Save the hold with the exact dates and expiry timestamp.
            await tempCollection.insertOne(
                {
                    TempID,
                    roomId,
                    roomName:
                        rooms.find((room) => room.id === roomId)?.name ||
                        roomId,
                    checkIn,
                    checkOut,
                    stayDates,
                    ip,
                    createdAt: now,
                    expiresAt,
                    status: "active",
                },
                { session }
            );

            // Mirror the hold into each night's availability record.
            for (const date of stayDates) {
                await availabilityCollection.updateOne(
                    { date },
                    {
                        $setOnInsert: {
                            date,
                            booked_rooms: [],
                            blocked_rooms: [],
                        },
                        $addToSet: {
                            temporary_holds: {
                                TempID,
                                roomId,
                                expiresAt,
                            },
                        },
                    },
                    { upsert: true, session }
                );
            }
        });

        return attachSession(
            NextResponse.json(
                {
                    success: true,
                    roomId,
                    checkIn,
                    checkOut,
                    expiresAt,
                    remainingSeconds: Math.round(HOLD_DURATION_MS / 1000),
                    message: "Room held for 10 minutes.",
                },
                { status: 201 }
            ),
            sid
        );
    } catch (error) {
        if (error instanceof RequestError) {
            return jsonError(error.message, error.status);
        }
        if (
            error.message === "ROOM_UNAVAILABLE" ||
            error.code === 11000
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "This room is no longer available for those dates. Please search again.",
                },
                { status: 409 }
            );
        }

        console.error("Temporary room hold failed:", error);

        return NextResponse.json(
            {
                success: false,
                message: "Unable to hold this room. Please try again.",
            },
            { status: 500 }
        );
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}

export async function DELETE(request) {
    let session;

    try {
        const blocked = assertSameOrigin(request);
        if (blocked) return blocked;

        const body = await readJsonBody(request, 2048);
        const { roomId } = body;

        if (
            roomId != null &&
            (typeof roomId !== "string" || !rooms.some((room) => room.id === roomId))
        ) {
            return jsonError("Invalid room.");
        }

        const sid = readSession(request);
        if (!sid) {
            return NextResponse.json({ success: true, releasedCount: 0, message: "No temporary holds were found." });
        }
        const TempID = deriveTempId(sid, body.TempID);

        const db = await getDb();
        const tempCollection = db.collection(TEMP_COLLECTION);
        const availabilityCollection = db.collection(
            AVAILABILITY_COLLECTION
        );
        const client = await clientPromise;

        session = client.startSession();

        let releasedCount = 0;

        await session.withTransaction(async () => {
            const filter = {
                TempID,
                ...(roomId ? { roomId } : {}),
            };

            const holds = await tempCollection
                .find(filter, { session })
                .toArray();

            if (holds.length === 0) return;

            await tempCollection.deleteMany(filter, { session });

            for (const hold of holds) {
                for (const date of hold.stayDates || []) {
                    await availabilityCollection.updateOne(
                        { date },
                        {
                            $pull: {
                                temporary_holds: {
                                    TempID: hold.TempID,
                                    roomId: hold.roomId,
                                },
                            },
                        },
                        { session }
                    );
                }
            }

            releasedCount = holds.length;
        });

        return NextResponse.json({
            success: true,
            releasedCount,
            message:
                releasedCount > 0
                    ? "Temporary room hold released."
                    : "No matching temporary holds were found.",
        });
    } catch (error) {
        if (error instanceof RequestError) {
            return jsonError(error.message, error.status);
        }
        console.error("Temporary room hold release failed:", error);

        return NextResponse.json(
            {
                success: false,
                message: "Unable to release the temporary hold.",
            },
            { status: 500 }
        );
    } finally {
        if (session) {
            await session.endSession();
        }
    }
}

// Maintenance endpoint for a scheduled job (e.g. Vercel Cron), which sends
// "Authorization: Bearer $CRON_SECRET". Not callable by the public.
export async function GET(request) {
    await connection();
    if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
        return jsonError("Not found.", 404);
    }
    try {
        const db = await getDb();
        await cleanExpiredHolds(db);

        return NextResponse.json({
            success: true,
            message: "Expired temporary holds cleaned up.",
        });
    } catch (error) {
        console.error("Temporary hold cleanup failed:", error);

        return NextResponse.json(
            {
                success: false,
                message: "Unable to clean expired holds.",
            },
            { status: 500 }
        );
    }
}
