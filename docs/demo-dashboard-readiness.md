# Demo dashboard: concept and collection readiness

The acceptance target is a complete, truthful reporting concept using sparse
test-call evidence, not a populated or representative election survey. Null,
missing, withheld and non-comparable results do not by themselves fail the demo.
Broken dataset references, failed sessions and API/visual errors still do.
No synthetic responses are mixed with captured survey evidence.

## Report-to-source coverage

This is a source-code audit as of 9 October 2026, not a declaration that every
deployed agent version has returned these fields. The current local Quick
authoring definition covers five sheets and 31 visuals. Its replacement is
unpublished; the existing published dashboard remains version 3.

| Report | Collection source | Reporting status and interpretation |
| --- | --- | --- |
| Party attention/salience | `party_salience_unaided` and approved aliases; current MLC questionnaire Q7 | Mapped to `party_salience` in the v2 view and charted. Recorded attention to graduates' concerns, not vote choice or party strength. |
| Group issue leadership | `perceived_issue_leader_aided` and approved aliases; Q8 | Mapped to `party_leadership` and charted. Group responsiveness, not approval of a named political leader. |
| Incumbent assessment | `incumbent_assessment`; Q4 | Mapped to `respondent_sentiment` and charted. Explicit-label descriptive coding; human review pending. |
| Candidate awareness/impression | `veeresh_awareness`, `veeresh_impression`; Q9 | Impression maps to `candidate_sentiment` and is charted. Awareness is captured separately; the open awareness question does not guarantee an overall impression answer. No response stays missing. |
| Candidate suitability | `veeresh_criterion_fit`; conditional Q10 | Normalizer and native analytics support it; it is not a separate Quick visual and must not supply missing candidate sentiment. |
| Graduate issue priorities | `graduate_issue_priority`; Q1 | Mapped to `issue_priority` and charted. Separate issue sentiment must not substitute for incumbent assessment. |
| Development priorities | `development_priority`, `priority_development` | Generic storage, normalization and native analytics support these aliases. No separate question in the current MLC instrument and no dimension/visual in the latest Quick v2 view. Needs explicit collection and Quick mapping. |
| Expected changes | `desired_change`, `expected_change`, `change_priority` | Same partial capability as development priorities. Needs an explicit question/extraction field and Quick mapping, not inference from unrelated answers. |
| Age, gender, constituency, Mandal | Voter-master fields joined to call evidence | Mapped to reporting dimensions. Age bands: 18–29, 30–39, 40–49, 50+. Unknown remains separate. Current geographic rollups do not support age/gender controls. |
| Geographic party-salience map | Qualified Mandal counts and geography-reference centroids | Conceptual point map and count-intensity heat tables. Approximate demo centroids are not verified respondent locations or party-strength estimates. |
| Iteration movement | Fixed-construct answered bases and recorded methodology/questionnaire snapshots | Descriptive adjacent-wave changes only when comparison checks pass. Non-comparable or inadequate bases remain unavailable. |
| Fieldwork and evidence quality | Executions, callbacks, transcripts, response sets and demographic completeness | Supported operational metrics. Not statistical confidence, model validation or population representativeness. |
| Direct party strength / election forecast | A party-qualified direct measure or separately validated aggregate model | Not certified by this demo. Legacy combined rating aliases lack a verified target-party contract; numeric strength and forecasts remain omitted. |

## Collection contract before an actual survey

The webhook stores returned `final_agent_variables` in `calls.response_variables`,
so new structured fields do not each require a new database column. Storage
capability is not proof that an agent asks the right question or returns the field.

For each intended report:

1. Define the construct, neutral question, output key, allowed values and separate
   missing/uncertainty/refusal states. Record target candidate/party where relevant.
2. Retain the questionnaire identity and frozen question content for the Iteration.
   The current questionnaire editor does not author `outputVariables`; the JSON
   instrument or a future editor extension must retain this metadata explicitly.
3. Configure and commit the matching Sarvam question and extraction field. Normal
   Campaign Runs currently use the compact phone-tested handoff with empty
   `questionnaire_context` and `research_context`; do not assume new platform
   questions automatically reach the agent. Do not restore the long payload
   without regression checks for the earlier greeting-loop issue.
4. Use an approved, consented test call to verify the exact agent/version, asked
   question, returned field and callback persistence. Historical calls are not
   rewritten to fill absent fields.
5. Verify normalization, reporting column, chart binding, answered base, filters
   and minimum distinct-person safeguards using isolated fixtures.
6. Perform a full SPICE refresh, verify zero skipped rows and a valid dashboard
   definition, then separately publish and verify the authenticated embed.

## Presentation acceptance

- Demonstrate Program/Campaign/Iteration drill-down and each sheet's actual
  supported filters, not universal filter coverage.
- Show empty chart frames with their purpose and source explained. Do not replace
  unavailable values with zero or relax the five-distinct-person safeguard.
- Distinguish **not recorded**, **withheld**, **not comparable** and **technical
  error**. Explicit "Can't say" is an answer, not an absent value.
- Use BRS pink, BJP saffron and Congress green for named party categories;
  sentiment uses its separate palette.
- Mark sentiment review pending and describe this as a capability preview using
  test surveys. Enterprise scale, survey representativeness and predictive-model
  validation require separate approval and work.

## Current outstanding work

The Quick working analysis has been reviewed, but candidate dashboard versions
4/5 have definition-readback errors/stale dataset bindings. Keep version 3 live
until the replacement passes verification. Sparse values are not the cause or
an acceptable substitute for resolving this technical publication gate.

Development/expected-change Quick reporting, personal-leader assessment and
generalized candidate/party-qualified measures are not end-to-end certified by
the current instrument. They can be shown as planned report capabilities, but
must not be presented as implemented collection paths or validated predictions.
