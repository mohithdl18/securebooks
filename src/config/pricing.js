/**
 * SU VILLA — THE ONE PRICE LIST (INR).
 *
 * Both the website display AND the server's payment calculation read
 * this file, so what a guest sees is exactly what they're charged.
 *
 * Editing this file in the browser changes nothing: the server uses its
 * own copy when it creates the Razorpay order. To change a price, edit
 * here and redeploy.
 *
 * Weekend = the nights of Friday, Saturday and Sunday.
 * Weekday = the nights of Monday–Thursday.
 */
export const PRICES = Object.freeze({
  // Per room, per night
  roomPerNight: Object.freeze({ weekday: 12999, weekend: 13999 }),

  // Beyond the 2 guests included in each room, per night
  extraAdultPerNight: Object.freeze({ weekday: 4000, weekend: 4500 }),
  extraChildPerNight: Object.freeze({ weekday: 2000, weekend: 2500 }), // child 6–12; 0–5 free

  // Per person, per night
  meals: Object.freeze({
    lunch: 550,
    dinner: 650,
    lunchDinner: 1100,
  }),

  // Per driver, per night
  driverAccommodationPerNight: 1500,

  // Applied on (subtotal − discount)
  taxRate: 0.18,
  platformFeeRate: 0.02,

  includedGuestsPerRoom: 2,
  maxDrivers: 4,
});

/**
 * Whole-villa packages. Booking a package holds every listed room.
 * The price covers `baseGuests`; guests above that (up to `maxGuests`)
 * are charged the normal extra adult / child rates for that night.
 */
export const PACKAGES = Object.freeze({
  FullVilla: Object.freeze({
    id: "FullVilla",
    name: "Full Villa",
    roomIds: Object.freeze(["Room1", "Room2", "Room3", "Room4"]),
    baseGuests: 18,
    maxGuests: 22,
    pricePerNight: 100000,
  }),
  VillaWithoutCottage: Object.freeze({
    id: "VillaWithoutCottage",
    name: "Full Villa without Cottage",
    roomIds: Object.freeze(["Room1", "Room2", "Room3"]),
    baseGuests: 16,
    maxGuests: 19,
    pricePerNight: 85000,
  }),
});

/** Shared rounding so the site and server always agree to the paisa. */
export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const isDateString = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * One entry per night of the stay: { date, weekend }.
 * A night is named by the date you sleep there (the check-in date of
 * that night). If dates aren't chosen yet, falls back to `fallbackNights`
 * weekday nights so the cards can still show a starting price.
 */
export function stayNights(checkIn, checkOut, fallbackNights = 1) {
  if (isDateString(checkIn) && isDateString(checkOut) && checkOut > checkIn) {
    const nights = [];
    const d = new Date(`${checkIn}T00:00:00.000Z`);
    const end = new Date(`${checkOut}T00:00:00.000Z`);
    while (d < end && nights.length < 400) {
      const day = d.getUTCDay(); // 0 Sun … 5 Fri, 6 Sat
      nights.push({ date: d.toISOString().slice(0, 10), weekend: day === 5 || day === 6 || day === 0 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return nights;
  }
  const n = Math.max(1, Math.floor(Number(fallbackNights) || 1));
  return Array.from({ length: n }, () => ({ date: null, weekend: false }));
}

const rateFor = (rate, weekend) => (weekend ? rate.weekend : rate.weekday);

function extrasFor(nights, extraAdults, extraChildren) {
  return nights.reduce(
    (sum, n) =>
      sum +
      extraAdults * rateFor(PRICES.extraAdultPerNight, n.weekend) +
      extraChildren * rateFor(PRICES.extraChildPerNight, n.weekend),
    0
  );
}

/** Price of one room for the whole stay, night by night. */
export function roomStayPrice({ checkIn, checkOut, nights: fallback = 1, extraAdults = 0, extraChildren = 0 }) {
  const nights = stayNights(checkIn, checkOut, fallback);
  const a = Math.max(0, Math.floor(Number(extraAdults) || 0));
  const c = Math.max(0, Math.floor(Number(extraChildren) || 0));
  const weekendNights = nights.filter((n) => n.weekend).length;
  const weekdayNights = nights.length - weekendNights;
  const base =
    weekdayNights * PRICES.roomPerNight.weekday + weekendNights * PRICES.roomPerNight.weekend;
  const extras = extrasFor(nights, a, c);
  return {
    nights: nights.length,
    weekdayNights,
    weekendNights,
    base: roundMoney(base),
    extras: roundMoney(extras),
    total: roundMoney(base + extras),
  };
}

/** Price of a whole-villa package for the whole stay. */
export function packageStayPrice({ packageId, checkIn, checkOut, nights: fallback = 1, extraAdults = 0, extraChildren = 0 }) {
  const pkg = PACKAGES[packageId];
  if (!pkg) return null;
  const nights = stayNights(checkIn, checkOut, fallback);
  const a = Math.max(0, Math.floor(Number(extraAdults) || 0));
  const c = Math.max(0, Math.floor(Number(extraChildren) || 0));
  const weekendNights = nights.filter((n) => n.weekend).length;
  const base = nights.length * pkg.pricePerNight;
  const extras = extrasFor(nights, a, c);
  return {
    nights: nights.length,
    weekdayNights: nights.length - weekendNights,
    weekendNights,
    base: roundMoney(base),
    extras: roundMoney(extras),
    total: roundMoney(base + extras),
  };
}

/** Subtotal → discount → tax → platform fee. Used by site and server. */
export function totalsFromSubtotal(subtotalRaw, promo = null) {
  const subtotal = roundMoney(subtotalRaw);
  const percent = promo ? Number(promo.percent) || 0 : 0;
  let discount = roundMoney(subtotal * (percent / 100));
  if (promo?.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  discount = Math.min(subtotal, discount);
  const taxable = roundMoney(Math.max(0, subtotal - discount));
  const tax = roundMoney(taxable * PRICES.taxRate);
  const platformFee = roundMoney(taxable * PRICES.platformFeeRate);
  return { subtotal, discountPercent: percent, discount, taxable, tax, platformFee, total: roundMoney(taxable + tax + platformFee) };
}

/** "₹12,999 weekdays · ₹13,999 weekends" */
export function rateLabel(rate, format) {
  return `${format(rate.weekday)} weekdays · ${format(rate.weekend)} weekends`;
}
