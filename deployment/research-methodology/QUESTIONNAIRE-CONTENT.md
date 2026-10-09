# Future questionnaire-content provenance

New Iterations freeze the actual ordered questions selected from the questionnaire
store, not just the questionnaire header. The snapshot retains its existing
`id`, `code`, `name`, `version` and `status_at_selection`, and adds:

- `snapshot_schema_version: 2` and `question_provenance: FROZEN_AT_SELECTION`;
- `questions`, containing the actual wording, Telugu text where recorded,
  options, type, completion rules, analysis category and output-variable metadata;
- `content_fingerprint`, a SHA-256 hash of the canonical semantic question array.

Question row IDs, author IDs and storage timestamps are excluded from instrument
content. English/Telugu wording, response options/order and output mappings are
not normalized or guessed. Changes to those definitions change the fingerprint.
Every question needs a unique stable code and positive unique order. Empty or
incomplete instruments cannot be selected for a new Iteration.

The UI mirror does not own the backend's original question relation. The helper
resolves exactly one public stored relation with the existing contract
`questionnaire_id`, `question_order`, `question_code`, `question_text`; its
catalog-derived identifiers are quoted and questionnaire identity remains a
parameter. Missing or ambiguous schemas fail closed with an actionable error.

No historical Iteration, question or answer is updated. Earlier header-only
snapshots remain explicitly limited; current catalogue wording cannot be used
to manufacture past provenance. No questions are automatically marked as a
common core. BASE, CAMPAIGN and TURNOUT questionnaires may legitimately differ;
equal output-variable names alone do not establish unchanged questions.

For future repeated-wave movement, retain the same complete frozen instrument.
If different stage-specific modules are needed, create/version those instruments
and treat their results separately until an explicitly approved unchanged core
question comparison is implemented. This step records content provenance; it
does not change Sarvam agent prompts or claim that different stages measure the
same construct.

## Launch-time catalogue drift check

The Step 3 installer adds a first-action guard to `launchRun`, before any launch
state change or provider submission. Future schema-v2 snapshots must have a
valid recorded fingerprint and still match the current questionnaire identity,
version and actual question definitions. Drift produces a `409` and blocks the
batch. An unavailable or ambiguous question schema fails closed.

Historical header-only snapshots return `LEGACY_CONTENT_UNAVAILABLE`; the guard
is explicitly unenforced for them. No past instrument is reconstructed and no
historical record is modified. Such waves remain limited by the comparison gate.

The check is catalogue parity at launch time, not cryptographic proof that the
committed Sarvam agent asks those questions. It does not change runtime context,
inject long questionnaire prompts or undo the compact handoff that fixed the
repeated-greeting problem. Verify the committed agent using an approved canary
call before a new instrument/version is used. Changes made after the check, and
direct execution paths outside `launchRun`, are outside this minimal guard.

Run the focused regression with Node.js:

```sh
node deployment/research-methodology/test-questionnaire-snapshot.mjs
node deployment/research-methodology/test-questionnaire-launch-guard.mjs
```

Installers that copy `campaign-iterations.repository.js` also install its new
helper dependency. The helper installer preserves an existing changed helper in
a dated backup and is idempotent for identical content.
