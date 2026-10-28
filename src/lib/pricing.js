import "server-only";
import rooms from "@/data/rooms.json";
import { RequestError } from "@/lib/security";
import { getStayDates } from "@/lib/validation";

import { PRICES, roundMoney } from "@/config/pricing";

/**
 * SERVER-SIDE PRICE CALCULATION.
 * Uses the same price list the website displays (src/config/pricing.js),
 * but only the server's copy decides what Razorpay charges. Nothing in
 * the request body (prices, totals, discounts) is ever used as a price.
 */
export const ROOM_RATE = PRICES.roomPerNight;
export const EXTRA_ADULT_RATE = PRICES.extraAdultPerNight;
export const EXTRA_CHILD_RATE = PRICES.extraChildPerNight;
export const ADDON_RATES = {
  ...PRICES.meals,
  driverAccommodation: PRICES.driverAccommodationPerNight,
};
export const TAX_RATE = PRICES.taxRate;
export const PLATFORM_FEE_RATE = PRICES.platformFeeRate;
export const BASE_OCCUPANCY = PRICES.includedGuestsPerRoom;
export const MAX_DRIVERS = PRICES.maxDrivers;

const VALID_PLANS = ["", "lunch", "dinner", "lunchDinner"];
const round = roundMoney;

function intInRange(value, min, max, label) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RequestError(`Invalid ${label}.`);
  }
  return n;
}

/**
 * @param promo  result of resolvePromo() or null
 */
export function quoteBooking({ roomSelections, checkIn, checkOut, addons = {}, promo = null }) {
  const nights = getStayDates(checkIn, checkOut).length;

  let roomSubtotal = 0;
  let totalOccupants = 0;

  const pricedRooms = roomSelections.map((selection) => {
    const room = rooms.find((r) => r.id === selection.roomId);
    const base = ROOM_RATE;
    if (!room) throw new RequestError("Invalid room selection.");

    const extraAdults = intInRange(selection.extraAdults, 0, 10, "number of extra adults");
    const extraChildren = intInRange(selection.extraChildren, 0, 10, "number of children");
    const occupants = BASE_OCCUPANCY + extraAdults + extraChildren;
    if (room.maxGuests && occupants > room.maxGuests) {
      throw new RequestError(`${room.name} allows at most ${room.maxGuests} guests.`);
    }
    totalOccupants += occupants;

    const amount = round(
      (base + extraAdults * EXTRA_ADULT_RATE + extraChildren * EXTRA_CHILD_RATE) * nights
    );
    roomSubtotal += amount;

    return {
      roomId: room.id,
      roomName: room.name,
      check_in: checkIn,
      check_out: checkOut,
      nights,
      nightly_rate: base,
      extra_adults: extraAdults,
      chargeable_children: extraChildren,
      amount,
    };
  });

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

  const subtotal = round(roomSubtotal + meal + driverStay + driverMeals);
  const discountPercent = promo ? promo.percent : 0;
  let discount = round(subtotal * (discountPercent / 100));
  if (promo?.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
  const taxable = round(subtotal - discount);
  const tax = round(taxable * TAX_RATE);
  const platformFee = round(taxable * PLATFORM_FEE_RATE);

  return {
    nights,
    rooms: pricedRooms,
    roomSubtotal: round(roomSubtotal),
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
    subtotal,
    promoCode: promo ? promo.code : null,
    discountPercent,
    discount,
    tax,
    platformFee,
    total: round(taxable + tax + platformFee),
  };
}
