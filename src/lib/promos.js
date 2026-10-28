import "server-only";
import { RequestError } from "@/lib/security";

/**
 * Promo codes live in MongoDB (collection: promo_codes), never in the
 * browser bundle. Document shape:
 * {
 *   code: "MONSOON12",          // stored upper-case, unique
 *   percent: 12,                // 1–50
 *   active: true,
 *   valid_from: ISODate,        // optional
 *   valid_until: ISODate,       // optional
 *   max_uses: 50,               // optional total cap
 *   used_count: 0,
 *   max_discount: 3000,         // optional INR cap per booking
 *   min_subtotal: 10000,        // optional
 *   one_per_customer: true      // optional (email / phone)
 * }
 * Use scripts/promo-codes.mjs to create or disable codes.
 */

export const CODE_RE = /^[A-Z0-9]{3,24}$/;
export const MAX_OFFER_PERCENT = 90;
export const MAX_OFFER_DAYS = 365;
const INVALID = "This promo code is invalid or has expired.";

export function normalizePromoCode(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

/**
 * Returns { code, percent, maxDiscount } or null when no code given.
 * Throws RequestError when the code can't be used.
 */
export async function resolvePromo(db, rawCode, { subtotal = null, customer = null } = {}) {
  const code = normalizePromoCode(rawCode);
  if (!code) return null;
  if (!CODE_RE.test(code)) throw new RequestError(INVALID);

  const now = new Date();
  const promo = await db.collection("promo_codes").findOne({ code, active: true });
  if (!promo) throw new RequestError(INVALID);

  const percent = Number(promo.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_OFFER_PERCENT) throw new RequestError(INVALID);
  if (promo.valid_from && now < new Date(promo.valid_from)) throw new RequestError(INVALID);
  if (promo.valid_until && now > new Date(promo.valid_until)) throw new RequestError(INVALID);
  if (promo.max_uses != null && (promo.used_count || 0) >= promo.max_uses) {
    throw new RequestError(INVALID);
  }
  if (subtotal != null && promo.min_subtotal && subtotal < promo.min_subtotal) {
    throw new RequestError(`This code needs a minimum booking of ₹${promo.min_subtotal}.`);
  }

  if (customer && promo.one_per_customer) {
    const used = await db.collection("bookings_data").findOne({
      status: "confirmed",
      "pricing.promoCode": code,
      $or: [
        { "personal_info.email": customer.email },
        { "personal_info.phone_number": customer.phone },
      ],
    });
    if (used) throw new RequestError("You have already used this promo code.");
  }

  return {
    code,
    percent,
    maxDiscount: Number(promo.max_discount) > 0 ? Number(promo.max_discount) : null,
  };
}

/** Called inside the confirmation transaction. */
export async function recordPromoUse(db, code, session) {
  if (!code) return;
  await db
    .collection("promo_codes")
    .updateOne({ code }, { $inc: { used_count: 1 } }, { session });
}

/* ------------------------------------------------------------------ */
/* Offers created from the admin dashboard                             */
/* ------------------------------------------------------------------ */

function istDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * "Valid for N days" counts today as day 1, so the offer ends at
 * 23:59:59 IST on (today + N − 1).
 */
export function offerExpiry(days, now = new Date()) {
  const today = istDateString(now);
  const end = new Date(`${today}T23:59:59.999+05:30`);
  end.setUTCDate(end.getUTCDate() + (days - 1));
  return end;
}

export function toOffer(doc) {
  const now = new Date();
  const expired = doc.valid_until ? now > new Date(doc.valid_until) : false;
  return {
    code: doc.code,
    percent: doc.percent,
    visibility: doc.visibility === "public" ? "public" : "private",
    validUntil: doc.valid_until || null,
    usedCount: doc.used_count || 0,
    status: !doc.active ? "off" : expired ? "expired" : "live",
    createdAt: doc.created_at || null,
  };
}

export function validateOfferInput({ code, visibility, days, percent }) {
  const c = normalizePromoCode(code);
  if (!CODE_RE.test(c)) throw new RequestError("Offer code must be 3–24 letters or numbers (no spaces).");
  if (!["public", "private"].includes(visibility)) throw new RequestError("Choose public or private.");
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > MAX_OFFER_DAYS) {
    throw new RequestError(`Validity must be 1–${MAX_OFFER_DAYS} days.`);
  }
  const p = Number(percent);
  if (!Number.isInteger(p) || p < 1 || p > MAX_OFFER_PERCENT) {
    throw new RequestError(`Percentage must be a whole number from 1 to ${MAX_OFFER_PERCENT}.`);
  }
  return { code: c, visibility, days: d, percent: p };
}

export async function createOffer(db, input, username) {
  const { code, visibility, days, percent } = validateOfferInput(input);
  const now = new Date();
  const validUntil = offerExpiry(days, now);
  const col = db.collection("promo_codes");

  const existing = await col.findOne({ code });
  if (existing && existing.active && (!existing.valid_until || now <= new Date(existing.valid_until))) {
    throw new RequestError("This code is already live. Turn it off first or use a different code.", 409);
  }

  const doc = {
    code,
    percent,
    visibility,
    active: true,
    valid_from: now,
    valid_until: validUntil,
    max_uses: null,
    max_discount: null,
    min_subtotal: null,
    one_per_customer: false,
    used_count: existing?.used_count || 0,
    created_at: now,
    created_by: username,
  };
  await col.updateOne({ code }, { $set: doc }, { upsert: true });
  return toOffer(doc);
}

export async function disableOffer(db, rawCode) {
  const code = normalizePromoCode(rawCode);
  if (!CODE_RE.test(code)) throw new RequestError("Invalid code.");
  const r = await db.collection("promo_codes").updateOne({ code }, { $set: { active: false } });
  if (!r.matchedCount) throw new RequestError("Offer not found.", 404);
}

export async function listOffers(db) {
  const docs = await db.collection("promo_codes").find({}).sort({ created_at: -1 }).limit(100).toArray();
  return docs.map(toOffer);
}

/** Only live PUBLIC offers — what guests see on the bookings page. */
export async function listPublicOffers(db) {
  const now = new Date();
  const docs = await db
    .collection("promo_codes")
    .find(
      {
        active: true,
        visibility: "public",
        $and: [
          { $or: [{ valid_from: null }, { valid_from: { $lte: now } }] },
          { $or: [{ valid_until: null }, { valid_until: { $gt: now } }] },
        ],
      },
      { projection: { code: 1, percent: 1, valid_until: 1 } }
    )
    .sort({ percent: -1 })
    .limit(20)
    .toArray();
  return docs.map((d) => ({ code: d.code, percent: d.percent, validUntil: d.valid_until || null }));
}
