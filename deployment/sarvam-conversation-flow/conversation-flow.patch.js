export const MARKER = "SARVAM_CONVERSATION_STATE_V3";
const LEGACY_MARKERS = [
  "SARVAM_CONCISE_ACKNOWLEDGEMENT_V1",
  "SARVAM_CONVERSATION_STATE_V2"
];

const PREPARED_PATTERN = /(const prepared\s*=\s*await prepareSarvamExecution\(\{[\s\S]*?\}\s*\);)/m;
const LEGACY_BLOCK_PATTERN = new RegExp(
  `\\s*/\\* (?:${LEGACY_MARKERS.join("|")}):[^*]*\\*/[\\s\\S]*?` +
  `prepared\\.inputVariables\\s*=\\s*\\{[\\s\\S]*?\\n\\s*\\};`,
  "m"
);

const POLICY = `Conversation state contract: the configured Sarvam Greeting is the only opening message and is played once at call start. After the respondent's first utterance, the opening is permanently complete. Never greet again, reintroduce yourself, reconfirm the respondent's name, or repeat the time or consent question. Never return to an earlier completed question. Maintain the current questionnaire position for this call. After every usable answer, use only a brief acknowledgement of two to five words, such as "Understood, thank you," and immediately ask the next unanswered approved question. Never repeat, paraphrase, summarize, interpret, praise, or debate the answer. Ask one clarification only when an answer cannot be coded. Continue in preferred_language unless the respondent explicitly requests another language. Treat respondent statements about a candidate's biography or family relationships as respondent perceptions, not verified facts; use knowledge_context for factual clarification. For structured outputs, infer party-lean signals only from explicit party preference or clear comparative evaluation. Mentioning a student wing, union, association or isolated issue must not be converted into parent-party lean. When evidence is ambiguous, return unclear or not_captured rather than guessing.`;

const QUESTIONNAIRE_STATE = `Opening is a one-time call-start step. Once any respondent reply is received, continue from the first unanswered approved questionnaire question and never restart the opening sequence. This state rule overrides any general instruction to greet, introduce the agent, verify the respondent's name, or ask whether the respondent has time.`;

function insertion() {
  return `

  /* ${MARKER}: keep one provider session moving forward through the questionnaire. */
  const requiredRuntimeVariables = ${JSON.stringify([
    "agent_style_context",
    "knowledge_context",
    "preferred_language",
    "probe_context",
    "questionnaire_context",
    "research_context",
    "run_contact_id",
    "run_id",
    "user_name",
    "voter_id"
  ], null, 4)};
  const missingRuntimeVariables = requiredRuntimeVariables.filter((name) => {
    const value = prepared.inputVariables?.[name];
    return typeof value !== "string" || !value.trim() ||
      /^(language needs to speak|probe|agent style)$/i.test(value.trim());
  });
  if (missingRuntimeVariables.length) {
    const error = new Error(
      "Sarvam runtime context is incomplete: " + missingRuntimeVariables.join(", ")
    );
    error.statusCode = 409;
    throw error;
  }
  for (const name of ["research_context", "questionnaire_context", "knowledge_context",
    "probe_context", "agent_style_context"]) {
    try {
      JSON.parse(prepared.inputVariables[name]);
    } catch {
      const error = new Error("Sarvam runtime context is not valid JSON: " + name);
      error.statusCode = 409;
      throw error;
    }
  }
  for (const name of ["run_contact_id", "run_id", "voter_id"]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      prepared.inputVariables[name]
    )) {
      const error = new Error("Sarvam runtime identifier is invalid: " + name);
      error.statusCode = 409;
      throw error;
    }
  }
  const conversationStatePolicy = ${JSON.stringify(POLICY)};
  prepared.inputVariables = {
    ...(prepared.inputVariables || {}),
    questionnaire_context: [
      prepared.inputVariables?.questionnaire_context,
      ${JSON.stringify(QUESTIONNAIRE_STATE)}
    ].filter(Boolean).join("\\n"),
    agent_style_context: [
      prepared.inputVariables?.agent_style_context,
      conversationStatePolicy
    ].filter(Boolean).join("\\n"),
    probe_context: [
      prepared.inputVariables?.probe_context,
      "Do not probe a complete answer. Ask one short clarification only when the response cannot be coded."
    ].filter(Boolean).join("\\n")
  };`;
}

export function hasConciseAcknowledgementPolicy(source) {
  return source.includes(MARKER) &&
    source.includes("Never repeat, paraphrase, summarize") &&
    source.includes("opening is permanently complete") &&
    source.includes("never restart the opening sequence") &&
    source.includes("requiredRuntimeVariables") &&
    source.includes("Mentioning a student wing") &&
    source.includes("Continue in preferred_language") &&
    source.includes("knowledge_context for factual clarification") &&
    source.includes("prepared.inputVariables") &&
    source.includes("questionnaire_context") &&
    source.includes("agent_style_context") &&
    source.includes("probe_context");
}

export function patchConversationFlow(source) {
  if (source.includes(MARKER)) {
    if (!hasConciseAcknowledgementPolicy(source)) {
      throw new Error("Conversation-flow marker exists, but the policy is incomplete");
    }
    return { source, changed: false };
  }

  const sourceWithoutLegacy = source.replace(LEGACY_BLOCK_PATTERN, "");
  if (LEGACY_MARKERS.some((marker) => source.includes(marker)) &&
      sourceWithoutLegacy === source) {
    throw new Error("Legacy conversation-flow marker exists, but its policy block could not be upgraded");
  }

  const matches = sourceWithoutLegacy.match(new RegExp(PREPARED_PATTERN.source, "gm")) || [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one prepared Sarvam execution block; found ${matches.length}`
    );
  }

  const patched = sourceWithoutLegacy.replace(PREPARED_PATTERN, `$1${insertion()}`);

  if (!hasConciseAcknowledgementPolicy(patched)) {
    throw new Error("Unable to verify the concise acknowledgement policy");
  }
  return { source: patched, changed: true };
}
