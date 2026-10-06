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
  priorities by constituency, with a party-filtered Mandal map over Amazon
  Quick's native base-map layer;
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
node src/jobs/sync-telangana-boundaries.js
node src/jobs/sync-telangana-boundaries.js --apply
node --check src/routes/amazon-quick-dashboard.routes.js
sudo systemctl restart psephology-api.service
curl --retry 10 --retry-connrefused --retry-delay 1 -i http://127.0.0.1:3000/ready
```

## Configure Amazon Quick Sight

1. Enable Quick Sight Enterprise in `ap-south-1`.
2. Add the RDS PostgreSQL data source through a VPC connection and grant the
   Quick Sight security group database access. Prefer a reporting/read replica.
3. Create a SPICE dataset from `analytics_research_enterprise_v1` and a second
   SPICE dataset from `analytics_research_geographic_v1`.
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

## Geographic map layer

The platform presents two governed geographic views:

1. an official Telangana administrative-boundary explorer, loaded from the
   Telangana Remote Sensing Applications Centre (TGRAC) ArcGIS service; and
2. Amazon Quick's aggregate survey map and charts.

The boundary explorer supports State, 33 District, 119 Assembly constituency
and 621 Mandal features. The deployment sync projects the source geometry to
EPSG:4326, simplifies it for web presentation and stores the resulting GeoJSON
in `analytics_geo_boundary_reference`. It identifies **AC 52 Serilingampally**
as the demo focus and retains Rangareddy and the corresponding Mandal as map
context. The sync is dry-run by default and only replaces the governed snapshot
when `--apply` is supplied.

Source service:
`https://tgrac.telangana.gov.in/arcgis/rest/services/AdministrativeInfoSystem_Folder/Administrative_Information_System_Query/MapServer`

The application endpoint is restricted to Super Admin and Admin, returns one
requested layer at a time and exposes administrative polygons only. It does
not return voter locations or respondent identities.

`analytics_research_geographic_v1` supplies latitude, longitude, party label,
respondent count and aggregate party-strength to an Amazon Quick geospatial
visual. Configure the visual as **Points on map**, place `latitude` and
`longitude` in the geospatial field well, use `heat_weight` as the weight, and
switch the point style to **Heatmap**. Add `party_name` as a sheet filter so
leadership can compare the aggregate pulse party by party.

The SQL enforces a minimum base of five distinct respondents before a
geography/party cell can enter the BI dataset. It does not expose voter
coordinates or identities. The included Serilingampally coordinate is a demo
centroid. Before statewide production, load authoritative Mandal or
constituency centroids/boundaries into `analytics_geo_reference` and record the
source and verification date. Amazon Quick supports latitude/longitude point
maps and a native heatmap style, so this implementation does not require a
separate Google Maps or Mapbox API key.

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
