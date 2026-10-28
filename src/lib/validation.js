import "server-only";
import { RequestError } from "@/lib/security";

export const MAX_NIGHTS = 10;
export const MAX_ADVANCE_DAYS = 365;

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getStayDates(checkIn, checkOut) {
  const dates = [];
  const current = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  while (current < end && dates.length <= MAX_NIGHTS + 1) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** Today's date at the resort (IST), not the server's timezone. */
export function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Validates a stay and returns its nightly dates, or throws RequestError.
 */
export function validateStay(checkIn, checkOut) {
  if (!isValidDate(checkIn) || !isValidDate(checkOut) || checkOut <= checkIn) {
    throw new RequestError("Please provide valid check-in and check-out dates.");
  }
  const today = todayInIndia();
  if (checkIn < today) throw new RequestError("Check-in cannot be in the past.");
  if (checkIn > addDays(today, MAX_ADVANCE_DAYS)) {
    throw new RequestError("Bookings open up to one year in advance.");
  }
  const stayDates = getStayDates(checkIn, checkOut);
  if (stayDates.length < 1 || stayDates.length > MAX_NIGHTS) {
    throw new RequestError(`Your stay must be between 1 and ${MAX_NIGHTS} nights.`);
  }
  return stayDates;
}

/* ------------------------------------------------------------------ */
/* Customer details                                                    */
/* ------------------------------------------------------------------ */

// Strip control characters and trim; cap length.
function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

/**
 * Aadhaar: never store the full number. Keep only the last four digits
 * (UIDAI rules + DPDP Act). Verify the physical ID at check-in instead.
 */
export function maskAadhaar(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 12) return "";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function validateCustomerDetails(details) {
  if (!details || typeof details !== "object") {
    throw new RequestError("Complete all required customer details.");
  }

  const name = clean(details.name, 100);
  const email = clean(details.email, 254).toLowerCase();
  const phoneDigits = String(details.phone || "").replace(/\D/g, "");
  const phone = phoneDigits.length === 12 && phoneDigits.startsWith("91")
    ? phoneDigits.slice(2)
    : phoneDigits;
  const address = clean(details.address, 300);
  const city = clean(details.city, 80);
  const pincode = clean(details.pincode, 6);
  const special = clean(details.specialRequests ?? details.specialRequest, 500);

  if (!name || name.length < 2) throw new RequestError("Please enter your full name.");
  if (!EMAIL_RE.test(email)) throw new RequestError("Please enter a valid email address.");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new RequestError("Please enter a valid 10-digit mobile number.");
  if (!address) throw new RequestError("Please enter your address.");
  if (!city) throw new RequestError("Please enter your city.");
  if (!/^[1-9]\d{5}$/.test(pincode)) throw new RequestError("Please enter a valid 6-digit PIN code.");

  return {
    name,
    email,
    phone: `+91${phone}`,
    address,
    city,
    pin_code: pincode,
    aadhar_number: maskAadhaar(details.aadharNumber),
    special_request: special,
  };
}
