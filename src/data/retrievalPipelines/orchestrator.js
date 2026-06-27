import { unique } from "./evidence.js";
import { confidencePipeline } from "./confidencePipeline.js";
import { routeSources, sourceDiscoveryPipeline } from "./sourceRouting.js";
import { createDefaultSourceAdapters } from "./sourceAdapters.js";
import { SPECIALIST_PIPELINES } from "./specialistPipelines.js";

export const PIPELINE_ORDER = [
  "identity",
  "location",
  "sourceDiscovery",
  "buildDate",
  "whyBuilt",
  "currentUse",
  "previousUse",
  "listedStatus",
  "coolHistoricalEvent",
  "confidence",
];

export async function runModularBuildingRetrieval(input = {}, sourceAdapters = createDefaultSourceAdapters(), options = {}) {
  const context = normaliseInput(input);
  const debugLog = [];
  const pipelineResults = [];
  const allEvidence = [];
  const allChecks = [];

  const identity = await runPipeline(findPipeline("identity"), context, sourceAdapters);
  record(identity);

  const location = await runPipeline(findPipeline("location"), context, sourceAdapters);
  record(location);

  const sourceDiscovery = sourceDiscoveryPipeline.run({
    ...context,
    placeType: context.placeType || identity.output.likely_place_type,
  });
  record(sourceDiscovery);

  const routedContext = {
    ...context,
    routedSources: sourceDiscovery.routedSources,
    identity: identity.output,
    location: location.output,
  };

  for (const pipeline of SPECIALIST_PIPELINES.filter((item) => !["identity", "location"].includes(item.id))) {
    record(await runPipeline(pipeline, routedContext, sourceAdapters));
  }

  const confidence = confidencePipeline.run({
    pipelineResults,
    evidence: allEvidence,
    checks: allChecks,
  });
  record(confidence, { aggregate: false });

  const conflicts = confidence.output.conflicts;
  const overallConfidence = confidence.output.overallConfidence;
  const profile = {
    identity: getOutput("identity"),
    location: getOutput("location"),
    buildDate: getOutput("buildDate"),
    whyBuilt: getOutput("whyBuilt"),
    currentUse: getOutput("currentUse"),
    previousUse: getOutput("previousUse")?.previous_uses || [],
    listedStatus: getOutput("listedStatus"),
    coolHistoricalEvent: getOutput("coolHistoricalEvent"),
    sourcesChecked: allChecks,
    conflicts,
    overallConfidence,
    displaySummary: buildDisplaySummary({
      identity: getOutput("identity"),
      buildDate: getOutput("buildDate"),
      whyBuilt: getOutput("whyBuilt"),
      currentUse: getOutput("currentUse"),
      coolHistoricalEvent: getOutput("coolHistoricalEvent"),
    }),
    debugLog: options.debug ? debugLog : undefined,
  };

  return profile;

  function record(result, { aggregate = true } = {}) {
    pipelineResults.push(result);
    if (aggregate) {
      allEvidence.push(...(result.evidence || []));
      allChecks.push(...(result.checks || []));
    }
    debugLog.push({
      pipeline: result.id,
      ...(result.diagnostics || {}),
    });
  }

  function getOutput(id) {
    return pipelineResults.find((result) => result.id === id)?.output || null;
  }
}

async function runPipeline(pipeline, context, sourceAdapters) {
  const activeSources = routeSources(context, pipeline.id);
  const activeSourceIds = new Set(activeSources.map((source) => source.id));
  const collected = await Promise.all(sourceAdapters
    .filter((adapter) => shouldRunAdapter(adapter, pipeline, activeSourceIds))
    .map((adapter) => adapter.collect({ pipeline, context: { ...context, activeSources } })));

  const evidence = collected.flatMap((item) => item?.evidence || []);
  const checks = collected.flatMap((item) => item?.checks || []);

  return pipeline.run({ context, evidence, checks });
}

function shouldRunAdapter(adapter, pipeline, activeSourceIds) {
  if (typeof adapter.collect !== "function") return false;
  if (Array.isArray(adapter.supportedPipelines) && !adapter.supportedPipelines.includes(pipeline.id)) return false;
  if (Array.isArray(adapter.supportedSourceIds) && !adapter.supportedSourceIds.some((id) => activeSourceIds.has(id))) return false;
  return true;
}

function findPipeline(id) {
  return SPECIALIST_PIPELINES.find((pipeline) => pipeline.id === id);
}

function normaliseInput(input = {}) {
  return {
    selectedPlaceName: input.selectedPlaceName || input.name || input.query || "",
    coordinates: input.coordinates || input.position || null,
    address: input.address || "",
    mapPlaceId: input.mapPlaceId || input.placeId || input.id || "",
    placeType: input.placeType || input.type || "",
    buildingRecord: input.buildingRecord || null,
    sourceUrls: input.sourceUrls || [],
    sources: input.sources || [],
    sourceLinks: input.sourceLinks || [],
  };
}

function buildDisplaySummary({ identity, buildDate, whyBuilt, currentUse, coolHistoricalEvent }) {
  const parts = [
    identity?.canonical_name,
    buildDate?.exact_build_date || buildDate?.estimated_build_date || buildDate?.date_range || buildDate?.century,
    whyBuilt?.original_purpose,
    currentUse?.current_use,
    coolHistoricalEvent?.summary && coolHistoricalEvent.summary !== "Nothing that interesting has happened here -_-"
      ? coolHistoricalEvent.summary
      : "",
  ].filter(Boolean);

  return parts.join(". ");
}

export function sourceUrlsForProfile(profile = {}) {
  return unique((profile.sourcesChecked || []).map((source) => source.url));
}
