import { mergeBuildingHistories, normaliseBuildingHistory } from "./buildingHistory.js";
import { enrichUndatedBuildingWithCurrentPlaceName } from "./currentPlaceName.js";
import { enrichBuildingWithHistoricEngland } from "./historicEngland.js";
import { enrichBuildingWithHistoricRoyalPalaces } from "./historicRoyalPalaces.js";
import { enrichUnnamedBuildingWithMapboxAddress } from "./mapboxGeocoding.js";
import { fetchWikidataBuildingById } from "./placeSearch.js";
import { enrichBuildingWithWikipediaEvents } from "./wikipedia.js";
import {
  createDefaultSourceAdapters,
  createEvidence,
  createSourceCheck,
  runModularBuildingRetrieval,
} from "./retrievalPipelines/index.js";

const MODULAR_SOURCE_NAME = "Modular retrieval pipeline";
const HISTORICAL_EVENT_FALLBACK = "No known historical events recorded for this building.";
const MAX_DISPLAY_SOURCES = 5;

export async function enrichBuildingWithModularRetrieval(
  building,
  { mapboxToken = "", collectExternalSources = true, sourceAdapters = createDefaultSourceAdapters() } = {},
) {
  if (building.modularRetrievalLoaded) return building;

  const sourceBackedBuilding = collectExternalSources
    ? await collectSourceBackedBuilding(building, mapboxToken)
    : normaliseBuildingHistory(building);
  const sourceAdapter = createBuildingHistoryEvidenceAdapter(sourceBackedBuilding);
  const profile = await runModularBuildingRetrieval(
    toRetrievalInput(sourceBackedBuilding),
    [sourceAdapter, ...sourceAdapters],
    { debug: true },
  );

  return mergeBuildingHistories(sourceBackedBuilding, normaliseBuildingHistory({
    ...profileToBuildingHistoryRecord(profile, sourceBackedBuilding),
    modularRetrievalLoaded: true,
  }));
}

async function collectSourceBackedBuilding(building, mapboxToken) {
  let nextBuilding = normaliseBuildingHistory(building);

  // Source collectors stay narrow: each gathers public facts, then the modular
  // evidence pipeline decides what to trust and how confident each field is.
  nextBuilding = await mergeAsyncIfChanged(nextBuilding, () => fetchLinkedWikidataRecord(nextBuilding));
  nextBuilding = mergeIfChanged(nextBuilding, enrichBuildingWithHistoricRoyalPalaces(nextBuilding));
  nextBuilding = await mergeAsyncIfChanged(nextBuilding, () => enrichBuildingWithHistoricEngland(nextBuilding));
  nextBuilding = await mergeAsyncIfChanged(nextBuilding, () => enrichUndatedBuildingWithCurrentPlaceName(nextBuilding));
  nextBuilding = await mergeAsyncIfChanged(nextBuilding, () => enrichBuildingWithWikipediaEvents(nextBuilding));
  nextBuilding = await mergeAsyncIfChanged(nextBuilding, () => enrichUnnamedBuildingWithMapboxAddress(nextBuilding, mapboxToken));

  return normaliseBuildingHistory(nextBuilding);
}

async function fetchLinkedWikidataRecord(building) {
  if (!building.wikidataId) return null;
  return fetchWikidataBuildingById(building.wikidataId);
}

function mergeIfChanged(building, enriched) {
  if (!enriched || enriched === building) return building;
  return mergeBuildingHistories(building, normaliseBuildingHistory(enriched));
}

async function mergeAsyncIfChanged(building, loader) {
  try {
    return mergeIfChanged(building, await loader());
  } catch (error) {
    return building;
  }
}

function toRetrievalInput(building) {
  return {
    selectedPlaceName: building.buildingName,
    coordinates: building.position,
    address: building.address,
    placeType: building.currentUse || building.architecturalStyle,
    id: building.id,
    buildingRecord: building,
    sourceUrls: building.sources.map((source) => source.url).filter(Boolean),
    sources: building.sources,
    sourceLinks: building.sourceLinks,
  };
}

function createBuildingHistoryEvidenceAdapter(building) {
  return {
    id: "existing-building-history-adapter",
    collect({ pipeline }) {
      const evidence = evidenceForPipeline(building, pipeline.id);
      return {
        evidence,
        checks: sourceChecksForPipeline(building, pipeline.id, evidence),
      };
    },
  };
}

