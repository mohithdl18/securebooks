
"use client";

import { useState } from "react";
import Image from "next/image";
import RoomsModal from "./RoomsModal";
import {
  PRICING,
  packageStayPrice,
  nightsBreakdown,
  weekdayWeekendLabel,
  formatPrice,
} from "@/logic/price";
import { isPackageAvailable } from "@/logic/packageAvailability";

/**
 * Whole-villa packages, laid out exactly like RoomsCard.
 * A package is shown as SOLD OUT unless every room in it is available.
 */
export default function PackagesCard({
  packages = [],
  onSelectPackage,
  onOccupancyChange,
  selectedPackageIds = [],
  nights = 1,
  availableRoomIds = null,
  checkIn = "",
  checkOut = "",
  isBusy = false,
}) {
  const [occupancy, setOccupancy] = useState({});
  const [activePackage, setActivePackage] = useState(null);

  const stayNights = Math.max(1, Number(nights) || 1);

  const guestsFor = (id) => occupancy[id] || { adults: 0, children: 0 };

  const priceFor = (pkg, guests) =>
    packageStayPrice({
      packageId: pkg.id,
      checkIn,
      checkOut,
      nights: stayNights,
      extraAdults: guests.adults,
      extraChildren: guests.children,
    });

  const withOccupancy = (pkg, guests) => {
    const price = priceFor(pkg, guests);
    return {
      ...pkg,
      extraAdults: guests.adults,
      extraChildren: guests.children,
      totalGuests: pkg.baseGuests + guests.adults + guests.children,
      nights: stayNights,
      totalPrice: price.total,
    };
  };

  const updateOccupancy = (pkg, type, change) => {
    if (!isPackageAvailable(pkg, availableRoomIds)) return;
    const current = guestsFor(pkg.id);
    const nextValue = Math.max(0, current[type] + change);
    const other = type === "adults" ? current.children : current.adults;
    if (pkg.baseGuests + nextValue + other > pkg.maxGuests) return;

    const updated = { ...current, [type]: nextValue };
    setOccupancy((previous) => ({ ...previous, [pkg.id]: updated }));

    if (selectedPackageIds.includes(pkg.id)) {
      onOccupancyChange?.(withOccupancy(pkg, updated));
    }
  };

  if (!packages.length) return null;

  return (
    <section className="w-full">
      <div className="flex flex-col gap-6">
        {packages.map((pkg) => {
          const isAvailable = isPackageAvailable(pkg, availableRoomIds);
          const isSelected = selectedPackageIds.includes(pkg.id);
          const guests = guestsFor(pkg.id);
          const stayPrice = priceFor(pkg, guests);
          const atMax = pkg.baseGuests + guests.adults + guests.children >= pkg.maxGuests;

          return (
            <article
              key={pkg.id}
              aria-disabled={!isAvailable}
              className={`grid w-full grid-cols-1 overflow-hidden rounded-2xl border shadow-sm transition-colors lg:grid-cols-2 ${
                !isAvailable
                  ? "border-gray-300 bg-gray-100 opacity-75"
                  : isSelected
                    ? "border-[#e4b441] bg-white ring-2 ring-[#e4b441]/40"
                    : "border-[#052a50]/10 bg-white"
              }`}
            >
              {/* LEFT COLUMN: PACKAGE INFORMATION */}
              <div className="min-w-0 p-4 sm:p-6">
                <div
                  className={`relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-[#F7FAEE] ${
                    !isAvailable ? "grayscale" : ""
                  }`}
                >
                  {pkg.image && (
                    <Image
                      src={pkg.image}
                      alt={pkg.name}
                      fill
                      sizes="(max-width: 1023px) 100vw, 35vw"
                      className="object-cover"
                    />
                  )}

                  <span className="absolute left-3 top-3 rounded-full bg-[#F7FAEE]/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#052a50]">
                    {pkg.shortName}
                  </span>

                  {!isAvailable && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/35">
                      <span className="rounded-full border border-white/70 bg-gray-900/80 px-5 py-2.5 text-sm font-bold tracking-[0.2em] text-white">
                        SOLD OUT
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div
                    className={`flex items-center gap-2 text-sm font-medium ${
                      isAvailable ? "text-[#052a50]" : "text-gray-500"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="7" r="4" />
                      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
                    </svg>
                    Up to {pkg.maxGuests} guests
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (isAvailable) setActivePackage(pkg);
                    }}
                    disabled={!isAvailable}
                    className="text-sm font-semibold text-[#052a50] underline decoration-[#e4b441] underline-offset-4 hover:text-[#b08a28] disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
                  >
                    More Details +
                  </button>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b08a28]">
                    Package {pkg.number}
                  </p>

                  <h2
                    className={`mt-1 text-xl font-semibold sm:text-2xl ${
                      isAvailable ? "text-[#052a50]" : "text-gray-500"
                    }`}
                  >
                    {pkg.name}
                  </h2>

                  {pkg.tagline && (
                    <p
                      className={`mt-1 font-display text-base ${
                        isAvailable ? "text-[#052a50]/75" : "text-gray-500"
                      }`}
                    >
                      {pkg.tagline}
                    </p>
                  )}

                  <p
                    className={`mt-2 text-xs leading-5 ${
                      isAvailable ? "text-[#052a50]/65" : "text-gray-500"
                    }`}
                  >
                    Includes: {pkg.includedRooms.join(", ")}
                  </p>
                </div>

                <div className="mt-5">
                  <div className="flex flex-wrap gap-2">
                    {pkg.highlights.map((highlight) => (
                      <span
                        key={highlight}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          isAvailable
                            ? "border-[#052a50]/10 bg-[#F7FAEE] text-[#052a50]/80"
                            : "border-gray-300 bg-gray-200 text-gray-500"
                        }`}
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: OCCUPANCY AND PRICE */}
              <div
                className={`flex min-w-0 flex-col border-t p-4 sm:p-6 lg:border-l lg:border-t-0 ${
                  isAvailable
                    ? "border-[#052a50]/10 bg-[#F7FAEE]/60"
                    : "border-gray-300 bg-gray-200/70"
                }`}
              >
                <div
                  className={`rounded-xl border p-4 ${
                    isAvailable
                      ? "border-[#052a50]/10 bg-white"
                      : "border-gray-300 bg-gray-100"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
                    Your Stay
                  </p>

                  <div
                    className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold ${
                      isAvailable ? "text-[#052a50]" : "text-gray-500"
                    }`}
                  >
                    <span>
                      {stayNights} {stayNights === 1 ? "Night" : "Nights"}
                    </span>
                    <span className="opacity-30">|</span>
                    <span>{pkg.baseGuests} Guests</span>
                    <span className="opacity-30">|</span>
                    <span>Breakfast Included</span>
                  </div>

                  <p className="mt-2 text-xs text-gray-500">
                    {pkg.baseGuests} guests and complimentary breakfast are
                    included in the package price.
                  </p>
                </div>

                <div className="mt-5">
                  <h3
                    className={`text-sm font-semibold ${
                      isAvailable ? "text-[#052a50]" : "text-gray-500"
                    }`}
                  >
                    Extra Occupancy
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Add up to {pkg.maxGuests - pkg.baseGuests} more guests
                    (maximum {pkg.maxGuests}).
                  </p>

                  {[
                    { type: "adults", label: "Extra Adults", rate: PRICING.extraGuests.adult },
                    { type: "children", label: "Children (6–12 years)", rate: PRICING.extraGuests.child },
                  ].map(({ type, label, rate }, i) => (
                    <div key={type} className={`${i === 0 ? "mt-4" : "mt-5"} flex items-center justify-between gap-3`}>
                      <div>
                        <p
                          className={`text-sm font-medium ${
                            isAvailable ? "text-[#052a50]" : "text-gray-500"
                          }`}
                        >
                          {label}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {weekdayWeekendLabel(rate)} / night
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => updateOccupancy(pkg, type, -1)}
                          disabled={!isAvailable || guests[type] === 0}
                          aria-label={`Remove ${type === "adults" ? "extra adult" : "child"} from ${pkg.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#052a50]/20 bg-white text-lg text-[#052a50] hover:bg-[#e4b441] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          −
                        </button>

                        <span className="w-4 text-center text-sm font-semibold tabular-nums text-gray-500">
                          {guests[type]}
                        </span>

                        <button
                          type="button"
                          onClick={() => updateOccupancy(pkg, type, 1)}
                          disabled={!isAvailable || atMax}
                          aria-label={`Add ${type === "adults" ? "extra adult" : "child"} to ${pkg.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#052a50]/20 bg-white text-lg text-[#052a50] hover:bg-[#e4b441] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}

                  <p className="mt-4 text-xs leading-5 text-gray-500">
                    Children under 6 stay complimentary. Package occupancy
                    limits apply.
                  </p>
                </div>

                {/* Total Price and Selection */}
                <div className="mt-auto pt-6">
                  <div
                    className={`rounded-xl border p-4 ${
                      isAvailable
                        ? "border-[#052a50]/10 bg-white"
                        : "border-gray-300 bg-gray-100"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
                      Total Stay Price
                    </p>

                    <p
                      className={`mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${
                        isAvailable ? "text-[#052a50]" : "text-gray-500"
                      }`}
                    >
                      {formatPrice(stayPrice.total)}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      {formatPrice(pkg.pricePerNight)} per night for{" "}
                      {pkg.baseGuests} guests ×{" "}
                      {stayNights} {stayNights === 1 ? "night" : "nights"}
                      {guests.adults + guests.children > 0
                        ? `, plus extra guests${checkIn && checkOut ? ` (${nightsBreakdown(stayPrice)})` : ""}`
                        : ""}
                      . Taxes are not included.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={!isAvailable || isBusy}
                    onClick={() => {
                      if (!isAvailable) return;
                      onSelectPackage?.(withOccupancy(pkg, guests));
                    }}
                    aria-pressed={isSelected}
                    className={`mt-4 w-full rounded-xl px-5 py-3.5 text-sm font-semibold transition-colors ${
                      !isAvailable
                        ? "cursor-not-allowed bg-gray-300 text-gray-600"
                        : isSelected
                          ? "bg-[#e4b441] text-[#052a50]"
                          : "bg-[#052a50] text-white hover:bg-[#e4b441] hover:text-[#052a50] disabled:opacity-60"
                    }`}
                  >
                    {!isAvailable
                      ? "SOLD OUT"
                      : isSelected
                        ? "Selected"
                        : isBusy
                          ? "Holding rooms..."
                          : "Select Package"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {activePackage && (
        <RoomsModal room={activePackage} onClose={() => setActivePackage(null)} />
      )}
    </section>
  );
}
