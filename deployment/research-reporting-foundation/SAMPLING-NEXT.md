# Sampling work that remains

Contact-cohort diagnostics are useful quality controls. They are not an
executable probability-sampling design or proof of electorate representativeness.
The existing Run selector applies allocation, geography, active/contact,
approved-demo and other eligibility filters, orders IDs and limits the count.
That is not random sampling. Retry Runs must not be counted as fresh samples.

## Future-only frame and selection controls

Before introducing an actual sampler, implement and independently validate:

1. **An approved frame definition:** election/registration category, target
   geography, eligibility rules, exclusions, source release, date and coverage
   limitations. Demo approval does not verify electorate membership.
2. **An immutable frame manifest:** approved eligible IDs in protected storage,
   recorded count, content hash, version and as-of time. Freeze demographic
   scope at selection rather than reconstructing it from today's voter master.
3. **A declared sampling design:** census of that recorded frame or a supported
   probability algorithm. Record target size, strata where applicable, inclusion
   probabilities, reproducibility inputs and the selected-cohort manifest hash.
   A declaration alone must not activate weighted or representative reporting.
4. **Approval and change history:** approve the draw before calling; prevent
   untracked redraws, silent replacements and post-result changes. Define panel,
   independent-sample and retry rules explicitly for later Iterations.
5. **Live calling vetoes:** preserve current consent, do-not-call, active-contact,
   role/allocation and approved-demo gates. A person blocked after selection is
   not silently replaced or erased from the original frame audit.

Political ratings, inferred support and individual political profiles are not
inputs to this statistical sampling design.

## Survey outcomes and statistical reporting

- Define interview completeness and partial-interview rules against the frozen
  instrument; retain actual question-delivery and eligibility evidence. Provider
  transport status, one answered output or an operational success flag is not
  sufficient evidence of a completed survey.
- Record a single reviewed survey disposition per sampled unit with provenance,
  distinguishing eligible, ineligible and unknown-eligibility cases. Do not infer
  refusal from a busy call, missing callback or technical failure.
- Adopt and document the appropriate standardized outcome-rate definitions only
  when their required dispositions and denominators are available.
- Diagnose coverage and nonresponse against the recorded frame and appropriate
  external population controls. Demographic differences alone neither prove nor
  rule out nonresponse bias.
- Add weights only through an audited execution pipeline: input population
  controls, eligible observations, algorithm/version, trimming, effective sample
  size and reproducible outputs. Validate any uncertainty estimates against the
  actual design; do not apply probability-sample margins of error to the demo.

Historical missing frame, eligibility, consent, question-delivery or sampling
identity must remain missing. This document does not authorize calling,
backfilling records, changing live selection or uploading respondent data.

Primary guidance: [AAPOR Standard Definitions](https://aapor.org/standards-and-ethics/standard-definitions/)
and [AAPOR best practices](https://aapor.org/standards-and-ethics/best-practices/).
