import "server-only";
import rooms from "@/data/rooms.json";
import { RequestError } from "@/lib/security";
import {
  PRICES,
  PACKAGES,
  roundMoney,
  roomStayPrice,
  packageStayPrice,
  totalsFromSubtotal,
  stayNights,
} from "@/config/pricing";

/**
 * SERVER-SIDE PRICE CALCULATION.
 * Uses the same price list and formulas the website displays
 * (src/config/pricing.js), but only the server's copy decides what
 * Razorpay charges. Nothing in the request body (prices, totals,
 * discounts) is ever used as a price.
 */
export const ADDON_RATES = {
  ...PRICES.meals,
  driverAccommodation: PRICES.driverAccommodationPerNight,
};
export const BASE_OCCUPANCY = PRICES.includedGuestsPerRoom;
export const MAX_DRIVERS = PRICES.maxDrivers;

const VALID_PLANS = ["", "lunch", "dinner", "lunchDinner"];
const round = roundMoney;
const roomName = (id) => rooms.find((r) => r.id === id)?.name || id;

function intInRange(value, min, max, label) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RequestError(`Invalid ${label}.`);
  }
  return n;
}

/** Validates a package choice. Returns the package definition. */
export function resolvePackage(packageSelection) {
  const pkg = PACKAGES[packageSelection?.packageId];
  if (!pkg) throw new RequestError("Invalid package selection.");
  return pkg;
}

/**
 * Either `roomSelections` (individual rooms) OR `packageSelection`
 * ({ packageId, extraAdults, extraChildren }) — never both.
 * @param promo  result of resolvePromo() or null
 */