function evidenceForPipeline(building, pipelineId) {
  const source = primarySource(building);
  const sourceContext = {
    sourceName: source.name || MODULAR_SOURCE_NAME,
    sourceUrl: source.url || "",
    sourceType: sourceTypeForSource(source),
    confidenceScore: confidenceScoreForBuilding(building),
  };

  if (pipelineId === "identity") {
    return [
      fact(pipelineId, "canonical_name", building.buildingName, sourceContext),
      fact(pipelineId, "likely_place_type", building.currentUse || building.architecturalStyle, sourceContext),
    ];
  }

  if (pipelineId === "location") {
    return [
      fact(pipelineId, "full_address", knownAddress(building.address), sourceContext),
      fact(pipelineId, "coordinates", building.position, sourceContext),
    ];
  }

  if (pipelineId === "buildDate") {
    const buildDate = building.buildDate?.value === "Date not available" ? null : building.buildDate?.value;
    return [
      fact(pipelineId, fieldForBuildDate(buildDate), buildDate, {
        ...sourceContext,
        sourceName: building.buildDate?.source?.name || sourceContext.sourceName,
        sourceUrl: building.buildDate?.source?.url || sourceContext.sourceUrl,
        confidenceScore: confidenceScoreForLabel(building.buildDate?.confidence),
        evidenceQuote: building.buildDate?.note || "",
      }),
    ];
  }

  if (pipelineId === "whyBuilt") {
    return building.originalPurpose
      ? [fact(pipelineId, "original_purpose", building.originalPurpose, sourceContext)]
      : [];
  }

  if (pipelineId === "currentUse") {
    return [
      fact(pipelineId, "current_use", knownCurrentUse(building.currentUse), sourceContext),
      fact(pipelineId, "category", building.architecturalStyle, sourceContext),
    ];
  }

  if (pipelineId === "previousUse") {
    return building.pastUsesTimeline.map((item) => fact(pipelineId, "previous_uses", {
      use: item.useType || item.description,
      approximate_dates: item.dateRange,
      evidence: item.description,
      source_url: item.source?.url || sourceContext.sourceUrl,
      confidence_score: confidenceScoreForLabel(item.confidence),
    }, {
      ...sourceContext,
      sourceName: item.source?.name || sourceContext.sourceName,
      sourceUrl: item.source?.url || sourceContext.sourceUrl,
      confidenceScore: confidenceScoreForLabel(item.confidence),
      evidenceQuote: item.description,
    }));
  }

  if (pipelineId === "listedStatus") {
    return [
      fact(pipelineId, "is_listed", isListed(building.listedStatus), sourceContext),
      fact(pipelineId, "listing_grade", extractListingGrade(building.listedStatus), sourceContext),
      fact(pipelineId, "official_description", building.listedStatus, sourceContext),
    ];
  }

  if (pipelineId === "coolHistoricalEvent") {
    const event = building.significantEvents[0];
    if (!event) return [];
    return [
      fact(pipelineId, "title", event.useType || "Significant event", sourceContext),
      fact(pipelineId, "summary", event.description, {
        ...sourceContext,
        sourceName: event.source?.name || sourceContext.sourceName,
        sourceUrl: event.source?.url || sourceContext.sourceUrl,
        confidenceScore: confidenceScoreForLabel(event.confidence),
        evidenceQuote: event.description,
      }),
      fact(pipelineId, "date_or_period", event.dateRange, sourceContext),
      fact(pipelineId, "event_type", event.useType, sourceContext),
      fact(pipelineId, "legend_or_verified", "verified public-source claim", sourceContext),
    ];
  }

  return [];
}

function fact(pipeline, field, value, source) {
  return createEvidence({
    pipeline,
    field,
    value,
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    sourceType: source.sourceType,
    confidenceScore: source.confidenceScore,
    evidenceQuote: source.evidenceQuote || "",
  });
}

function sourceChecksForPipeline(building, pipelineId, evidence) {
  const sources = building.sources.length ? building.sources : [{ name: MODULAR_SOURCE_NAME, url: "" }];
  const matchedEvidence = evidence.filter((item) => item?.value !== null && item?.value !== undefined);
  return sources.map((source) => createSourceCheck({
    pipeline: pipelineId,
    sourceName: source.name || MODULAR_SOURCE_NAME,
    sourceType: sourceTypeForSource(source),
    status: matchedEvidence.length ? "matched" : "checked",
    query: `${building.buildingName} ${building.address}`.trim(),
    url: source.url || "",
    rawSnippet: source.coverage || "",
    extractedFacts: matchedEvidence.map((item) => ({ field: item.field, value: item.value })),
    confidenceScore: confidenceScoreForBuilding(building),
  }));
}

