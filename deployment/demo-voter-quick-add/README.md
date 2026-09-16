# Admin demo-voter quick add

This provides an Admin/Super Admin-only form on a READY Run 1. It creates one
consented demo contact, records an INTERNAL_DEMO identifier and DEMO electorate
registration, and adds the contact to the frozen cohort in one transaction.

It refuses the operation when:

- the Run is not Run 1 in READY status;
- any Run execution/attempt has started;
- a later Run exists;
- the phone number already exists in voter_master;
- the geography is not already represented in the Run;
- consent is not explicitly confirmed; or
- the live voter_master has unsupported mandatory fields.

No provider call is submitted by this endpoint. The Campaigner must refresh,
review every recipient and launch separately.

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

Build/deploy the Next.js UI after installing the API.
