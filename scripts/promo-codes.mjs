#!/usr/bin/env node
/**
 * Manage promo codes (stored in MongoDB, never shipped to the browser).
 *
 *   node --env-file=.env.local scripts/promo-codes.mjs add MONSOON12 12 --until 2026-12-31 --max-uses 50 --max-discount 3000 --once
 *   node --env-file=.env.local scripts/promo-codes.mjs disable MONSOON12
 *   node --env-file=.env.local scripts/promo-codes.mjs list
 *
 * Use long, non-guessable codes for private offers (e.g. SUV-K7Q2-WINTER).
 */
import { MongoClient } from "mongodb";

const [, , cmd, rawCode, rawPercent, ...rest] = process.argv;
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db(process.env.MONGODB_DB || "suvilla_bookings").collection("promo_codes");
await col.createIndex({ code: 1 }, { unique: true });

try {
  if (cmd === "add") {
    const code = String(rawCode || "").toUpperCase();
    const percent = Number(rawPercent);
    if (!/^[A-Z0-9]{3,24}$/.test(code)) throw new Error("Code must be 3–24 letters/digits.");
    if (!(percent > 0 && percent <= 90)) throw new Error("Percent must be 1–90.");
    const doc = {
      code,
      percent,
      visibility: rest.includes("--public") ? "public" : "private",
      active: true,
      used_count: 0,
      valid_from: flag("from") ? new Date(flag("from")) : new Date(),
      valid_until: flag("until") ? new Date(`${flag("until")}T23:59:59+05:30`) : null,
      max_uses: flag("max-uses") ? Number(flag("max-uses")) : null,
      max_discount: flag("max-discount") ? Number(flag("max-discount")) : null,
      min_subtotal: flag("min-subtotal") ? Number(flag("min-subtotal")) : null,
      one_per_customer: rest.includes("--once"),
      created_at: new Date(),
    };
    await col.updateOne({ code }, { $set: doc }, { upsert: true });
    console.log("Saved", doc);
  } else if (cmd === "disable") {
    const r = await col.updateOne({ code: String(rawCode).toUpperCase() }, { $set: { active: false } });
    console.log(r.matchedCount ? "Disabled" : "Not found");
  } else if (cmd === "list") {
    console.table(await col.find({}, { projection: { _id: 0 } }).toArray());
  } else {
    console.log("Usage: add <CODE> <PERCENT> [--until YYYY-MM-DD] [--max-uses N] [--max-discount INR] [--min-subtotal INR] [--once] | disable <CODE> | list");
  }
} finally {
  await client.close();
}
