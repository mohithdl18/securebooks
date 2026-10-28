import { getDb } from "@/lib/mongodb";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  assertSameOrigin,
  enforceRateLimit,
  rateLimit,
  RequestError,
} from "@/lib/security";
import {
  adminConfigured,
  adminUsername,
  checkCredentials,
  createAdminSession,
  setAdminCookie,
  audit,
} from "@/lib/adminAuth";

export async function POST(request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;

    if (!adminConfigured()) {
      return jsonError("Admin access is not configured.", 503);
    }

    const db = await getDb();
    // 5 attempts per 15 min per IP, and 30/hour overall (slows distributed guessing).
    const limited = await enforceRateLimit(db, request, "admin-login", 5, 15 * 60 * 1000);
    if (limited) return limited;
    if (!(await rateLimit(db, "admin-login-global", 30, 60 * 60 * 1000))) {
      return jsonError("Too many login attempts. Try again later.", 429);
    }

    const { username, password } = await readJsonBody(request, 1024);
    if (typeof username !== "string" || typeof password !== "string" ||
        username.length > 100 || password.length > 200) {
      return jsonError("Invalid username or password.", 401);
    }

    if (!checkCredentials(username.trim(), password)) {
      await audit(request, { username: username.slice(0, 50) }, "login_failed");
      // Small fixed delay to blunt automated guessing.
      await new Promise((r) => setTimeout(r, 600));
      return jsonError("Invalid username or password.", 401);
    }

    const { token, expiresAt } = await createAdminSession(request, adminUsername());
    await audit(request, { username: adminUsername() }, "login");
    return setAdminCookie(
      jsonOk({ success: true, expiresAt: expiresAt.toISOString() }),
      token,
      expiresAt
    );
  } catch (error) {
    if (error instanceof RequestError) return jsonError(error.message, error.status);
    console.error("Admin login failed:", error);
    return jsonError("Unable to log in right now.", 500);
  }
}
