# Graduate MLC Campaign thought-pulse questionnaire — draft v1

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
