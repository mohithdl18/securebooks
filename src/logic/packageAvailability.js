
import rooms from "@/data/rooms.json";
import { PACKAGES } from "@/config/pricing";

const unique = (list) => [...new Set(list.filter(Boolean))];

// Display details for each package. Prices and guest limits come from
// src/config/pricing.js (the same file the server charges from).
const DISPLAY = {
  FullVilla: {
    number: "01",
    shortName: "FULL VILLA",
    tagline: "The complete SU VILLA, all to yourselves.",
    description:
      "Book the entire villa — both Family Suites, the Couple Suite and the Pond View Cottage — for your family or group.",
    image: "/images/packages/package1.jpg",
  },
  VillaWithoutCottage: {
    number: "02",
    shortName: "VILLA WITHOUT COTTAGE",
    tagline: "The whole villa, minus the cottage.",
    description:
      "Book both Family Suites and the Couple Suite together. The Pond View Cottage is not included.",
    image: "/images/packages/package2.jpg",
  },
};

function buildPackage(def) {
  const included = def.roomIds.map((id) => rooms.find((r) => r.id === id)).filter(Boolean);
  const display = DISPLAY[def.id] || {};
  return {
    ...display,
    id: def.id,
    name: def.name,
    roomIds: [...def.roomIds],
    includedRooms: included.map((r) => r.name),
    baseGuests: def.baseGuests,
    maxGuests: def.maxGuests,
    pricePerNight: def.pricePerNight,
    // Same amenities as the rooms it contains.
    highlights: unique(["Breakfast Included", ...included.flatMap((r) => r.highlights || [])]),
    features: unique(included.flatMap((r) => r.features || [])),
    bathroom: unique(included.flatMap((r) => r.bathroom || [])),
    tech: unique(included.flatMap((r) => r.tech || [])),
    amenities: unique(included.flatMap((r) => r.amenities || [])),
    images: unique(included.flatMap((r) => r.images || [])),
    heroImage: display.image,
    details: [
      { label: "Guests", value: `${def.baseGuests} included · up to ${def.maxGuests}` },
      { label: "Rooms", value: `${included.length} — ${included.map((r) => r.name).join(", ")}` },
      { label: "Views", value: unique(included.map((r) => r.details?.find((d) => d.label === "View")?.value)).join(", ") },
      { label: "Breakfast", value: "Included" },
    ],
  };
}

export const ALL_PACKAGES = Object.values(PACKAGES).map(buildPackage);

export function getPackageById(id) {
  return ALL_PACKAGES.find((p) => p.id === id) || null;
}

/** A package is available only if EVERY room in it is available. */
export function isPackageAvailable(pkg, availableRoomIds) {
  if (!Array.isArray(availableRoomIds)) return false;
  return pkg.roomIds.every((id) => availableRoomIds.includes(id));
}

/** Kept for compatibility: only the packages that are fully available. */
export function getAvailablePackages(availableRoomIds) {
  if (!Array.isArray(availableRoomIds)) return [];
  return ALL_PACKAGES.filter((p) => isPackageAvailable(p, availableRoomIds));
}
