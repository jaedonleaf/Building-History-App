// This module converts source-specific records into one BuildingHistory shape.
// It also merges likely matches, keeps source attribution, and records conflicts
// instead of silently overwriting facts from lower-priority sources.
const SOURCE_PRIORITY = {
  "Historic England": 1,
  "Local authority heritage data": 2,
  "OpenStreetMap": 3,
  "Wikidata": 4,
  "Wikipedia": 4,
};

const CONFIDENCE_SCORE = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

const SOURCE_ID_LOOKUP = {
  openstreetmap: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/", coverage: "Mapped building feature data" },
  wikidata: { name: "Wikidata", url: "https://www.wikidata.org/", coverage: "Structured public data" },
  wikipedia: { name: "Wikipedia", url: "https://www.wikipedia.org/", coverage: "Narrative public reference where available" },
  "historic-england": { name: "Historic England", url: "https://historicengland.org.uk/listing/the-list/", coverage: "Official listed building records" },
};

export function normaliseBuildingHistory(record) {
  const sources = normaliseSources([...(record.sources || []), ...(record.sourceLinks || [])]);
  const fallbackName = record.address || record.mapFeatureName || "Unnamed mapped building";
  const buildingName = firstText([
    record.officialName,
    record.listedName,
    record.commonName,
    record.buildingName,
    record.name,
    record.address,
    fallbackName,
  ]);

  const buildDate = normaliseBuildDate(record.buildDate || {
    value: record.built,
    confidence: record.confidence,
    source: sources[0],
  });

  const pastUsesTimeline = normaliseTimeline(record.pastUsesTimeline || record.timeline || [], "Recorded use");
  const significantEvents = normaliseTimeline(record.significantEvents || [], "Significant event");

  // Backwards-compatible aliases keep the current marker/search code simple.
  return {
    id: record.id,
    sourceRecordIds: record.sourceRecordIds || [record.id].filter(Boolean),
    buildingName,
    name: buildingName,
    address: record.address || "Address not available",
    position: record.position,
    buildDate,
    built: buildDate.value,
    confidence: titleCase(buildDate.confidence),
    architecturalStyle: record.architecturalStyle || "",
    currentUse: record.currentUse || inferCurrentUse(pastUsesTimeline),
    pastUsesTimeline,
    significantEvents,
    conflictingSourceData: record.conflictingSourceData || [],
    sources,
    sourceLinks: sources,
    matchConfidence: record.matchConfidence || "high",
    sourcePriority: getBestSourcePriority(sources),
    timeline: buildDisplayTimeline(buildDate, pastUsesTimeline, significantEvents),
  };
}

export function mergeBuildingHistories(existing, incoming) {
  const sources = mergeSources(existing.sources, incoming.sources);
  const buildDateMerge = chooseBuildDate(existing.buildDate, incoming.buildDate);
  const pastUsesTimeline = mergeTimeline(existing.pastUsesTimeline, incoming.pastUsesTimeline);
  const significantEvents = mergeTimeline(existing.significantEvents, incoming.significantEvents);

  const merged = normaliseBuildingHistory({
    ...existing,
    sourceRecordIds: [...new Set([...(existing.sourceRecordIds || []), ...(incoming.sourceRecordIds || [])])],
    officialName: chooseName(existing, incoming),
    address: chooseAddress(existing, incoming),
    position: existing.position || incoming.position,
    buildDate: buildDateMerge.selected,
    architecturalStyle: chooseSupportedValue(existing.architecturalStyle, incoming.architecturalStyle, existing, incoming),
    currentUse: chooseSupportedValue(existing.currentUse, incoming.currentUse, existing, incoming),
    pastUsesTimeline,
    significantEvents,
    sources,
    conflictingSourceData: [
      ...(existing.conflictingSourceData || []),
      ...(incoming.conflictingSourceData || []),
      ...buildDateMerge.conflicts,
    ],
    matchConfidence: getMergedMatchConfidence(existing, incoming),
  });

  return merged;
}

export function areLikelySameBuilding(a, b) {
  if (!a.position || !b.position) return false;

  const distance = distanceMetres(a.position, b.position);
  const namesOverlap = hasTextOverlap(a.buildingName, b.buildingName);
  const addressesOverlap = hasTextOverlap(a.address, b.address);

  // Coordinate proximity is required to avoid false matches with common names.
  return distance <= 18 && (namesOverlap || addressesOverlap || distance <= 7);
}

export function hasLimitedHistory(building) {
  return building.built === "Date not available"
    && building.pastUsesTimeline.length <= 1
    && building.significantEvents.length === 0;
}

function chooseName(existing, incoming) {
  return chooseSupportedValue(existing.buildingName, incoming.buildingName, existing, incoming);
}

