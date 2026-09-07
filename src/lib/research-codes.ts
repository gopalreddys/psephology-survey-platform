export type SurveyStage = "BASE" | "CAMPAIGN" | "TURNOUT";

export type ElectionFamily = "MP" | "MLA" | "MLC" | "LOCAL";

const surveyTypeCodes: Record<string, string> = {
  OPINION_SURVEY: "OPN",
  VOTER_PULSE: "PULSE",
  BASE: "BASE",
  BASE_SURVEY: "BASE",
  CAMPAIGN: "CAMPAIGN",
  CAMPAIGN_SURVEY: "CAMPAIGN",
  TURNOUT: "TURNOUT",
  TURNOUT_SURVEY: "TURNOUT",
};

export function electionFamily(electionType: string): ElectionFamily {
  const value = String(electionType || "").toUpperCase();
  if (value === "LOCAL" || value.includes("LOCAL_BODY")) return "LOCAL";
  if (value === "PARLIAMENTARY") return "MP";
  if (value.startsWith("MLC")) return "MLC";
  return "MLA";
}

export function surveyTypeCode(studyType: string): string {
  return surveyTypeCodes[studyType] || studyType.replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase() || "SURVEY";
}

export function compactGeographyCode(code: string | null | undefined): string {
  const compact = String(code || "STATE").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact || "STATE";
}

export function buildProgramCode({
  stateCode = "TG",
  electionType,
  constituencyCode,
  studyType,
  year = new Date().getFullYear(),
  sequence = 1,
}: {
  stateCode?: string;
  electionType: string;
  constituencyCode?: string | null;
  studyType: string;
  year?: number;
  sequence?: number;
}): string {
  return [
    compactGeographyCode(stateCode),
    electionFamily(electionType),
    compactGeographyCode(constituencyCode),
    surveyTypeCode(studyType),
    year,
    `P${String(sequence).padStart(2, "0")}`,
  ].join("-");
}

export function buildCampaignCode({
  stateCode = "TG",
  electionType,
  constituencyCode,
  studyType,
  stage,
  sequence = 1,
}: {
  stateCode?: string;
  electionType: string;
  constituencyCode?: string | null;
  studyType: string;
  stage: SurveyStage;
  sequence?: number;
}): string {
  const typeCode = surveyTypeCode(studyType);
  const stageCode = stage;
  return [
    compactGeographyCode(stateCode),
    electionFamily(electionType),
    compactGeographyCode(constituencyCode),
    ...(typeCode === stageCode ? [] : [typeCode]),
    stageCode,
    `C${String(sequence).padStart(2, "0")}`,
  ].join("-");
}

export function nextCodeSequence(prefix: string, existingCodes: Array<string | null | undefined>): number {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedPrefix}-(?:P|C)(\\d+)$`, "i");
  const used = existingCodes.reduce(function (max, code) {
    const match = String(code || "").match(matcher);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return used + 1;
}

export const surveyStageOptions: Array<{ value: SurveyStage; label: string; detail: string }> = [
  { value: "BASE", label: "Base survey", detail: "Establish the voter thought baseline" },
  { value: "CAMPAIGN", label: "Campaign survey", detail: "Track campaign movement and issues" },
  { value: "TURNOUT", label: "Turnout survey", detail: "Final turnout intent and mobilisation" },
];