export function quoteBooking({ roomSelections = null, packageSelection = null, checkIn, checkOut, addons = {}, promo = null, longWeekendDates = [] }) {
  const nightsList = stayNights(checkIn, checkOut, 1, longWeekendDates);
  const nights = nightsList.length;
  const longWeekendNights = nightsList.filter((n) => n.longWeekend).length;
  const weekendNights = nightsList.filter((n) => !n.longWeekend && n.weekend).length;

  let staySubtotal = 0;
  let totalOccupants = 0;
  let pricedRooms = [];
  let pricedPackage = null;

  if (packageSelection) {
    const pkg = resolvePackage(packageSelection);
    const maxExtras = pkg.maxGuests - pkg.baseGuests;
    const extraAdults = intInRange(packageSelection.extraAdults, 0, maxExtras, "number of extra adults");
    const extraChildren = intInRange(packageSelection.extraChildren, 0, maxExtras, "number of children");
    if (extraAdults + extraChildren > maxExtras) {
      throw new RequestError(`${pkg.name} allows at most ${pkg.maxGuests} guests.`);
    }
    const price = packageStayPrice({ packageId: pkg.id, checkIn, checkOut, extraAdults, extraChildren, longWeekendDates });
    totalOccupants = pkg.baseGuests + extraAdults + extraChildren;
    staySubtotal = price.total;
    pricedPackage = {
      packageId: pkg.id,
      name: pkg.name,
      roomIds: [...pkg.roomIds],
      nights,
      weekday_nights: price.weekdayNights,
      weekend_nights: price.weekendNights,
      long_weekend_nights: price.longWeekendNights,
      price_per_night: pkg.pricePerNight,
      base_guests: pkg.baseGuests,
      max_guests: pkg.maxGuests,
      extra_adults: extraAdults,
      chargeable_children: extraChildren,
      base_amount: price.base,
      extras_amount: price.extras,
      amount: price.total,
    };
    // Every room in the package is recorded (amount 0 — the package line
    // carries the price) so availability, admin and cancellation work.
    pricedRooms = pkg.roomIds.map((id) => ({
      roomId: id,
      roomName: roomName(id),
      check_in: checkIn,
      check_out: checkOut,
      nights,
      packageId: pkg.id,
      extra_adults: 0,
      chargeable_children: 0,
      amount: 0,
    }));
  } else {
    if (!Array.isArray(roomSelections) || !roomSelections.length) {
      throw new RequestError("Select at least one room.");
    }
    pricedRooms = roomSelections.map((selection) => {
      const room = rooms.find((r) => r.id === selection.roomId);
      if (!room) throw new RequestError("Invalid room selection.");

      const extraAdults = intInRange(selection.extraAdults, 0, 10, "number of extra adults");
      const extraChildren = intInRange(selection.extraChildren, 0, 10, "number of children");
      const occupants = BASE_OCCUPANCY + extraAdults + extraChildren;
      if (room.maxGuests && occupants > room.maxGuests) {
        throw new RequestError(`${room.name} allows at most ${room.maxGuests} guests.`);
      }
      totalOccupants += occupants;

      const price = roomStayPrice({ checkIn, checkOut, extraAdults, extraChildren, longWeekendDates });
      staySubtotal += price.total;

      return {
        roomId: room.id,
        roomName: room.name,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        weekday_nights: price.weekdayNights,
        weekend_nights: price.weekendNights,
        long_weekend_nights: price.longWeekendNights,
        nightly_rate: price.weekendNights || price.longWeekendNights ? null : PRICES.roomPerNight.weekday,
        extra_adults: extraAdults,
        chargeable_children: extraChildren,
        amount: price.total,
      };
    });
  }

  const mealPlan = typeof addons.mealPlan === "string" ? addons.mealPlan : "";
  const driverMealPlan = typeof addons.driverMealPlan === "string" ? addons.driverMealPlan : "";
  if (!VALID_PLANS.includes(mealPlan) || !VALID_PLANS.includes(driverMealPlan)) {
    throw new RequestError("Invalid add-on selection.");
  }

  const mealGuests = mealPlan
    ? intInRange(addons.mealGuests, 0, Math.max(50, totalOccupants), "number of meal guests")
    : 0;
  const drivers = intInRange(addons.drivers, 0, MAX_DRIVERS, "number of drivers");

  const meal = mealPlan ? ADDON_RATES[mealPlan] * mealGuests * nights : 0;
  const driverStay = drivers * ADDON_RATES.driverAccommodation * nights;
  const driverMeals =
    driverMealPlan && drivers > 0 ? ADDON_RATES[driverMealPlan] * drivers * nights : 0;

  const totals = totalsFromSubtotal(staySubtotal + meal + driverStay + driverMeals, promo);

  return {
    nights,
    weekday_nights: nights - weekendNights - longWeekendNights,
    weekend_nights: weekendNights,
    long_weekend_nights: longWeekendNights,
    long_weekend_dates: nightsList.filter((n) => n.longWeekend).map((n) => n.date),
    guests: totalOccupants,
    package: pricedPackage,
    rooms: pricedRooms,
    roomSubtotal: round(staySubtotal),
    addons: {
      mealPlan,
      mealGuests,
      drivers,
      driverMealPlan: drivers > 0 ? driverMealPlan : "",
      mealSubtotal: round(meal),
      driverAccommodation: round(driverStay),
      driverMeals: round(driverMeals),
      total: round(meal + driverStay + driverMeals),
    },
    subtotal: totals.subtotal,
    promoCode: promo ? promo.code : null,
    discountPercent: totals.discountPercent,
    discount: totals.discount,
    tax: totals.tax,
    platformFee: totals.platformFee,
    total: totals.total,
  };
}

export const LONG_WEEKENDS_COLLECTION = "long_weekends";

/**
 * Nights in [fromDate, toDate) that the admin marked as long weekend.
 * Stored in the `long_weekends` collection: one document per night,
 * { _id: "YYYY-MM-DD", date: "YYYY-MM-DD", created_by, created_at }.
 * Nights switched on before this collection existed (a `long_weekend`
 * flag on room_availabilty) still count.
 */
export async function getLongWeekendDates(db, fromDate, toDate) {
  const range = { $gte: fromDate, $lt: toDate };
  const [current, legacy] = await Promise.all([
    db.collection(LONG_WEEKENDS_COLLECTION).find({ date: range }, { projection: { _id: 0, date: 1 } }).toArray(),
    db.collection("room_availabilty").find({ date: range, long_weekend: true }, { projection: { _id: 0, date: 1 } }).toArray(),
  ]);
  return [...new Set([...current, ...legacy].map((d) => d.date))].sort();
}