function chooseAddress(existing, incoming) {
  if (existing.address && existing.address !== "Address not available") return existing.address;
  return incoming.address || existing.address;
}

function chooseSupportedValue(existingValue, incomingValue, existing, incoming) {
  if (!incomingValue) return existingValue || "";
  if (!existingValue) return incomingValue;
  return incoming.sourcePriority < existing.sourcePriority ? incomingValue : existingValue;
}

function chooseBuildDate(existing, incoming) {
  if (!existing?.value || existing.value === "Date not available") {
    return { selected: incoming, conflicts: [] };
  }
  if (!incoming?.value || incoming.value === "Date not available") {
    return { selected: existing, conflicts: [] };
  }
  if (existing.value === incoming.value) {
    return { selected: scoreBuildDate(incoming) > scoreBuildDate(existing) ? incoming : existing, conflicts: [] };
  }

  const selected = scoreBuildDate(incoming) > scoreBuildDate(existing) ? incoming : existing;
  const other = selected === incoming ? existing : incoming;
  return {
    selected,
    conflicts: [{
      field: "buildDate",
      selected: selected.value,
      alternative: other.value,
      source: other.source?.name || "Unknown source",
    }],
  };
}

function scoreBuildDate(buildDate) {
  // Official sources should win over community/secondary sources; confidence breaks ties.
  const priorityScore = 10 - getSourcePriority(buildDate?.source);
  return (priorityScore * 10) + (CONFIDENCE_SCORE[buildDate?.confidence] || 0);
}

function normaliseBuildDate(buildDate) {
  const value = buildDate?.value && buildDate.value !== "Unknown" ? buildDate.value : "Date not available";
  return {
    value,
    confidence: (buildDate?.confidence || (value === "Date not available" ? "unknown" : "medium")).toLowerCase(),
    source: normaliseSource(buildDate?.source),
    note: buildDate?.note || "",
  };
}

function normaliseTimeline(items, fallbackType) {
  return items
    .map((item) => ({
      dateRange: item.dateRange || item.period || "Undated",
      useType: item.useType || item.type || fallbackType,
      description: item.description || item.use || "",
      source: normaliseSource(item.source),
      confidence: (item.confidence || "medium").toLowerCase(),
      sortYear: item.sortYear || extractYear(item.dateRange || item.period),
    }))
    .filter((item) => item.description)
    .sort((a, b) => a.sortYear - b.sortYear);
}

function buildDisplayTimeline(buildDate, pastUsesTimeline, significantEvents) {
  return [
    {
      period: buildDate.value,
      description: buildDate.value === "Date not available"
        ? "No reliable public build date has been found yet."
        : `Build date from ${buildDate.source?.name || "public source"} (${buildDate.confidence} confidence).`,
    },
    ...pastUsesTimeline.map((item) => ({
      period: item.dateRange,
      description: `${item.useType}: ${item.description}`,
    })),
    ...significantEvents.map((item) => ({
      period: item.dateRange,
      description: item.description,
    })),
  ];
}

function mergeTimeline(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((item) => {
    const key = `${item.dateRange}|${item.useType}|${item.description}|${item.source?.name || ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.sortYear - right.sortYear);
}

function mergeSources(a = [], b = []) {
  const byUrl = new Map();
  [...a, ...b].map(normaliseSource).forEach((source) => {
    const key = source.url || source.name;
    if (key) byUrl.set(key, source);
  });
  return [...byUrl.values()].sort((left, right) => getSourcePriority(left) - getSourcePriority(right));
}

function normaliseSources(sources) {
  return sources.map(normaliseSource).filter((source) => source.name || source.url);
}

function normaliseSource(source = {}) {
  if (typeof source === "string") return SOURCE_ID_LOOKUP[source] || { name: source, url: "", coverage: "" };
  return {
    name: source.name || "Unknown source",
    url: source.url || "",
    coverage: source.coverage || source.reference || "",
  };
}

function getBestSourcePriority(sources) {
  return Math.min(...sources.map(getSourcePriority), 99);
}

function getSourcePriority(source = {}) {
  return SOURCE_PRIORITY[source.name] || 99;
}

function inferCurrentUse(timeline) {
  const current = [...timeline].reverse().find((item) => /present|current|mapped/i.test(item.dateRange + item.description));
  return current?.description || "";
}

function getMergedMatchConfidence(existing, incoming) {
  return existing.matchConfidence === "low" || incoming.matchConfidence === "low" ? "low" : "medium";
}

function firstText(values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "Unnamed mapped building";
}

function hasTextOverlap(a = "", b = "") {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return false;
  return [...left].some((word) => right.has(word));
}

function words(value) {
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
}

function distanceMetres(a, b) {
  const lat = (a.lat + b.lat) / 2 * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function extractYear(value = "") {
  const match = String(value).match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return match ? Number(match[1]) : 9999;
}

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}