function profileToBuildingHistoryRecord(profile, fallbackBuilding) {
  const buildDate = profileBuildDate(profile, fallbackBuilding);
  const currentUse = profile.currentUse?.current_use || fallbackBuilding.currentUse;
  const listedStatus = profileListedStatus(profile) || fallbackBuilding.listedStatus;

  return {
    id: fallbackBuilding.id,
    sourceRecordIds: fallbackBuilding.sourceRecordIds,
    officialName: profile.identity?.canonical_name || fallbackBuilding.buildingName,
    address: profile.location?.full_address || fallbackBuilding.address,
    position: profile.location?.coordinates || fallbackBuilding.position,
    buildDate,
    architecturalStyle: profile.currentUse?.category || fallbackBuilding.architecturalStyle,
    currentUse,
    listedStatus,
    originalPurpose: profile.whyBuilt?.original_purpose || fallbackBuilding.originalPurpose,
    constructionContext: profile.whyBuilt?.historical_context
      || profile.whyBuilt?.related_transport_trade_religious_commercial_context
      || fallbackBuilding.constructionContext
      || "",
    pastUsesTimeline: profile.previousUse.map(previousUseToTimelineItem),
    significantEvents: profile.coolHistoricalEvent?.summary
      && profile.coolHistoricalEvent.summary !== "Nothing that interesting has happened here -_-"
      ? [eventToTimelineItem(profile.coolHistoricalEvent)]
      : [],
    sources: sourcesFromProfile(profile, fallbackBuilding),
    sourceLinks: sourcesFromProfile(profile, fallbackBuilding),
    retrievalChecks: profile.sourcesChecked || [],
    conflictingSourceData: profile.conflicts || [],
    dataConfidence: profile.overallConfidence,
  };
}

function profileBuildDate(profile, fallbackBuilding) {
  const buildDate = profile.buildDate || {};
  const value = buildDate.exact_build_date
    || buildDate.estimated_build_date
    || buildDate.date_range
    || buildDate.century
    || fallbackBuilding.buildDate?.value
    || "Date not available";

  return {
    value,
    confidence: confidenceLabel(buildDate.confidence_score || confidenceScoreForLabel(fallbackBuilding.buildDate?.confidence)),
    source: sourceFromUrls(buildDate.source_urls, fallbackBuilding.buildDate?.source),
    note: (buildDate.evidence_quotes || []).join(" "),
  };
}

function previousUseToTimelineItem(item) {
  return {
    dateRange: item.approximate_dates || "Former use",
    useType: item.use || "Previous use",
    description: item.evidence || item.use || "Previous use recorded in public sources.",
    source: sourceFromUrls([item.source_url]),
    confidence: confidenceLabel(item.confidence_score),
  };
}

function eventToTimelineItem(event) {
  return {
    dateRange: event.date_or_period || "Historical event",
    useType: event.event_type || event.title || "Significant event",
    description: event.summary || HISTORICAL_EVENT_FALLBACK,
    source: sourceFromUrls(event.source_urls),
    confidence: confidenceLabel(event.confidence_score),
  };
}

function sourcesFromProfile(profile, fallbackBuilding) {
  const byKey = new Map();

  // Keep the public source list compact: show sources that actually support
  // displayed facts, then add a small fallback set from the selected record.
  factSourcesFromProfile(profile).forEach((source) => addSource(byKey, source));
  matchedCheckSources(profile).forEach((source) => addSource(byKey, source));

  if (byKey.size < 2) {
    [...(fallbackBuilding.sources || []), ...(fallbackBuilding.sourceLinks || [])]
      .forEach((source) => addSource(byKey, source));
  }

  return rankDisplaySources([...byKey.values()]).slice(0, MAX_DISPLAY_SOURCES);
}

function addSource(byKey, source = {}) {
  const name = source.name || source.sourceName || "";
  const url = source.url || source.sourceUrl || "";
  const key = normaliseSourceKey(url || name);
  if (!key) return;
  byKey.set(key, {
    name: name || "Unknown source",
    url,
    coverage: source.coverage || source.reference || "Source checked by the modular retrieval pipeline",
  });
}

function factSourcesFromProfile(profile = {}) {
  const sources = [];
  collectSourceUrls(sources, profile.buildDate?.source_urls, "Build date evidence");
  collectSourceUrls(sources, profile.whyBuilt?.source_urls, "Construction purpose/context evidence");
  collectSourceUrls(sources, profile.currentUse?.source_urls, "Current-use evidence");
  (profile.previousUse || []).forEach((item) => collectSourceUrls(sources, [item.source_url], "Previous-use evidence"));
  collectSourceUrls(sources, profile.coolHistoricalEvent?.source_urls, "Historical event evidence");
  return sources;
}

