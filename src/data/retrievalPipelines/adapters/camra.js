import { createEvidence, createSourceCheck } from "../evidence.js";
import { getSourceById } from "../sourceRegistry.js";

const CAMRA_SOURCE_IDS = ["camra-pub-search", "camra-heritage-pubs"];
const CAMRA_PIPELINES = ["buildDate", "previousUse"];
const CAMRA_SEARCH_URL = "https://camra.org.uk/pubs/";
const MAX_CAMRA_CANDIDATES = 5;

export function createCamraSourceAdapter({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: "camra-source-adapter",
    supportedSourceIds: CAMRA_SOURCE_IDS,
    supportedPipelines: CAMRA_PIPELINES,
    async collect({ pipeline, context }) {
      if (!CAMRA_PIPELINES.includes(pipeline.id)) return emptyResult();
      if (!isPubContext(context)) return emptyResult();

      const source = chooseCamraSource(context);
      const query = buildCamraQuery(context);
      const candidateUrls = await discoverCamraCandidateUrls({ context, query, fetchImpl });
      const checks = [];

      if (!candidateUrls.length) {
        checks.push(createSourceCheck({
          pipeline: pipeline.id,
          sourceName: source.source_name,
          sourceType: source.source_category,
          status: "checked",
          query,
          url: source.source_url,
          failureReason: "No CAMRA pub page URL was discovered for this building.",
          confidenceScore: source.confidence_weight,
        }));
        return { evidence: [], checks };
      }

      const pages = await fetchCandidatePages({ candidateUrls, fetchImpl });
      const matchedPage = chooseMatchedPage(context, pages);
      if (!matchedPage) {
        checks.push(createSourceCheck({
          pipeline: pipeline.id,
          sourceName: source.source_name,
          sourceType: source.source_category,
          status: "checked",
          query,
          url: source.source_url,
          failureReason: "CAMRA candidate pages did not pass identity/location checks.",
          rawSnippet: pages.map((page) => page.text.slice(0, 280)).join(" | "),
          confidenceScore: source.confidence_weight,
        }));
        return { evidence: [], checks };
      }

      const extracted = pipeline.id === "buildDate"
        ? extractBuildDateEvidence({ pipelineId: pipeline.id, page: matchedPage, source })
        : extractPreviousUseEvidence({ pipelineId: pipeline.id, page: matchedPage, source });

      checks.push(createSourceCheck({
        pipeline: pipeline.id,
        sourceName: source.source_name,
        sourceType: source.source_category,
        status: extracted.length ? "matched" : "checked",
        query,
        url: matchedPage.url,
        rawSnippet: matchedPage.text.slice(0, 500),
        extractedFacts: extracted.map((item) => ({
          field: item.field,
          value: item.value,
        })),
        confidenceScore: source.confidence_weight,
      }));

      return { evidence: extracted, checks };
    },
  };
}

export async function discoverCamraCandidateUrls({ context = {}, query = "", fetchImpl = globalThis.fetch } = {}) {
  const explicitUrls = getExplicitCamraUrls(context);
  if (explicitUrls.length) return explicitUrls;
  if (typeof fetchImpl !== "function") return [];

  const searchUrl = `${CAMRA_SEARCH_URL}?search=${encodeURIComponent(query)}`;
  try {
    const response = await fetchImpl(searchUrl, { headers: requestHeaders() });
    if (!response?.ok) return [];
    const html = await response.text();
    return extractCamraPubUrls(html).slice(0, MAX_CAMRA_CANDIDATES);
  } catch (error) {
    return [];
  }
}

export function extractBuildDateEvidence({ pipelineId, page, source }) {
  const sentence = findBuildDateSentence(page.text);
  if (!sentence) return [];

  const field = buildDateField(sentence);
  const value = extractBuildDateValue(sentence, field);
  if (!value) return [];

  return [createEvidence({
    pipeline: pipelineId,
    field,
    value,
    sourceName: source.source_name,
    sourceUrl: page.url,
    sourceType: source.source_category,
    confidenceScore: source.confidence_weight,
    evidenceQuote: sentence,
    uncertaintyNotes: field === "exact_build_date"
      ? ""
      : "CAMRA wording is approximate; date has not been converted into an exact construction year.",
  })];
}

export function extractPreviousUseEvidence({ pipelineId, page, source }) {
  const sentence = findPreviousUseSentence(page.text);
  if (!sentence) return [];

  const use = extractPreviousUseValue(sentence);
  if (!use) return [];

  return [createEvidence({
    pipeline: pipelineId,
    field: "previous_uses",
    value: {
      use,
      approximate_dates: extractApproximateDateFromSentence(sentence),
      evidence: sentence,
      source_url: page.url,
      confidence_score: source.confidence_weight,
    },
    sourceName: source.source_name,
    sourceUrl: page.url,
    sourceType: source.source_category,
    confidenceScore: source.confidence_weight,
    evidenceQuote: sentence,
  })];
}

function chooseCamraSource(context = {}) {
  const activeSourceIds = new Set((context.activeSources || []).map((source) => source.id));
  return CAMRA_SOURCE_IDS
    .filter((id) => activeSourceIds.has(id))
    .map(getSourceById)
    .find(Boolean) || getSourceById("camra-pub-search");
}

async function fetchCandidatePages({ candidateUrls, fetchImpl }) {
  const pages = [];
  for (const url of candidateUrls.slice(0, MAX_CAMRA_CANDIDATES)) {
    try {
      const response = await fetchImpl(url, { headers: requestHeaders() });
      if (!response?.ok) continue;
      pages.push({ url, text: htmlToText(await response.text()) });
    } catch (error) {
      // Failed candidates are represented by the aggregate source check.
    }
  }
  return pages;
}

