const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const SEARCH_RADIUS_METRES = 35;
const NOMINATIM_REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const CURRENT_NAME_SOURCE = {
  name: "OpenStreetMap nearby place",
  url: "https://www.openstreetmap.org/",
  coverage: "Nearby named shop, amenity, office, tourism, or leisure feature used as current public-facing building name",
};

export async function enrichUndatedBuildingWithCurrentPlaceName(building) {
  if (!shouldFindCurrentPlaceName(building)) return building;

  try {
    const place = await findNearbyCurrentPlace(building.position);

    if (!place) return markAttempted(building);

    const tags = place.tags || {};
    const placeName = tags.brand || tags.name || tags.official_name || "";
    if (!placeName) return markAttempted(building);

    const placeUrl = `https://www.openstreetmap.org/${place.type}/${place.id}`;
    const source = { ...CURRENT_NAME_SOURCE, url: placeUrl };
    const currentUse = inferCurrentUse(tags) || building.currentUse;
    const officialWebsite = getWebsiteUrl(tags);
    const officialWebsiteSource = officialWebsite ? {
      name: "Official venue website",
      url: officialWebsite,
      coverage: "Website linked from nearby OpenStreetMap place and checked before enrichment",
    } : null;

    return {
      ...building,
      buildingName: placeName,
      name: placeName,
      commonName: placeName,
      officialWebsite: officialWebsite || building.officialWebsite,
      currentUse,
      currentPlaceNameLoaded: true,
      matchConfidence: "medium",
      sources: mergeSources(building.sources, [source, officialWebsiteSource].filter(Boolean)),
      sourceLinks: mergeSources(building.sourceLinks, [source, officialWebsiteSource].filter(Boolean)),
    };
  } catch (error) {
    return markAttempted(building);
  }
}

async function findNearbyCurrentPlace(position) {
  let overpassPlace = null;

  try {
    const query = buildNearbyPlaceQuery(position);
    const data = await requestOverpass(query);
    overpassPlace = chooseBestPlace(data.elements || [], position);
  } catch (error) {
    overpassPlace = null;
  }

  return overpassPlace || await reverseGeocodeNamedPlace(position);
}

function shouldFindCurrentPlaceName(building) {
  return !building.currentPlaceNameLoaded
    && building.position
    && building.buildDate?.value === "Date not available"
    && isGenericBuildingName(building.buildingName);
}

function buildNearbyPlaceQuery(position) {
  const around = `${SEARCH_RADIUS_METRES},${position.lat},${position.lng}`;

  return `[out:json][timeout:15];
(
node(around:${around})["name"]["shop"];
way(around:${around})["name"]["shop"];
relation(around:${around})["name"]["shop"];
node(around:${around})["brand"]["shop"];
way(around:${around})["brand"]["shop"];
relation(around:${around})["brand"]["shop"];
node(around:${around})["name"]["amenity"];
way(around:${around})["name"]["amenity"];
relation(around:${around})["name"]["amenity"];
node(around:${around})["name"]["office"];
way(around:${around})["name"]["office"];
relation(around:${around})["name"]["office"];
node(around:${around})["name"]["tourism"];
way(around:${around})["name"]["tourism"];
relation(around:${around})["name"]["tourism"];
node(around:${around})["name"]["leisure"];
way(around:${around})["name"]["leisure"];
relation(around:${around})["name"]["leisure"];
);
out center tags 20;`;
}

async function requestOverpass(query) {
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { Accept: "application/json" },
      });

      if (response.ok) return response.json();
      errors.push(`${endpoint}: ${response.status}`);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }

  throw new Error(`Overpass current-place lookup failed: ${errors.join("; ")}`);
}

function chooseBestPlace(elements, position) {
  return elements
    .map((element) => ({
      element,
      score: scorePlace(element, position),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.element || null;
}

async function reverseGeocodeNamedPlace(position) {
  const url = new URL(NOMINATIM_REVERSE_ENDPOINT);
  url.searchParams.set("lat", position.lat);
  url.searchParams.set("lon", position.lng);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("namedetails", "1");

  const response = await fetch(url, {
    headers: getRequestHeaders(),
  });
  if (!response.ok) return null;

  const place = await response.json();
  const name = place.namedetails?.name || place.name;
  if (!name || !isCurrentPlaceCategory(place.category)) return null;

  return {
    type: place.osm_type === "node" ? "node" : place.osm_type === "way" ? "way" : "relation",
    id: place.osm_id,
    lat: Number(place.lat),
    lon: Number(place.lon),
    tags: {
      name,
      [place.category]: place.type,
    },
  };
}

function getRequestHeaders() {
  const headers = { Accept: "application/json" };
  if (typeof process !== "undefined") {
    headers["User-Agent"] = "BuildingHistoryApp/0.1 (https://github.com/jaedonleaf/Building-History-App)";
  }
  return headers;
}

function scorePlace(element, position) {
  const tags = element.tags || {};
  const placePosition = getElementPosition(element);
  const name = tags.brand || tags.name || tags.official_name || "";
  if (!name || !placePosition) return 0;

  let score = 100 - distanceMetres(position, placePosition);
  if (tags.brand) score += 12;
  if (tags.shop) score += 10;
  if (tags.amenity) score += 6;
  if (tags.office || tags.tourism || tags.leisure) score += 4;
  if (isGenericPlaceName(name)) score -= 30;

  return score;
}

function getElementPosition(element) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) return { lat: element.center.lat, lng: element.center.lon };
  return null;
}

function inferCurrentUse(tags = {}) {
  if (tags.shop) return `${tagLabel(tags.shop)} shop`;
  if (tags.amenity) return tagLabel(tags.amenity);
  if (tags.office) return `${tagLabel(tags.office)} office`;
  if (tags.tourism) return tagLabel(tags.tourism);
  if (tags.leisure) return tagLabel(tags.leisure);
  return "";
}

function isCurrentPlaceCategory(category = "") {
  return ["shop", "amenity", "office", "tourism", "leisure"].includes(category);
}

function isGenericBuildingName(value = "") {
  return /^(mapped building|unnamed mapped building|building near\b|building$)/i.test(String(value || "").trim());
}

function isGenericPlaceName(value = "") {
  return /^(shop|store|office|building|retail)$/i.test(String(value || "").trim());
}

function getWebsiteUrl(tags = {}) {
  const value = tags.website || tags["contact:website"] || tags.url || "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value;
}

function tagLabel(value = "") {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function distanceMetres(a, b) {
  const lat = (a.lat + b.lat) / 2 * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function markAttempted(building) {
  return { ...building, currentPlaceNameLoaded: true };
}

function mergeSources(existing = [], incoming = []) {
  const byKey = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((source) => {
    const key = source.url || source.name;
    if (key) byKey.set(key, source);
  });
  return [...byKey.values()];
}
