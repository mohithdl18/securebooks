"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Already logged in → go straight to the dashboard.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => {
        if (!cancelled && r.ok) router.replace("/admin");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setError(data.message || "Invalid username or password.");
        setPassword("");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#b08a28]">
            SU VILLA
          </p>
          <h1 className="font-display mt-2 text-5xl">Admin</h1>
          <p className="mt-3 text-sm opacity-70">Sign in to manage bookings and rooms.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-[#052a50]/10 bg-white p-6 shadow-sm sm:p-8"
          noValidate
        >
          <label htmlFor="username" className="text-sm font-semibold">
            Username
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isSubmitting}
            className="mt-2 w-full rounded-xl border border-[#052a50]/15 bg-[#F7FAEE] px-4 py-3 text-sm outline-none transition focus:border-[#e4b441] disabled:opacity-60"
          />

          <label htmlFor="password" className="mt-5 block text-sm font-semibold">
            Password
          </label>
          <div className="relative mt-2">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-[#052a50]/15 bg-[#F7FAEE] px-4 py-3 pr-20 text-sm outline-none transition focus:border-[#e4b441] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#052a50]/70 hover:bg-[#052a50]/5"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full rounded-xl bg-[#052a50] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#e4b441] hover:text-[#052a50] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>

          <p className="mt-4 text-center text-xs opacity-55">
            You’ll be signed out automatically after 24 hours.
          </p>
        </form>
      </div>
    </main>
  );
}
