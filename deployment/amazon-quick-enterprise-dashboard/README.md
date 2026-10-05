# Amazon Quick enterprise dashboard

This deployment adds a governed, non-PII research dataset and an authenticated
Amazon Quick Sight embedding endpoint. Quick Sight is the BI capability within
Amazon Quick. The platform dashboard remains the operational fallback while
the enterprise dashboard is authored and published in AWS.

## What leadership will see

- leadership overview: respondent base, aggregate party-strength, party,
  candidate, leadership and sentiment distributions;
- demographic pulse: age histogram, age-band sentiment, gender composition and
  party salience by gender;
- geographic intelligence: constituency and Mandal heat tables plus issue
  priorities by constituency;
- Iteration movement: comparable party-strength, candidate sentiment and issue
  movement across Iterations.

The deterministic authoring specification is in
`quick-dashboard-blueprint.json`. Do not display any cell below the governed
minimum base (currently `n=5` in the application). Do not describe an
unweighted demo result as an election forecast.

## Install on the API host

```bash
cd /opt/psephology-survey-ui/psephology
node deployment/amazon-quick-enterprise-dashboard/install-amazon-quick-dashboard.js \
  /opt/sarvam-voice-analytics

cd /opt/sarvam-voice-analytics
npm install --save @aws-sdk/client-quicksight
node src/db/migrate-amazon-quick-dashboard.js
node --check src/routes/amazon-quick-dashboard.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

## Configure Amazon Quick Sight

1. Enable Quick Sight Enterprise in `ap-south-1`.
2. Add the RDS PostgreSQL data source through a VPC connection and grant the
   Quick Sight security group database access. Prefer a reporting/read replica.
3. Create a SPICE dataset from `analytics_research_enterprise_v1`.
4. Author the four sheets in `quick-dashboard-blueprint.json` and publish the
   dashboard.
5. Create a Quick Sight Reader for the leadership preview and share the
   dashboard with that Reader.
6. Allow-list the Amplify/custom application domain for embedding.
7. Add the following variables to `/etc/psephology-api.env`:

```dotenv
QUICKSIGHT_REGION=ap-south-1
QUICKSIGHT_AWS_ACCOUNT_ID=123456789012
QUICKSIGHT_DASHBOARD_ID=psephology-enterprise-leadership
QUICKSIGHT_READER_USER_ARN=arn:aws:quicksight:ap-south-1:123456789012:user/default/psephology-leadership-reader
QUICKSIGHT_ALLOWED_DOMAINS=https://your-platform.example.com
```

For an authenticated internal-only preview, a one-click embed can be used
instead by setting `QUICKSIGHT_ONE_CLICK_EMBED_URL`. Do not use public
embedding.

The EC2 instance role needs only:

```json
{
  "Effect": "Allow",
  "Action": "quicksight:GenerateEmbedUrlForRegisteredUser",
  "Resource": [
    "arn:aws:quicksight:ap-south-1:123456789012:dashboard/psephology-enterprise-leadership",
    "arn:aws:quicksight:ap-south-1:123456789012:user/default/psephology-leadership-reader"
  ]
}
```

## Security boundary

The enterprise embed endpoint is limited to Super Admin and Admin roles until
row-level security is configured. The
dataset contains a pseudonymous respondent key but excludes names, phone
numbers, EPIC IDs, transcripts and raw output JSON. Before offering this across
multiple organizations, replace the shared Reader with per-user provisioning or
anonymous capacity embedding with session-tag row-level security.
