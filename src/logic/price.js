
import {
  PRICES,
  PACKAGES,
  roomStayPrice,
  packageStayPrice,
  stayNights,
} from "@/config/pricing";

/**
 * Display helpers. All prices come from src/config/pricing.js — the same
 * file the server uses to charge. Breakfast is complimentary.
 * Weekend = Friday, Saturday and Sunday nights.
 */
export const PRICING = {
  accommodation: { ...PRICES.roomPerNight },
  extraGuests: {
    adult: { ...PRICES.extraAdultPerNight },
    child: { ...PRICES.extraChildPerNight },
    complimentaryChildMaxAge: 5,
  },
  meals: { ...PRICES.meals },
  driverAccommodation: {
    perDriverPerNight: PRICES.driverAccommodationPerNight,
  },
  tax: {
    rate: PRICES.taxRate,
    percentage: Math.round(PRICES.taxRate * 100),
  },
  platformFee: {
    rate: PRICES.platformFeeRate,
    percentage: Math.round(PRICES.platformFeeRate * 100),
  },
};

export { PACKAGES, roomStayPrice, packageStayPrice, stayNights };

/**
 * Room price for the stay (night-by-night weekday/weekend rates).
 * Pass checkIn/checkOut when known; otherwise `nights` weekday nights.
 */
export function calculateRoomPrice({
  checkIn = "",
  checkOut = "",
  nights = 1,
  extraAdults = 0,
  chargeableChildren = 0,
} = {}) {
  return roomStayPrice({
    checkIn,
    checkOut,
    nights,
    extraAdults,
    extraChildren: chargeableChildren,
  }).total;
}

/** "2 weekday + 1 weekend night" style summary. */
export function nightsBreakdown(price) {
  if (!price) return "";
  const parts = [];
  if (price.weekdayNights)
    parts.push(`${price.weekdayNights} weekday ${price.weekdayNights === 1 ? "night" : "nights"}`);
  if (price.weekendNights)
    parts.push(`${price.weekendNights} weekend ${price.weekendNights === 1 ? "night" : "nights"}`);
  return parts.join(" + ");
}

/** "₹4,000 weekdays · ₹4,500 weekends" */
export function weekdayWeekendLabel(rate) {
  return `${formatPrice(rate.weekday)} weekdays · ${formatPrice(rate.weekend)} weekends`;
}

/**
 * Format an amount in Indian Rupees.
 */
export function formatPrice(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}
