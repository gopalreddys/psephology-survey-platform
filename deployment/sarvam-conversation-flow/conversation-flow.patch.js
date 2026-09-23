export const MARKER = "SARVAM_CONCISE_ACKNOWLEDGEMENT_V1";

const PREPARED_PATTERN = /(const prepared\s*=\s*await prepareSarvamExecution\(\{[\s\S]*?\}\s*\);)/m;

const POLICY = `After every respondent answer, use only a brief acknowledgement of two to five words, such as "Understood, thank you." Never repeat, paraphrase, summarize, interpret, praise, or debate the answer. Immediately ask the next approved questionnaire question. Ask a clarification only when the answer is unusable, and ask no more than the configured probe limit.`;

export function hasConciseAcknowledgementPolicy(source) {
  return source.includes(MARKER) &&
    source.includes("Never repeat, paraphrase, summarize") &&
    source.includes("prepared.inputVariables") &&
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

  const matches = source.match(new RegExp(PREPARED_PATTERN.source, "gm")) || [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one prepared Sarvam execution block; found ${matches.length}`
    );
  }

  const insertion = `$1

  /* ${MARKER}: prevent answer echo and keep the interview moving. */
  const conciseAcknowledgementPolicy = ${JSON.stringify(POLICY)};
  prepared.inputVariables = {
    ...(prepared.inputVariables || {}),
    agent_style_context: [
      prepared.inputVariables?.agent_style_context,
      conciseAcknowledgementPolicy
    ].filter(Boolean).join("\\n"),
    probe_context: [
      prepared.inputVariables?.probe_context,
      "Do not probe a complete answer. Ask one short clarification only when the response cannot be coded."
    ].filter(Boolean).join("\\n")
  };`;
  const patched = source.replace(PREPARED_PATTERN, insertion);

  if (!hasConciseAcknowledgementPolicy(patched)) {
    throw new Error("Unable to verify the concise acknowledgement policy");
  }
  return { source: patched, changed: true };
}
