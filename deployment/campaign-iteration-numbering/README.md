# Campaign-local Iteration numbers

`program_iterations.iteration_number` was previously allocated with `MAX(...)`
for the whole Program. A second Campaign under that Program therefore started at
Iteration 4. This package changes the scope to each Campaign: its first three
Iterations are 1, 2, and 3. A fourth is rejected.

The migration preserves Iteration IDs, Runs, calls, questionnaires, agents, and
analysis. It adds Campaign ownership to `program_iterations`, replaces the
Program-wide uniqueness rule with Campaign-local uniqueness, and renumbers
existing Campaign Iterations in their original order. Legacy Iterations not
linked to a Campaign retain Program-wide uniqueness.

Before applying, take a recoverable database backup or RDS snapshot. Stop the
API during installation and migration so no Iteration is created in between.
The migration will abort if an Iteration is linked to multiple Campaigns or a
Campaign already has more than three Iterations.

```bash
cd /opt/psephology-survey-ui/psephology
git pull --ff-only origin main

sudo systemctl stop psephology-api.service
sudo node deployment/campaign-iteration-numbering/install-campaign-iteration-numbering.js /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
node --check src/repositories/campaign-iterations.repository.js
node --check src/db/migrate-campaign-iteration-numbering.js
node src/db/migrate-campaign-iteration-numbering.js

sudo systemctl start psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

Check the second Campaign in the UI: its existing first Iteration should now
show `Iteration 1`. New Campaigns should independently start at `Iteration 1`.
Do not launch calls as part of this numbering validation.
