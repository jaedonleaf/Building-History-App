import { createSourceCheck } from "./evidence.js";
import {
  getActivatedSourcePacks,
  getSourcesForPipeline,
  sortByConfidence,
} from "./sourceRegistry.js";

const DOWNSTREAM_PIPELINES = [
  "identity",
  "location",
  "buildDate",
  "whyBuilt",
  "currentUse",
  "previousUse",
  "listedStatus",
  "coolHistoricalEvent",
];

export const sourceDiscoveryPipeline = {
  id: "sourceDiscovery",
  label: "Source Discovery / Source Routing",
  run(context) {
    const activatedPacks = getActivatedSourcePacks(context);
    const routedSources = routeSources(context);
    const checks = routedSources.map((item) => createSourceCheck({
      pipeline: this.id,
      sourceName: item.source_name,
      sourceType: item.source_category,
      status: "planned",
      query: buildQuery(context, item),
      url: item.source_url,
      confidenceScore: item.confidence_weight,
    }));

    return {
      id: this.id,
      routedSources,
      activatedPacks,
      evidence: [],
      checks,
      diagnostics: {
        queriesGenerated: checks.map((check) => check.query),
        sourcesChecked: [],
        sourcesFailed: [],
        rawSnippetsRetrieved: [],
        extractedFacts: [],
        confidenceScores: checks.map((check) => ({
          sourceName: check.sourceName,
          confidenceScore: check.confidenceScore,
        })),
        finalSelectedValue: {
          activatedPacks,
          routedSources: routedSources.map((item) => item.source_name),
        },
        conflictsFound: [],
      },
    };
  },
};

export function routeSources(context = {}, pipelineId = "") {
  const pipelineIds = pipelineId ? [pipelineId] : DOWNSTREAM_PIPELINES;
  const sources = pipelineIds.flatMap((id) => getSourcesForPipeline(id, {
    placeType: context.placeType || context.identity?.likely_place_type || "",
    coverageArea: context.coverageArea || context.address || "",
  }));

  return sortByConfidence(dedupeSources(sources));
}

function dedupeSources(sources) {
  const byId = new Map();
  sources.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function buildQuery(context, source) {
  return [
    context.selectedPlaceName,
    context.address,
    context.placeType || context.identity?.likely_place_type,
    source.source_name,
  ].filter(Boolean).join(" ");
}
