import { readFile } from "node:fs/promises";
import { loadIterationComparability, evaluateIterationComparison } from "../../research-comparability/research-comparability.repository.js";

let sequence = 0;
async function loadSource(relativePath, bindings) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const key = `__analysisFixtureBindings${sequence++}`;
  globalThis[key] = bindings;
  // Runtime imports target the installed API layout. Inject fixture dependencies
  // while executing the complete production repository, including its SQL paths.
  const executable = `const { ${Object.keys(bindings).join(", ")} } = globalThis[${JSON.stringify(key)}];\n`
    + source.replace(/^import\s[\s\S]*?;\n/gm, "");
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  } finally {
    delete globalThis[key];
  }
}

export async function loadTestRepositories(db) {
  const campaign = await loadSource("../campaign-analysis.repository.js", {
    getDb: async () => db,
    canReviewCampaign: (record, actor) => actor.role_code === "SUPER_ADMIN" || actor.role_code === "ADMIN" || record.campaign_manager_user_id === actor.id,
    loadIterationComparability, evaluateIterationComparison
  });
  const analytics = await loadSource("../../analytics-workspace/analytics-workspace.repository.js", {
    getDb: async () => db,
    campaignReviewVisibilitySql: () => ({ sql: "TRUE", values: [] }),
    getCampaignAnalysis: campaign.getCampaignAnalysis,
    latestStructuredRespondents: campaign.latestStructuredRespondents,
    buildResponseDistributions: campaign.buildResponseDistributions,
    selectConsecutiveComparisonIterations: campaign.selectConsecutiveComparisonIterations,
    evaluateCompletedIterationComparison: campaign.evaluateCompletedIterationComparison,
    loadIterationComparability
  });
  return { campaign, analytics };
}

export async function loadTestProgramRepository(db, campaign) {
  return loadSource("../../program-executive-dashboard/program-dashboard.repository.js", {
    getDb: async () => db,
    canReviewCampaign: (_record, actor) => actor.role_code === "SUPER_ADMIN" || actor.role_code === "ADMIN",
    recordLifecycleEvent: async () => {},
    loadIterationComparability,
    selectConsecutiveComparisonIterations: campaign.selectConsecutiveComparisonIterations,
    evaluateCompletedIterationComparison: campaign.evaluateCompletedIterationComparison,
    buildResponseDistributions: campaign.buildResponseDistributions,
    latestStructuredRespondents: campaign.latestStructuredRespondents
  });
}
