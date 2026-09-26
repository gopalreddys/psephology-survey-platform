# Concise Sarvam conversation flow

Adds a governed conversation-state and turn-taking instruction to every
platform-launched Sarvam Run call. The configured Sarvam Greeting is the only
opening and must play once. After any respondent utterance, the agent must not
greet, introduce itself, reconfirm the name or repeat the time/consent request.
It continues from the first unanswered approved question. After a usable voter
answer, the agent acknowledges in two to five words and immediately advances.
It must not repeat, paraphrase, summarize, interpret, praise or debate the
answer. One short probe is allowed only when an answer cannot be coded.

Before any provider submission, the V3 guard also requires all ten registered
runtime variables to contain real values, validates UUID identifiers and checks
that the five context variables are valid JSON. Placeholder Sarvam test values
such as `Language needs to speak`, `Probe` and `Agent Style` are rejected. The
conversation remains in `preferred_language` unless the respondent explicitly
asks to switch. Candidate-family statements are treated as respondent
perceptions unless `knowledge_context` verifies them, and student-wing, union
or association mentions cannot by themselves produce a parent-party lean.
Ambiguous structured outputs must be `unclear` or `not_captured`.

The policy is appended to the existing `agent_style_context` and
`probe_context`; it does not replace the Iteration questionnaire, consent,
language, candidate knowledge or voice-agent snapshot. The committed Sarvam
Agent App must reference both input variables in its system instructions.

Deploy on the API host before launching another call:

```bash
node deployment/sarvam-conversation-flow/test-sarvam-conversation-flow.js
node deployment/sarvam-conversation-flow/install-sarvam-conversation-flow.js \
  /opt/sarvam-voice-analytics
node --check /opt/sarvam-voice-analytics/src/services/sarvam-execution.service.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 \
  -i http://127.0.0.1:3000/ready
```

Validate with one approved demo call before bulk launch. Confirm from its AWS
transcript that answers are not echoed and all expected questions are reached.

If a previous Run repeated its opening, run the read-only diagnostic first. It
reports execution, provider-attempt and interaction counts without printing
names, phone numbers or transcript text:

```bash
node deployment/sarvam-conversation-flow/diagnose-repeated-opening.js \
  /opt/sarvam-voice-analytics \
  --run-id=RUN_UUID
```

One execution, one provider attempt and one interaction per Run contact rules
out repeated platform submission. `repeatedOpeningTurns` greater than one then
locates the problem inside the single Sarvam conversation/context. Multiple
attempts or interactions require launch-idempotency investigation instead.
