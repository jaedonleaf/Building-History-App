export const SOURCE_CONFIDENCE = {
  governmentDataset: 95,
  statutoryGovernment: 95,
  statutoryHeritageRegister: 90,
  historicEngland: 90,
  heritageGatewayArchiveMuseum: 85,
  localCouncilArchive: 85,
  universityInstitution: 80,
  universitySpecialistInstitution: 80,
  localHistory: 75,
  localHistorySociety: 75,
  specialistHeritageGroup: 70,
  specialistHeritageOrganisation: 70,
  citedWiki: 65,
  communityMap: 60,
  localBlog: 50,
  blogArticle: 50,
  uncitedClaim: 30,
  unverifiedClaim: 30,
};

export const UNKNOWN_NOTE = "No source-backed value has been verified for this field yet.";

export function createEvidence({
  pipeline,
  field,
  value = null,
  sourceName = "",
  sourceUrl = "",
  sourceType = "uncitedClaim",
  evidenceQuote = "",
  confidenceScore,
  uncertaintyNotes = "",
  retrievalTimestamp = new Date().toISOString(),
  raw = null,
} = {}) {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
  const resolvedConfidence = Number.isFinite(confidenceScore) ? confidenceScore : sourceConfidence(sourceType);
  return {
    pipeline,
    field,
    value: hasValue ? value : null,
    sourceName,
    source_name: sourceName,
    sourceUrl,
    source_url: sourceUrl,
    sourceType,
    source_category: sourceType,
    evidenceQuote,
    evidence_snippet: evidenceQuote,
    confidenceScore: resolvedConfidence,
    confidence_score: resolvedConfidence,
    uncertaintyNotes: uncertaintyNotes || (hasValue ? "" : UNKNOWN_NOTE),
    uncertainty_notes: uncertaintyNotes || (hasValue ? "" : UNKNOWN_NOTE),
    retrievalTimestamp,
    retrieval_timestamp: retrievalTimestamp,
    raw,
  };
}

export function createSourceCheck({
  pipeline,
  sourceName,
  sourceType = "uncitedClaim",
  status = "planned",
  query = "",
  url = "",
  failureReason = "",
  rawSnippet = "",
  extractedFacts = [],
  confidenceScore,
  retrievalTimestamp = new Date().toISOString(),
} = {}) {
  const resolvedConfidence = Number.isFinite(confidenceScore) ? confidenceScore : sourceConfidence(sourceType);
  return {
    pipeline,
    sourceName,
    source_name: sourceName,
    sourceType,
    source_category: sourceType,
    status,
    query,
    url,
    source_url: url,
    failureReason,
    failure_reason: failureReason,
    rawSnippet,
    raw_snippet: rawSnippet,
    extractedFacts,
    extracted_facts: extractedFacts,
    confidenceScore: resolvedConfidence,
    confidence_score: resolvedConfidence,
    retrievalTimestamp,
    retrieval_timestamp: retrievalTimestamp,
  };
}

export function selectBestEvidence(evidenceItems = []) {
  const verified = evidenceItems
    .filter((item) => item?.value !== null && item?.value !== undefined && item.sourceUrl)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);

  if (!verified.length) {
    return {
      value: null,
      evidence: [],
      source_urls: [],
      confidence_score: 0,
      uncertainty_notes: UNKNOWN_NOTE,
    };
  }

  const selected = verified[0];
  return {
    value: selected.value,
    evidence: verified,
    source_urls: unique(verified.map((item) => item.sourceUrl)),
    confidence_score: selected.confidenceScore,
    uncertainty_notes: selected.uncertaintyNotes || "",
  };
}

export function findConflicts(evidenceItems = []) {
  const byField = new Map();
  evidenceItems
    .filter((item) => item?.value !== null && item?.value !== undefined && item.sourceUrl)
    .forEach((item) => {
      const bucket = byField.get(item.field) || new Map();
      const key = normaliseValue(item.value);
      bucket.set(key, [...(bucket.get(key) || []), item]);
      byField.set(item.field, bucket);
    });

  return [...byField.entries()]
    .filter(([, valueGroups]) => valueGroups.size > 1)
    .map(([field, valueGroups]) => ({
      field,
      claims: [...valueGroups.values()].map((items) => ({
        value: items[0].value,
        confidence_score: Math.max(...items.map((item) => item.confidenceScore)),
        source_urls: unique(items.map((item) => item.sourceUrl)),
      })),
      resolution: "Preserved conflicting claims. Final display should use the highest-confidence sourced claim.",
    }));
}

export function sourceConfidence(sourceType = "uncitedClaim") {
  return SOURCE_CONFIDENCE[sourceType] || SOURCE_CONFIDENCE.uncitedClaim;
}

export function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
