/**
 * Builds the line items shown on invoices, the confirmation email and
 * the admin booking window — one place, so they always match.
 * Input: booking details from toDetails() (src/lib/adminData.js).
 */
const MEAL_LABEL = { lunch: "Lunch", dinner: "Dinner", lunchDinner: "Lunch + Dinner" };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function nightsText(weekday, weekend, total) {
  if (weekday == null && weekend == null) return plural(total || 0, "night", "nights");
  const parts = [];
  if (weekday) parts.push(plural(weekday, "weekday night", "weekday nights"));
  if (weekend) parts.push(plural(weekend, "weekend night", "weekend nights"));
  return parts.join(" + ") || plural(total || 0, "night", "nights");
}

function extrasText(adults, children) {
  return [
    adults ? `+${plural(adults, "extra adult", "extra adults")}` : "",
    children ? `+${plural(children, "child", "children")}` : "",
  ].filter(Boolean);
}

/**
 * @param b      booking details
 * @param money  (amount) => string
 * @param sep    separator between detail parts
 * @returns [{ label, sub, amount }]
 */
export function invoiceLines(b, money, sep = " · ") {
  const p = b.pricing || {};
  const a = p.addons || {};
  const nights = p.nights || b.nights || 1;
  const lines = [];

  if (b.packageLine) {
    const k = b.packageLine;
    lines.push({
      label: `${k.name} (whole villa)`,
      sub: [
        `${plural(k.nights, "night", "nights")} × ${money(k.pricePerNight)} for ${k.baseGuests} guests`,
        k.rooms?.length ? `Includes ${k.rooms.join(", ")}` : "",
        ...extrasText(k.extraAdults, k.children),
      ].filter(Boolean).join(sep),
      amount: k.amount,
    });
  } else {
    for (const r of b.roomLines || []) {
      lines.push({
        label: r.roomName,
        sub: [
          r.nightlyRate && !r.weekendNights
            ? `${plural(r.nights, "night", "nights")} × ${money(r.nightlyRate)}`
            : nightsText(r.weekdayNights, r.weekendNights, r.nights),
          ...extrasText(r.extraAdults, r.children),
        ].join(sep),
        amount: r.amount,
      });
    }
  }

  if (a.mealSubtotal > 0)
    lines.push({ label: `Meals — ${MEAL_LABEL[a.mealPlan] || ""}`, sub: `${a.mealGuests} guests × ${plural(nights, "night", "nights")}`, amount: a.mealSubtotal });
  if (a.driverAccommodation > 0)
    lines.push({ label: "Driver accommodation", sub: `${a.drivers} × ${plural(nights, "night", "nights")}`, amount: a.driverAccommodation });
  if (a.driverMeals > 0)
    lines.push({ label: `Driver meals — ${MEAL_LABEL[a.driverMealPlan] || ""}`, sub: `${a.drivers} × ${plural(nights, "night", "nights")}`, amount: a.driverMeals });

  return lines;
}

/** Total people staying, for summaries. */
export function guestSummary(b, includedPerRoom = 2) {
  if (b.packageLine) {
    const k = b.packageLine;
    const total = k.baseGuests + (k.extraAdults || 0) + (k.children || 0);
    return plural(total, "guest", "guests");
  }
  const adults = (b.roomLines || []).reduce((t, r) => t + includedPerRoom + (r.extraAdults || 0), 0);
  const children = (b.roomLines || []).reduce((t, r) => t + (r.children || 0), 0);
  return `${plural(adults, "adult", "adults")}${children ? `, ${plural(children, "child", "children")}` : ""}`;
}
