# Role-specific Dashboard

Replaces the fixed demo homepage metrics with read-only, role-scoped operational data.

- Super Admin: visible portfolio, ownership gaps, active Runs and evidence exceptions.
- Admin: assigned campaigns and drafts created by that Admin.
- Campaign Manager: assigned Campaigns, Iterations and closeout readiness.
- Campaigner: only actively allocated Campaigns and Iterations, with ready Runs and call follow-up.

The Dashboard never launches calls or changes lifecycle state. It does not infer vote share from demo respondents.

Campaign cards expose an aggregate execution funnel—attempts, connected calls,
successful outcomes, connection rate and evidence readiness—without exposing voter-level
records. These campaign-level measures form the safe product boundary for a future embedded
QuickSight dashboard.

Each role receives a distinct operating brief and decision boundary:

- Super Admin sees platform governance, ownership and evidence exceptions.
- Admin sees campaign administration, assignment readiness and operational exceptions.
- Campaign Manager sees research completion, successful outcomes and evidence readiness.
- Campaigner sees only their execution queue, pending/retry contacts and callback follow-up.

For Super Admin, Admin and Campaign Manager roles, the Dashboard additionally
provides an executive program-intelligence layer:

- Program, Campaign, Iteration, Mandal, age and gender selectors;
- aggregate five-point Program pulse;
- positive, neutral, negative and uncertain sentiment distribution;
- unaided party-salience, candidate-perception and issue-leadership landscapes;
- non-overlapping age cohorts: 18–29, 30–39, 40–49 and 50+;
- gender-level aggregate reporting;
- Mandal sentiment heatmap with suppression below five respondents;
- issue-priority chart; and
- aggregate cross-Iteration trend, indicative next-Iteration pulse and confidence label.

Cross-Iteration trends and projections are shown only inside one selected
Campaign and only when at least two Iterations share the same frozen
questionnaire code/version, research phase and sample design. Program-wide or
instrument-incompatible scopes retain their operational roll-ups, but the
research trend is explicitly marked unavailable. This prevents a questionnaire
change or a different Campaign from being presented as voter-opinion movement.

The demo uses unweighted directional evidence. The latest connected structured
response per respondent is retained within each Iteration, filtered cohorts below
five observations are withheld, and direct party support must not be inferred when
the questionnaire records only proxy variables.

The regular Dashboard keeps results, report scope, answered/respondent bases,
review status and withholding labels visible. Detailed explanations start closed:

- “About this Dashboard” distinguishes role-visible operational totals from
  filtered research reports.
- “Role and scope” retains responsibilities and decision boundaries.
- “How it’s measured” explains each report, denominator and unavailable values.
- Demographic and Mandal notes retain detailed answer-coverage tables.
- “Research method” retains sample, collection mode, weighting, instrument,
  analysis unit and statistical-precision disclosures.

These native expandable notes work with mouse, keyboard and touch; they do not
change calculations, filters, data access or survey outputs. Operational totals
remain independent of research filters. Campaign evidence readiness measures
captured transcript/response slots, not the proportion of fully complete calls.

The nine research report cards share one responsive equal-width grid and a
consistent header, visualization and footer structure. Closed cards have equal
heights, matching heading slots and bottom-aligned measurement notes. Long
labels remain readable; opening a note expands its row without clipping its
explanation or making every other row taller. The Mandal heatmap stays full-width
to accommodate its geographic table. Operational metric cards also use shared
label/value/detail slots.

Analysis remains the detailed evidence workspace for questionnaire performance,
Run/Iteration diagnosis and interpretation. Dashboard visualizations are concise
monitoring signals. They do not create participant-level political scores or
election forecasts.

Run the offline rendering regression checks:

```bash
node deployment/role-dashboard/test-dashboard-disclosures.mjs
```

For isolated visual review, serve the actual Dashboard/CSS with synthetic data:

```bash
node deployment/role-dashboard/test-dashboard-disclosures.mjs --serve-fixture=4177
```

Open `http://127.0.0.1:4177/`, `/?fixture=sparse` or `/?fixture=populated` for
default, empty and long/populated card layouts. These fixtures disable effects
and live API requests; they are not deployment or survey-result evidence.

The disclosure-layout change is frontend-only; it requires no API installation
or database migration.

Install on the API host:

```bash
node deployment/role-dashboard/install-role-dashboard.js \
  /opt/sarvam-voice-analytics
```

Then syntax-check the installed files, restart the API and verify `/ready` plus the authenticated `/api/dashboard` endpoint for every role. No database migration is required.
