# Graduate MLC Campaign thought-pulse questionnaire — draft v1

**Historical handoff:** the V1 account below records 15 September 2026, not the
current live Run/version state or today's deployment procedure. The subsequent
compact runtime handoff deliberately leaves dynamic questionnaire context blank
for the dedicated V1 prompt. Use the coordinated
[callback/consent release runbook](../outbound-consent/README.md) for the current
release; preserve used V1 records. The separate Reporting V2 section below is
prospective, unused and draft-only.

`campaign-mlc-pulse-v1.json` is a reviewable, ten-question specification for a
new Campaign-stage questionnaire. The ten questions were entered as a **Draft**
in the live platform on 15 September 2026 as questionnaire
`eb55fbc2-54db-4609-80d4-7cf7118bb15d`. The questionnaire has not been
validated in a call, and the wording has not been sent to Sarvam through a Run
context. On 15 September 2026, the assigned Demo Campaign Manager created
Campaign-stage Iteration `5410403e-d257-4389-8c47-fba6ac31c666` in the second
Serilingampally Campaign and selected this questionnaire and the committed
Political Agent App v1. Serilingampally work area `4516` was saved for Demo
Campaigner. No Run or call was created during this handoff. The incumbent
name was checked against the Telangana State
Portal on 15 September 2026. The name and affiliation of Veeresh were not
verified from an official source; the questions deliberately do not state an
affiliation or make claims about his record.

The intended Sarvam agent is `Political_Agent_Base`, Agent App ID
`Political-A-b26ad56c-c4ae`, committed version 1. Its selectable platform
catalog record was verified on 15 September 2026. Reuse this agent for the
Campaign stage only after confirming that its deployed
version receives `questionnaire_context` and follows the newly selected
Campaign questionnaire rather than a hard-coded Base survey. Keep the Base
survey version/deployment unchanged if an agent update would alter its behavior.

The wording is intentionally neutral: it measures priorities, prior awareness,
perceived issue responsiveness and candidate criteria, not vote choice. The
first party item is unaided; the second gives BRS, BJP, Congress, Left parties,
independent groups, Other, None and Not enough information equal standing.
Do not present the user's hypotheses about student or teacher wings as facts
to respondents. Review the provisional Telugu wording with a fluent researcher
before publication or calls.

## Primary output variables

| Question | Primary variable | Meaning |
| --- | --- | --- |
| 1 | `graduate_issue_priority` | Main concern, coded from the respondent's words |
| 2 | `mlc_role_awareness` | Prior familiarity with the role |
| 3 | `incumbent_awareness` | Prior awareness of Surabhi Vani Devi |
| 4 | `incumbent_assessment` | Assessment only if the respondent has prior knowledge |
| 5 | `candidate_criterion` | Most important candidate quality, unaided |
| 6 | `association_influence` | Whether an association shaped views; do not infer party affiliation |
| 7 | `party_salience_unaided` | Group named before any party list is read |
| 8 | `perceived_issue_leader_aided` | Group chosen from balanced aided options |
| 9 | `veeresh_awareness` | Prior knowledge of Veeresh, not prompted approval |
| 10 | `veeresh_criterion_fit` | Fit with the respondent's own criterion, if known |

Optional qualitative fields in the JSON preserve reasons or impressions.
Extract from explicit answers only. Use `NOT_ENOUGH_INFORMATION` or an
equivalent null/unknown code when a respondent does not know; never infer a
vote intention, party preference or candidate support from these fields.

## Platform and Sarvam handoff

1. An authorized questionnaire editor reviews the Draft `MLC_CAMPAIGN_PULSE_V1`
   record in the platform. Confirm codes,
   types, options, English/Telugu text and required flags against the JSON.
2. Confirm the new Campaign-stage Iteration selects **this** questionnaire,
   not the Base-stage questionnaire, and retains its ID/version snapshot.
3. Inspect `src/services/call-context-compiler.service.js` and
   `src/services/call-configuration.service.js` on the API host. The Iteration's
   `questionnaire_id` must resolve to the ten ordered question texts/options;
   `questionnaire_code` and `questionnaire_context` must reach the selected
   Sarvam Agent App as input variables. Selecting an ID alone does not prove
   that the voice agent received the question content.
4. In Sarvam, the Agent App must define and reference the input variables and
   configure output extraction variables. Sarvam's Variables tab controls
   whether an input variable is actually sent to the LLM. A source field that
   is not referenced in the agent's instructions may be ignored.
   Match `Political_Agent_Base` to its actual Agent App ID/version and active
   outbound deployment. The platform's Voice Agents catalog also requires an
   enabled, categorized record with connection ID and outbound phone number
   before it appears in the Iteration selector. If the Campaign survey needs
   different instructions, publish and deploy a separate version rather than
   changing the historical Base-stage configuration in place.
5. Test only on an approved demo voter. Verify the spoken wording, skip logic,
   webhook output variables and AWS-stored transcript before bulk launching.

The newly created Iteration inherited the older Campaign-stage objective
"Measure campaign movement and persuasion." Before any call, apply the
guarded `repair-campaign-iteration-objective.js` on the API host and verify
that the Iteration now describes neutral measurement without influencing
respondents. Install the updated default in the API repository to protect
future Campaign-stage Iterations.

