import { findConflicts } from "./evidence.js";

export const confidencePipeline = {
  id: "confidence",
  label: "Source Confidence / Conflict Handling",
  run({ pipelineResults = [], evidence = [], checks = [] } = {}) {
    const conflicts = findConflicts(evidence);
    const overallConfidence = calculateOverallConfidence(pipelineResults, conflicts);

    return {
      id: this.id,
      label: this.label,
      output: {
        conflicts,
        overallConfidence,
        sourcesChecked: checks,
      },
      evidence,
      checks,
      diagnostics: {
        queriesGenerated: [],
        sourcesChecked: checks.map((check) => check.sourceName),
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
        finalSelectedValue: overallConfidence,
        conflictsFound: conflicts,
      },
    };
  },
};

function calculateOverallConfidence(pipelineResults, conflicts) {
  const confidenceValues = pipelineResults
    .map((result) => result.output?.confidence_score ?? result.output?.location_confidence)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!confidenceValues.length) return 0;
  const average = confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
  const conflictPenalty = conflicts.length * 10;
  return Math.max(0, Math.round(average - conflictPenalty));
}
