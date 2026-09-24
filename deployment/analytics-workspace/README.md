# Analytics Workspace

Adds the role-scoped API behind the Analytics sidebar page.

The workspace is hierarchical: Campaigns contain Iterations and Runs, and every
analysis entry point resolves to the dedicated Analytics workspace.

- Super Admin: all non-archived Campaigns.
- Admin: assigned Campaigns plus unassigned drafts created by that Admin.
- Campaign Manager: Campaigns assigned to that manager.
- Campaigner: no Analytics workspace access.

The overview reports survey coverage and evidence completeness independently:

- successful voter coverage;
- callback coverage;
- transcript coverage for connected calls;
- structured response coverage for connected calls.

The Analytics landing page applies a role-specific decision lens without changing data scope:

- Super Admin receives portfolio lifecycle and evidence-governance signals.
- Admin receives delivery progress and data-assurance signals for administered Campaigns.
- Campaign Manager receives respondent coverage and analysis-readiness signals for assigned Campaigns.
- Campaigner remains excluded from portfolio Analytics and uses the execution Dashboard instead.

Phase 1 strategic Campaign analysis adds:

- a directional/demo validity banner;
- comparable Iteration movement;
- questionnaire answer and missing-data performance;
- issue-priority coding;
- candidate awareness and criterion-fit distributions;
- party salience, perceived issue leadership and association visibility;
- deterministic transcript themes with links back to stored call evidence;
- evidence-qualified finding cards.

The strategic workspace supports an explicit Campaign → Iteration → Run hierarchy:

- Campaign overview uses the latest completed Iteration for current distributions and keeps cross-Iteration movement separate.
- Iteration analysis deduplicates respondents across Runs using the latest connected evidence per voter.
- Run analysis isolates the selected execution cohort and labels Run 2/3 as retry cohorts, not independent opinion movement.
- The selected scope reports attempts, connections, successful outcomes, duration, callback coverage, transcript coverage and structured-response coverage.
- Institutional awareness, incumbent assessment, candidate criteria and association influence are retained beside the original issue, candidate and party signals.

The selected Iteration now includes a concise decision dashboard with:

- candidate perception grouped as Positive, Neutral, Negative or Can't say;
- candidate criterion-fit and incumbent-assessment distributions;
- unaided party-attention and aided issue-leadership signals;
- priority issues, development priorities and desired changes;
- aggregate filters for gender, non-overlapping age bands and Mandal;
- suppression of filtered political results below a five-respondent base;
- an aggregate five-star party-strength index only when a direct neutral 1–5
  questionnaire response is available.

The Campaign view also presents a transparent five-point aggregate campaign
rating. It combines available campaign-level output distributions for direct
neutral rating, unaided BRS attention, perceived BRS issue leadership and
candidate-perception balance. The card shows its component coverage, confidence,
respondent-observation base and contributing components. The composite is
directional research evidence, not vote intention, and no participant rating or
participant-to-band mapping is created or retained.

Party attention is not labelled as vote intention. Predictive output remains
an aggregate directional judgment while the evidence is a small/demo cohort
without sampling weights and out-of-sample validation. The platform never
produces an individual voter political-propensity score.

The streamlined Iteration-wide Analysis separates:

- predictive analytics: aggregate party-strength outlook, confidence, drivers
  and exact contributing output variables;
- sentiment analysis: positive, neutral, negative and uncertain distributions,
  variable-level coverage and an Iteration judgment;
- direct party-strength measurement from an explicit neutral 1–5 output, shown
  separately from the derived aggregate estimate;
- a three-step next-Iteration plan that cites the variables supporting every
  recommendation; and
- psephology quality controls for sample base, minimum segment size, weighting,
  representativeness, uncertainty and benchmark continuity.

Selecting a Run changes operational metrics only. Predictive, sentiment and
party-strength judgments always use all deduplicated respondents in the selected
Iteration.

Install on the API host:

```bash
node deployment/analytics-workspace/install-analytics-workspace.js \
  /opt/sarvam-voice-analytics
```

Then syntax-check and restart the API.
