// This module converts source-specific records into one BuildingHistory shape.
// It also merges likely matches, keeps source attribution, and records conflicts
// instead of silently overwriting facts from lower-priority sources.
const SOURCE_PRIORITY = {
  "Ordnance Survey": 1,
  "Historic England": 1,
  "National Heritage List for England (NHLE)": 1,
  "Planning Data Listed Buildings": 1,
  "Historic Royal Palaces": 2,
  "Official venue website": 2,
  "Official business website": 2,
  "CAMRA Pub Search": 2,
  "CAMRA Heritage Pubs": 2,
  "Local authority heritage data": 2,
  "Local council conservation documents": 2,
  "OpenStreetMap": 3,
  "OpenStreetMap Nominatim": 3,
  "Overpass API": 3,
  "Wikidata": 4,
  "Wikipedia": 4,
  "Wikipedia API": 4,
  "National Library of Scotland Maps": 5,
  "British History Online": 6,
  "Modular retrieval pipeline": 99,
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
  "historic-royal-palaces": { name: "Historic Royal Palaces", url: "https://www.hrp.org.uk/", coverage: "Official royal palace histories" },
  "official-venue-website": { name: "Official venue website", url: "", coverage: "Website linked from mapped source data" },
};

const UNKNOWN_CURRENT_USE = "Current use not found in public sources";
const FORMAL_NAME_SUFFIXES = new Set([
  "inn",
  "hotel",
  "public",
  "house",
  "listed",
  "building",
]);

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

  let buildDate = normaliseBuildDate(record.buildDate || {
    value: record.built,
    confidence: record.confidence,
    source: sources[0],
  });

  const pastUsesTimeline = normaliseTimeline(record.pastUsesTimeline || record.timeline || [], "Recorded use");
  buildDate = promoteTimelineBuildDate(buildDate, pastUsesTimeline);
  const significantEvents = normaliseTimeline(record.significantEvents || [], "Significant event");
  const originalPurpose = normaliseOriginalPurpose(record, buildDate, pastUsesTimeline);

  // Backwards-compatible aliases keep the current marker/search code simple.
  return {
    id: record.id,
    sourceRecordIds: record.sourceRecordIds || [record.id].filter(Boolean),
    wikidataId: record.wikidataId || extractId(record.sourceRecordIds, "wikidata"),
    nhleId: record.nhleId || extractId(record.sourceRecordIds, "historic-england"),
    officialWebsite: record.officialWebsite || getOfficialWebsiteUrl(sources),
    buildingName,
    name: buildingName,
    address: record.address || "Address not available",
    position: record.position,
    buildDate,
    built: buildDate.value,
    confidence: titleCase(buildDate.confidence),
    architecturalStyle: record.architecturalStyle || "",
    currentUse: normaliseCurrentUse(record, pastUsesTimeline, buildingName),
    listedStatus: record.listedStatus || "",
    originalPurpose,
    constructionContext: record.constructionContext || "",
    builtBy: record.builtBy || "",
    builtFor: record.builtFor || "",
    buildPurposeSources: normaliseSources(record.buildPurposeSources || []),
    pastUsesTimeline,
    significantEvents,
    conflictingSourceData: record.conflictingSourceData || [],
    sources,
    sourceLinks: sources,
    retrievalChecks: record.retrievalChecks || [],
    currentPlaceNameLoaded: Boolean(record.currentPlaceNameLoaded),
    officialWebsiteLoaded: Boolean(record.officialWebsiteLoaded),
    wikipediaEventsLoaded: Boolean(record.wikipediaEventsLoaded),
    mapboxAddressLoaded: Boolean(record.mapboxAddressLoaded),
    hrpLoaded: Boolean(record.hrpLoaded),
    modularRetrievalLoaded: Boolean(record.modularRetrievalLoaded),
    dataConfidence: record.dataConfidence || record.dataConfidence === 0 ? record.dataConfidence : null,
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
    wikidataId: existing.wikidataId || incoming.wikidataId || "",
    nhleId: existing.nhleId || incoming.nhleId || "",
    officialWebsite: existing.officialWebsite || incoming.officialWebsite || "",
    officialName: chooseName(existing, incoming),
    address: chooseAddress(existing, incoming),
    position: existing.position || incoming.position,
    buildDate: buildDateMerge.selected,
    architecturalStyle: chooseSupportedValue(existing.architecturalStyle, incoming.architecturalStyle, existing, incoming),
    currentUse: chooseCurrentUse(existing, incoming),
    listedStatus: chooseSupportedValue(existing.listedStatus, incoming.listedStatus, existing, incoming),
    originalPurpose: chooseOriginalPurpose(existing, incoming),
    constructionContext: chooseSupportedValue(existing.constructionContext, incoming.constructionContext, existing, incoming),
    builtBy: chooseSupportedValue(existing.builtBy, incoming.builtBy, existing, incoming),
    builtFor: chooseSupportedValue(existing.builtFor, incoming.builtFor, existing, incoming),
    buildPurposeSources: mergeSources(existing.buildPurposeSources, incoming.buildPurposeSources),
    retrievalChecks: mergeRetrievalChecks(existing.retrievalChecks, incoming.retrievalChecks),
    currentPlaceNameLoaded: existing.currentPlaceNameLoaded || incoming.currentPlaceNameLoaded,
    officialWebsiteLoaded: chooseOfficialWebsiteLoaded(existing, incoming),
    wikipediaEventsLoaded: existing.wikipediaEventsLoaded || incoming.wikipediaEventsLoaded,
    mapboxAddressLoaded: existing.mapboxAddressLoaded || incoming.mapboxAddressLoaded,
    hrpLoaded: existing.hrpLoaded || incoming.hrpLoaded,
    modularRetrievalLoaded: existing.modularRetrievalLoaded || incoming.modularRetrievalLoaded,
    dataConfidence: chooseNumericConfidence(existing.dataConfidence, incoming.dataConfidence),
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
  const historicEnglandMatch = hasSourceIdPrefix(a, "historic-england") || hasSourceIdPrefix(b, "historic-england");

  if (historicEnglandMatch) {
    return distance <= 18 && (namesOverlap || addressesOverlap);
  }

  // Coordinate proximity is required to avoid false matches with common names.
  return distance <= 18 && (namesOverlap || addressesOverlap || distance <= 7);
}