From the repository checkout on EC2, the repair first runs read-only. It will
refuse to modify a different Campaign, Iteration, questionnaire or Agent App:

```bash
node deployment/campaign-mlc-questionnaire/repair-campaign-iteration-objective.js /opt/sarvam-voice-analytics
node deployment/campaign-mlc-questionnaire/repair-campaign-iteration-objective.js /opt/sarvam-voice-analytics --apply
node deployment/campaign-mlc-questionnaire/install-neutral-campaign-objective.js /opt/sarvam-voice-analytics
node --check /opt/sarvam-voice-analytics/src/repositories/campaign-iterations.repository.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

`preflight-sarvam-questionnaire-context.js` is read-only and never submits a
provider call. After Demo Campaigner creates Run 1 **without launching**, run:

```bash
node deployment/campaign-mlc-questionnaire/preflight-sarvam-questionnaire-context.js /opt/sarvam-voice-analytics
```

It verifies the Run's questionnaire/App v1 snapshots, compiles context for one
selected Run contact, checks every approved question text or code, and confirms
the compiled context is handed to Sarvam `agentVariables` in the execution
service. This proves the platform's pre-submission payload, not Sarvam's spoken
behavior; a single approved demo call and its AWS webhook/transcript remain
necessary to validate what the provider actually used.

Suggested agent rule: identify the call as voluntary research by an AI
assistant, use the approved consent/recording script, ask the approved Telugu
questions one at a time, accept "don't know" or refusal, skip Q4/Q10 when
there is no prior knowledge, do not advocate for any person or party, do not
ask how the respondent will vote, and end promptly on request. If asked for a
fact about a candidate or party that is not in an approved knowledge source,
say that it cannot be verified rather than inventing an answer.

The ten-contact demo cohort is a pilot. Treat percentages and sentiment as
descriptive, not predictive for the wider Graduates' electorate. Comparing
Base and Campaign stages requires shared normalized themes and a documented
instrument change; BRS/Veeresh-specific items have no Base-stage trend.

## Sources checked

- Telangana State Portal, [Members of Legislative Council](https://www.telangana.gov.in/legislature/members-of-legislative-council/), for the current constituency/member listing.
- [AAPOR survey best practices](https://aapor.org/standards-and-ethics/best-practices/) and [Pew's question-order guidance](https://www.pewresearch.org/writing-survey-questions/) for neutral wording, unknown options and unaided-before-aided order.
- [Sarvam Variables & Personalization](https://docs.sarvam.ai/conversations/build/variables-personalization) and [webhook payload](https://docs.sarvam.ai/conversations/api/deployments/webhooks/webhook-payload) for input/output variables and callback validation.
# Reporting V2 — new unused questionnaire

The [voice identity and delivery guardrail](voice-survey-identity-guardrail.md)
requires a direct, truthful AI answer when asked, a one-time opening and brief
neutral acknowledgments. It is a prompt-review artifact, not a publication or
call-launch command.

The additive [V2 source](campaign-mlc-pulse-v2.json) and
[Sarvam handoff](sarvam-campaign-mlc-pulse-v2.md) configure ten neutral questions
with nine supported report contracts and one context-only awareness question.
This is a new `MLC_CAMPAIGN_PULSE_V2` / version 2 instrument, not an edit or
backfill of the used V1 instrument. Questionnaire codes are unique in the
verified deployed schema, so V2 has its own code and ID.

The importer creates the DRAFT header and all questions/metadata in one
transaction. It checks the actual storage schema and unique identity, verifies
the active Admin/Super Admin creator and uses an exact fixture fingerprint for
apply. Identical unused content is idempotent. Conflicting, partial or used
content is refused; no merge, overwrite, repair or deletion occurs.

Resolve the authorized account ID, then dry-run from the checkout using the
existing API database adapter. No secret or password is supplied to this script:

```sh
node deployment/campaign-mlc-questionnaire/import-campaign-questionnaire-version.mjs \
  --fixture deployment/campaign-mlc-questionnaire/campaign-mlc-pulse-v2.json \
  --api-root /opt/sarvam-voice-analytics \
  --created-by "$QUESTIONNAIRE_ACTOR_ID" \
  --dry-run
```

After reviewing the exact returned `fixtureHash`, use the same command with
`--apply --expected-fixture-hash "$QUESTIONNAIRE_REVIEWED_HASH"` instead of
`--dry-run`. Undefined/invalid values fail closed. Retain the returned ID and
receipt; verify the saved catalogue and downloaded review pack. Do not blindly
retry an uncertain apply—dry-run first to distinguish an exact existing draft
from a failed or conflicting operation.

The importer does not install application code, restart services, assign an
Iteration, alter Sarvam, commit an agent or launch calls. Keep the new version
unused until independent wording review, exact provider-variable configuration
and separately approved call validation. Platform questions do not automatically
program Sarvam; preserve the compact runtime integration.

```sh
node deployment/campaign-mlc-questionnaire/test-campaign-mlc-pulse-v2.mjs
node deployment/campaign-mlc-questionnaire/test-import-campaign-questionnaire-version.mjs
```

Set `PGLITE_MODULE_PATH` to the local PGlite module when running the importer
test to include real PostgreSQL atomic-create, JSONB, usage-lock and rollback
checks. Without that variable, only the mocked operator/CLI tests run.
