
import { PRICES } from "@/config/pricing";

/**
 * Display helpers. Prices come from src/config/pricing.js — the same
 * file the server uses to charge. Breakfast is complimentary.
 */
export const PRICING = {
  accommodation: {
    weekday: PRICES.roomPerNight, // single rate for every night
  },
  extraGuests: {
    adult: PRICES.extraAdultPerNight,
    child: PRICES.extraChildPerNight,
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

/**
 * Calculate additional guest charges before tax.
 */
export function calculateRoomPrice({
  basePrice = 0,
  extraAdults = 0,
  chargeableChildren = 0,
  nights = 1,
} = {}) {
  const validNights = Math.max(1, Number(nights) || 1);

  const nightlyPrice =
    Number(basePrice || 0) +
    Number(extraAdults || 0) * PRICING.extraGuests.adult +
    Number(chargeableChildren || 0) * PRICING.extraGuests.child;

  return nightlyPrice * validNights;
}

/**
 * Calculate meal costs before tax.
 */
export function calculateMealPrice({
  mealType = null,
  guests = 0,
  nights = 1,
} = {}) {
  if (!mealType || !(mealType in PRICING.meals)) {
    return 0;
  }

  return (
    PRICING.meals[mealType] *
    Math.max(0, Number(guests) || 0) *
    Math.max(1, Number(nights) || 1)
  );
}

/**
 * Calculate driver accommodation before tax.
 */
export function calculateDriverAccommodationPrice({
  drivers = 0,
  nights = 1,
} = {}) {
  return (
    Math.max(0, Number(drivers) || 0) *
    PRICING.driverAccommodation.perDriverPerNight *
    Math.max(1, Number(nights) || 1)
  );
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
