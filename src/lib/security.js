import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export function jsonError(message, status = 400, extra = {}) {
  return NextResponse.json(
    { success: false, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export function jsonOk(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

/* ------------------------------------------------------------------ */
/* Request body                                                        */
/* ------------------------------------------------------------------ */

export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

/**
 * Read a JSON body with a hard size cap. Rejects non-object bodies.
 */
export async function readJsonBody(request, maxBytes = 16 * 1024) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new RequestError("Request is too large.", 413);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestError("Expected a JSON request.", 415);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new RequestError("Request is too large.", 413);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestError("Malformed JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("Invalid request body.");
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Same-origin check (CSRF defence in depth)                           */
/* ------------------------------------------------------------------ */

function allowedOrigins(request) {
  const set = new Set();
  if (process.env.APP_ORIGIN) {
    process.env.APP_ORIGIN.split(",").forEach((o) => set.add(o.trim().replace(/\/$/, "")));
  }
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  if (host && !process.env.APP_ORIGIN) set.add(`${proto}://${host}`);
  return set;
}

/**
 * Browser-initiated state-changing requests must come from our own site.
 * Returns an error response, or null when the request is allowed.
 */
export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return jsonError("Cross-site request blocked.", 403);
  }
  if (origin && !allowedOrigins(request).has(origin.replace(/\/$/, ""))) {
    return jsonError("Cross-site request blocked.", 403);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Client IP                                                           */
/* ------------------------------------------------------------------ */

export function getClientIp(request) {
  // On Vercel / most reverse proxies the first XFF entry is the client.
  const xff = request.headers.get("x-forwarded-for");
  const ip =
    request.headers.get("x-real-ip") ||
    (xff ? xff.split(",")[0].trim() : "") ||
    "unknown";
  return ip.slice(0, 64);
}

/* ------------------------------------------------------------------ */
/* Rate limiting (MongoDB-backed so it works across serverless         */
/* instances). Uses a fixed window with a TTL-indexed collection.      */
/* ------------------------------------------------------------------ */

export async function rateLimit(db, key, limit, windowMs) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const id = `${key}:${windowStart}`;
  const result = await db.collection("rate_limits").findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(windowStart + windowMs * 2) },
    },
    { upsert: true, returnDocument: "after" }
  );
  const count = (result?.value ?? result)?.count ?? 1;
  return count <= limit;
}

export async function enforceRateLimit(db, request, name, limit, windowMs) {
  const ip = getClientIp(request);
  const ok = await rateLimit(db, `${name}:${ip}`, limit, windowMs);
  return ok ? null : jsonError("Too many requests. Please wait a moment and try again.", 429);
}

/* ------------------------------------------------------------------ */
/* Booking session                                                     */
/*                                                                     */
/* The browser gets an unguessable, HttpOnly session cookie. The        */
/* TempID stored in MongoDB is derived from it, so a TempID seen        */
/* anywhere (DB, Razorpay notes, logs) cannot be used to act on         */
/* someone else's holds.                                                */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-suv_sid" : "suv_sid";
const SESSION_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MAX_AGE = 60 * 60 * 6; // 6 hours

export function readSession(request) {
  const value = request.cookies?.get(SESSION_COOKIE)?.value;
  return typeof value === "string" && SESSION_RE.test(value) ? value : null;
}

export function getOrCreateSession(request) {
  const existing = readSession(request);
  if (existing) return { sid: existing, isNew: false };
  return { sid: crypto.randomBytes(32).toString("base64url"), isNew: true };
}

export function attachSession(response, sid) {
  response.cookies.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

/**
 * The client may still send its own per-tab id; it only scopes holds
 * between tabs. Authority comes from the HttpOnly cookie.
 */
export function deriveTempId(sid, clientTabId) {
  const tab =
    typeof clientTabId === "string" && clientTabId.length <= 150 ? clientTabId : "";
  return (
    "T" +
    crypto.createHmac("sha256", sid).update(`tab:${tab}`).digest("hex").slice(0, 40)
  );
}

/* ------------------------------------------------------------------ */
/* Misc crypto                                                         */
/* ------------------------------------------------------------------ */

export function safeEqualHex(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    !/^[a-f0-9]+$/i.test(a) ||
    !/^[a-f0-9]+$/i.test(b)
  ) {
    return false;
  }
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Constant-time check of a shared secret header (e.g. cron). */
export function hasBearerSecret(request, secret) {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(sha256(given), "hex");
  const b = Buffer.from(sha256(secret), "hex");
  return crypto.timingSafeEqual(a, b) && given.length > 0;
}
