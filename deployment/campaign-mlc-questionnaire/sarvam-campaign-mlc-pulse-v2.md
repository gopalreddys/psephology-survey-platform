# Sarvam handoff: neutral Campaign questionnaire V2

This is a draft configuration guide for `MLC_CAMPAIGN_PULSE_V2`, version **2**, named **Graduate MLC Campaign Thought Pulse — Reporting V2**. The source is `campaign-mlc-pulse-v2.json`. It does not itself save a platform questionnaire, change Sarvam, commit an agent or authorize a call. Preserve the used V1 questionnaire and all historical Iteration snapshots.

## Questions and exact output variables

Copy the English/Telugu question wording from the JSON, in its recorded order, into the intended Sarvam agent configuration. Independent multilingual wording review remains required. The aided party question must follow the unaided question.

| Order | Measurement | Exact output key | Canonical values / handling |
| --- | --- | --- | --- |
| 1 | Graduate issue priority | `graduate_issue_priority` | Priority categories below |
| 2 | Development priority | `development_priority` | Priority categories below |
| 3 | Desired change | `desired_change` | Priority categories below |
| 4 | Unaided party attention | `party_salience_unaided` | Party/group categories below; do not read a list |
| 5 | Aided issue leadership | `perceived_issue_leader_aided` | Party/group categories below; read the neutral list in the saved question |
| 6 | Surabhi Vani Devi's incumbent performance | `incumbent_assessment` | `Positive`, `Neutral`, `Negative`, `Mixed` |
| 7 | Previous awareness of Kasani Veeresh | `candidate_awareness` | `Previously aware`, `Not previously aware`; context and skip logic only |
| 8 | Overall impression of Kasani Veeresh | `candidate_impression` | `Positive`, `Neutral`, `Negative`, `Mixed` |
| 9 | Kasani Veeresh's suitability to address graduates' needs | `candidate_criterion_fit` | `Strong fit`, `Some fit`, `Poor fit`, `Mixed` |
| 10 | Kasani Veeresh's public work | `leader_assessment` | `Positive`, `Neutral`, `Negative`, `Mixed` |

Priority categories: `Employment and jobs`, `Education and universities`, `Skills and professional development`, `Representation and accessibility`, `Civic services and infrastructure`, `None`.

Party/group categories: `BRS`, `BJP`, `Congress`, `Communist / Left`, `Independent / graduate group`, `None`.

Keep categorical output values in the exact canonical English spelling even when the respondent speaks Telugu or Hindi. Question and spoken-option translations are in the JSON. Configure extraction from the matching question only. Do not create aliases, infer an answer from another question, or substitute a whole-call sentiment. Do not add auxiliary reason/awareness keys to one of the nine report contracts.

### Sarvam output-variable settings

In Sarvam's **Variables → Output variables**, set **Data Type = Enum** for each of the ten exact keys above, not free-form String. Sarvam documents the supported String/Enum choice and extraction prompts in its [Variables & Personalization guide](https://docs.sarvam.ai/voice-agents/build/variables-personalization). For this instrument, Enum is the bounded categorical configuration; its members are string-valued labels, not numeric codes.

For each field, enter its own canonical substantive values from the table **plus all four special members**, exactly: `no answer`, `can't say`, `refused`, `uncoded response`. For Q7, the substantive members are only `Previously aware` and `Not previously aware`, followed by those four special members. Do not add the special members to the platform reporting contract's substantive `allowedValues` list.

Set the **default/fallback to `no answer`** for an unasked, skipped or unanswered question. If a default-value control is available for that variable, select `no answer`; also state the fallback in its extraction prompt. The public output-variable documentation does not establish a separate mandatory default-setting control, so do not invent an API field or change runtime input variables to emulate one.

Use a field-specific extraction prompt: extract only the respondent's explicit answer to that field's exact question; return one of its configured Enum members; return `no answer` if the question was not asked or not answered. Use `can't say` only for expressed uncertainty, `refused` for explicit refusal, and `uncoded response` if the answer cannot be mapped unambiguously. Never infer a missing value, force a substantive category or copy another output. Keep the Q7 awareness gate for Q8–Q10.

