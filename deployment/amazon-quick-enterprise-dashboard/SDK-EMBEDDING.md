# Platform-integrated Quick reports

Source release: `PLATFORM_CONSOLIDATION_20261013_V1`. These changes are implemented and locally tested; they are **not** evidence of an EC2 deployment, SQL migration, AWS RLS change, SPICE refresh or dashboard publication.

## Experience

The official `amazon-quicksight-embedding-sdk` is pinned to 2.12.1. The authenticated report component replaces the raw iframe, inside the existing platform shell. It uses the warm platform canvas, ink/accent colors, the supported Arial typeface, border-free Quick tiles and native gutters/margins. BRS pink, BJP saffron and Congress green remain category-bound published colors; runtime theming does not override the data palette.

The SDK controls the cross-origin iframe. Application CSS cannot restyle arbitrary content inside it. Quick's supported theme properties do not promise the application's exact corner radius, custom font loading or pixel-specific internal spacing. Compact four-column filters are prepared in the report definition; changing that definition still requires AWS validation and publication. Sheet tabs remain visible, with auto-fit width and SDK height-resizing on sheet changes. The surrounding page is responsive.

Readiness follows `CONTENT_LOADED`, not iframe creation. Render errors, a 60-second rendering timeout and expired authorization receive distinct recovery UI. The server grants 120-minute sessions; the page conservatively expires them from issuance and requests a new URL on renewal. It never replays a consumed URL. Renewal resets report filters. Sign-out unmounts the profile/report state; another account cannot revive the previous session. Pending page requests are aborted or discarded when superseded. Embed URLs, auth codes and raw SDK events are not logged or stored in local storage.

The embed toolbar hides exports and authoring extras for a compact presentation. This is a UI setting, **not** a substitute for AWS permissions, column security or disclosure controls.

## Access configuration before release

Super Admin may retain the existing, explicitly labelled full-portfolio Reader preview. Admin cannot reuse that Reader. Restricted Admin embedding fails closed until all of the following are independently reviewed and configured:

1. A unique active registered `READER`/`READER_PRO` for each platform user; no Author/Admin or dataset-owner permissions, including through group membership.
2. Every dashboard dataset is approved, with a reviewed rules-dataset mapping. Rules must be enabled `GRANT_ACCESS`, `VERSION_2`, `UserARN`-based and attached to a `RLS_RULES` dataset with string `UserARN` and `campaign_id` columns.
3. Actual rule rows match the platform's campaign visibility. Test permitted, unrelated and unassigned Campaigns using separate Readers. A grant rule containing blank/NULL scope values can grant the whole dataset; metadata checks cannot inspect or certify those rows. Maintain and retest rules when assignment/ownership changes; dashboard controls are not access boundaries.
4. The Reader has access to the published dashboard, and explicit application origins are allowed. One to three HTTPS origins are accepted, without paths, wildcards or credentials. Explicit `http://localhost:<port>` is development-only. Static one-click URLs are retired.

Environment contracts (illustrative identifiers, not credentials or applied configuration):

```dotenv
QUICKSIGHT_REGION=ap-south-1
QUICKSIGHT_AWS_ACCOUNT_ID=123456789012
QUICKSIGHT_DASHBOARD_ID=your-existing-dashboard-id
QUICKSIGHT_READER_USER_ARN=arn:aws:quicksight:ap-south-1:123456789012:user/default/super-admin-preview
QUICKSIGHT_ALLOWED_DOMAINS=https://your-platform.example.com
QUICKSIGHT_USER_ARN_MAP='{"PLATFORM_ADMIN_UUID":"arn:aws:quicksight:ap-south-1:123456789012:user/default/unique-admin-reader"}'
QUICKSIGHT_RLS_DATASET_ARNS=arn:aws:quicksight:ap-south-1:123456789012:dataset/report-one
QUICKSIGHT_RLS_RULES_MAP='{"arn:aws:quicksight:ap-south-1:123456789012:dataset/report-one":"arn:aws:quicksight:ap-south-1:123456789012:dataset/reviewed-campaign-rules"}'
```

The API role needs narrowly scoped existing `GenerateEmbedUrlForRegisteredUser` permission plus `DescribeDashboard`, `DescribeDataSet`, `ListIngestions`, `DescribeUser`, `ListUserGroups` and `DescribeDataSetPermissions` for the reviewed assets/Readers. IAM/domain/RLS access changes require separate approval. This source release does not create Readers or alter access.

`GRANT_ACCESS` is the modern grant-list policy: unmatched users have no rows. `DENY_ACCESS` is legacy deny-list semantics and is rejected here. See [AWS RLS policy reference](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RowLevelPermissionDataSet.html) and [AWS user-based RLS rules](https://docs.aws.amazon.com/quick/latest/userguide/restrict-access-to-a-data-set-using-row-level-security.html).

## Reporting consistency and freshness

Migration 034 and the prepared Quick definition protect whole construct partitions and linked bases rather than hiding one cell beside a revealing total. Native reports and exports use conflict-aware normalization; contradictory aliases remain unresolved rather than supplying a guessed score. Withheld counts/percentages remain NULL and render as Withheld, not zero. The strict native report/export schema includes `demographicProvenance: CURRENT_MASTER_DATA`; deploy the matching frontend/backend together.

This is a bounded small-cell safeguard, not a formal guarantee against all repeated-query or arbitrary cross-filter inference. Demographics/geography remain current voter-master attributes, not invented historical snapshots. No individual political scores, targeting lists or vote forecasts are added. Research/call-quality human review remains separate from technical health/completion.

Freshness is assessed across all published dashboard datasets. SPICE reports show the oldest **creation time of a completed ingestion**, not its finish time. Latest failed/cancelled refreshes, refreshes in progress, completed ingestions older than 24 hours and unavailable metadata are distinguished. Direct Query is labelled separately. Missing metadata permission does not invent a current timestamp; restricted access verification still fails closed. The API AWS requests share a bounded 35-second deadline.

The methodology editor is canonical in Iteration operations. Quick keeps read-only links and closed supporting notes. Fieldwork totals explicitly cover the whole authorized portfolio/all Runs and do not pretend to follow embedded filters.

## Release and checks

Use the [controlled consolidation release](../platform-consolidation/README.md), not a chain of overlapping old installers. Its dry run is file-only. Applying SQL, activating backend/frontend, validating the candidate definition in AWS and publishing/refreshing Quick are separate controlled operations. The previously published version is unchanged by these source edits.

```sh
node deployment/amazon-quick-enterprise-dashboard/test-quick-embedding-sdk.mjs
node deployment/amazon-quick-enterprise-dashboard/test-quick-auth-boundary.mjs
node deployment/amazon-quick-enterprise-dashboard/test-quick-embed-access.mjs
node deployment/amazon-quick-enterprise-dashboard/test-dashboard-simplification.mjs
node deployment/platform-consolidation/test-platform-consolidation.mjs
```

Tests use synthetic hooks/SDK events, isolated files and PostgreSQL-compatible fixtures, never real users or outbound calls. After an approved release, verify actual `CONTENT_LOADED`, all sheets/filters and theme support, a fresh/expired session, sign-out/account switching, Admin row boundaries, null/sparse partitions and SPICE ingestion state in AWS. Local simulation cannot certify those live properties.

Supported behavior follows [AWS runtime theming](https://docs.aws.amazon.com/quick/latest/userguide/embedding-runtime-theming.html) and the [official Embedding SDK](https://github.com/awslabs/amazon-quicksight-embedding-sdk).
