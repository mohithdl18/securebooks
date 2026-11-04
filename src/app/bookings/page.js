
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ToolBar from "@/components/Bookings/ToolBar";
import RoomsCard from "@/components/Bookings/RoomsCard";
import PackagesCard from "@/components/Bookings/PackagesCard";
import Cart from "@/components/Bookings/Cart";
import OffersButton from "@/components/Bookings/OffersButton";
import { ALL_PACKAGES } from "@/logic/packageAvailability";
import { useLongWeekendDates } from "@/logic/useLongWeekendDates";
import {
  initializeTempID,
  updateBookingDates,
  updateBookingRooms,
  startTemporaryHold,
  clearHoldExpiry,
} from "@/logic/Data";

const TEMP_HOLD_DURATION_MS = 10 * 60 * 1000;

function calculateNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;

  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);

  return Math.max(
    1,
    Math.round((end - start) / (24 * 60 * 60 * 1000))
  );
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function BookingsPage() {
  const [dates, setDates] = useState({
    checkIn: "",
    checkOut: "",
  });

  const [view, setView] = useState("rooms");
  const longWeekendDates = useLongWeekendDates(dates.checkIn, dates.checkOut);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [selectedRoomData, setSelectedRoomData] = useState([]);
  const [selectedPackageIds, setSelectedPackageIds] = useState([]);
  // The chosen package with its extra-guest counts (one package at a time).
  const [selectedPackageData, setSelectedPackageData] = useState(null);
  const [isHoldingPackage, setIsHoldingPackage] = useState(false);

  const [availableRoomIds, setAvailableRoomIds] = useState(null);
  // Nights in the chosen stay that the resort marked as long weekend
  // (fetched directly from the server — same lookup the payment uses).
  const [, setLongWeekendDates] = useState([]);
  const [isCheckingAvailability, setIsCheckingAvailability] =
    useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [isFixed, setIsFixed] = useState(false);

  // Each selected room has its own server-confirmed expiry timestamp.
  const [holdExpiries, setHoldExpiries] = useState({});
  const [remainingHoldTime, setRemainingHoldTime] = useState(0);
  const [holdError, setHoldError] = useState("");
  const [isSelectingRoom, setIsSelectingRoom] = useState(false);

  const toolbarRef = useRef(null);
  const requestIdRef = useRef(0);
  const tempIDRef = useRef(null);
  const selectedRoomIdsRef = useRef([]);
  const selectedPackageIdsRef = useRef([]);
  const holdExpiriesRef = useRef({});
  const datesRef = useRef(dates);
  const isMountedRef = useRef(false);
  const selectionLocksRef = useRef(new Set());

  useEffect(() => {
    tempIDRef.current = initializeTempID();
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedRoomIdsRef.current = selectedRoomIds;
  }, [selectedRoomIds]);

  useEffect(() => {
    selectedPackageIdsRef.current = selectedPackageIds;
  }, [selectedPackageIds]);

  useEffect(() => {
    holdExpiriesRef.current = holdExpiries;
  }, [holdExpiries]);

  useEffect(() => {
    datesRef.current = dates;
  }, [dates]);

  // Keep the shared booking data synchronized.
  useEffect(() => {
    if (dates.checkIn && dates.checkOut) {
      updateBookingDates(dates.checkIn, dates.checkOut);
    }
  }, [dates.checkIn, dates.checkOut]);

  useEffect(() => {
    updateBookingRooms(selectedRoomData);
  }, [selectedRoomData]);

  // Release temporary holds through the server.
  // Pass roomId to release one room, or omit it to release all rooms.
  const releaseTemporaryHolds = useCallback(async (roomId = null) => {
    const tempID = tempIDRef.current || initializeTempID();

    try {
      const response = await fetch("/api/Bookings/TempBooks", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          TempID: tempID,
          ...(roomId ? { roomId } : {}),
        }),
        keepalive: true,
      });

      if (!response.ok) {
        console.error("Unable to release temporary room hold.");
      }
    } catch (error) {
      console.error("Temporary hold release failed:", error);
    }
  }, []);

  // Re-check pricing nights when the guest comes back to the tab, so a
  // long weekend switched on in the admin shows without a manual search.
  // Runs quietly: no loading state, selections and holds are untouched.
  useEffect(() => {
    let lastRun = 0;

    async function refreshPricingNights() {
      const { checkIn, checkOut } = datesRef.current;
      if (!checkIn || !checkOut || document.visibilityState !== "visible") return;
      if (Date.now() - lastRun < 5000) return;
      lastRun = Date.now();

      const requestId = requestIdRef.current;
      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkIn, checkOut, TempID: tempIDRef.current || "" }),
        });
        const result = await response.json().catch(() => ({}));
        // Ignore if the dates changed or a full search started meanwhile.
        if (
          !response.ok ||
          !result.success ||
          requestId !== requestIdRef.current ||
          datesRef.current.checkIn !== checkIn ||
          datesRef.current.checkOut !== checkOut ||
          !isMountedRef.current
        ) {
          return;
        }
        setLongWeekendDates(Array.isArray(result.longWeekendDates) ? result.longWeekendDates : []);
        if (Array.isArray(result.availableRoomIds)) setAvailableRoomIds(result.availableRoomIds);
      } catch {
        // Next full search will catch up.
      }
    }

    window.addEventListener("focus", refreshPricingNights);
    document.addEventListener("visibilitychange", refreshPricingNights);
    return () => {
      window.removeEventListener("focus", refreshPricingNights);
      document.removeEventListener("visibilitychange", refreshPricingNights);
    };
  }, []);

  // Keep the toolbar's existing sticky behavior.
  useEffect(() => {
    function handleScroll() {
      if (!toolbarRef.current) return;

      const top = toolbarRef.current.getBoundingClientRect().top;
      setIsFixed(top <= 10);
    }

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleAvailabilitySearch = useCallback(
    async ({ checkIn, checkOut, mode } = {}) => {
      if (!checkIn || !checkOut || checkOut <= checkIn) {
        setAvailabilityError(
          "Please select a valid check-in and check-out date."
        );
        return;
      }

      const previousDates = datesRef.current;

      const datesChanged =
        previousDates.checkIn !== checkIn ||
        previousDates.checkOut !== checkOut;

      // Release previous holds when the stay dates change.
      if (
        datesChanged &&
        Object.keys(holdExpiriesRef.current).length > 0
      ) {
        await releaseTemporaryHolds();

        if (!isMountedRef.current) return;

        setSelectedRoomIds([]);
        setSelectedRoomData([]);
        selectedRoomIdsRef.current = [];
        setHoldExpiries({});
        holdExpiriesRef.current = {};
        setRemainingHoldTime(0);
        clearHoldExpiry();
      }

      setDates({ checkIn, checkOut });
      datesRef.current = { checkIn, checkOut };

      updateBookingDates(checkIn, checkOut);

      // Packages need the same availability + pricing check as rooms
      // (it used to return early here, leaving prices out of date).
      if (mode === "packages") {
        setView("packages");
      }

      const requestId = ++requestIdRef.current;

      setIsCheckingAvailability(true);
      setAvailabilityError("");
      setHoldError("");
      setAvailableRoomIds(null);
      setLongWeekendDates([]);

      // Changing dates invalidates selected rooms and packages.
      if (datesChanged) {
        setSelectedRoomIds([]);
        setSelectedRoomData([]);
        setSelectedPackageIds([]);
        setSelectedPackageData(null);
        selectedRoomIdsRef.current = [];
      }

      try {
        const tempID = tempIDRef.current || initializeTempID();

        const response = await fetch("/api/availability", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            checkIn,
            checkOut,
            TempID: tempID,
          }),
        });

        const result = await response.json();

        if (requestId !== requestIdRef.current) return;

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || "Unable to check room availability."
          );
        }

        setLongWeekendDates(
          Array.isArray(result.longWeekendDates) ? result.longWeekendDates : []
        );

        setAvailableRoomIds(
          Array.isArray(result.availableRoomIds)
            ? result.availableRoomIds
            : []
        );
      } catch (error) {
        if (requestId !== requestIdRef.current) return;

        console.error("Availability check failed:", error);

        setAvailabilityError(
          error.message ||
          "Unable to check availability. Please try again."
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setIsCheckingAvailability(false);
        }
      }
    },
    [releaseTemporaryHolds]
  );

  // On first load, check the same stay the toolbar already shows
  // (tonight → tomorrow). Before this, room cards had no dates and always
  // showed the plain weekday price, ignoring weekend / long-weekend rates.
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    if (autoSearchedRef.current || datesRef.current.checkIn) return;
    autoSearchedRef.current = true;

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Deferred so it runs after mount, outside the effect body.
    const timer = setTimeout(() => {
      handleAvailabilitySearch({
        checkIn: formatLocalDate(today),
        checkOut: formatLocalDate(tomorrow),
        mode: "rooms",
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [handleAvailabilitySearch]);


  // Load today's and tomorrow's availability on the first visit.
  useEffect(() => {
    const today = new Date();
    const tomorrow = new Date(today);

    tomorrow.setDate(tomorrow.getDate() + 1);

    handleAvailabilitySearch({
      checkIn: formatLocalDate(today),
      checkOut: formatLocalDate(tomorrow),
      mode: "rooms",
    });

    return () => {
      requestIdRef.current += 1;
    };
  }, [handleAvailabilitySearch]);

  // Update the countdown using the earliest expiry among selected rooms.
  useEffect(() => {
    function updateCountdown() {
      const expiries = Object.values(holdExpiriesRef.current);

      if (expiries.length === 0) {
        setRemainingHoldTime(0);
        return;
      }

      const earliestExpiry = Math.min(...expiries.map(Number));

      setRemainingHoldTime(
        Math.max(0, earliestExpiry - Date.now())
      );
    }

    updateCountdown();

    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [holdExpiries]);

  // Release holds only when their actual expiry timestamp has passed.
  useEffect(() => {
    const expiryValues = Object.values(holdExpiries);

    if (expiryValues.length === 0) return;

    const earliestExpiry = Math.min(
      ...expiryValues.map(Number)
    );

    if (!Number.isFinite(earliestExpiry)) {
      console.error("Invalid temporary hold expiry timestamp.");
      return;
    }

    if (Date.now() < earliestExpiry) return;

    let cancelled = false;

    async function expireSelection() {
      await releaseTemporaryHolds();

      if (cancelled || !isMountedRef.current) return;

      const hadPackage = selectedPackageIdsRef.current.length > 0;

      setSelectedRoomIds([]);
      setSelectedRoomData([]);
      selectedRoomIdsRef.current = [];

      setSelectedPackageIds([]);
      setSelectedPackageData(null);
      selectedPackageIdsRef.current = [];

      setHoldExpiries({});
      holdExpiriesRef.current = {};

      setRemainingHoldTime(0);
      clearHoldExpiry();

      setHoldError(
        hadPackage
          ? "Your 10-minute package hold has expired. Please select the package again."
          : "Your 10-minute room hold has expired. Please select your room again."
      );
    }

    expireSelection();

    return () => {
      cancelled = true;
    };
  }, [
    remainingHoldTime,
    holdExpiries,
    releaseTemporaryHolds,
  ]);

  // Release holds when the tab is refreshed or closed.
  // Server-side expiry remains the fallback.
  useEffect(() => {
    function handlePageHide() {
      if (Object.keys(holdExpiriesRef.current).length === 0) {
        return;
      }

      const tempID = tempIDRef.current;

      if (!tempID) return;

      fetch("/api/Bookings/TempBooks", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          TempID: tempID,
        }),
        keepalive: true,
      }).catch(() => {
        // Server-side expiry will release abandoned holds.
      });
    }

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  // Select or deselect a room.
  // The backend must confirm every new temporary hold.
  async function handleRoomSelection(room) {
    if (
      !room?.id ||
      !datesRef.current.checkIn ||
      !datesRef.current.checkOut
    ) {
      return;
    }

    const roomId = room.id;
    const isSelected = selectedRoomIdsRef.current.includes(roomId);

    if (selectionLocksRef.current.has(roomId)) return;

    selectionLocksRef.current.add(roomId);
    setIsSelectingRoom(true);
    setHoldError("");

    try {
      // A package and individual rooms can't be combined: picking a room
      // releases the package's holds first.
      if (selectedPackageIdsRef.current.length > 0) {
        await releaseTemporaryHolds();
        if (!isMountedRef.current) return;
        selectedPackageIdsRef.current = [];
        setSelectedPackageIds([]);
        setSelectedPackageData(null);
        holdExpiriesRef.current = {};
        setHoldExpiries({});
        setRemainingHoldTime(0);
        clearHoldExpiry();
      }

      if (isSelected) {
        await releaseTemporaryHolds(roomId);

        if (!isMountedRef.current) return;

        setSelectedRoomIds((previous) =>
          previous.filter((id) => id !== roomId)
        );

        setSelectedRoomData((previous) =>
          previous.filter((item) => item.id !== roomId)
        );

        const remainingExpiries = {
          ...holdExpiriesRef.current,
        };

        delete remainingExpiries[roomId];

        holdExpiriesRef.current = remainingExpiries;
        setHoldExpiries(remainingExpiries);

        setSelectedPackageIds([]);
        setSelectedPackageData(null);

        selectedRoomIdsRef.current =
          selectedRoomIdsRef.current.filter(
            (id) => id !== roomId
          );

        if (Object.keys(remainingExpiries).length === 0) {
          setRemainingHoldTime(0);
          clearHoldExpiry();
        } else {
          startTemporaryHold(
            Math.min(...Object.values(remainingExpiries))
          );
        }

        return;
      }

      // Prevent selecting rooms that the latest availability result
      // marks as unavailable. The backend also validates the hold.
      if (
        availableRoomIds !== null &&
        !availableRoomIds.includes(roomId)
      ) {
        setHoldError(
          "This room is no longer available for your selected dates. Please check availability again."
        );
        return;
      }

      const tempID = tempIDRef.current || initializeTempID();

      const response = await fetch("/api/Bookings/TempBooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          TempID: tempID,
          roomId,
          checkIn: datesRef.current.checkIn,
          checkOut: datesRef.current.checkOut,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          "Unable to reserve this room temporarily."
        );
      }

      if (!isMountedRef.current) return;

      const expiresAt = result.expiresAt
        ? new Date(result.expiresAt).getTime()
        : Date.now() + TEMP_HOLD_DURATION_MS;

      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        throw new Error(
          "The temporary room hold has expired. Please select the room again."
        );
      }

      setSelectedRoomIds((previous) =>
        previous.includes(roomId)
          ? previous
          : [...previous, roomId]
      );

      setSelectedRoomData((previous) => [
        ...previous.filter((item) => item.id !== roomId),
        room,
      ]);

      selectedRoomIdsRef.current = [
        ...new Set([
          ...selectedRoomIdsRef.current,
          roomId,
        ]),
      ];

      const nextExpiries = {
        ...holdExpiriesRef.current,
        [roomId]: expiresAt,
      };

      holdExpiriesRef.current = nextExpiries;
      setHoldExpiries(nextExpiries);

      startTemporaryHold(
        Math.min(...Object.values(nextExpiries))
      );

      setSelectedPackageIds([]);
        setSelectedPackageData(null);
    } catch (error) {
      console.error("Room selection failed:", error);

      if (isMountedRef.current) {
        setHoldError(
          error.message ||
          "Unable to hold this room. Please try again."
        );
      }
    } finally {
      selectionLocksRef.current.delete(roomId);

      if (isMountedRef.current) {
        setIsSelectingRoom(
          selectionLocksRef.current.size > 0
        );
      }
    }
  }

  function handleRoomOccupancyChange(updatedRoom) {
    if (
      !updatedRoom ||
      !selectedRoomIds.includes(updatedRoom.id)
    ) {
      return;
    }

    setSelectedRoomData((previous) =>
      previous.map((room) =>
        room.id === updatedRoom.id ? updatedRoom : room
      )
    );
  }

  // Select or deselect a whole-villa package. Every room in the package
  // is held on the server (same 10-minute holds as single rooms); if any
  // one can't be held, nothing is kept.
  async function handlePackageSelection(pkg) {
    if (!pkg?.id) return;

    if (!datesRef.current.checkIn || !datesRef.current.checkOut) {
      setHoldError("Please choose your check-in and check-out dates first.");
      return;
    }

    if (isHoldingPackage) return;

    const alreadySelected = selectedPackageIdsRef.current.includes(pkg.id);

    setIsHoldingPackage(true);
    setHoldError("");

    try {
      // Release whatever is currently held (rooms or another package).
      if (
        Object.keys(holdExpiriesRef.current).length > 0 ||
        selectedRoomIdsRef.current.length > 0 ||
        selectedPackageIdsRef.current.length > 0
      ) {
        await releaseTemporaryHolds();
      }

      if (!isMountedRef.current) return;

      setSelectedRoomIds([]);
      setSelectedRoomData([]);
      selectedRoomIdsRef.current = [];
      setSelectedPackageIds([]);
      setSelectedPackageData(null);
      selectedPackageIdsRef.current = [];
      setHoldExpiries({});
      holdExpiriesRef.current = {};
      setRemainingHoldTime(0);
      clearHoldExpiry();

      // Clicking the selected package again just deselects it.
      if (alreadySelected) return;

      const tempID = tempIDRef.current || initializeTempID();
      const expiries = {};

      for (const roomId of pkg.roomIds) {
        const response = await fetch("/api/Bookings/TempBooks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            TempID: tempID,
            roomId,
            checkIn: datesRef.current.checkIn,
            checkOut: datesRef.current.checkOut,
          }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
          await releaseTemporaryHolds();
          throw new Error(
            response.status === 409
              ? `${pkg.name} is no longer available — one of its rooms was just booked or is being booked by another guest. Please try again in a few minutes or choose individual rooms.`
              : result.message || "Unable to hold this package. Please try again."
          );
        }

        const expiresAt = result.expiresAt
          ? new Date(result.expiresAt).getTime()
          : Date.now() + TEMP_HOLD_DURATION_MS;
        expiries[roomId] = Number.isFinite(expiresAt)
          ? expiresAt
          : Date.now() + TEMP_HOLD_DURATION_MS;
      }

      if (!isMountedRef.current) return;

      holdExpiriesRef.current = expiries;
      setHoldExpiries(expiries);
      startTemporaryHold(Math.min(...Object.values(expiries)));

      selectedPackageIdsRef.current = [pkg.id];
      setSelectedPackageIds([pkg.id]);
      setSelectedPackageData(pkg);
    } catch (error) {
      console.error("Package selection failed:", error);
      if (isMountedRef.current) {
        setHoldError(error.message || "Unable to hold this package. Please try again.");
      }
    } finally {
      if (isMountedRef.current) setIsHoldingPackage(false);
    }
  }

  function handlePackageOccupancyChange(updatedPackage) {
    if (!updatedPackage || !selectedPackageIdsRef.current.includes(updatedPackage.id)) {
      return;
    }
    setSelectedPackageData(updatedPackage);
  }

  async function handleClearCart() {
    await releaseTemporaryHolds();

    setSelectedRoomIds([]);
    setSelectedRoomData([]);
    setSelectedPackageIds([]);
        setSelectedPackageData(null);

    selectedRoomIdsRef.current = [];
    setHoldExpiries({});
    holdExpiriesRef.current = {};

    setRemainingHoldTime(0);
    setHoldError("");

    clearHoldExpiry();
    updateBookingRooms([]);
  }

  const handleViewChange = (newMode) => {
    setView(newMode);
    setAvailabilityError("");

    if (
      newMode === "packages" &&
      dates.checkIn &&
      dates.checkOut &&
      availableRoomIds === null &&
      !isCheckingAvailability
    ) {
      handleAvailabilitySearch({
        ...dates,
        mode: "rooms",
      });
    }
  };

  const nights = calculateNights(
    dates.checkIn,
    dates.checkOut
  );


  return (
    <main
      className="min-h-screen px-4 py-8 sm:px-8 lg:px-12"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1
            className="font-display text-4xl sm:text-5xl"
            style={{ color: "var(--foreground)" }}
          >
            Find Your Stay
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 opacity-75 sm:text-base">
            Choose your dates and discover a peaceful stay surrounded by
            nature at SU VILLA.
          </p>
        </header>

        <div ref={toolbarRef}>
          <div
            className={
              isFixed
                ? "fixed top-[10px] left-0 right-0 z-50"
                : ""
            }
          >
            <ToolBar
              onSearch={handleAvailabilitySearch}
              onModeChange={handleViewChange}
              initialCheckIn={dates.checkIn}
              initialCheckOut={dates.checkOut}
              initialMode={view}
            />
          </div>
        </div>

        <section className="mt-8">
          {view === "rooms" ? (
            <>
              <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">
                    Our Rooms
                  </h2>

                  <p className="mt-1 text-sm opacity-70">
                    Discover your perfect stay at SU VILLA.
                  </p>

                  {dates.checkIn && dates.checkOut && (
                    <p className="mt-2 text-sm opacity-75">
                      {dates.checkIn} to {dates.checkOut} · {nights}{" "}
                      {nights === 1 ? "night" : "nights"}
                    </p>
                  )}
                  {dates.checkIn && dates.checkOut && longWeekendDates.length > 0 && (
                    <p className="mt-2 inline-flex rounded-full border border-[#e4b441] bg-[#e4b441]/15 px-3 py-1 text-xs font-semibold">
                      Long weekend rates apply on{" "}
                      {longWeekendDates
                        .map((d) =>
                          new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        )
                        .join(", ")}
                    </p>
                  )}
                </div>

                {selectedRoomIds.length > 0 && (
                  <div className="text-sm font-medium">
                    <p>
                      {selectedRoomIds.length}{" "}
                      {selectedRoomIds.length === 1
                        ? "room"
                        : "rooms"}{" "}
                      selected
                    </p>

                    {remainingHoldTime > 0 && (
                      <p role="timer" className="mt-1">
                        Time remaining:{" "}
                        {formatCountdown(remainingHoldTime)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {holdError && (
                <div
                  className="mb-4 rounded-xl border p-4 text-sm"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(179, 67, 37, 0.3)",
                  }}
                  role="alert"
                >
                  {holdError}
                </div>
              )}

              {isSelectingRoom && (
                <p
                  className="mb-4 text-sm opacity-70"
                  role="status"
                >
                  Updating your room selection...
                </p>
              )}

              {isCheckingAvailability ? (
                <div
                  className="rounded-2xl border p-8 text-center"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(5, 42, 80, 0.12)",
                  }}
                  role="status"
                >
                  Checking room availability...
                </div>
              ) : availabilityError ? (
                <div
                  className="rounded-2xl border p-6 text-center"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(5, 42, 80, 0.15)",
                  }}
                  role="alert"
                >
                  <p>{availabilityError}</p>

                  <button
                    type="button"
                    onClick={() =>
                      handleAvailabilitySearch({
                        ...dates,
                        mode: "rooms",
                      })
                    }
                    className="mt-4 rounded-full px-5 py-2 font-medium"
                    style={{
                      backgroundColor: "var(--accent)",
                      color: "var(--foreground)",
                    }}
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                // Always render every room. RoomsCard handles availability
                // styling and disables rooms not returned by the API.
                <RoomsCard
                  selectedRoomIds={selectedRoomIds}
                  onSelectRoom={handleRoomSelection}
                  onOccupancyChange={handleRoomOccupancyChange}
                  nights={nights}
                  availableRoomIds={availableRoomIds}
                  checkIn={dates.checkIn}
                  checkOut={dates.checkOut}
                />
              )}
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold">
                  Stay Packages
                </h2>

                <p className="mt-1 text-sm opacity-70">
                  Book the whole villa. A package is available only when
                  every room in it is free for your selected dates.
                </p>

                {dates.checkIn && dates.checkOut && (
                  <p className="mt-2 text-sm opacity-75">
                    {dates.checkIn} to {dates.checkOut} · {nights}{" "}
                    {nights === 1 ? "night" : "nights"}
                  </p>
                )}

                {dates.checkIn && dates.checkOut && longWeekendDates.length > 0 && (
                  <p className="mt-2 inline-flex rounded-full border border-[#e4b441] bg-[#e4b441]/15 px-3 py-1 text-xs font-semibold">
                    Long weekend rates apply on{" "}
                    {longWeekendDates
                      .map((d) =>
                        new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                      )
                      .join(", ")}
                  </p>
                )}

                {selectedPackageIds.length > 0 && remainingHoldTime > 0 && (
                  <p role="timer" className="mt-2 text-sm font-medium">
                    Package held · Time remaining:{" "}
                    {formatCountdown(remainingHoldTime)}
                  </p>
                )}
              </div>

              {holdError && (
                <div
                  className="mb-4 rounded-xl border p-4 text-sm"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(179, 67, 37, 0.3)",
                  }}
                  role="alert"
                >
                  {holdError}
                </div>
              )}

              {isHoldingPackage && (
                <p className="mb-4 text-sm opacity-70" role="status">
                  Holding all rooms in this package...
                </p>
              )}

              {isCheckingAvailability ? (
                <div
                  className="rounded-2xl border p-8 text-center"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(5, 42, 80, 0.12)",
                  }}
                  role="status"
                >
                  Checking package availability...
                </div>
              ) : availabilityError ? (
                <div
                  className="rounded-2xl border p-6 text-center"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(5, 42, 80, 0.15)",
                  }}
                  role="alert"
                >
                  <p>{availabilityError}</p>

                  <button
                    type="button"
                    onClick={() =>
                      handleAvailabilitySearch({
                        ...dates,
                        mode: "rooms",
                      })
                    }
                    className="mt-4 rounded-full px-5 py-2 font-medium"
                    style={{
                      backgroundColor: "var(--accent)",
                      color: "var(--foreground)",
                    }}
                  >
                    Try Again
                  </button>
                </div>
              ) : availableRoomIds === null ? (
                <div
                  className="rounded-2xl border p-8 text-center"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(5, 42, 80, 0.12)",
                  }}
                >
                  Checking availability is required before packages
                  can be displayed.
                </div>
              ) : (
                <PackagesCard
                  packages={ALL_PACKAGES}
                  availableRoomIds={availableRoomIds}
                  selectedPackageIds={selectedPackageIds}
                  onSelectPackage={handlePackageSelection}
                  onOccupancyChange={handlePackageOccupancyChange}
                  nights={nights}
                  checkIn={dates.checkIn}
                  checkOut={dates.checkOut}
                  isBusy={isHoldingPackage}
                />
              )}
            </>
          )}
        </section>
      </div>


      <OffersButton />

      <Cart
        selectedRoomIds={selectedRoomIds}
        selectedRoomData={selectedRoomData}
        selectedPackageIds={selectedPackageIds}
        selectedPackageData={selectedPackageData}
        availableRoomIds={availableRoomIds}
        nights={nights}
        onClear={handleClearCart}
        tempID={tempIDRef.current || ""}
        checkIn={dates.checkIn}
        checkOut={dates.checkOut}
      />

    </main>
  );
}

// okayyy