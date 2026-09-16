# Voter identity and electorate model

Use one database and one voter_master person/contact record. Do not copy a
person into separate Assembly, MLC and local-body voter databases.

The model separates three concepts:

1. voter_master.id — stable internal person/contact key.
2. voter_identifiers — zero or more typed identifiers such as EPIC, a
   Graduates' MLC roll number, a local-body roll number, or an internal demo ID.
3. voter_electorate_registrations — the specific electorate in which the
   person is eligible. One voter can have multiple registrations.

## Election rules

| Contest | Identity/roll rule |
| --- | --- |
| MP / MLA | EPIC should be present and the Assembly/Parliamentary registration verified before production selection. |
| MLC Graduates | EPIC is not required; use the Graduates' constituency roll and its identifier when available. |
| MLC Teachers | EPIC is not required; use the Teachers' constituency roll. |
| MLC Local Authorities | Use the applicable local-authority electoral roll. |
| Local body | Use the relevant ward/division/panchayat/local-body roll; EPIC remains optional. |
| Controlled demo | Explicit consent and the demo allow-list are required; an internal demo identifier is used. |

Phone number, name and address are matching signals, not authoritative
eligibility identifiers. Never convert an existing production voter into a
demo voter merely because a submitted phone number matches.

## Deployment

    cd /opt/psephology-survey-ui/psephology
    node deployment/voter-electorate-model/install-voter-electorate-model.js /opt/sarvam-voice-analytics

    cd /opt/sarvam-voice-analytics
    node src/db/migrate-voter-electorate-model.js

The migration is additive and backfills existing nonblank
voter_master.epic_number values as EPIC identifiers with UNVERIFIED status. It
does not invent MLC or local-body eligibility.

## Rollout sequence

1. Apply this migration.
2. Update each import mapping to declare its electorate type, target, roll
   source and identifier type.
3. Reconcile duplicates into one voter_master record while retaining every
   typed identifier.
4. Validate registration coverage. Do not enable a hard production selection
   gate until every active campaign dataset has been reconciled.
5. New production Run selection can call
   voter_is_eligible_for_campaign(voter.id, campaign.id). Controlled demo
   voters continue through the explicit demo allow-list.

This design keeps historical calls and responses attached to one person while
allowing eligibility to change by election, roll and validity period.