function chooseMatchedPage(context, pages) {
  return pages
    .map((page) => ({ page, score: scoreCamraPage(context, page.text) }))
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score)[0]?.page || null;
}

function scoreCamraPage(context = {}, text = "") {
  const content = normaliseText(text);
  const nameWords = significantWords(context.selectedPlaceName || context.identity?.canonical_name || "");
  const locationWords = significantWords([
    context.address,
    context.location?.town,
    context.location?.county,
  ].join(" "));

  let score = 0;
  nameWords.forEach((word) => {
    if (content.includes(word)) score += 2;
  });
  locationWords.forEach((word) => {
    if (content.includes(word)) score += 1;
  });
  if (/\b(pub|public house|inn|real ale|camra)\b/.test(content)) score += 1;
  return score;
}

function getExplicitCamraUrls(context = {}) {
  return [
    context.camraUrl,
    ...(context.sourceUrls || []),
    ...(context.sources || []).map((source) => source.url),
    ...(context.sourceLinks || []).map((source) => source.url),
  ]
    .filter(Boolean)
    .filter((url) => /^https?:\/\/(?:www\.)?camra\.org\.uk\/pubs\//i.test(url))
    .map((url) => url.replace(/\/feedback\/?$/i, ""))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function extractCamraPubUrls(html = "") {
  const urls = new Set();
  const patterns = [
    /https:\/\/camra\.org\.uk\/pubs\/[a-z0-9-]+-\d+/gi,
    /href=["'](\/pubs\/[a-z0-9-]+-\d+)["']/gi,
  ];

  patterns.forEach((pattern) => {
    for (const match of html.matchAll(pattern)) {
      const url = match[1]?.startsWith("/")
        ? `https://camra.org.uk${match[1]}`
        : match[0].replace(/^href=["']|["']$/g, "");
      urls.add(url);
    }
  });

  return [...urls];
}

function findBuildDateSentence(text = "") {
  return getSentences(text).find((sentence) => /\b(built|dates? from|dating from|dating back to|opened|originat(?:es|ed))\b/i.test(sentence)
    && /\b(?:c\.?|circa|around|about|early|mid|late)?\s*(?:1[0-9]{3}|20[0-2][0-9]|[0-9]{1,2}(?:st|nd|rd|th)\s+century|victorian|georgian|edwardian|tudor|medieval)\b/i.test(sentence));
}

function buildDateField(sentence = "") {
  if (/\b(?:c\.?|circa|around|about|early|mid|late|century|victorian|georgian|edwardian|tudor|medieval)\b/i.test(sentence)) {
    if (/\bcentury\b/i.test(sentence) || /\b(victorian|georgian|edwardian|tudor|medieval)\b/i.test(sentence)) return "century";
    return "estimated_build_date";
  }
  return "exact_build_date";
}

function extractBuildDateValue(sentence = "", field = "") {
  const year = sentence.match(/\b(?:c\.?|circa|around|about)?\s*(1[0-9]{3}|20[0-2][0-9])\b/i);
  if (year) {
    const prefix = /\b(c\.?|circa|around|about)\b/i.test(sentence) || field === "estimated_build_date" ? "c." : "";
    return `${prefix}${prefix ? "" : ""}${year[1]}`.replace(/^c\./, "c.");
  }

  const century = sentence.match(/\b(?:early|mid|late)?\s*[0-9]{1,2}(?:st|nd|rd|th)\s+century\b/i);
  if (century) return century[0].trim();

  const period = sentence.match(/\b(victorian|georgian|edwardian|tudor|medieval)\b/i);
  return period?.[0] || "";
}

function findPreviousUseSentence(text = "") {
  return getSentences(text).find((sentence) => /\b(former|formerly|converted from|converted to|previously|used to be|was once|now a|now an)\b/i.test(sentence));
}

function extractPreviousUseValue(sentence = "") {
  const patterns = [
    /\bformer\s+([^.;,]+)/i,
    /\bformerly\s+(?:a|an|the)?\s*([^.;,]+)/i,
    /\bconverted from\s+(?:a|an|the)?\s*([^.;,]+)/i,
    /\bpreviously\s+(?:a|an|the)?\s*([^.;,]+)/i,
    /\bwas once\s+(?:a|an|the)?\s*([^.;,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (match?.[1]) return cleanUse(match[1]);
  }
  return "";
}

function extractApproximateDateFromSentence(sentence = "") {
  return sentence.match(/\b(?:c\.?|circa|around|about)?\s*(?:1[0-9]{3}|20[0-2][0-9]|[0-9]{1,2}(?:st|nd|rd|th)\s+century|victorian|georgian|edwardian|tudor|medieval)\b/i)?.[0] || "";
}

function buildCamraQuery(context = {}) {
  return [
    context.selectedPlaceName,
    context.identity?.canonical_name,
    context.address,
    context.location?.town,
    context.location?.county,
  ].filter(Boolean).join(" ");
}

function isPubContext(context = {}) {
  const text = [
    context.placeType,
    context.identity?.likely_place_type,
    context.selectedPlaceName,
    context.currentUse?.current_use,
  ].join(" ").toLowerCase();
  return /\b(pub|public house|inn|bar)\b/.test(text);
}

function requestHeaders() {
  return {
    Accept: "text/html,text/plain",
  };
}

function htmlToText(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;/g, "'")
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
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function normaliseText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanUse(value = "") {
  return value
    .replace(/\b(now|that|which|with|and)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function emptyResult() {
  return { evidence: [], checks: [] };
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "pub",
  "inn",
  "bar",
  "public",
  "house",
]);
