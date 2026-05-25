const OVERPASS_ENDPOINT = "https://overpass.kumi.systems/api/interpreter";
const MAX_VIEWPORT_DEGREES = 0.08;

const DATE_TAGS = ["start_date", "building:year", "year_built", "construction_date", "built"];

export async function fetchOpenStreetMapDatedBuildingsForBounds(bounds) {
  if (!bounds || bounds.width > MAX_VIEWPORT_DEGREES || bounds.height > MAX_VIEWPORT_DEGREES) {
    return { buildings: [], skipped: true };
  }

  const query = buildQuery(bounds);
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: getRequestHeaders(),
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with ${response.status}`);
  }

  const data = await response.json();
  return {
    buildings: data.elements.map(mapElementToBuilding).filter(Boolean),
    skipped: false,
  };
}

function getRequestHeaders() {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
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
way["building"][~"^(${DATE_TAGS.join("|")})$"~"."](${box});
relation["building"][~"^(${DATE_TAGS.join("|")})$"~"."](${box});
);
out center tags 120;`;
}

function mapElementToBuilding(element) {
  const tags = element.tags || {};
  const position = getPosition(element);
  const rawDate = DATE_TAGS.map((tag) => tags[tag]).find(Boolean);
  const built = formatBuildDate(rawDate);

  if (!position || built === "Unknown") return null;

  const name = tags.name || tags["addr:housename"] || buildAddress(tags) || "Mapped building";
  const use = getRecordedUse(tags);
  const osmUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;

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
        description: `Approximate construction/start date from OpenStreetMap tag ${getDateTagName(tags)}.`,
      },
      {
        period: "Recorded use",
        description: use,
      },
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
  if (!clean) return "Unknown";

  const yearMatch = clean.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (yearMatch) return `c. ${yearMatch[1]}`;

  const centuryMatch = clean.match(/\b([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (centuryMatch) return `c. ${centuryMatch[1]}th century`;

  return `c. ${clean}`;
}

function getDateConfidence(value = "") {
  return /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(value) ? "Medium" : "Low";
}

function getDateTagName(tags) {
  return DATE_TAGS.find((tag) => tags[tag]) || "date";
}

function getRecordedUse(tags) {
  const values = [
    tags.building && `building=${tags.building}`,
    tags.amenity && `amenity=${tags.amenity}`,
    tags.shop && `shop=${tags.shop}`,
    tags.office && `office=${tags.office}`,
    tags.historic && `historic=${tags.historic}`,
    tags.heritage && `heritage=${tags.heritage}`,
  ].filter(Boolean);

  return values.length ? values.join(", ") : "No additional use tag was available.";
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
