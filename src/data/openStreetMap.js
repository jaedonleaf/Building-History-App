const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_VIEWPORT_DEGREES = 0.045;

const DATE_TAGS = ["start_date", "building:year", "year_built", "construction_date", "built"];

export async function fetchOpenStreetMapBuildingsForBounds(bounds) {
  if (!bounds || bounds.width > MAX_VIEWPORT_DEGREES || bounds.height > MAX_VIEWPORT_DEGREES) {
    return { buildings: [], skipped: true };
  }

  const query = buildQuery(bounds);
  const data = await requestOverpass(query);
  return {
    buildings: data.elements.map(mapElementToBuilding).filter(Boolean),
    skipped: false,
  };
}

async function requestOverpass(query) {
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: getRequestHeaders(),
      });

      if (response.ok) return response.json();
      errors.push(`${endpoint}: ${response.status}`);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }

  throw new Error(`Overpass request failed: ${errors.join("; ")}`);
}

function getRequestHeaders() {
  const headers = {
    Accept: "application/json",
  };

  if (typeof process !== "undefined") {
    headers["User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
  }

  return headers;
}

function buildQuery(bounds) {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  return `[out:json][timeout:25];
(
way["building"](${box});
relation["building"](${box});
);
out center tags 250;`;
}

function mapElementToBuilding(element) {
  const tags = element.tags || {};
  const position = getPosition(element);
  const rawDate = DATE_TAGS.map((tag) => tags[tag]).find(Boolean);
  const built = formatBuildDate(rawDate);

  if (!position) return null;

  const name = tags.name || tags["addr:housename"] || buildAddress(tags) || "Mapped building";
  const osmUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const usageTimeline = buildUsageTimeline(tags, built);

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    address: buildAddress(tags) || "OpenStreetMap building record",
    built,
    confidence: getDateConfidence(rawDate),
    position,
    sources: ["openstreetmap"],
    sourceLinks: [
      {
        name: "OpenStreetMap feature",
        url: osmUrl,
        coverage: "Community mapped building tags including construction/start date where available",
      },
    ],
    timeline: [
      {
        period: built,
        description: rawDate
          ? `Approximate construction/start date from OpenStreetMap tag ${getDateTagName(tags)}.`
          : "No public build-date tag was available for this mapped building yet.",
      },
      ...usageTimeline,
    ],
  };
}

function getPosition(element) {
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }

  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }

  return null;
}

function formatBuildDate(value = "") {
  const clean = value.trim();
  if (!clean) return "Date not available";

  const yearMatch = clean.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (yearMatch) return `c. ${yearMatch[1]}`;

  const centuryMatch = clean.match(/\b([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (centuryMatch) return `c. ${centuryMatch[1]}th century`;

  return `c. ${clean}`;
}

function getDateConfidence(value = "") {
  if (!value) return "Unknown";
  return /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(value) ? "Medium" : "Low";
}

function getDateTagName(tags) {
  return DATE_TAGS.find((tag) => tags[tag]) || "date";
}

function buildUsageTimeline(tags, built) {
  const currentUse = getCurrentUse(tags);
  const formerUse = getFormerUse(tags);
  const lifecycleUse = getLifecycleUse(tags);
  const timeline = [];

  if (formerUse.length) {
    timeline.push({
      period: "Former use",
      description: formerUse.join(", "),
    });
  }

  if (lifecycleUse.length) {
    timeline.push({
      period: "Lifecycle status",
      description: lifecycleUse.join(", "),
    });
  }

  if (currentUse.length) {
    timeline.push({
      period: built,
      description: `Recorded or current mapped use: ${currentUse.join(", ")}`,
    });
  } else {
    timeline.push({
      period: "Recorded use",
      description: "No additional use tag was available.",
    });
  }

  return timeline;
}

function getCurrentUse(tags) {
  return [
    tags.building && `building=${tags.building}`,
    tags["building:use"] && `building use=${tags["building:use"]}`,
    tags.use && `use=${tags.use}`,
    tags.amenity && `amenity=${tags.amenity}`,
    tags.shop && `shop=${tags.shop}`,
    tags.office && `office=${tags.office}`,
    tags.tourism && `tourism=${tags.tourism}`,
    tags.leisure && `leisure=${tags.leisure}`,
    tags.historic && `historic=${tags.historic}`,
    tags.heritage && `heritage=${tags.heritage}`,
  ].filter(Boolean);
}

function getFormerUse(tags) {
  return Object.entries(tags)
    .filter(([key]) => key.startsWith("former:") || key.startsWith("was:") || key === "old_name")
    .map(([key, value]) => `${key}=${value}`);
}

function getLifecycleUse(tags) {
  return Object.entries(tags)
    .filter(([key]) => key.startsWith("disused:") || key.startsWith("abandoned:") || key.startsWith("demolished:") || key.startsWith("ruins:"))
    .map(([key, value]) => `${key}=${value}`);
}

function buildAddress(tags) {
  const parts = [
    tags["addr:housename"],
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:postcode"],
  ].filter(Boolean);

  return parts.join(", ");
}
