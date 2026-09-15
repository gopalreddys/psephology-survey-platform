# Future Iteration questionnaire provenance

New Campaign Iterations require the assigned Campaign Manager to choose a
questionnaire. The API validates its UUID, existence and availability, then
stores its `questionnaire_id` and a frozen code/name/version/status snapshot in
the same transaction as the Iteration and Campaign link. The selectable list is
scoped to the assigned Campaign Manager. Archived, retired and inactive
questionnaires are excluded. A Draft questionnaire may be selected for a
controlled demo, but must be reviewed/published before live research.

Historical Iterations with null questionnaire identity are not changed. The
new snapshot column is nullable for this reason.

## EC2 deployment

From `/opt/psephology-survey-ui/psephology`, after `git pull --ff-only origin main`:

```bash
node deployment/iteration-questionnaire-provenance/install-iteration-questionnaire-provenance.js /opt/sarvam-voice-analytics
cd /opt/sarvam-voice-analytics
node src/db/migrate-iteration-questionnaire-snapshot.js
node --check src/repositories/campaign-iterations.repository.js
node --check src/routes/campaign-iterations.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/health
```

The installer refuses to overwrite an API Iteration file that has drifted from
the known platform version, and keeps timestamped copies of overwritten files.
If it stops on drift, inspect and merge the runtime changes before retrying;
do not force-copy the deployment file over a demo-call hotfix. Then build
and deploy the UI using the platform's existing UI deployment workflow. Check
that the Campaign Manager can see the questionnaire/version selector, cannot
submit with it blank, and that the new Iteration has both `questionnaire_id`
and `questionnaire_snapshot`. The API rejects a missing questionnaire even if
the UI is bypassed. Do not test by creating a throwaway Iteration in the
completed demo Campaign.
