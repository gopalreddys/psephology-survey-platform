function clean(value) {
  return String(value || "").trim();
}

function demoGeography(voter) {
  const geographyName = clean(voter.geography_name);
  const geographyType = clean(voter.geography_type).toUpperCase();
  const parentName = clean(voter.parent_geography_name);
  const parentType = clean(voter.parent_geography_type).toUpperCase();

  return {
    areaType: geographyType,
    district:
      geographyType === "DISTRICT"
        ? geographyName
        : parentType === "DISTRICT"
          ? parentName
          : "",
    mandal:
      clean(voter.mandal_name_source) ||
      (geographyType === "MANDAL" ? geographyName : ""),
    village: geographyType === "VILLAGE" ? geographyName : "",
    mlaConstituency: clean(voter.assembly_constituency_name)
  };
}

export function buildVoterDemoAgentVariables({ demoCallId, voter }) {
  const preferredLanguage = voter.preferred_language || "Telugu";
  const geography = demoGeography(voter);
  const locationParts = [
    geography.mandal && `Mandal: ${geography.mandal}`,
    geography.district && `District: ${geography.district}`,
    geography.mlaConstituency &&
      `Assembly constituency: ${geography.mlaConstituency}`
  ].filter(Boolean);
  const knownGeography = locationParts.length
    ? locationParts.join("; ")
    : "No platform geography is available for this demo voter.";

  return {
    demo_call_id: demoCallId,
    voter_id: voter.id,
    run_contact_id: "",
    run_id: "",
    attempt_cycle_id: "",
    study_id: "",
    iteration_id: "",
    iteration_number: "0",
    user_name: voter.full_name,
    preferred_language: preferredLanguage,
    voter_profession: voter.occupation || "",
    voter_qualification: voter.qualification || "",
    gender: voter.gender || "",
    district: geography.district,
    mandal: geography.mandal,
    village: geography.village,
    area_type: geography.areaType,
    mla_constituency: geography.mlaConstituency,
    mp_constituency: "",
    agent_code: process.env.SARVAM_DEMO_AGENT_CODE || "DEMO",
    voice_code: process.env.SARVAM_DEMO_VOICE_CODE || "DEFAULT",
    questionnaire_code:
      process.env.SARVAM_DEMO_QUESTIONNAIRE_CODE ||
      "CONTROLLED_DEMO",
    probe_set: "",
    max_probes: "1",
    knowledge_packs: "",
    source: "VOTER_MASTER_DEMO",
    analytics_excluded: "true",
    research_context:
      "Controlled platform demonstration. Completion policy: mark survey_completed only when all three required civic themes in questionnaire_context have meaningful respondent evidence. If one or more required themes are missing but useful feedback exists, mark substantial_feedback_captured or partial_feedback_captured as appropriate.",
    questionnaire_context:
      "Three required civic themes: (1) overall satisfaction with local public services and development; (2) the single most important local issue and why it matters; (3) the one improvement or leadership response the respondent most wants. Ask naturally, credit information already volunteered, avoid repetition, and close once all three themes are meaningfully covered.",
    knowledge_context:
      `Known Voter Master geography: ${knownGeography} This is platform reference data, not a statement made by the respondent. Use it only for neutral local context and never present it as a surveyed answer.`,
    probe_context:
      "At most one short neutral clarification when a required theme cannot be coded. Never probe a complete answer.",
    agent_style_context:
      "Identify yourself truthfully as an AI calling assistant. Be respectful, concise and neutral. After each answer, acknowledge in two to five words and ask the next missing theme. Never repeat, paraphrase, summarize, interpret, praise or debate the answer. End immediately if asked to stop."
  };
}
