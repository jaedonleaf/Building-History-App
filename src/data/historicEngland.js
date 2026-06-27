const NHLE_SERVICE = "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer";
const LISTED_BUILDING_LAYERS = [0, 3];
const MAX_VIEWPORT_DEGREES = 0.045;

const HISTORIC_ENGLAND_SOURCE = {
  name: "Historic England",
  url: "https://historicengland.org.uk/listing/the-list/",
  coverage: "Official National Heritage List for England listed-building records",
};

export async function fetchHistoricEnglandBuildingsForBounds(bounds) {
  if (!bounds || bounds.width > MAX_VIEWPORT_DEGREES || bounds.height > MAX_VIEWPORT_DEGREES) {
    return { buildings: [], skipped: true };
  }

  const results = await Promise.allSettled(
    LISTED_BUILDING_LAYERS.map((layerId) => queryHistoricEnglandLayer(layerId, buildBoundsParams(bounds))),
  );

  return {
    buildings: dedupeEntries(results.flatMap((result) => result.status === "fulfilled" ? result.value : [])),
    skipped: false,
  };
}

export async function enrichBuildingWithHistoricEngland(building) {
  const nhleId = getNhleIdFromBuilding(building);
  if (!nhleId) return null;

  const candidates = await fetchHistoricEnglandByListEntry(nhleId);
  const best = chooseBestMatch(building, candidates);
  return best || null;
}

async function fetchHistoricEnglandByListEntry(nhleId) {
  const params = {
    where: `ListEntry=${Number(nhleId)}`,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
  };

  const results = await Promise.allSettled(
    LISTED_BUILDING_LAYERS.map((layerId) => queryHistoricEnglandLayer(layerId, params)),
  );
  return dedupeEntries(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
}

async function queryHistoricEnglandLayer(layerId, params) {
  const url = new URL(`${NHLE_SERVICE}/${layerId}/query`);
  url.searchParams.set("f", "json");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Historic England request failed with ${response.status}`);

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Historic England request failed");

  return (data.features || []).map((feature) => mapFeatureToBuilding(feature, layerId)).filter(Boolean);
}

function buildBoundsParams(bounds) {
  return {
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
  };
}

function mapFeatureToBuilding(feature, layerId) {
  const attributes = feature.attributes || {};
  const listEntry = String(attributes.ListEntry || "").trim();
  const name = titleCase(attributes.Name || "");
  const url = attributes.hyperlink || (listEntry ? `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}` : HISTORIC_ENGLAND_SOURCE.url);
  const position = getFeaturePosition(feature.geometry);

  if (!listEntry || !name || !position) return null;

  const grade = String(attributes.Grade || "").trim();
  const listDate = formatArcgisDate(attributes.ListDate);
  const source = { ...HISTORIC_ENGLAND_SOURCE, url };

  return {
    id: `historic-england-${listEntry}`,
    sourceRecordIds: [`historic-england-${listEntry}`],
    listedName: name,
    officialName: name,
    commonName: name,
    name,
    address: name,
    nhleId: listEntry,
    buildDate: {
      value: "Date not available",
      confidence: "unknown",
      source,
    },
    architecturalStyle: "",
    currentUse: "",
    listedStatus: grade ? `Grade ${grade}` : "Listed building",
    position,
    sources: ["historic-england"],
    sourceLinks: [{
      ...source,
      coverage: `Official NHLE list entry ${listEntry}${grade ? `, Grade ${grade}` : ""}`,
    }],
    pastUsesTimeline: [],
    significantEvents: [{
      dateRange: listDate || "Heritage listing",
      useType: "Listed status",
      description: grade
        ? `Grade ${grade} listed building on the National Heritage List for England.`
        : "Listed building on the National Heritage List for England.",
      source,
      confidence: "high",
    }],
    matchConfidence: layerId === 3 ? "high" : "medium",
  };
}

function chooseBestMatch(building, candidates) {
  if (!candidates.length) return null;

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(building, candidate),
    }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

function scoreCandidate(building, candidate) {
  let score = 0;
  if (getNhleIdFromBuilding(building) && getNhleIdFromBuilding(building) === candidate.nhleId) score += 100;
  if (hasTextOverlap(building.buildingName, candidate.name)) score += 20;
  if (hasTextOverlap(building.address, candidate.name)) score += 10;
  if (building.position && candidate.position) score += Math.max(0, 20 - distanceMetres(building.position, candidate.position));
  return score;
}

function getNhleIdFromBuilding(building = {}) {
  return [
    building.nhleId,
    ...(building.sourceRecordIds || []).map((id) => String(id).match(/^historic-england-(\d{7})$/)?.[1]),
    ...(building.sources || []).map((source) => source.url || "").map(extractNhleId),
  ].find(Boolean) || "";
}

function extractNhleId(value = "") {
  return String(value).match(/list-entry\/(\d{7})/)?.[1] || "";
}

function getFeaturePosition(geometry = {}) {
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) {
    return { lng: geometry.x, lat: geometry.y };
  }

  const points = (geometry.rings || [])
    .flat()
    .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));

  if (!points.length) return null;

  const total = points.reduce((sum, point) => ({
    lng: sum.lng + point[0],
    lat: sum.lat + point[1],
  }), { lng: 0, lat: 0 });

  return {
    lng: total.lng / points.length,
    lat: total.lat / points.length,
  };
}

function dedupeEntries(entries) {
  const byId = new Map();
  entries.forEach((entry) => {
    if (!byId.has(entry.nhleId) || entry.matchConfidence === "high") {
      byId.set(entry.nhleId, entry);
    }
  });
  return [...byId.values()];
}

function formatArcgisDate(value) {
  if (!Number.isFinite(Number(value))) return "";
  const year = new Date(Number(value)).getUTCFullYear();
  return Number.isFinite(year) ? `Listed ${year}` : "";
}

function hasTextOverlap(a = "", b = "") {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return false;
  return [...left].some((word) => right.has(word));
}

function words(value = "") {
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
}

function distanceMetres(a, b) {
  const lat = (a.lat + b.lat) / 2 * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function titleCase(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/(^|[\s(-])[a-z]/g, (match) => match.toUpperCase());
}
