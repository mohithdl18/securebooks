"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdminCalendar from "@/components/Admin/AdminCalendar";
import RoomStatusGrid from "@/components/Admin/RoomStatusGrid";
import BookingsTable from "@/components/Admin/BookingsTable";
import BookingDetailsModal from "@/components/Admin/BookingDetailsModal";
import PinDialog from "@/components/Admin/PinDialog";
import OffersModal from "@/components/Admin/OffersModal";
import { adminFetch, todayIST, formatMoney, formatDateTime } from "@/lib/adminClient";

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-[#052a50]/10 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#b08a28]">{label}</p>
      <p className="mt-2 text-3xl font-semibold sm:text-4xl">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  // Dates are set in the browser (not during prerender).
  const [today, setToday] = useState(null);
  const [date, setDate] = useState(null);

  const [stats, setStats] = useState(null);
  // Each result remembers which date/page it belongs to; "loading" is
  // simply "the result we have isn't for what's selected yet".
  const [roomsState, setRoomsState] = useState({ date: null, rooms: [], error: "" });
  const [page, setPage] = useState(1);
  const [bookingsState, setBookingsState] = useState({ page: null, data: null, error: "" });

  const [openBookingId, setOpenBookingId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [offersOpen, setOffersOpen] = useState(false);
  const roomsRequest = useRef(0);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.replace("/admin/login");
    }
  }, [router]);

  // 1. Session check + automatic logout when the 24-hour session ends.
  useEffect(() => {
    let timer;
    let interval;
    adminFetch("/api/admin/session")
      .then((s) => {
        const now = todayIST();
        setToday(now);
        setDate(now);
        setSession(s);
        const expiresAt = new Date(s.expiresAt).getTime();
        const check = () => Date.now() >= expiresAt && logout();
        timer = setTimeout(check, Math.max(0, expiresAt - Date.now()) + 500);
        interval = setInterval(check, 60 * 1000); // covers sleep / background tabs
      })
      .catch(() => {});
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [logout]);

  const loadStats = useCallback(() => {
    adminFetch("/api/admin/stats").then(setStats).catch(() => {});
  }, []);

  const loadRooms = useCallback((forDate) => {
    const id = ++roomsRequest.current;
    adminFetch(`/api/admin/rooms?date=${forDate}`)
      .then((d) => id === roomsRequest.current && setRoomsState({ date: forDate, rooms: d.rooms, error: "" }))
      .catch((e) => id === roomsRequest.current && setRoomsState((prev) => ({ ...prev, date: forDate, error: e.message })));
  }, []);

  const loadBookings = useCallback((forPage) => {
    adminFetch(`/api/admin/bookings?page=${forPage}`)
      .then((d) => setBookingsState({ page: forPage, data: d, error: "" }))
      .catch((e) => setBookingsState((prev) => ({ ...prev, page: forPage, error: e.message })));
  }, []);

  useEffect(() => {
    if (session) loadStats();
  }, [session, loadStats]);

  useEffect(() => {
    if (session && date) loadRooms(date);
  }, [session, date, loadRooms]);

  useEffect(() => {
    if (session) loadBookings(page);
  }, [session, page, loadBookings]);

  function handleCancelled(bookingId) {
    setCancelTarget(null);
    setOpenBookingId(null);
    setNotice(`Booking ${bookingId} was cancelled and its rooms released.`);
    loadStats();
    loadRooms(date);
    loadBookings(page);
  }

  if (!session || !date) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
        <p className="text-sm opacity-60">Checking your session…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8 lg:px-12" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#b08a28]">SU VILLA</p>
            <h1 className="font-display text-4xl sm:text-5xl">Admin Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs leading-5 opacity-70">
              <p>Signed in as <strong>{session.username}</strong></p>
              <p>Auto sign-out {formatDateTime(session.expiresAt)}</p>
            </div>
            <button type="button" onClick={() => setOffersOpen(true)}
              className="rounded-xl bg-[#052a50] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e4b441] hover:text-[#052a50]">
              Offers
            </button>
            <button type="button" onClick={logout}
              className="rounded-xl border border-[#052a50]/20 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#e4b441]">
              Log out
            </button>
          </div>
        </header>

        {notice && (
          <div role="status" className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} className="font-semibold" aria-label="Dismiss">×</button>
          </div>
        )}

        {/* Stats */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total bookings" value={stats ? stats.totalBookings : "—"}
            hint={stats?.cancelledBookings ? `${stats.cancelledBookings} cancelled` : "All time"} />
          <StatCard label="Active bookings" value={stats ? stats.activeBookings : "—"} hint="Upcoming and in-house" />
          <StatCard label="Amount collected" value={stats ? formatMoney(stats.amountCollected) : "—"} hint="Confirmed bookings" />
        </section>

        {/* Calendar + rooms */}
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(300px,380px)_1fr]">
          <AdminCalendar value={date} today={today} onChange={setDate} />
          <RoomStatusGrid
            date={date}
            rooms={roomsState.rooms}
            loading={roomsState.date !== date}
            error={roomsState.date === date ? roomsState.error : ""}
            isPast={date < today}
            onChanged={() => loadRooms(date)}
            onOpenBooking={setOpenBookingId}
          />
        </section>

        {/* Bookings list */}
        <div className="mt-8">
          <BookingsTable
            data={bookingsState.data}
            loading={bookingsState.page !== page}
            error={bookingsState.page === page ? bookingsState.error : ""}
            onPage={setPage}
            onOpen={setOpenBookingId}
            onCancel={setCancelTarget}
          />
        </div>
      </div>

      <BookingDetailsModal
        bookingId={cancelTarget ? null : openBookingId}
        onClose={() => setOpenBookingId(null)}
        onRequestCancel={(b) => setCancelTarget({ bookingId: b.bookingId, name: b.guest?.name || b.name })}
      />
      <OffersModal isOpen={offersOpen} onClose={() => setOffersOpen(false)} />
      {cancelTarget && (
        <PinDialog booking={cancelTarget} onClose={() => setCancelTarget(null)} onCancelled={handleCancelled} />
      )}
    </main>
  );
}
