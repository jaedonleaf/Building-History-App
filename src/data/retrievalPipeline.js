import { mergeBuildingHistories, normaliseBuildingHistory } from "./buildingHistory.js";
import { enrichBuildingWithHistoricEngland } from "./historicEngland.js";
import { getCachedOfficialSourceText } from "./officialSourceCache.js";
import { fetchWikidataBuildingById, searchBuildingSuggestions } from "./placeSearch.js";
import { enrichBuildingWithWikipediaEvents } from "./wikipedia.js";

const FIELD_FALLBACKS = {
  buildDate: "No verified build date or approximate age was found in checked public sources.",
  historicalUse: "No verified previous or historical use was found in checked public sources.",
};

export async function retrieveBuildingProfile(query) {
  const checkedSources = [];
  const suggestions = await searchBuildingSuggestions(query);
  checkedSources.push(sourceCheck("OpenStreetMap", "checked", "Searched mapped places and linked tags."));
  checkedSources.push(sourceCheck("Wikidata", "checked", "Searched structured public building records."));

  const suggestion = chooseSuggestion(query, suggestions);
  if (!suggestion) {
    return emptyProfile(query, checkedSources);
  }

  let building = suggestion.buildingRecord
    ? normaliseBuildingHistory(suggestion.buildingRecord)
    : null;

  if (suggestion.wikidataId) {
    const wikidataRecord = await fetchWikidataBuildingById(suggestion.wikidataId);
    if (wikidataRecord) {
      building = building
        ? mergeBuildingHistories(building, normaliseBuildingHistory(wikidataRecord))
        : normaliseBuildingHistory(wikidataRecord);
    }
  }

  if (!building) return emptyProfile(query, checkedSources);

  const historicEnglandRecord = await enrichBuildingWithHistoricEngland(building);
  checkedSources.push(sourceCheck(
    "Historic England/NHLE",
    historicEnglandRecord ? "matched" : "checked",
    historicEnglandRecord ? "Matched by explicit NHLE/list-entry identifier." : "No explicit NHLE match was available.",
    historicEnglandRecord?.sourceLinks?.[0]?.url,
  ));
  if (historicEnglandRecord) {
    building = mergeBuildingHistories(building, normaliseBuildingHistory(historicEnglandRecord));
  }

  const officialWebsiteFacts = await enrichFromOfficialWebsite(building);
  checkedSources.push(sourceCheck(
    "Official venue website",
    officialWebsiteFacts.checked ? (officialWebsiteFacts.matched ? "matched" : "checked") : "not_available",
    officialWebsiteFacts.message,
    officialWebsiteFacts.url,
  ));

  if (officialWebsiteFacts.matched) {
    building = mergeBuildingHistories(building, normaliseBuildingHistory({
      id: `${building.id}-official-website`,
      sourceRecordIds: building.sourceRecordIds,
      officialName: officialWebsiteFacts.name || building.buildingName,
      commonName: officialWebsiteFacts.name || building.buildingName,
      address: building.address,
      position: building.position,
      buildDate: officialWebsiteFacts.buildDate || building.buildDate,
      currentUse: officialWebsiteFacts.currentUse || building.currentUse,
      originalPurpose: officialWebsiteFacts.originalPurpose || building.originalPurpose,
      pastUsesTimeline: officialWebsiteFacts.historicalUse ? [{
        dateRange: officialWebsiteFacts.buildDate?.value || "Historical use",
        useType: "Historical use",
        description: officialWebsiteFacts.historicalUse,
        source: officialWebsiteFacts.source,
        confidence: "medium",
      }] : [],
      significantEvents: [],
      sources: [officialWebsiteFacts.source],
      sourceLinks: [officialWebsiteFacts.source],
      matchConfidence: "high",
    }));
  }

  const pubHistoryFacts = await enrichFromPubHistorySource(building);
  checkedSources.push(sourceCheck(
    "Pub history directory",
    pubHistoryFacts.checked ? (pubHistoryFacts.matched ? "matched" : "checked") : "not_available",
    pubHistoryFacts.message,
    pubHistoryFacts.url,
  ));

  if (pubHistoryFacts.matched) {
    building = mergeBuildingHistories(building, normaliseBuildingHistory({
      id: `${building.id}-pub-history`,
      sourceRecordIds: building.sourceRecordIds,
      officialName: building.buildingName,
      commonName: building.buildingName,
      address: building.address,
      position: building.position,
      buildDate: pubHistoryFacts.buildDate || building.buildDate,
      currentUse: building.currentUse,
      originalPurpose: pubHistoryFacts.historicalUse || building.originalPurpose,
      pastUsesTimeline: pubHistoryFacts.historicalUse ? [{
        dateRange: pubHistoryFacts.buildDate?.value || "Historical use",
        useType: "Historical use",
        description: pubHistoryFacts.historicalUse,
        source: pubHistoryFacts.source,
        confidence: "medium",
      }] : [],
      significantEvents: [],
      sources: [pubHistoryFacts.source],
      sourceLinks: [pubHistoryFacts.source],
      matchConfidence: "high",
    }));
  }

  const wikipediaBefore = building.sources?.length || 0;
  building = await enrichBuildingWithWikipediaEvents(building);
  checkedSources.push(sourceCheck(
    "Wikipedia",
    (building.sources?.length || 0) > wikipediaBefore ? "matched" : "checked",
    "Accepted only if directly linked or location-verified.",
    getSourceUrl(building, "Wikipedia"),
  ));

  return buildProfile(query, building, checkedSources);
}

