import { createEvidence, createSourceCheck } from "../evidence.js";
import { getSourceById } from "../sourceRegistry.js";

const WHY_BUILT_PIPELINE = "whyBuilt";

export function createWikipediaWhyBuiltAdapter() {
  return createWhyBuiltAdapter({
    id: "wikipedia-why-built-adapter",
    sourceIds: ["wikipedia-api", "wikipedia"],
    sourceFallbackId: "wikipedia-api",
    sourceNamePattern: /wikipedia/i,
    sourceType: "citedWiki",
    confidenceScore: 65,
    collectEvidence(building, source) {
      if (!building.originalPurpose) return [];

      return [evidence({
        field: "original_purpose",
        value: building.originalPurpose,
        source,
        evidenceQuote: buildPurposeQuote(building) || `Original purpose extracted as "${building.originalPurpose}".`,
        uncertaintyNotes: "Wikipedia is a secondary source; official sources should override this if they provide a different purpose.",
      })];
    },
  });
}

export function createWikidataWhyBuiltAdapter() {
  return createWhyBuiltAdapter({
    id: "wikidata-why-built-adapter",
    sourceIds: ["wikidata-query-service", "wikidata"],
    sourceFallbackId: "wikidata",
    sourceNamePattern: /wikidata/i,
    sourceType: "citedWiki",
    confidenceScore: 65,
    collectEvidence(building, source) {
      const evidenceItems = [];
      const useTimeline = (building.pastUsesTimeline || [])
        .filter((item) => /wikidata/i.test(item.source?.name || ""))
        .map((item) => item.description)
        .find(Boolean);

      if (useTimeline) {
        evidenceItems.push(evidence({
          field: "historical_context",
          value: useTimeline,
          source,
          evidenceQuote: useTimeline,
          uncertaintyNotes: "Wikidata type/use statements describe context but do not always prove original construction purpose.",
        }));
      }

      const typeContext = [building.currentUse, building.architecturalStyle]
        .filter(Boolean)
        .join(", ");

      if (typeContext && /wikidata/i.test(source.sourceName || "")) {
        evidenceItems.push(evidence({
          field: "related_transport_trade_religious_commercial_context",
          value: typeContext,
          source,
          evidenceQuote: typeContext,
          uncertaintyNotes: "Structured public type/use data; treat as context unless supported by a narrative source.",
        }));
      }

      return evidenceItems;
    },
  });
}

export function createHistoricEnglandWhyBuiltAdapter() {
  return createWhyBuiltAdapter({
    id: "historic-england-why-built-adapter",
    sourceIds: ["historic-england-nhle", "historic-england", "historic-england-open-data-api"],
    sourceFallbackId: "historic-england-nhle",
    sourceNamePattern: /historic england|national heritage list|nhle/i,
    sourceType: "statutoryHeritageRegister",
    confidenceScore: 90,
    collectEvidence(building, source) {
      const evidenceItems = [];

      if (building.originalPurpose && hasPurposeSource(building, /historic england|nhle|national heritage list/i)) {
        evidenceItems.push(evidence({
          field: "original_purpose",
          value: building.originalPurpose,
          source,
          evidenceQuote: buildPurposeQuote(building) || `Original purpose extracted as "${building.originalPurpose}".`,
        }));
      }

      if (building.listedStatus) {
        evidenceItems.push(evidence({
          field: "historical_context",
          value: building.listedStatus,
          source,
          evidenceQuote: building.listedStatus,
          uncertaintyNotes: "Official heritage status is context; it is not by itself a construction-purpose claim.",
        }));
      }

      return evidenceItems;
    },
  });
}

function createWhyBuiltAdapter({
  id,
  sourceIds,
  sourceFallbackId,
  sourceNamePattern,
  sourceType,
  confidenceScore,
  collectEvidence,
}) {
  return {
    id,
    supportedSourceIds: sourceIds,
    supportedPipelines: [WHY_BUILT_PIPELINE],
    collect({ pipeline, context }) {
      if (pipeline.id !== WHY_BUILT_PIPELINE) return emptyResult();

      const building = context.buildingRecord || {};
      const source = resolveSource({ building, context, sourceFallbackId, sourceNamePattern, sourceType, confidenceScore });
      const evidenceItems = collectEvidence(building, source);

      return {
        evidence: evidenceItems,
        checks: [createSourceCheck({
          pipeline: pipeline.id,
          sourceName: source.sourceName,
          sourceType,
          status: evidenceItems.length ? "matched" : "checked",
          query: buildQuery(context),
          url: source.sourceUrl,
          failureReason: evidenceItems.length ? "" : "No source-backed construction purpose was available from this source.",
          rawSnippet: evidenceItems.map((item) => item.evidenceQuote).filter(Boolean).join(" | "),
          extractedFacts: evidenceItems.map((item) => ({ field: item.field, value: item.value })),
          confidenceScore,
        })],
      };
    },
  };
}

function evidence({ field, value, source, evidenceQuote = "", uncertaintyNotes = "" }) {
  return createEvidence({
    pipeline: WHY_BUILT_PIPELINE,
    field,
    value,
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    sourceType: source.sourceType,
    confidenceScore: source.confidenceScore,
    evidenceQuote,
    uncertaintyNotes,
  });
}

function resolveSource({ building, context, sourceFallbackId, sourceNamePattern, sourceType, confidenceScore }) {
  const sourceFromBuilding = [
    ...(building.buildPurposeSources || []),
    ...(building.sources || []),
    ...(building.sourceLinks || []),
  ].find((source) => sourceNamePattern.test(`${source.name || ""} ${source.url || ""}`));

  const sourceFromRoute = (context.activeSources || [])
    .find((source) => sourceNamePattern.test(`${source.source_name || ""} ${source.id || ""}`));

  const registrySource = getSourceById(sourceFallbackId);

  return {
    sourceName: sourceFromBuilding?.name || sourceFromRoute?.source_name || registrySource?.source_name || "Public source",
    sourceUrl: sourceFromBuilding?.url || sourceFromRoute?.source_url || registrySource?.source_url || "",
    sourceType: sourceFromRoute?.source_category || registrySource?.source_category || sourceType,
    confidenceScore: sourceFromRoute?.confidence_weight || registrySource?.confidence_weight || confidenceScore,
  };
}

function hasPurposeSource(building, pattern) {
  return (building.buildPurposeSources || []).some((source) => pattern.test(`${source.name || ""} ${source.url || ""}`));
}

function buildPurposeQuote(building) {
  return [
    building.buildDate?.note,
    ...(building.pastUsesTimeline || []).map((item) => item.description),
  ].find((item) => item && item.toLowerCase().includes(String(building.originalPurpose || "").toLowerCase())) || "";
}

function buildQuery(context = {}) {
  return [
    context.selectedPlaceName,
    context.address,
    context.placeType || context.identity?.likely_place_type,
    "why built",
  ].filter(Boolean).join(" ");
}

function emptyResult() {
  return { evidence: [], checks: [] };
}
