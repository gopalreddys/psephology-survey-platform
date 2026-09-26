export const RUNTIME_MARKER = "SARVAM_COMPACT_RUNTIME_CONTEXT_V1";

const RESPONSE_PATTERN = /return res\.json\(\{[\s\S]*?user_name\s*:[\s\S]*?agent_style_context\s*:[\s\S]*?\}\);/m;

const COMPACT_RESPONSE = `/* ${RUNTIME_MARKER}: keep the live LLM handoff aligned with the committed-agent phone test. */
      return res.json({
        user_name: compiled.user_name,
        preferred_language: compiled.preferred_language,
        research_context: "",
        questionnaire_context: "",
        knowledge_context: "",
        probe_context: "Probe",
        agent_style_context: "Agent style"
      });`;

export function hasCompactRuntimeContext(source) {
  return source.includes(RUNTIME_MARKER) &&
    source.includes('questionnaire_context: ""') &&
    source.includes('knowledge_context: ""') &&
    source.includes('research_context: ""') &&
    source.includes('probe_context: "Probe"') &&
    source.includes('agent_style_context: "Agent style"') &&
    source.includes("user_name: compiled.user_name") &&
    source.includes("preferred_language: compiled.preferred_language");
}

export function patchRuntimeContext(source) {
  if (source.includes(RUNTIME_MARKER)) {
    if (!hasCompactRuntimeContext(source)) {
      throw new Error("Compact Sarvam runtime marker exists, but the response is incomplete");
    }
    return { source, changed: false };
  }

  const matches = source.match(new RegExp(RESPONSE_PATTERN.source, "gm")) || [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Sarvam runtime-context response; found ${matches.length}`
    );
  }

  const patched = source.replace(RESPONSE_PATTERN, COMPACT_RESPONSE);
  if (!hasCompactRuntimeContext(patched)) {
    throw new Error("Unable to verify compact Sarvam runtime-context response");
  }
  return { source: patched, changed: true };
}