The target `kasani-veeresh` / `Kasani Veeresh` is explicitly frozen as `CANDIDATE` for impression/suitability and separately as `LEADER` for public-work assessment. These distinct answers must not be copied into each other. Incumbent performance targets `surabhi-vani-devi` / `Surabhi Vani Devi` as `LEADER`; the officeholder was checked on the [official Telangana Legislative Council list](https://www.telangana.gov.in/legislature/members-of-legislative-council/) on 15 October 2026. Recheck the officeholder before later fieldwork. The question does not assert a party affiliation.

## Missing answers, awareness and neutral coding

- Use `no answer` (or null if the existing output mechanism requires null) for an omitted, skipped or unanswered question.
- Use `can't say` only for the respondent's stated uncertainty or insufficient information, `refused` for an explicit refusal, and `uncoded response` for unsupported/ambiguous answers.
- Do **not** emit literal `NOT_ANSWERED`, `CANT_SAY` or `REFUSED`; those are internal conceptual state names, not the configured provider labels.
- Do not replace uncertainty, refusal or unfamiliarity with `Neutral`, `Mixed`, `Negative` or `None`.
- Q8–Q10 apply only when Q7 is `Previously aware`. Otherwise skip them and record `no answer` for each; do not introduce a biography to create an opinion during measurement. An aware respondent may still answer `can't say` to any subsequent question.
- The priority questions are open, not a list to steer answers. Ask at most one neutral clarification to identify one priority; preserve an unresolved multiple answer as `uncoded response`. Do not invent a match for an out-of-taxonomy answer.
- Identify the caller honestly as an automated survey assistant and obtain consent; do not claim to be human or invent a sponsor. Respect withdrawal, use a short acknowledgement and move forward. Do not repeatedly greet, confirm the name or repeat the respondent's answer. Do not ask for a vote, advocate a party or infer an individual political alignment.

Q1–Q6 are unconditional core questions with `required: true` and `requiredForCompletion: true`. This declares the evidence needed for recorded completion; it never authorizes a forced answer. Actual uncertainty and refusal are accounted for distinctly, while missing answers keep coverage incomplete. Q7 and conditional Q8–Q10 remain optional for completion. The current completeness parser does not infer conditional paths. Respect a stopped interview; do not fill its unanswered core outputs.

An `uncoded response` on a categorical core question remains uncoded in reporting and technically unresolved for completion under the current parser; it must not be coerced into an allowed category to pass a completion check. A call with only uncertainty/refusal has no substantive required record even when each question is accounted for.

## Platform configuration and runtime boundaries

1. Review the new wording independently. Save it as a **new unused questionnaire version**, not as an edit to V1 or an existing Iteration's frozen questionnaire. The source intentionally has no saved questionnaire or question IDs.
2. Save the nine exact `reportingContract` definitions from the JSON using the existing reporting-contract workflow. Also preserve `required_for_completion`, `output_variables`, the optional `askIf` rules and Telugu wording in question metadata when saving; a basic UI question entry alone may not persist these fields. Verify the actual saved rows before selecting the instrument. Q7 is explicitly context-only and has no invented native reporting contract. Nine reportable questions out of ten is intentional; `scheme_experience` remains unsupported.
3. Refresh saved definitions and download the platform's agent review pack. Verify its saved wording, output variables, targets and fingerprints against this source. Source tests alone do not prove a successful live save.
4. In Sarvam, resolve the intended **actual app ID, newly committed version and outbound connection**. No agent version or connection is hardcoded in this specification. Configure the ten matching extraction variables and review the committed configuration before assigning the future Iteration.
   Replace only the intended instrument-specific question section in a preserved
   new draft; do not append these ten questions to another questionnaire. Do not
   overwrite unrelated uncommitted edits or delete historical versions. For this
   instrument, disable legacy theme collection and participant-level political
   inference (including `party_lean_signal`, `national_party_lean_signal` and
   ideology/participant ratings). Retained legacy schema fields must not invent
   values from these answers. Preserve verified greeting, interruption, voice,
   tools, runtime-variable names and call-session behavior.
5. Keep the deployed compact platform runtime input contract unchanged. These are agent-owned question/extraction instructions; do not inject a large questionnaire context into an undocumented variable, add another greeting, restart the session on each turn or change outbound integration settings without separate validation.
6. Before any separately approved outbound test, verify the frozen questionnaire identity, selected app/committed version, expected outbound connection and payload keys. After that approved call, review actual question delivery, one-time greeting, name handling, skips and extracted output values. Do not batch launch on the strength of a source artifact.

No calls, agent commits or launch approvals are performed by this guide. Current reports are unweighted aggregate descriptions; candidate awareness is not approval, party attention is not vote choice, and suitability is not sentiment. Existing disclosure rules can withhold small demo distributions; do not weaken them to populate a chart. Independent real-call/extraction review and research sign-off remain pending.

## Local validation

```sh
node deployment/campaign-mlc-questionnaire/test-campaign-mlc-pulse-v2.mjs
```

The test uses the actual platform contract validator, shared output normalizer, snapshot builder and interview-completion parser. It checks ten distinct questions/keys, nine supported contracts, stable targets, neutral ordering, context-only awareness, six required unconditional core questions and canonical/missing-state round trips. Synthetic completion probes verify accounted uncertainty/refusal and incomplete missing evidence. It does not validate spoken delivery, translation quality, provider configuration or research representativeness.
