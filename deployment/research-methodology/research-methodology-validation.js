export class ResearchDesignError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const permittedSamplingMethods = new Set([
  'CENSUS', 'SIMPLE_RANDOM', 'STRATIFIED_RANDOM', 'CLUSTER', 'SYSTEMATIC',
  'QUOTA', 'PURPOSIVE', 'CONVENIENCE', 'DIRECTIONAL_NON_PROBABILITY'
]);
const weightingStatuses = new Set(['NOT_CONFIGURED', 'NOT_REQUIRED', 'PLANNED', 'APPLIED']);
const cohortDesigns = new Set(['SAME_PARTICIPANTS', 'INDEPENDENT_SAMPLES', 'PARTIAL_OVERLAP']);
const fieldworkModes = new Set(['AI_ASSISTED_OUTBOUND_VOICE', 'HUMAN_ASSISTED_PHONE', 'MIXED_MODE']);
const placeholder = /^(?:not declared|unknown|n\/?a|tbd|not specified)$/i;

function text(body, key, maximum, required = false) {
  const value = body[key] ?? '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new ResearchDesignError(`${key} must be text of at most ${maximum} characters`, 'INVALID_RESEARCH_DESIGN_FIELD');
  }
  const cleaned = value.trim();
  if (required && (!cleaned || placeholder.test(cleaned))) {
    throw new ResearchDesignError(`${key} must describe the actual survey method`, 'INCOMPLETE_RESEARCH_DESIGN');
  }
  return cleaned;
}

export function validateResearchDesign(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ResearchDesignError('A research design object is required', 'INVALID_RESEARCH_DESIGN');
  }
  const design = {
    targetPopulation: text(body, 'targetPopulation', 500, true),
    sampleFrameName: text(body, 'sampleFrameName', 500, true),
    samplingMethod: text(body, 'samplingMethod', 80, true).toUpperCase(),
    selectionMethod: text(body, 'selectionMethod', 500, true),
    cohortDesign: text(body, 'cohortDesign', 80, true).toUpperCase(),
    weightingStatus: text(body, 'weightingStatus', 40, true).toUpperCase(),
    weightingMethod: text(body, 'weightingMethod', 500),
    fieldworkMode: text(body, 'fieldworkMode', 120, true).toUpperCase(),
    methodologyNotes: text(body, 'methodologyNotes', 2000),
    changeReason: text(body, 'changeReason', 1000, true)
  };
  for (const [key, allowed] of [
    ['samplingMethod', permittedSamplingMethods], ['cohortDesign', cohortDesigns],
    ['weightingStatus', weightingStatuses], ['fieldworkMode', fieldworkModes]
  ]) {
    if (!allowed.has(design[key])) {
      throw new ResearchDesignError(`Select a supported ${key}`, 'INVALID_RESEARCH_DESIGN_CHOICE');
    }
  }
  if (body.attested !== true) {
    throw new ResearchDesignError('Confirm that the declaration describes actual fieldwork, not a proposed design', 'METHODOLOGY_ATTESTATION_REQUIRED');
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new ResearchDesignError('Load the current research design revision before saving', 'RESEARCH_DESIGN_REVISION_REQUIRED');
  }
  const variables = body.weightingVariables ?? [];
  if (!Array.isArray(variables) || variables.length > 20 || variables.some((value) =>
    typeof value !== 'string' || !value.trim() || value.length > 80)) {
    throw new ResearchDesignError('Weighting variables must be an array of up to 20 non-empty text values', 'INVALID_WEIGHTING_VARIABLES');
  }
  design.weightingVariables = [...new Set(variables.map((value) => value.trim()))];
  if (design.weightingStatus === 'APPLIED') {
    throw new ResearchDesignError('Current reports are unweighted. Applied weights cannot be declared until a verified weighting pipeline is available', 'WEIGHTED_REPORTING_NOT_SUPPORTED');
  }
  if (design.weightingStatus === 'NOT_CONFIGURED') {
    throw new ResearchDesignError('Confirm whether no weights were used or weighting was planned before declaring actual methodology', 'WEIGHTING_NOT_DECLARED');
  }
  if (design.weightingStatus === 'PLANNED' && (!design.weightingMethod || !design.weightingVariables.length)) {
    throw new ResearchDesignError('Planned weighting requires its method and variables', 'WEIGHTING_DETAILS_REQUIRED');
  }
  if (design.weightingStatus !== 'PLANNED' && (design.weightingMethod || design.weightingVariables.length)) {
    throw new ResearchDesignError('Clear weighting method and variables when no weights are configured', 'INCONSISTENT_WEIGHTING_DETAILS');
  }
  return { ...design, expectedRevision: body.expectedRevision };
}
