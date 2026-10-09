# Demo sentiment checks and review protocol

This package runs locally against the shared versioned normalizer. It does not
call a model, contact a database, fetch transcripts, change stored outputs, approve
rules, install a service or deploy anything. A recorded party mention, candidate
awareness or demographic characteristic cannot become an individual political
trait or a sentiment label through this tool.

The default benchmark contains **246 authored synthetic engineering checks**:
English, Telugu, Hindi and mixed/code-switch inputs across five sentiment
constructs and one separate suitability construct. Ten source families cover
explicit categories, negation, ambiguity, uncertainty, refusal and absent output;
six additional controls check that awareness is not an assessment. Repeated
phrases across constructs check isolation; they are not independent language
observations. The Telugu/Hindi examples and intended readings are drafts requiring
fluent human review, not a validated translation or sentiment dataset.

The current `OUTPUT_TAXONOMY_V2` baseline matches 246/246 authored contract
expectations. This is a deterministic regression result, **not 100% sentiment
accuracy**. There are zero reviewed real-call samples. Human review remains
`HUMAN_REVIEW_PENDING`. In the generated report, each of the 24 language/construct
strata has its own status counts, confusion matrix, coverage and abstention rate.
No pooled sentiment result combines different questions or suitability.
Custom inputs retain all 24 cells, including absent cells with zero counts and
null rates. `realCallCoverageGaps` identifies each cell with no attested reviewed
real-call reference. `stratifiedReviewStatus` stays `HUMAN_REVIEW_PENDING` while
any such gap or incomplete real-call declaration remains. A nonzero count in
every cell still does not prove sample sufficiency, accurate extraction, reviewer
identity or deployment approval.

## Run offline

```sh
node deployment/sentiment-validation/test-sentiment-evaluation.js
node deployment/sentiment-validation/evaluate-sentiment.js
node deployment/sentiment-validation/evaluate-sentiment.js --report /absolute/path/to/new-report.json
node deployment/sentiment-validation/evaluate-sentiment.js --input /absolute/path/to/manually-sanitized-review.json --report /absolute/path/to/new-review-report.json
```

The report directory must already exist. Report creation uses an exclusive write:
an existing file, including the input, cannot be overwritten. Inputs stay
unchanged. An input/schema error, mismatched reference, invalid construct output
or pending real-call review returns a nonzero exit code. Passing synthetic checks
returns zero while explicitly retaining pending human review and granting no
deployment approval. Reports bind `normalizationVersion` and `rulesetHash` to the
shared raw rule source **and implementation bytes**. Any change requires a fresh
evaluation; a report for an earlier hash does not cover newer code.
The report also hashes the validated input object, including supplied outputs and
review declarations, so changing a review label changes the dataset binding.

The report omits source excerpts and raw provider output. Keep review input files
and signed evidence in the approved local restricted review location; do not add
real excerpts to the public repository. Pattern checks can catch some phone,
email and source identifiers, but cannot prove complete anonymization or recognize
every person's name. Manual sanitization is required.

## What is evaluated

`NORMALIZATION_MAPPING` tests the supplied recorded scalar against an authored
coding contract. For example, an unsupported narrative must remain uncoded even
if a reader could make a plausible guess. Some code-switch fixtures therefore
expect abstention. The score does not measure narrative understanding.

`RECORDED_PROVIDER_OUTPUT` compares the **actual stored provider output** with the
reference label. The evaluator never extracts a label from the excerpt or runs
the upstream provider. If the excerpt is negative but the provider recorded
`Positive`, correct normalization of that supplied value still produces a
mismatch against a negative reviewed reference. Do not replace the provider value
with a human label before evaluation. The synthetic provider-output fixtures are
illustrations of this comparison, not evidence that extraction succeeded in a
real call.

These six constructs stay separate:

| Construct | Accepted recorded keys | Categories |
| --- | --- | --- |
| Candidate impression | `candidate_impression`, `candidate_sentiment`, `veeresh_impression` | Positive, Negative, Neutral, Mixed |
| Incumbent assessment | `incumbent_assessment` | Positive, Negative, Neutral, Mixed |
| Issue assessment | `issue_sentiment` | Positive, Negative, Neutral, Mixed |
| Development assessment | `development_sentiment` | Positive, Negative, Neutral, Mixed |
| Expected-change assessment | `change_sentiment` | Positive, Negative, Neutral, Mixed |
| Candidate criterion fit | `candidate_criterion_fit`, `veeresh_criterion_fit` | Strong fit, Some fit, Poor fit, Mixed |

All constructs also retain `MISSING`, `CANT_SAY`, `REFUSED` and `UNCODED` separately.
An awareness key is rejected as the input key for an assessment. Suitability is
not polarity; “Strong fit” cannot be treated as “Positive.”

Coverage is the count of supported coded assessments divided by recorded
non-missing outputs. Classifier abstention counts only `UNCODED`; explicit
uncertainty and refusal have separate counts. These are descriptive checks of
submitted cases, not estimated field accuracy, standardized survey response rates
or statistical precision. Synthetic and attested real-call agreements have
separate counters in each stratum.

## Select an actual demo review batch

No actual samples are included or fetched automatically. An authorized person
first defines the approved demo scope and extracts only short relevant excerpts
from permitted existing material. Do not launch new calls for this package.