function matchedCheckSources(profile = {}) {
  return (profile.sourcesChecked || [])
    .filter((check) => check.status === "matched")
    .filter((check) => (check.extractedFacts || check.extracted_facts || []).some((factItem) => factItem?.value !== null && factItem?.value !== undefined && factItem?.value !== ""))
    .map((check) => ({
      name: check.sourceName || check.source_name,
      url: check.url || check.source_url,
      coverage: "Matched evidence used in this building profile",
    }));
}

function collectSourceUrls(sources, urls = [], coverage = "Evidence source") {
  (urls || []).filter(Boolean).forEach((url) => {
    sources.push({
      name: sourceNameFromUrl(url) || "Public source",
      url,
      coverage,
    });
  });
}

function rankDisplaySources(sources = []) {
  return sources
    .filter((source) => source.name || source.url)
    .sort((a, b) => displaySourceScore(b) - displaySourceScore(a));
}

function displaySourceScore(source = {}) {
  const text = `${source.name || ""} ${source.url || ""}`.toLowerCase();
  if (/historicengland|nhle|planning\.data|ordnancesurvey|ordnance survey/.test(text)) return 100;
  if (/official|council|local authority/.test(text)) return 90;
  if (/camra|heritage gateway|nationalarchives|maps\.nls/.test(text)) return 80;
  if (/wikidata/.test(text)) return 70;
  if (/wikipedia/.test(text)) return 65;
  if (/openstreetmap|overpass|nominatim/.test(text)) return 55;
  return 40;
}

function normaliseSourceKey(value = "") {
  return String(value || "").trim().replace(/\/$/, "").toLowerCase();
}

function sourceFromUrls(urls = [], fallback = {}) {
  const url = urls.find(Boolean) || fallback?.url || "";
  return {
    name: fallback?.name || sourceNameFromUrl(url) || MODULAR_SOURCE_NAME,
    url,
    coverage: fallback?.coverage || "Evidence selected by the modular retrieval pipeline",
  };
}

function primarySource(building) {
  return building.sources[0] || building.buildDate?.source || { name: MODULAR_SOURCE_NAME, url: "" };
}

function sourceTypeForSource(source = {}) {
  const name = String(source.name || "").toLowerCase();
  if (/historic england|nhle|planning data|ordnance survey|os /.test(name)) return "statutoryHeritageRegister";
  if (/official|council|local authority/.test(name)) return "localCouncilArchive";
  if (/wikidata|wikipedia/.test(name)) return "citedWiki";
  if (/openstreetmap|overpass|nominatim/.test(name)) return "communityMap";
  if (/mapbox/.test(name)) return "universitySpecialistInstitution";
  if (/camra|heritage/.test(name)) return "specialistHeritageOrganisation";
  return "uncitedClaim";
}

function confidenceScoreForBuilding(building) {
  return Math.max(confidenceScoreForLabel(building.buildDate?.confidence), 40);
}

function confidenceScoreForLabel(label = "") {
  const value = String(label || "").toLowerCase();
  if (value === "high") return 90;
  if (value === "medium") return 70;
  if (value === "low") return 45;
  return 0;
}

function confidenceLabel(score = 0) {
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

function fieldForBuildDate(value = "") {
  if (!value) return "estimated_build_date";
  if (/century|victorian|georgian|edwardian|tudor|medieval/i.test(value)) return "century";
  if (/c\.|circa|around|about|early|mid|late/i.test(value)) return "estimated_build_date";
  return "exact_build_date";
}

function knownAddress(address = "") {
  return address && address !== "Address not available" ? address : null;
}

function knownCurrentUse(currentUse = "") {
  return /not found|unknown/i.test(currentUse) ? null : currentUse;
}

function isListed(listedStatus = "") {
  if (!listedStatus) return null;
  return /listed|grade|nhle|national heritage list/i.test(listedStatus) ? true : null;
}

function extractListingGrade(listedStatus = "") {
  return listedStatus.match(/\bGrade\s+(?:I{1,3}\*?|II\*?)\b/i)?.[0] || null;
}

function profileListedStatus(profile) {
  const listed = profile.listedStatus || {};
  if (listed.listing_grade) return listed.listing_grade;
  if (listed.is_listed === true) return "Listed building";
  if (listed.official_description) return listed.official_description;
  return "";
}

function sourceNameFromUrl(url = "") {
  if (/historicengland/i.test(url)) return "Historic England";
  if (/wikidata/i.test(url)) return "Wikidata";
  if (/wikipedia/i.test(url)) return "Wikipedia";
  if (/openstreetmap/i.test(url)) return "OpenStreetMap";
  if (/camra/i.test(url)) return "CAMRA";
  return "";
}
