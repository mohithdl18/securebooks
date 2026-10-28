import "server-only";
import crypto from "node:crypto";
import { getDb } from "@/lib/mongodb";
import {
  jsonError,
  assertSameOrigin,
  getClientIp,
  randomToken,
  sha256,
} from "@/lib/security";

/**
 * Admin authentication.
 *
 * Credentials come from env (.env.local):
 *   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_CANCEL_PIN
 *
 * On login the browser gets a random token in an HttpOnly cookie. Only
 * its SHA-256 hash is stored (collection: admin_sessions), with a hard
 * 24-hour expiry. Logging out deletes the session server-side.
 */

export const ADMIN_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-suv_admin" : "suv_admin";
export const ADMIN_SESSION_MS = 24 * 60 * 60 * 1000;

function safeEqualString(a, b) {
  // Hash first so lengths always match and timing reveals nothing.
  const x = Buffer.from(sha256(`cmp:${a}`), "hex");
  const y = Buffer.from(sha256(`cmp:${b}`), "hex");
  return crypto.timingSafeEqual(x, y);
}

const env = (name) => String(process.env[name] || "").trim();

/** Returns null when admin is set up, otherwise the reason it isn't. */
export function adminConfigProblem() {
  const missing = ["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_CANCEL_PIN"].filter((k) => !env(k));
  if (missing.length) return `missing in .env.local: ${missing.join(", ")}`;
  if (env("ADMIN_PASSWORD").length < 10) return "ADMIN_PASSWORD must be at least 10 characters";
  if (!/^\d{4,8}$/.test(env("ADMIN_CANCEL_PIN"))) return "ADMIN_CANCEL_PIN must be 4–8 digits only";
  return null;
}

let warned = false;
export function adminConfigured() {
  const problem = adminConfigProblem();
  if (problem && !warned) {
    warned = true;
    console.error(`[admin] Admin area is switched off — ${problem}. Fix .env.local and restart the server.`);
  }
  return !problem;
}

export function checkCredentials(username, password) {
  if (!adminConfigured()) return false;
  const userOk = safeEqualString(String(username || ""), env("ADMIN_USERNAME"));
  const passOk = safeEqualString(String(password || ""), env("ADMIN_PASSWORD"));
  return userOk && passOk;
}

export function checkCancelPin(pin) {
  if (!adminConfigured()) return false;
  return safeEqualString(String(pin || ""), env("ADMIN_CANCEL_PIN"));
}

export function adminUsername() {
  return env("ADMIN_USERNAME");
}

export async function createAdminSession(request, username) {
  const db = await getDb();
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MS);
  await db.collection("admin_sessions").insertOne({
    _id: sha256(token),
    username,
    ip: getClientIp(request),
    userAgent: (request.headers.get("user-agent") || "").slice(0, 200),
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export function setAdminCookie(response, token, expiresAt) {
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  return response;
}

export function clearAdminCookie(response) {
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function readToken(request) {
  const value = request.cookies?.get(ADMIN_COOKIE)?.value;
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value) ? value : null;
}

export async function getAdminSession(request) {
  const token = readToken(request);
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection("admin_sessions").findOne({
    _id: sha256(token),
    expiresAt: { $gt: new Date() },
  });
  return session ? { ...session, tokenHash: session._id } : null;
}

/**
 * Use at the top of every admin API route.
 * Returns { session } or { response } (an error to return immediately).
 */
export async function requireAdmin(request, { mutating = false } = {}) {
  if (mutating) {
    const blocked = assertSameOrigin(request);
    if (blocked) return { response: blocked };
  }
  if (!adminConfigured()) {
    return { response: jsonError("Admin access is not configured.", 503) };
  }
  const session = await getAdminSession(request);
  if (!session) {
    return { response: clearAdminCookie(jsonError("Please log in again.", 401)) };
  }
  return { session };
}

export async function destroyAdminSession(request) {
  const token = readToken(request);
  if (!token) return;
  const db = await getDb();
  await db.collection("admin_sessions").deleteOne({ _id: sha256(token) });
}

export async function audit(request, session, action, details = {}) {
  try {
    const db = await getDb();
    await db.collection("admin_audit").insertOne({
      action,
      username: session?.username || null,
      ip: getClientIp(request),
      details,
      at: new Date(),
    });
  } catch (error) {
    console.error("Audit log failed:", error.message);
  }
}
