"use client";

import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { adminFetch, formatDate } from "@/lib/adminClient";

export default function RoomStatusGrid({ date, rooms, loading, error, isPast, onChanged, onOpenBooking }) {
  const [busyRoom, setBusyRoom] = useState(null);
  const [actionError, setActionError] = useState("");

  async function toggleBlock(room, block) {
    setBusyRoom(room.roomId);
    setActionError("");
    try {
      await adminFetch("/api/admin/rooms/block", {
        method: block ? "POST" : "DELETE",
        body: { roomId: room.roomId, date },
      });
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyRoom(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Rooms</h2>
          <p className="text-sm opacity-65">Night of {formatDate(date)}</p>
        </div>
      </div>

      {(error || actionError) && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || actionError}</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(loading && !rooms.length ? Array.from({ length: 4 }, (_, i) => ({ roomId: `s${i}` })) : rooms).map((room) => {
          const skeleton = !room.name;
          const busy = busyRoom === room.roomId;
          const clickable = room.status === "booked" && room.bookingId;
          return (
            <article
              key={room.roomId}
              onClick={clickable ? () => onOpenBooking(room.bookingId) : undefined}
              className={`overflow-hidden rounded-3xl border bg-white transition ${
                room.status === "booked" ? "border-[#052a50]/30" : "border-[#052a50]/10"
              } ${clickable ? "cursor-pointer hover:shadow-md" : ""} ${loading ? "opacity-60" : ""}`}
            >
              <div
                className="h-28 bg-[#052a50]/10 bg-cover bg-center"
                style={room.image ? { backgroundImage: `url(${room.image})` } : undefined}
              />
              <div className="p-4">
                {skeleton ? (
                  <div className="h-16 animate-pulse rounded-xl bg-[#052a50]/5" />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">{room.name}</p>
                      <StatusBadge value={room.status} />
                    </div>

                    {room.status === "booked" && (
                      <p className="mt-2 text-xs leading-5 opacity-70">
                        {room.guestName ? `${room.guestName} · ` : ""}
                        {room.checkIn ? `${formatDate(room.checkIn, false)} → ${formatDate(room.checkOut, false)}` : "Marked booked"}
                      </p>
                    )}
                    {room.status === "held" && (
                      <p className="mt-2 text-xs opacity-70">A guest is checking out right now.</p>
                    )}
                    {room.status === "blocked" && (
                      <p className="mt-2 text-xs opacity-70">Not available to guests for this night.</p>
                    )}

                    <div className="mt-3">
                      {room.status === "booked" && room.bookingId && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenBooking(room.bookingId); }}
                          className="w-full rounded-xl bg-[#052a50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e4b441] hover:text-[#052a50]">
                          View booking details
                        </button>
                      )}
                      {room.status === "available" && (
                        <button type="button" disabled={busy || isPast} onClick={() => toggleBlock(room, true)}
                          className="w-full rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                          {busy ? "Blocking..." : isPast ? "Past date" : "Block room"}
                        </button>
                      )}
                      {room.status === "blocked" && (
                        <button type="button" disabled={busy || isPast} onClick={() => toggleBlock(room, false)}
                          className="w-full rounded-xl border border-[#052a50]/20 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#052a50]/5 disabled:opacity-50">
                          {busy ? "Unblocking..." : "Unblock room"}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
