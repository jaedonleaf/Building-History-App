import { createEvidence, selectBestEvidence } from "./evidence.js";

export const identityPipeline = definePipeline({
  id: "identity",
  label: "Identity / Name Resolution",
  fields: ["canonical_name", "alternative_names", "likely_place_type", "matched_sources"],
  emptyOutput() {
    return {
      canonical_name: null,
      alternative_names: [],
      likely_place_type: null,
      matched_sources: [],
      confidence_score: 0,
      notes: "Building identity has not been verified yet.",
    };
  },
});

export const locationPipeline = definePipeline({
  id: "location",
  label: "Location / Address Validation",
  fields: ["full_address", "street", "town", "county", "postcode", "coordinates"],
  emptyOutput(context) {
    return {
      full_address: context.address || null,
      street: null,
      town: null,
      county: null,
      postcode: null,
      coordinates: context.coordinates || null,
      location_confidence: context.coordinates ? 40 : 0,
      notes: context.coordinates
        ? "Coordinates were supplied by the map selection but have not been independently validated yet."
        : "Location has not been verified yet.",
    };
  },
});

export const buildDatePipeline = definePipeline({
  id: "buildDate",
  label: "Build Date / Age",
  fields: ["exact_build_date", "estimated_build_date", "date_range", "century"],
  emptyOutput() {
    return {
      exact_build_date: null,
      estimated_build_date: null,
      date_range: null,
      century: null,
      evidence_quotes: [],
      source_urls: [],
      confidence_score: 0,
      conflict_notes: "No source-backed build date or approximate age has been verified yet.",
    };
  },
});

export const whyBuiltPipeline = definePipeline({
  id: "whyBuilt",
  label: "Why It Was Built",
  fields: ["original_purpose", "historical_context", "related_transport_trade_religious_commercial_context"],
  emptyOutput() {
    return {
      original_purpose: null,
      historical_context: null,
      related_transport_trade_religious_commercial_context: null,
      source_urls: [],
      confidence_score: 0,
      uncertainty_notes: "No source-backed original purpose or construction context has been verified yet.",
    };
  },
});

export const currentUsePipeline = definePipeline({
  id: "currentUse",
  label: "Current Use",
  fields: ["current_use", "business_name_if_relevant", "category", "opening_status_if_available"],
  emptyOutput() {
    return {
      current_use: null,
      business_name_if_relevant: null,
      category: null,
      opening_status_if_available: null,
      source_urls: [],
      confidence_score: 0,
      uncertainty_notes: "Current use has not been verified yet.",
    };
  },
});

export const previousUsePipeline = definePipeline({
  id: "previousUse",
  label: "Previous Use",
  fields: ["previous_uses"],
  emptyOutput() {
    return {
      previous_uses: [],
      confidence_score: 0,
      uncertainty_notes: "No source-backed previous uses have been verified yet.",
    };
  },
});

export const listedStatusPipeline = definePipeline({
  id: "listedStatus",
  label: "Listed Status",
  fields: ["is_listed", "listing_grade", "list_entry_number", "official_description"],
  emptyOutput() {
    return {
      is_listed: null,
      listing_grade: null,
      list_entry_number: null,
      official_description: null,
      source_url: null,
      confidence_score: 0,
      notes: "Listed status has not been verified against an official register yet.",
    };
  },
});

export const coolHistoricalEventPipeline = definePipeline({
  id: "coolHistoricalEvent",
  label: "Cool Historical Event",
  fields: ["title", "summary", "date_or_period", "people_involved", "event_type", "legend_or_verified"],
  emptyOutput() {
    return {
      title: null,
      summary: "Nothing that interesting has happened here -_-",
      date_or_period: null,
      people_involved: [],
      event_type: null,
      interestingness_score_0_to_100: 0,
      source_urls: [],
      confidence_score: 0,
      legend_or_verified: null,
    };
  },
});

export const SPECIALIST_PIPELINES = [
  identityPipeline,
  locationPipeline,
  buildDatePipeline,
  whyBuiltPipeline,
  currentUsePipeline,
  previousUsePipeline,
  listedStatusPipeline,
  coolHistoricalEventPipeline,
];

function definePipeline({ id, label, fields, emptyOutput }) {
  return {
    id,
    label,
    fields,
    run({ context = {}, evidence = [], checks = [] } = {}) {
      const output = buildOutput({ id, fields, emptyOutput, context, evidence });
      return {
        id,
        label,
        output,
        evidence,
        checks,
        diagnostics: buildDiagnostics({ checks, evidence, output }),
      };
    },
  };
}

function buildOutput({ id, fields, emptyOutput, context, evidence }) {
  const output = emptyOutput(context);

  fields.forEach((field) => {
    const selected = selectBestEvidence(evidence.filter((item) => item.field === field));
    if (selected.value === null) return;

    if (field === "previous_uses") {
      output.previous_uses = evidence
        .filter((item) => item.field === field && item.value)
        .map((item) => item.value);
      output.confidence_score = Math.max(output.confidence_score || 0, selected.confidence_score);
      return;
    }

    output[field] = selected.value;
    copySourceData(output, selected);
  });

  if (id === "identity") {
    output.matched_sources = sourceUrls(evidence);
    output.confidence_score = maxConfidence(evidence);
  }
  if (id === "location") output.location_confidence = maxConfidence(evidence) || output.location_confidence || 0;

  return output;
}

function copySourceData(output, selected) {
  if ("source_urls" in output) output.source_urls = uniqueValues([...(output.source_urls || []), ...selected.source_urls]);
  if ("source_url" in output) output.source_url = selected.source_urls[0] || null;
  if ("evidence_quotes" in output) {
    output.evidence_quotes = uniqueValues([
      ...(output.evidence_quotes || []),
      ...selected.evidence.map((item) => item.evidenceQuote).filter(Boolean),
    ]);
  }
  if ("confidence_score" in output) output.confidence_score = Math.max(output.confidence_score || 0, selected.confidence_score);
  if ("uncertainty_notes" in output && selected.uncertainty_notes) {
    output.uncertainty_notes = output.uncertainty_notes && output.uncertainty_notes !== selected.uncertainty_notes
      ? `${output.uncertainty_notes} ${selected.uncertainty_notes}`
      : selected.uncertainty_notes;
  }
}

function buildDiagnostics({ checks, evidence, output }) {
  return {
    queriesGenerated: checks.map((check) => check.query).filter(Boolean),
    sourcesChecked: checks.filter((check) => check.status === "checked" || check.status === "matched").map((check) => check.sourceName),
    sourcesFailed: checks.filter((check) => check.status === "failed").map((check) => ({
      sourceName: check.sourceName,
      reason: check.failureReason,
    })),
    rawSnippetsRetrieved: checks.map((check) => check.rawSnippet).filter(Boolean),
    extractedFacts: evidence.map((item) => ({
      field: item.field,
      value: item.value,
      sourceUrl: item.sourceUrl,
      confidenceScore: item.confidenceScore,
    })),
    confidenceScores: evidence.map((item) => item.confidenceScore),
    finalSelectedValue: output,
    conflictsFound: [],
  };
}

function sourceUrls(evidence) {
  return [...new Set(evidence.map((item) => item.sourceUrl).filter(Boolean))];
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function maxConfidence(evidence) {
  return evidence.length ? Math.max(...evidence.map((item) => item.confidenceScore || 0)) : 0;
}

export function fieldEvidence(pipeline, field, value, source) {
  return createEvidence({
    pipeline,
    field,
    value,
    ...source,
  });
}
