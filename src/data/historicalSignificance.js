export const DISCOVERY_MODES = {
  history: "history",
  everything: "everything",
};

export const DEFAULT_HISTORICAL_SIGNIFICANCE_CONFIG = {
  threshold: 12,
  minimumQualityFields: 2,
  scores: {
    listedBuilding: 10,
    historicRegistryRecord: 10,
    historicalEvent: 10,
    previousUse: 5,
    historicalImage: 5,
    buildYearKnown: 3,
    builtBefore1945: 7,
    builtBefore1900: 5,
    wikiArticle: 5,
    historicalDescription: 5,
    landmarkOrTouristAttraction: 5,
  },
};

const UNKNOWN_BUILD_DATES = new Set([
  "",
  "unknown",
  "date not available",
  "build date unknown",
  "not found in public sources",
]);

export function getHistoricalSignificance(building = {}, config = getHistoricalSignificanceConfig()) {
  const signals = getHistoricalSignals(building);
  const qualityFields = getAvailableQualityFields(signals);
  const score = calculateScore(signals, config.scores);
  const hasDirectHistoricalSignal = signals.listedBuilding
    || signals.historicRegistryRecord
    || signals.builtBefore1945
    || signals.previousUse
    || signals.historicalEvent
    || signals.historicalArchiveReference
    || signals.landmarkOrTouristAttraction;

  return {
    score,
    eligible: qualityFields.length >= config.minimumQualityFields && hasDirectHistoricalSignal,
    qualityFields,
    signals,
  };
}

export function isHistoricallyEligible(building = {}, config) {
  return getHistoricalSignificance(building, config).eligible;
}

export function getHistoricalSignificanceConfig() {
  const threshold = readNumericSetting("buildingHistory.historyThreshold", DEFAULT_HISTORICAL_SIGNIFICANCE_CONFIG.threshold);
  const minimumQualityFields = readNumericSetting("buildingHistory.minimumHistoricalFields", DEFAULT_HISTORICAL_SIGNIFICANCE_CONFIG.minimumQualityFields);

  return {
    ...DEFAULT_HISTORICAL_SIGNIFICANCE_CONFIG,
    threshold,
    minimumQualityFields,
  };
}

function getHistoricalSignals(building) {
  const buildYear = extractBuildYear(building.buildDate?.value || building.built);
  const sources = [...(building.sources || []), ...(building.sourceLinks || [])];
  const sourceText = sources.map((source) => `${source.name || ""} ${source.url || ""} ${source.coverage || ""}`).join(" ").toLowerCase();
  const timeline = building.pastUsesTimeline || [];
  const significantEvents = building.significantEvents || [];

  return {
    listedBuilding: hasListedStatus(building),
    historicRegistryRecord: hasHistoricRegistryRecord(building, sourceText),
    historicalEvent: significantEvents.length > 0,
    previousUse: hasKnownPreviousUse(timeline),
    historicalImage: /\b(image|photo|photograph|archive image|historic image)\b/.test(sourceText),
    buildYearKnown: Number.isFinite(buildYear),
    builtBefore1945: Number.isFinite(buildYear) && buildYear < 1945,
    builtBefore1900: Number.isFinite(buildYear) && buildYear < 1900,
    wikiArticle: /wikipedia|wikidata/.test(sourceText) || Boolean(building.wikidataId),
    historicalDescription: hasHistoricalDescription(building),
    historicalArchiveReference: /archive|newspaper|british history online|national library of scotland|maps\.nls|heritage gateway|historic england/.test(sourceText),
    landmarkOrTouristAttraction: isLandmarkOrTouristAttraction(building),
  };
}

function getAvailableQualityFields(signals) {
  const fields = [];
  if (signals.buildYearKnown) fields.push("buildDate");
  if (signals.previousUse) fields.push("previousUse");
  if (signals.historicalEvent) fields.push("historicalEvent");
  if (signals.listedBuilding) fields.push("listedStatus");
  if (signals.historicalDescription) fields.push("historicalDescription");
  if (signals.historicalImage) fields.push("historicalImage");
  if (signals.historicRegistryRecord || signals.historicalArchiveReference) fields.push("historicalSourceRecord");
  return fields;
}

function calculateScore(signals, scores) {
  return Object.entries({
    listedBuilding: signals.listedBuilding,
    historicRegistryRecord: signals.historicRegistryRecord,
    historicalEvent: signals.historicalEvent,
    previousUse: signals.previousUse,
    historicalImage: signals.historicalImage,
    buildYearKnown: signals.buildYearKnown,
    builtBefore1945: signals.builtBefore1945,
    builtBefore1900: signals.builtBefore1900,
    wikiArticle: signals.wikiArticle,
    historicalDescription: signals.historicalDescription,
    landmarkOrTouristAttraction: signals.landmarkOrTouristAttraction,
  }).reduce((total, [key, enabled]) => total + (enabled ? scores[key] || 0 : 0), 0);
}

function hasListedStatus(building = {}) {
  return Boolean(building.listedStatus && !/not found|unknown|not listed/i.test(building.listedStatus));
}

function hasHistoricRegistryRecord(building = {}, sourceText = "") {
  return (building.sourceRecordIds || []).some((id) => /^historic-england-|^planning-data-|^nhle-/i.test(String(id)))
    || /historic england|national heritage list|nhle|planning data listed|heritage gateway|historic environment record/.test(sourceText);
}

function hasKnownPreviousUse(timeline = []) {
  return timeline.some((item) => {
    const text = `${item.dateRange || ""} ${item.useType || ""} ${item.description || ""}`.toLowerCase();
    if (!text.trim()) return false;
    if (/current mapped use|present|current use/.test(text)) return false;
    return /former|previous|converted|originally|historic|used as|recorded use|warehouse|inn|post office|school|church|chapel|station|mill|factory|market|arcade/.test(text);
  });
}

function hasHistoricalDescription(building = {}) {
  return Boolean(
    building.originalPurpose
      || building.constructionContext
      || sourceBackedText(building.buildDate?.note, building.buildDate?.source)
      || (building.pastUsesTimeline || []).some((item) => sourceBackedText(item.description, item.source)),
  );
}

function isLandmarkOrTouristAttraction(building = {}) {
  const text = [
    building.buildingName,
    building.currentUse,
    building.architecturalStyle,
    building.address,
  ].join(" ").toLowerCase();
  return /\b(landmark|tourist attraction|visitor attraction|castle|palace|cathedral|abbey|monument|museum|historic site)\b/.test(text);
}

function extractBuildYear(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  if (UNKNOWN_BUILD_DATES.has(clean)) return null;
  const match = clean.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return match ? Number(match[1]) : null;
}

function sourceBackedText(value = "", source = {}) {
  if (!String(value || "").trim()) return false;
  const sourceName = String(source?.name || "").trim().toLowerCase();
  if (!sourceName || sourceName === "unknown source") return false;
  return true;
}

function readNumericSetting(key, fallback) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  } catch (error) {
    return fallback;
  }
}
