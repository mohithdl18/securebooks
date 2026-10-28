/**
 * SU VILLA — THE ONE PRICE LIST (INR).
 *
 * Both the website display AND the server's payment calculation read
 * this file, so what a guest sees is exactly what they're charged.
 *
 * Editing this file in the browser changes nothing: the server uses its
 * own copy when it creates the Razorpay order. To change a price, edit
 * here and redeploy.
 */
export const PRICES = Object.freeze({
  // Per room, per night (all rooms, every night)
  roomPerNight: 12999,

  // Beyond the 2 guests included in each room, per night
  extraAdultPerNight: 4000,
  extraChildPerNight: 2000, // child aged 6–12; 0–5 free

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

/** Shared rounding so the site and server always agree to the paisa. */
export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