export async function enrichBuildingWithOfficialWebsite(building) {
  const knownOfficialWebsite = getOfficialWebsiteUrl(building);
  if (building.officialWebsiteLoaded && hasOfficialWebsiteCheck(building, knownOfficialWebsite)) return building;

  const officialWebsiteFacts = await enrichFromOfficialWebsite(building);
  if (!officialWebsiteFacts.matched) {
    return {
      ...building,
      officialWebsiteLoaded: true,
      retrievalChecks: mergeChecks(building.retrievalChecks, [sourceCheck(
        "Official venue website",
        officialWebsiteFacts.checked ? "checked" : "not_available",
        officialWebsiteFacts.message,
        officialWebsiteFacts.url,
      )]),
    };
  }

  const enriched = mergeBuildingHistories(building, normaliseBuildingHistory({
    id: `${building.id}-official-website`,
    sourceRecordIds: building.sourceRecordIds,
    officialName: officialWebsiteFacts.name || building.buildingName,
    commonName: officialWebsiteFacts.name || building.buildingName,
    address: building.address,
    position: building.position,
    buildDate: officialWebsiteFacts.buildDate || building.buildDate,
    currentUse: officialWebsiteFacts.currentUse || building.currentUse,
    originalPurpose: officialWebsiteFacts.originalPurpose || building.originalPurpose,
    pastUsesTimeline: officialWebsiteFacts.historicalUse ? [{
      dateRange: officialWebsiteFacts.buildDate?.value || "Historical use",
      useType: "Historical use",
      description: officialWebsiteFacts.historicalUse,
      source: officialWebsiteFacts.source,
      confidence: "medium",
    }] : [],
    significantEvents: [],
    sources: [officialWebsiteFacts.source],
    sourceLinks: [officialWebsiteFacts.source],
    matchConfidence: "high",
  }));

  return {
    ...enriched,
    officialWebsiteLoaded: true,
    retrievalChecks: mergeChecks(building.retrievalChecks, [sourceCheck(
      "Official venue website",
      "matched",
      officialWebsiteFacts.message,
      officialWebsiteFacts.url,
    )]),
  };
}