export function hasLimitedHistory(building) {
  return building.built === "Date not available"
    && building.pastUsesTimeline.length <= 1
    && building.significantEvents.length === 0;
}

function chooseName(existing, incoming) {
  const currentName = chooseCurrentMappedName(existing, incoming);
  if (currentName) return currentName;

  return chooseSupportedValue(existing.buildingName, incoming.buildingName, existing, incoming);
}

function chooseCurrentMappedName(existing, incoming) {
  const existingName = existing.buildingName || "";
  const incomingName = incoming.buildingName || "";
  if (!existingName || !incomingName) return "";

  const existingIsMapped = hasSource(existing, "OpenStreetMap");
  const incomingIsMapped = hasSource(incoming, "OpenStreetMap");
  const existingIsVerifiedCurrentName = existingIsMapped || hasSource(existing, "Official venue website");
  const incomingIsVerifiedCurrentName = incomingIsMapped || hasSource(incoming, "Official venue website");
  if (incomingIsVerifiedCurrentName && isCleanerSameVenueName(incomingName, existingName)) return incomingName;
  if (existingIsVerifiedCurrentName && isCleanerSameVenueName(existingName, incomingName)) return existingName;

  return "";
}

function isCleanerSameVenueName(candidate = "", alternative = "") {
  const candidateWords = nameWords(candidate);
  const alternativeWords = nameWords(alternative);
  if (!candidateWords.size || !alternativeWords.size) return false;
  if (![...candidateWords].every((word) => alternativeWords.has(word))) return false;

  const extraWords = [...alternativeWords].filter((word) => !candidateWords.has(word));
  return extraWords.length > 0 && extraWords.every((word) => FORMAL_NAME_SUFFIXES.has(word));
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

function chooseCurrentUse(existing, incoming) {
  if (isUnknownCurrentUse(existing.currentUse)) return incoming.currentUse || existing.currentUse;
  if (isUnknownCurrentUse(incoming.currentUse)) return existing.currentUse;
  const equivalentUse = chooseEquivalentCurrentUse(existing.currentUse, incoming.currentUse);
  if (equivalentUse) return equivalentUse;
  return chooseSupportedValue(existing.currentUse, incoming.currentUse, existing, incoming);
}

function chooseEquivalentCurrentUse(existingValue = "", incomingValue = "") {
  const values = [existingValue, incomingValue].map((value) => String(value || "").toLowerCase());
  if (values.some((value) => /\bpub\b/.test(value)) || values.some((value) => /\bpublic house\b/.test(value))) {
    return "pub / public house";
  }
  return "";
}

function chooseOriginalPurpose(existing, incoming) {
  if (!existing.originalPurpose) return incoming.originalPurpose || "";
  if (!incoming.originalPurpose) return existing.originalPurpose;
  return chooseSupportedValue(existing.originalPurpose, incoming.originalPurpose, existing, incoming);
}

function chooseOfficialWebsiteLoaded(existing, incoming) {
  const existingWebsite = existing.officialWebsite || "";
  const incomingWebsite = incoming.officialWebsite || "";
  const selectedWebsite = existingWebsite || incomingWebsite;
  const websiteWasAdded = incomingWebsite && incomingWebsite !== existingWebsite;
  const buildDateMissing = !existing.buildDate?.value || existing.buildDate.value === "Date not available";

  if (selectedWebsite && websiteWasAdded && buildDateMissing) return false;
  return existing.officialWebsiteLoaded || incoming.officialWebsiteLoaded;
}

function chooseNumericConfidence(existingValue, incomingValue) {
  if (Number.isFinite(incomingValue) && !Number.isFinite(existingValue)) return incomingValue;
  if (Number.isFinite(existingValue) && !Number.isFinite(incomingValue)) return existingValue;
  if (Number.isFinite(existingValue) && Number.isFinite(incomingValue)) return Math.max(existingValue, incomingValue);
  return null;
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

function promoteTimelineBuildDate(buildDate, pastUsesTimeline) {
  if (buildDate.value !== "Date not available") return buildDate;

  const candidate = pastUsesTimeline
    .map(getBuildDateFromTimelineItem)
    .find(Boolean);

  return candidate || buildDate;
}

function getBuildDateFromTimelineItem(item = {}) {
  const text = `${item.dateRange || ""} ${item.useType || ""} ${item.description || ""}`;
  if (!isBuildDateTimelineItem(text)) return null;
  if (isOccupantBusinessTimelineDate(text)) return null;

  const value = formatTimelineBuildDate(item.dateRange) || formatTimelineBuildDate(item.description);
  if (!value || value === "Date not available") return null;

  return {
    value,
    confidence: item.confidence || "low",
    source: item.source,
    note: item.description || "",
  };
}

function isBuildDateTimelineItem(value = "") {
  return /\b(build date|built|constructed|erected|completed|inception|start date|year built|construction)\b/i.test(value);
}

function isOccupantBusinessTimelineDate(value = "") {
  const text = String(value || "").toLowerCase();
  return /\b(bar|pub|restaurant|cafe|shop|store|retailer|business|company|brand|chain|venue|club|nightclub)\b/.test(text)
    && /\b(opened|founded|launched|started|began trading|operates|occupied by|tenant)\b/.test(text)
    && !/\b(building|house|hall|church|chapel|castle|tower|station|warehouse|hotel|theatre|library|museum|school|college|prison|gaol|jail|court|workhouse)\b/.test(text);
}

function formatTimelineBuildDate(value = "") {
  const clean = String(value || "").trim();
  if (!clean || /^undated|current|present|recorded use|former use|heritage/i.test(clean)) return "";

  const range = clean.match(/\b(1[0-9]{3}|20[0-2][0-9])\s*[-–]\s*(1[0-9]{3}|20[0-2][0-9])\b/);
  if (range) return `c. ${range[1]}-${range[2]}`;

  const year = clean.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (year) return `c. ${year[1]}`;

  const century = clean.match(/\b(early|mid|late)?\s?([0-9]{1,2})(?:st|nd|rd|th) century\b/i);
  if (century) return `c. ${century[1] ? `${century[1]} ` : ""}${century[2]}th century`;

  return "";
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
  const byKey = new Map();
  sources.map(normaliseSource).filter((source) => source.name || source.url).forEach((source) => {
    const key = normaliseSourceKey(source.url || source.name);
    const existing = byKey.get(key);
    if (!existing || source.coverage && !existing.coverage) byKey.set(key, source);
  });
  return [...byKey.values()];
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

function getOfficialWebsiteUrl(sources = []) {
  return sources.find((source) => source.name === "Official venue website")?.url || "";
}

function mergeRetrievalChecks(a = [], b = []) {
  const byKey = new Map();
  [...a, ...b].filter(Boolean).forEach((check) => {
    byKey.set([
      check.pipeline || "",
      check.sourceName || check.source_name || "",
      check.url || check.source_url || "",
      check.status || "",
    ].join("|"), check);
  });
  return [...byKey.values()];
}

function inferCurrentUse(timeline) {
  const current = [...timeline].reverse().find((item) => /present|current|mapped/i.test(item.dateRange + item.description));
  return current?.description || "";
}

function normaliseCurrentUse(record, pastUsesTimeline, buildingName) {
  return firstText([
    record.currentUse,
    inferCurrentUse(pastUsesTimeline),
    inferCurrentUseFromText([
      record.architecturalStyle,
      record.buildingType,
      record.type,
      buildingName,
      record.address,
    ].join(" ")),
    UNKNOWN_CURRENT_USE,
  ]);
}

function normaliseOriginalPurpose(record, buildDate, pastUsesTimeline) {
  return [
    record.originalPurpose,
    extractOriginalPurposeFromText(buildDate.note),
    ...pastUsesTimeline.map((item) => extractOriginalPurposeFromText(item.description)),
  ].find(Boolean) || "";
}

function extractOriginalPurposeFromText(value = "") {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const patterns = [
    /\bofficially\s+(?:His|Her|Their)\s+Majesty's\s+Royal\s+Palace\s+and\s+Fortress\b/i,
    /\b(?:a\s+)?grand palace early in its history,\s+it served as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+by\s+[^.;,]{3,90}?\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+for\s+([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed|opened)\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
    /\b(?:built|constructed|erected|designed)\s+to\s+(?:house|serve|accommodate)\s+([^.;,]{3,90})/i,
    /\b(?:constructed|built)\s+for\s+use\s+as\s+(?:an?\s+|the\s+)?([^.;,]{3,90})/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && !match[1] && /Royal\s+Palace\s+and\s+Fortress/i.test(match[0])) {
      return "a royal palace and fortress";
    }
    if (match?.[1]) return tidyOriginalPurpose(match[1]);
  }

  return "";
}

function tidyOriginalPurpose(value = "") {
  return value
    .replace(/\s+(during|when|with|by|in)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCurrentUseFromText(value = "") {
  const text = String(value).toLowerCase();

  if (/\b(church|chapel|cathedral|minster|abbey|mosque|synagogue|temple)\b/.test(text)) return "Place of worship";
  if (/\b(school|college|academy|university)\b/.test(text)) return "Education";
  if (/\b(pub|public house|bar|inn|tavern|hotel)\b/.test(text)) return "Hospitality";
  if (/\bwarehouse|mill|works|factory|depot\b/.test(text)) return "Industrial/storage";
  if (/\bshop|retail|arcade|market|bank|office|commercial\b/.test(text)) return "Commercial";
  if (/\bhouse|residential|apartments|flats|dwelling|terrace\b/.test(text)) return "Residential";
  if (/\bcastle|fort|palace|manor|keep\b/.test(text)) return "Historic visitor attraction";

  return "";
}

function isUnknownCurrentUse(value = "") {
  return !value || value === UNKNOWN_CURRENT_USE || value === "Not found in public sources";
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

function nameWords(value) {
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/)
    .map((word) => word === "bulls" ? "bull" : word)
    .filter((word) => word.length > 2 && word !== "the"));
}

function normaliseSourceKey(value = "") {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

function hasSourceIdPrefix(building = {}, prefix) {
  return (building.sourceRecordIds || []).some((id) => String(id).startsWith(`${prefix}-`));
}

function hasSource(building = {}, sourceName) {
  return (building.sources || []).some((source) => source.name === sourceName);
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

function extractId(ids = [], prefix) {
  return ids
    .map((id) => String(id || "").match(new RegExp(`^${prefix}-(.+)$`))?.[1] || "")
    .find(Boolean) || "";
}