Use a planning target of **10 manually sanitized excerpts per language/construct
stratum**: 4 language strata × 6 constructs = up to 240 excerpts. This is a small
purposive diagnostic review plan, not an accuracy-certification threshold. Report
the actual count in every cell, including zero. If a language or construct is
absent, record that gap rather than translating or inventing real examples to
fill it. Do not infer a person's language from name, location or demographics.

Within each available stratum include explicit categories and challenging
negation, genuinely mixed assessments, ambiguous/code-switch narratives,
uncertainty, refusal and missing/capture failures where present. Keep the
selection log and sampling limitations outside the evaluation dataset. Do not
select only examples the current rules already code successfully. If multiple
excerpts come from the same conversation, document that dependence privately;
the report's excerpt counts are not unique people or independent samples.

Replace personal and candidate names with neutral role placeholders where needed
to preserve question meaning. Remove phone numbers, voter/EPIC/call/provider IDs,
addresses and other identifying details. Use new technical sample references
that cannot be mapped publicly to source records. Preserve only the approved
question, short response excerpt and actual recorded output needed for review.
Never add voter/contact fields to this schema. Confirm both manual sanitization
flags only after this work is complete.

## Label and adjudicate

Two independently working reviewers fluent in the relevant language/code-switch
pair inspect the question context and sanitized excerpt. They record their label
and rationale **before seeing the provider output or each other's label**.
Reviewers must distinguish the target construct from a mention of another target.
After initial labels are frozen, compare against the recorded provider output.

| Reference state | Required meaning |
| --- | --- |
| Positive / Negative | An explicit evaluative assessment of the stated target; negation and scope have been resolved from context. |
| Neutral | Explicit middle/neutral evaluation; not missing output, mixed views, lack of knowledge or refusal. |
| Mixed | Both favorable and unfavorable evaluation of the same target; retained separately from Neutral. |
| Strong / Some / Poor fit | Explicit suitability relative to the stated criterion; never converted into sentiment polarity. |
| Can't say | Explicit uncertainty, insufficient knowledge or inability to assess. |
| Declined to answer | Explicit refusal; not silence, disconnect or a missing capture. |
| Missing | No recorded answer/output, unasked or capture unavailable; do not claim the speaker expressed uncertainty. If an excerpt contains an answer but provider output is absent, label the excerpt's meaning and retain the missing provider output as an extraction mismatch. |
| Uncoded response | Meaning cannot be resolved reliably for this construct: ambiguous scope, sarcasm, conflicting narrative or unsupported content. Do not force polarity. |

When the two labels disagree, a third distinct fluent reviewer must adjudicate
from the source context and record a signed decision with rationale. Unresolved
disagreement, an unsigned review, a repeated reviewer reference or an `AUTO`
review remains `HUMAN_REVIEW_PENDING`. Pseudonymous references do not prove that
reviewers are distinct human beings. This CLI records claims; the responsible
review owner must inspect identity, independence, signed evidence and language
competence outside the tool.

Use review state `UNREVIEWED` or `REVIEW_IN_PROGRESS` until the declared signed
records are present. Only `REVIEW_DECLARED_COMPLETE` with two distinct
`HUMAN_DECLARED`, human-confirmed, signed evidence references can provide an
attested reference. A disagreement additionally needs distinct signed
adjudication. The report labels such references
`HUMAN_REVIEW_ATTESTED_UNVERIFIED`; it never labels them independently verified.
Even adding reviewer declarations to synthetic fixtures does not turn them into
real-call validation or autoapprove them.

See [review-input.template.json](review-input.template.json) for the exact schema.
Its sanitation flags are deliberately false and reviews are empty. It must fail
until a person supplies actual manually sanitized material and review records;
do not submit the template as a real sample.

Each reviewer/adjudication object uses this shape. These provisional values do
not qualify as a signed review; replace them only after actual review:

```json
{
  "reviewerReference": "reviewer-a",
  "identityKind": "HUMAN_DECLARED",
  "confirmedHuman": false,
  "signedAt": null,
  "evidenceReference": null,
  "label": { "status": "UNCODED", "label": "Uncoded response" },
  "note": "Provisional; independent review and signed evidence required"
}
```

`signedAt` must be a valid UTC timestamp such as `2026-10-09T09:00:00Z`.
`evidenceReference` names the restricted signed review record; it is not fetched
or verified by the evaluator. Real names and contact details do not belong in
these fields. An `AUTO` record may be retained as such but cannot provide human
gold, even if a confirmation checkbox was set.

## Demo acceptance and review decision

The engineering requirement is strict: no contract mismatch; no mixing of
constructs; no invented polarity from awareness, number/boolean values, missing
or refusal; and preserved input bytes. Report every critical error and all
language/construct gaps. A mismatch blocks the engineering gate even if an
aggregate match rate looks high.

Before any human review claim, the review owner must inspect actual signed
records, resolve every disagreement, verify the manual selection/sanitization
log, and examine each language/construct confusion matrix and coded coverage.
Inspect polarity flips on negation, mixed-to-neutral collapses, false assessment
from awareness, refusal/uncertainty confusion and provider extraction errors
case by case. Do not average away a failure in one language or construct. Any
unresolved critical error or missing required stratum leaves that scope pending.

This small demo plan supplies no defensible numeric model-accuracy threshold.
Passing fixture assertions or increasing sample counts alone cannot validate
sentiment accuracy. A human owner must state the reviewed demo scope, observed
limitations, exact rule hash, unresolved errors and approval rationale before a
separate authorized deployment decision. This evaluator cannot change the shared
pending validation status, grant deployment approval, introduce a model, create
individual political scores or certify representativeness or forecasting.