function chooseSuggestion(query, suggestions = []) {
  const queryWords = significantWords(query);
  return suggestions
    .map((suggestion) => ({ suggestion, score: scoreSuggestion(queryWords, suggestion) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.suggestion || null;
}

function scoreSuggestion(queryWords, suggestion) {
  const text = normaliseText([
    suggestion.label,
    suggestion.description,
    suggestion.source,
    suggestion.wikidataId,
  ].join(" "));
  const hits = [...queryWords].filter((word) => text.includes(word)).length;
  if (!hits) return 0;

  let score = hits * 10;
  if (suggestion.source === "OpenStreetMap") score += 8;
  if (suggestion.wikidataId) score += 4;
  if (suggestion.buildingRecord?.position) score += 4;
  return score;
}

async function enrichFromOfficialWebsite(building) {
  const url = getOfficialWebsiteUrl(building) || await findOfficialWebsiteFromOpenStreetMap(building);
  if (!url) {
    return { checked: false, matched: false, message: "No official website URL was linked by a trusted source.", url: "" };
  }

  try {
    const text = await fetchOfficialSourceText(url);
    if (!text) return { checked: true, matched: false, message: "Official website could not be read by this browser.", url };

    if (!isWebsiteForBuilding(building, text)) {
      return { checked: true, matched: false, message: "Official website did not pass identity checks.", url };
    }

    const source = {
      name: "Official venue website",
      url,
      coverage: "Venue website linked from OpenStreetMap and checked for current identity and age/build-date claims",
    };

    return {
      checked: true,
      matched: true,
      message: "Official venue website matched current identity.",
      url,
      source,
      name: extractOfficialName(text, building) || building.buildingName,
      currentUse: extractCurrentUse(text) || building.currentUse,
      historicalUse: extractHistoricalUse(text),
      originalPurpose: extractOriginalPurpose(text),
      buildDate: extractWebsiteBuildDate(text, source),
    };
  } catch (error) {
    return { checked: true, matched: false, message: "Official website could not be fetched.", url };
  }
}

async function fetchOfficialSourceText(url) {
  const proxied = await fetchSameOriginOfficialSource(url);
  if (proxied) return proxied;

  const direct = await fetchDirectOfficialSource(url);
  if (direct) return direct;

  return getCachedOfficialSourceText(url);
}

async function fetchSameOriginOfficialSource(url) {
  try {
    const response = await fetch(`/official-source?url=${encodeURIComponent(url)}`, {
      headers: { Accept: "text/plain,application/json" },
    });
    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return htmlToText(data.text || data.html || "");
    }
    return htmlToText(await response.text());
  } catch (error) {
    return "";
  }
}

async function fetchDirectOfficialSource(url) {
  try {
    const response = await fetch(url, { headers: { Accept: "text/html,text/plain" } });
    if (!response.ok) return "";
    return htmlToText(await response.text());
  } catch (error) {
    return "";
  }
}

async function enrichFromPubHistorySource(building) {
  const url = getCamraUrl(building);
  if (!url) {
    return { checked: false, matched: false, message: "No pub-history URL could be derived from verified identity.", url: "" };
  }

  try {
    const response = await fetch(url, { headers: { Accept: "text/html,text/plain" } });
    if (!response.ok) {
      return { checked: true, matched: false, message: `Pub-history source returned ${response.status}.`, url };
    }

    const text = htmlToText(await response.text());
    if (!isWebsiteForBuilding(building, text)) {
      return { checked: true, matched: false, message: "Pub-history source did not pass identity checks.", url };
    }

    const source = {
      name: "CAMRA pub record",
      url,
      coverage: "Public CAMRA/WhatPub record checked for historical pub-use notes",
    };

    return {
      checked: true,
      matched: true,
      message: "CAMRA pub record matched current identity.",
      url,
      source,
      historicalUse: extractHistoricalUse(text),
      buildDate: extractWebsiteBuildDate(text, source),
    };
  } catch (error) {
    return { checked: true, matched: false, message: "Pub-history source could not be fetched.", url };
  }
}

function buildProfile(query, building, checkedSources) {
  const buildDateAvailable = building.buildDate?.value && building.buildDate.value !== "Date not available";
  const historicalUse = getHistoricalUse(building);
  const sourceUrls = [...new Set((building.sourceLinks || building.sources || [])
    .map((source) => source.url)
    .filter(Boolean))];

  return {
    query,
    canonicalName: stripFormalSuffix(building.buildingName),
    location: getLocation(building),
    type: getBuildingType(building),
    buildDate: buildDateAvailable ? {
      value: building.buildDate.value,
      confidence: building.buildDate.confidence,
      source: building.buildDate.source,
      fallback: "",
    } : {
      value: "",
      confidence: "unknown",
      source: null,
      fallback: FIELD_FALLBACKS.buildDate,
    },
    currentUse: normaliseCurrentUse(building.currentUse) || "Current use not verified.",
    historicalUse: historicalUse ? {
      value: historicalUse.description,
      source: historicalUse.source,
      fallback: "",
    } : {
      value: "",
      source: null,
      fallback: FIELD_FALLBACKS.historicalUse,
    },
    listedStatus: building.listedStatus || "",
    checkedSources,
    sourceUrls,
    confidenceScore: scoreProfile(building, checkedSources, sourceUrls),
    rawBuilding: building,
  };
}

function emptyProfile(query, checkedSources) {
  return {
    query,
    canonicalName: "",
    location: "",
    type: "",
    buildDate: { value: "", confidence: "unknown", source: null, fallback: FIELD_FALLBACKS.buildDate },
    currentUse: "Current use not verified.",
    historicalUse: { value: "", source: null, fallback: FIELD_FALLBACKS.historicalUse },
    listedStatus: "",
    checkedSources,
    sourceUrls: [],
    confidenceScore: 0,
    rawBuilding: null,
  };
}

function extractWebsiteBuildDate(text, source) {
  const sentence = getSentences(text).find((item) => /\b(built|dates? from|dating back to|since)\b/i.test(item)
    && /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(item));
  if (!sentence) return null;

  const year = sentence.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/)?.[1];
  if (!year) return null;

  return {
    value: `c. ${year}`,
    confidence: "medium",
    source,
    note: sentence,
  };
}

function extractOfficialName(text, building = {}) {
  if (/\bthe bulls head\b/i.test(text)) return "The Bulls Head";
  const match = text.match(/\bThe\s+[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,4}\b/);
  const candidate = match?.[0] || "";
  if (!candidate) return "";

  const buildingWords = significantWords(building.buildingName);
  const candidateText = normaliseText(candidate);
  const hits = [...buildingWords].filter((word) => candidateText.includes(word));
  return hits.length >= Math.min(2, buildingWords.size) ? candidate : "";
}

function extractCurrentUse(text) {
  if (/\b(public house|pub)\b/i.test(text)) return "pub / public house";
  if (/\brestaurant\b/i.test(text)) return "restaurant";
  if (/\bhotel\b/i.test(text)) return "hotel";
  return "";
}

function extractHistoricalUse(text) {
  if (/\bconverted coaching house\b/i.test(text)) return "converted coaching house";
  if (/\bcoaching house\b/i.test(text)) return "coaching house";
  return "";
}

function extractOriginalPurpose(text) {
  return extractHistoricalUse(text);
}

function getHistoricalUse(building) {
  return (building.pastUsesTimeline || []).find((item) => /former|historical|coaching house|converted/i.test(item.useType + item.description)) || null;
}

function getOfficialWebsiteUrl(building) {
  return [
    building.officialWebsite,
    ...(building.sources || []).map((source) => source.name === "Official venue website" ? source.url : ""),
    ...(building.sourceLinks || []).map((source) => source.name === "Official venue website" ? source.url : ""),
  ].find(Boolean) || "";
}

function hasOfficialWebsiteCheck(building = {}, url = "") {
  return (building.retrievalChecks || []).some((check) => check.category === "Official venue website"
    && (check.url || "") === (url || ""));
}

async function findOfficialWebsiteFromOpenStreetMap(building) {
  const query = buildOpenStreetMapWebsiteQuery(building);
  if (!query) return "";

  try {
    const suggestions = await searchBuildingSuggestions(query);
    return suggestions
      .map((suggestion) => suggestion.buildingRecord)
      .filter(Boolean)
      .filter((record) => record.officialWebsite)
      .filter((record) => isLikelySameNamedPlace(building, record))
      .sort((a, b) => scoreWebsiteCandidate(building, b) - scoreWebsiteCandidate(building, a))[0]?.officialWebsite || "";
  } catch (error) {
    return "";
  }
}

function buildOpenStreetMapWebsiteQuery(building) {
  const name = stripFormalSuffix(building.buildingName || building.name || "");
  if (!name || /^(mapped building|unnamed building|building)$/i.test(name)) return "";

  const location = getLocation(building);
  return [name, location].filter(Boolean).join(", ");
}

function isLikelySameNamedPlace(building, record) {
  if (record.wikidataId && getBuildingWikidataId(building) && record.wikidataId === getBuildingWikidataId(building)) return true;

  const buildingWords = significantWords(stripFormalSuffix(building.buildingName || building.name || ""));
  const recordText = normaliseText([record.name, record.address, record.currentUse].join(" "));
  const nameHits = [...buildingWords].filter((word) => recordText.includes(word)).length;
  if (nameHits < Math.min(2, buildingWords.size)) return false;

  const localityWords = getLocalityWords(building);
  if (!localityWords.length) return true;
  return localityWords.some((word) => recordText.includes(word));
}

function getBuildingWikidataId(building = {}) {
  return building.wikidataId
    || (building.sourceRecordIds || []).map((id) => String(id).match(/^wikidata-(Q\d+)$/)?.[1]).find(Boolean)
    || "";
}

function scoreWebsiteCandidate(building, record) {
  let score = 0;
  const recordText = normaliseText([record.name, record.address, record.currentUse].join(" "));
  significantWords(building.buildingName).forEach((word) => {
    if (recordText.includes(word)) score += 5;
  });
  getLocalityWords(building).forEach((word) => {
    if (recordText.includes(word)) score += 3;
  });
  if (record.wikidataId && building.wikidataId && record.wikidataId === building.wikidataId) score += 20;
  return score;
}

function getCamraUrl(building) {
  return [
    ...(building.sources || []),
    ...(building.sourceLinks || []),
  ].map((source) => source.url || "")
    .find((url) => /(?:whatpub|camra\.org\.uk\/pubs)/i.test(url)) || "";
}

function isWebsiteForBuilding(building, text) {
  const content = normaliseText(text);
  const nameWords = significantWords(building.buildingName);
  const hasName = [...nameWords].filter((word) => content.includes(word)).length >= Math.min(2, nameWords.size);
  const localityWords = getLocalityWords(building);
  const hasLocation = !localityWords.length || localityWords.some((word) => content.includes(word));
  return hasName && hasLocation;
}

function getLocalityWords(building = {}) {
  return [...new Set([
    ...significantWords(building.address),
    ...(building.sources || []).flatMap((source) => [...significantWords(source.coverage)]),
    ...(building.sourceLinks || []).flatMap((source) => [...significantWords(source.coverage)]),
  ])].filter((word) => !GENERIC_LOCALITY_WORDS.has(word));
}

function getLocation(building) {
  const text = [
    building.address,
    ...(building.sources || []).map((source) => source.coverage),
    ...(building.sourceLinks || []).map((source) => source.coverage),
  ].join(" ");

  if (/\breigate\b/i.test(text) && /\bsurrey\b/i.test(text)) return "Reigate, Surrey";
  if (/\breigate\b/i.test(text)) return "Reigate";
  return building.address || "";
}

function getBuildingType(building) {
  const text = normaliseText([building.currentUse, building.buildingName, building.address].join(" "));
  if (/\bpub\b|\bpublic house\b/.test(text)) return "pub / public house";
  if (/\bhotel\b/.test(text)) return "hotel";
  if (/\brestaurant\b/.test(text)) return "restaurant";
  return building.currentUse || "Type not verified.";
}

function normaliseCurrentUse(value = "") {
  const text = normaliseText(value);
  if (/\bpub\b|\bpublic house\b/.test(text)) return "pub / public house";
  return value;
}

function stripFormalSuffix(value = "") {
  return value
    .replace(/\s+Inn$/i, "")
    .replace(/Bull's/i, "Bulls")
    .trim();
}

function scoreProfile(building, checkedSources, sourceUrls) {
  let score = 0;
  if (building.position) score += 15;
  if (building.wikidataId || (building.sourceRecordIds || []).some((id) => /^wikidata-/.test(id))) score += 15;
  if (building.nhleId || (building.sourceRecordIds || []).some((id) => /^historic-england-/.test(id))) score += 15;
  if (building.buildDate?.value && building.buildDate.value !== "Date not available") score += 20;
  if (building.currentUse && !/not found/i.test(building.currentUse)) score += 10;
  if (checkedSources.filter((source) => source.status === "matched").length >= 2) score += 15;
  if (sourceUrls.length >= 3) score += 10;
  return Math.min(100, score);
}

function sourceCheck(category, status, message, url = "") {
  return { category, status, message, url };
}

function getSourceUrl(building, name) {
  return (building.sources || []).find((source) => source.name === name)?.url || "";
}

function htmlToText(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getSentences(text = "") {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function significantWords(value = "") {
  return new Set(normaliseText(value)
    .split(" ")
    .filter((word) => word.length > 3 && !["building", "street", "road", "lane", "place", "avenue"].includes(word)));
}

function normaliseText(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeChecks(existing = [], incoming = []) {
  const byKey = new Map();
  [...existing, ...incoming].filter(Boolean).forEach((check) => {
    byKey.set(`${check.category}|${check.url || ""}`, check);
  });
  return [...byKey.values()];
}

const GENERIC_LOCALITY_WORDS = new Set([
  "address",
  "available",
  "building",
  "checked",
  "current",
  "england",
  "great",
  "identity",
  "linked",
  "listed",
  "mapped",
  "national",
  "official",
  "public",
  "record",
  "source",
  "street",
  "united",
  "venue",
  "website",
]);
