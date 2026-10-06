# Admin demo-voter entry in Voter Master

This provides an Admin/Super Admin-only form on the Voter Data page. It creates
one consented demo contact and records an `INTERNAL_DEMO` identifier and `DEMO`
electorate registration in one transaction.

It refuses the operation when:

- the phone number already exists in voter_master;
- the geography is not an active geography already used by Voter Master;
- consent is not explicitly confirmed; or
- the live voter_master has unsupported mandatory fields.

The operation never changes a Campaign, Iteration, Run, frozen cohort or target
count. No provider call is submitted. A later governed voter-selection workflow
may include the new record in a future cohort.

The Voter Data bulk-ingestion panel also exposes a static CSV template whose
canonical column names match `voter-ingestion.service.js`. `full_name` and either
`epic_number` or `app_id` are required by the current importer.

## Install

Install and migrate the voter electorate model first:

    cd /opt/psephology-survey-ui/psephology
    node deployment/voter-electorate-model/install-voter-electorate-model.js /opt/sarvam-voice-analytics
    cd /opt/sarvam-voice-analytics
    node src/db/migrate-voter-electorate-model.js

Then install the API route:

    cd /opt/psephology-survey-ui/psephology
    node deployment/demo-voter-quick-add/install-demo-voter-quick-add.js /opt/sarvam-voice-analytics

    cd /opt/sarvam-voice-analytics
    node --check src/repositories/demo-voter-quick-add.validation.js
    node --check src/repositories/demo-voter-quick-add.repository.js
    node --check src/routes/demo-voter-quick-add.routes.js
    node --check src/server.js
    sudo systemctl restart psephology-api.service
    curl --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/ready

Build/deploy the Next.js UI after installing the API. The quick-add control is
intentionally absent from Campaign, Iteration and Run pages.
