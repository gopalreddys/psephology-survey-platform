import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = readFileSync(path.join(here, "dashboard.repository.js"), "utf8");
const routes = readFileSync(path.join(here, "dashboard.routes.js"), "utf8");
const installer = readFileSync(path.join(here, "install-role-dashboard.js"), "utf8");
const dashboardPage = readFileSync(path.resolve(here, "../../src/app/page.tsx"), "utf8");

assert.match(routes, /requireAuth/);
assert.match(routes, /requireRole\(\["SUPER_ADMIN", "ADMIN", "CAMPAIGN_MANAGER", "CAMPAIGNER"\]\)/);
assert.match(routes, /"\/dashboard"/);
assert.match(repository, /campaignReviewVisibilitySql\(actor, "campaign", 1\)/);
assert.match(repository, /permitted\.campaigner_user_id = \$1/);
assert.match(repository, /permitted\.iteration_id = iteration\.id OR permitted\.iteration_id IS NULL/);
assert.match(repository, /permitted\.status <> 'REASSIGNED'/);
assert.match(repository, /stale_callbacks/);
assert.match(repository, /missing_transcripts/);
assert.match(repository, /missing_responses/);
assert.match(repository, /successful_contacts/);
assert.match(repository, /roleBrief/);
assert.match(repository, /EXECUTION RESPONSIBILITY/);
assert.match(repository, /RESEARCH OWNERSHIP/);
assert.match(repository, /CAMPAIGN ADMINISTRATION/);
assert.match(repository, /PLATFORM GOVERNANCE/);
assert.match(repository, /iteration\.runs\.length >= 3/);
assert.match(repository, /run\.number === Math\.max\(\.\.\.iteration\.runs/);
assert.match(repository, /connectionRatePct/);
assert.match(repository, /evidenceReadyPct/);
assert.match(repository, /buildDashboardIntelligence/);
assert.match(repository, /MINIMUM_REPORTING_BASE/);
assert.match(repository, /18–29/);
assert.match(repository, /program\.study_name AS program_name/);
assert.match(repository, /selectedProgram/);
assert.match(repository, /selectedIteration/);
assert.match(repository, /selectedAgeBand/);
assert.match(repository, /selectedGender/);
assert.match(repository, /OUTPUT_KEYS\.party/);
assert.match(repository, /OUTPUT_KEYS\.leadership/);
assert.match(repository, /UNWEIGHTED_DIRECTIONAL/);
assert.match(repository, /mandalHeatmap/);
assert.match(repository, /not an election forecast or participant-level prediction/);
assert.match(repository, /nextIterationProjection/);
assert.match(repository, /questionnaire_snapshot/);
assert.match(repository, /sample_design_type/);
assert.match(repository, /researchInstrument/);
assert.match(repository, /INSUFFICIENT_COMPARABLE_HISTORY/);
assert.match(repository, /Select one Campaign before interpreting movement across Iterations/);
assert.match(repository, /trendScope\.status === "DIRECTIONAL"/);
assert.match(repository, /The result is directional, not an election forecast/);
assert.match(repository, /summarizeOutput/);
assert.doesNotMatch(repository, /function classifyParty|function classifyIssue|function classifySentiment/);
assert.match(dashboardPage, /BaseCaption summary=\{data\.intelligence\.measures\.candidate\}/);
assert.match(dashboardPage, /Missing \{summary\.missingCount\}/);
assert.match(dashboardPage, /fewer than 5 answers/);
assert.match(routes, /req\.query\.programId/);
assert.match(routes, /req\.query\.campaignId/);
assert.match(routes, /req\.query\.iterationId/);
assert.match(routes, /req\.query\.mandal/);
assert.match(routes, /req\.query\.ageBand/);
assert.match(routes, /req\.query\.gender/);
assert.match(routes, /req\.query\.sentimentConstruct/);
assert.match(dashboardPage, /query\.set\("sentimentConstruct", sentimentConstruct\)/);
assert.match(dashboardPage, /Sentiment measure/);
assert.match(dashboardPage, /Human review pending/);
assert.match(dashboardPage, /Mixed is separate from Neutral/);
assert.doesNotMatch(dashboardPage, /First recorded assessment per respondent \(candidate, then incumbent, then issue\)/);
assert.doesNotMatch(repository, /const SENTIMENT_KEYS|codedAssessmentBase >= 100|reportable\.length >= 100/);
assert.doesNotMatch(repository, /phone_number|interaction_transcript\s+AS/);
assert.match(installer, /ROLE_DASHBOARD_V1/);
assert.match(installer, /\.bak-role-dashboard-/);
assert.match(installer, /research-comparability\/research-comparability\.repository\.js/);
assert.equal((dashboardPage.match(/requestSequence === requestSequenceRef\.current/g) || []).length, 3, "success, errors and loading completion ignore stale requests");
assert.match(dashboardPage, /else\s*\{\s*setLoading\(true\);\s*setData\(null\);/, "a new filter fetch clears prior findings");
assert.match(dashboardPage, /catch \(reason\)[\s\S]*?setData\(null\);/, "a failed filter fetch cannot show old findings under the new controls");
assert.match(dashboardPage, /clearTimeout\(timer\); requestSequenceRef\.current \+= 1/, "changing scope invalidates the prior in-flight request before the next one starts");

// Import the deployed module with a mock database and the real shared comparison
// gate. This exercises returned dashboard data, including the repository loader.
const runtime = await mkdtemp(path.join(os.tmpdir(), "role-dashboard-test-"));
try {
  await mkdir(path.join(runtime, "src/repositories"), { recursive: true });
  await mkdir(path.join(runtime, "src/db"), { recursive: true });
  await writeFile(path.join(runtime, "package.json"), '{"type":"module"}');
  await writeFile(path.join(runtime, "src/db/postgres.js"), "export async function getDb() { return globalThis.roleDashboardTestDb; }\n");
  await copyFile(path.join(here, "dashboard.repository.js"), path.join(runtime, "src/repositories/dashboard.repository.js"));
  await copyFile(path.resolve(here, "../campaign-draft-privacy/campaign-visibility.repository.js"), path.join(runtime, "src/repositories/campaign-visibility.repository.js"));
  await copyFile(path.resolve(here, "../research-comparability/research-comparability.repository.js"), path.join(runtime, "src/repositories/research-comparability.repository.js"));
  await copyFile(path.resolve(here, "../output-variable-standardization/output-normalization.repository.js"), path.join(runtime, "src/repositories/output-normalization.repository.js"));
  await copyFile(path.resolve(here, "../output-variable-standardization/normalization-rules.json"), path.join(runtime, "src/repositories/normalization-rules.json"));
  const { buildDashboardIntelligence, getRoleDashboard } = await import(path.join(runtime, "src/repositories/dashboard.repository.js"));
  const actor = { id: "manager-1", role_code: "CAMPAIGN_MANAGER" };
  const campaigns = [{ id: "campaign-1", name: "Study campaign", code: "C1", programId: "program-1", programName: "Study", programCode: "P1" }];
  const iteration = (number) => ({
    id: `iteration-${number}`, campaign_id: "campaign-1", iteration_number: number,
    iteration_name: `Wave ${number}`, campaign_name: "Study campaign",
    questionnaire_snapshot: { code: "Q", version: "1" }, research_phase: "PULSE", sample_design_type: "PURPOSIVE"
  });
  const iterations = [1, 2, 3].map(iteration);
  const comparisons = new Map(iterations.map((wave, index) => [wave.id, {
    iterationId: wave.id, campaignId: wave.campaign_id, iterationNumber: wave.iteration_number,
    previousIterationId: index ? iterations[index - 1].id : null,
    status: index ? "COMPARABLE" : "BASELINE", reasons: [], designDeclared: true
  }]));
  const cohort = (wave, size, value, overrides = {}) => Array.from({ length: size }, (_, index) => ({
    campaign_id: "campaign-1", iteration_id: `iteration-${wave}`, voter_id: `${wave}-${index}`,
    mandal_name: "Mandal A", gender: "female", age: 25,
    response_variables: { candidate_sentiment: value }, ...overrides
  }));
  const records = iterations.flatMap((wave) => [
    ...cohort(wave.iteration_number, 5, wave.iteration_number === 2 ? "poor" : "good"),
    ...cohort(wave.iteration_number, 5, "poor", { mandal_name: "Mandal B" }),
    ...cohort(wave.iteration_number, 5, "poor", { gender: "male" }),
    ...cohort(wave.iteration_number, 5, "poor", { age: 45 })
  ]);
  const selection = { campaignId: "campaign-1", mandal: "Mandal A", gender: "Female", ageBand: "18–29" };
  const build = (options = {}) => buildDashboardIntelligence(
    actor, campaigns, options.iterations || iterations, options.records || records,
    { ...selection, ...options.selection }, options.comparisons || comparisons
  );

  const selected = build({ selection: { iterationId: "iteration-2" } });
  assert.equal(selected.respondentBase, 5, "current distribution applies all selected demographic filters");
  assert.equal(selected.sentiment[0].value, "Negative");
  assert.equal(selected.sentiment[0].percentage, 100);
  assert.deepEqual(selected.mandalHeatmap.map((cell) => [cell.label, cell.base]), [["Mandal A", 5]], "heatmap honors selected Mandal as well as age and gender");
  assert.deepEqual(selected.predictive.points.map((point) => [point.iterationNumber, point.base, point.value]), [[1, 5, 5], [2, 5, 1]], "each wave uses the selected cohort and future waves are excluded");
  assert.equal(selected.predictive.direction, "Declining");
  assert.equal(selected.sentimentConstruct.key, "candidate_impression", "default dashboards preserve candidate impressions without cross-construct fallback");
  assert.deepEqual(selected.sentimentConstruct.outputKeys, ["candidate_impression", "candidate_sentiment", "veeresh_impression"]);
  assert.equal(selected.filters.selectedSentimentConstruct, "candidate_impression");
  assert.deepEqual(selected.filters.sentimentConstructs.map((item) => item.key), ["candidate_impression", "incumbent_assessment", "issue_sentiment", "development_sentiment", "change_sentiment"]);
  assert.equal(selected.sentimentValidation.status, "HUMAN_REVIEW_PENDING");
  assert.equal(selected.sentimentValidation.method, "EXPLICIT_LABEL_MAPPING");
  assert.equal(selected.sentimentValidation.normalizationVersion, "OUTPUT_TAXONOMY_V2");
  assert.match(selected.sentimentValidation.ruleHash, /^[a-f0-9]{64}$/);
  assert.match(selected.sentimentValidation.message, /not a validated NLP model or electoral prediction/);
  assert.equal(selected.rating.confidence, "Descriptive only");
  assert.equal(selected.predictive.confidence, "Descriptive only");
  assert.equal(selected.predictive.comparability.source, "analytics_iteration_comparability_v1");
  assert.match(selected.predictive.scopeLabel, /Selected segment/);
  assert.match(build({ selection: { mandal: "", gender: "", ageBand: "" } }).predictive.scopeLabel, /Full Iteration/);
  for (const [key, value] of [["programId", "unavailable-program"], ["campaignId", "unavailable-campaign"], ["iterationId", "unavailable-iteration"]]) {
    assert.throws(() => build({ selection: { [key]: value } }), { statusCode: 404 }, "an explicit unavailable scope must not broaden to a fallback scope");
  }
  for (const key of ["programId", "campaignId", "iterationId"]) {
    assert.throws(() => build({ selection: { [key]: ["unexpected-array"] } }), { statusCode: 400 });
    assert.throws(() => build({ selection: { [key]: "   " } }), { statusCode: 400 });
  }
  for (const key of ["mandal", "gender", "ageBand", "sentimentConstruct"]) {
    assert.throws(() => build({ selection: { [key]: ["unexpected-array"] } }), { statusCode: 400 });
  }
  assert.throws(() => build({ selection: { gender: "unsupported" } }), { statusCode: 400 });
  assert.throws(() => build({ selection: { ageBand: "18-100" } }), { statusCode: 400 });
  for (const value of ["candidate_criterion_fit", "unsupported", "   "]) {
    assert.throws(() => build({ selection: { sentimentConstruct: value } }), { statusCode: 400 }, "suitability and malformed selectors cannot be pooled as sentiment");
  }
  const otherCampaign = { ...campaigns[0], id: "other-campaign", programId: "other-program", programName: "Other study" };
  const otherIteration = { ...iterations[0], id: "other-iteration", campaign_id: "other-campaign" };
  const scopedCampaigns = [...campaigns, otherCampaign];
  const scopedIterations = [...iterations, otherIteration];
  assert.throws(() => buildDashboardIntelligence(actor, scopedCampaigns, scopedIterations, records, { programId: "program-1", campaignId: "other-campaign" }, comparisons), { statusCode: 404 }, "a campaign from another selected program must not broaden the scope");
  assert.throws(() => buildDashboardIntelligence(actor, scopedCampaigns, scopedIterations, records, { campaignId: "campaign-1", iterationId: "other-iteration" }, comparisons), { statusCode: 404 }, "an iteration outside the selected campaign must not broaden the scope");
  assert.throws(() => buildDashboardIntelligence(actor, scopedCampaigns, scopedIterations, records, { programId: "program-1", iterationId: "other-iteration" }, comparisons), { statusCode: 404 });
  assert.equal(buildDashboardIntelligence(actor, scopedCampaigns, scopedIterations, [], { campaignId: "other-campaign" }, comparisons).program.id, "other-program", "a valid campaign alone determines its own program scope");
  assert.equal(buildDashboardIntelligence(actor, scopedCampaigns, scopedIterations, [], { iterationId: "other-iteration" }, comparisons).program.id, "other-program", "a valid iteration alone determines its own program scope");
  for (const size of [0, 4, 5]) {
    const fullCohort = build({ iterations: [iterations[0]], records: cohort(1, size, "good"), selection: { mandal: "", gender: "", ageBand: "" } });
    assert.equal(fullCohort.suppressed, size < 5, "current cards require a five-person base even without demographic filters");
    assert.equal(fullCohort.respondentBase, size < 5 ? null : 5);
    assert.equal(fullCohort.rating.value, size < 5 ? null : 5);
    assert.equal(fullCohort.sentiment.length, size < 5 ? 0 : 1);
  }

  const normalizedParties = ["BRS", "brs", "Bharat Rashtra Samithi", "TRS", " BRS ", "None", "Can't say", "BRS and BJP", "not BRS", null];
  const partyRecords = cohort(1, 10, "good").map((record, index) => ({
    ...record,
    response_variables: { candidate_sentiment: "good", party_salience_unaided: normalizedParties[index] }
  }));
  const normalized = build({ iterations: [iterations[0]], records: partyRecords });
  assert.equal(normalized.landscape.party.find((item) => item.value === "BRS").respondents, 5, "case, spacing and known aliases collapse to one party category");
  assert.equal(normalized.landscape.party.find((item) => item.value === "BRS").percentage, 55.6, "denominator includes explicit uncertainty, none and uncoded records");
  assert.equal(normalized.measures.party.answerBase, 9);
  assert.equal(normalized.measures.party.respondentBase, 10);
  assert.equal(normalized.measures.party.missingCount, 1);
  assert.equal(normalized.measures.party.cantSayCount, 1);
  assert.equal(normalized.measures.party.uncodedCount, 2, "multiple named parties and negated mentions never select the first matching party");
  assert.ok(normalized.landscape.party.some((item) => item.value === "None"), "None is distinct from Can't say");

  const mixedResponses = ["good", "good", "good", "good", "good", null, "", "Can't say", "It sounds good but I have no assessment", "prefer not to answer"];
  const mixed = build({ iterations: [iterations[0]], records: cohort(1, 10, "").map((record, index) => ({
    ...record, response_variables: { candidate_sentiment: mixedResponses[index] }
  })) });
  assert.equal(mixed.measures.sentiment.answerBase, 8);
  assert.equal(mixed.measures.sentiment.missingCount, 2);
  assert.equal(mixed.measures.sentiment.cantSayCount, 1);
  assert.equal(mixed.measures.sentiment.refusedCount, 1);
  assert.equal(mixed.measures.sentiment.uncodedCount, 1, "an unrecognized narrative isn't silently classified as uncertainty or positive sentiment");
  assert.equal(mixed.sentiment.find((item) => item.value === "Positive").percentage, 62.5);
  assert.equal(mixed.rating.value, 5, "only five explicitly coded assessment responses enter the descriptive rating");
  assert.equal(mixed.rating.answeredBase, 5);
  assert.equal(mixed.age[0].positivePct, 62.5, "segment percentages retain the same answered denominator as their full measure");
  const uncertaintyHeavy = build({ iterations: [iterations[0]], records: cohort(1, 10, "").map((record, index) => ({
    ...record, response_variables: { candidate_sentiment: index < 4 ? "good" : "Can't say" }
  })) });
  assert.equal(uncertaintyHeavy.measures.sentiment.suppressed, false, "ten recorded responses support a mix chart");
  assert.equal(uncertaintyHeavy.rating.value, null, "explicit uncertainty cannot supply the fifth rated assessment");
  assert.equal(uncertaintyHeavy.rating.answeredBase, 4);
  const unrecognized = build({ iterations: [iterations[0]], records: cohort(1, 5, "a narrative with no explicit assessment") });
  assert.deepEqual(unrecognized.sentiment.map((item) => [item.value, item.percentage]), [["Uncoded response", 100]]);
  assert.equal(unrecognized.measures.sentiment.cantSayCount, 0);
  assert.equal(unrecognized.rating.value, null);

  const sparseRecords = cohort(1, 10, "").map((record, index) => ({
    ...record, response_variables: {
      veeresh_awareness: "yes", candidate_sentiment: index < 2 ? "good" : null,
      party_salience_unaided: index === 0 ? "BRS" : null
    }
  }));
  const sparse = build({ iterations: [iterations[0]], records: sparseRecords });
  assert.equal(sparse.suppressed, false, "ten respondents may have a reportable cohort while particular measures remain sparse");
  assert.equal(sparse.rating.value, null);
  assert.equal(sparse.rating.answeredBase, 2);
  assert.deepEqual(sparse.landscape.party, []);
  assert.equal(sparse.measures.party.answerBase, 1);
  assert.equal(sparse.measures.party.missingCount, 9, "sparse and empty chart metadata is retained for captions");
  assert.deepEqual(sparse.landscape.candidate, []);
  assert.equal(sparse.measures.candidate.answerBase, 2, "awareness-only responses are not assessment evidence");
  assert.equal(sparse.age[0].suppressed, true, "segment suppression uses answered measure base, not respondent count");
  assert.equal(sparse.mandalHeatmap[0].positivePct, null);
  assert.deepEqual(sparse.mandalHeatmap[0].sentiment, []);
  const incumbentOnly = build({ iterations: [iterations[0]], records: cohort(1, 10, "", { response_variables: { incumbent_assessment: "good" } }) });
  assert.equal(incumbentOnly.measures.leadership.answerBase, 0, "incumbent assessment cannot substitute for a leadership response");
  assert.deepEqual(incumbentOnly.landscape.leadership, []);
  assert.equal(incumbentOnly.measures.candidate.answerBase, 0);
  assert.equal(incumbentOnly.measures.sentiment.answerBase, 0, "missing candidate impressions never fall back to incumbent assessment");
  assert.equal(incumbentOnly.rating.value, null);
  assert.deepEqual(incumbentOnly.sentiment, []);
  assert.equal(incumbentOnly.age[0].positivePct, null);
  assert.equal(incumbentOnly.mandalHeatmap[0].positivePct, null);
  const incumbentSelected = build({ iterations: [iterations[0]], records: cohort(1, 10, "", { response_variables: { incumbent_assessment: "good" } }), selection: { sentimentConstruct: "incumbent_assessment" } });
  assert.equal(incumbentSelected.rating.value, 5, "incumbent evidence is available only through its own explicit construct");
  assert.equal(incumbentSelected.sentimentConstruct.key, "incumbent_assessment");
  assert.deepEqual(incumbentSelected.landscape.candidate, [], "the independent candidate chart remains impression-only");

  const separateConstructRows = cohort(1, 10, "", { response_variables: {
    candidate_impression: "positive", incumbent_assessment: "negative", issue_sentiment: "neutral",
    development_sentiment: "mixed", change_sentiment: "Can't say", candidate_criterion_fit: "good"
  } });
  for (const [key, label, rating] of [
    ["candidate_impression", "Positive", 5], ["incumbent_assessment", "Negative", 1],
    ["issue_sentiment", "Neutral", 3], ["development_sentiment", "Mixed", null],
    ["change_sentiment", "Can't say", null]
  ]) {
    const chosen = build({ iterations: [iterations[0]], records: separateConstructRows, selection: { sentimentConstruct: key } });
    assert.deepEqual(chosen.sentiment.map((item) => [item.value, item.percentage]), [[label, 100]], `${key} uses only its own structured construct`);
    assert.equal(chosen.rating.value, rating);
    for (const segments of [chosen.age, chosen.gender, chosen.mandalHeatmap]) {
      assert.deepEqual(segments[0].sentiment.map((item) => item.value), [label], "every demographic chart uses the same chosen construct");
    }
  }
  const criterionOnly = build({ iterations: [iterations[0]], records: cohort(1, 5, "", { response_variables: { candidate_criterion_fit: "good", veeresh_criterion_fit: "good" } }) });
  assert.equal(criterionOnly.measures.candidate.answerBase, 0, "candidate suitability is not candidate impression");
  assert.equal(criterionOnly.measures.sentiment.answerBase, 0);
  assert.equal(criterionOnly.rating.value, null);
  const mixedOnly = build({ iterations: [iterations[0]], records: cohort(1, 5, "mixed") });
  assert.deepEqual(mixedOnly.sentiment.map((item) => item.value), ["Mixed"]);
  assert.equal(mixedOnly.rating.value, null, "Mixed is neither Neutral nor a numerical middle score");
  assert.equal(mixedOnly.rating.answeredBase, 0);
  const insufficientPolarity = build({ iterations: [iterations[0]], records: [
    ...cohort(1, 4, "positive"), ...cohort(1, 1, "mixed"), ...cohort(1, 1, "Can't say"), ...cohort(1, 1, "None")
  ] });
  assert.equal(insufficientPolarity.rating.value, null, "mixed, explicit uncertainty and None cannot reach the five-coded rating threshold");
  assert.equal(insufficientPolarity.rating.answeredBase, 4);
  const fivePolarity = build({ iterations: [iterations[0]], records: [
    ...cohort(1, 5, "positive"), ...cohort(1, 1, "mixed"), ...cohort(1, 1, "Can't say"), ...cohort(1, 1, "None")
  ] });
  assert.equal(fivePolarity.rating.value, 5, "excluded sentiment categories cannot dilute the descriptive average");
  assert.equal(fivePolarity.rating.answeredBase, 5);
  const largeDescriptive = build({ iterations: [iterations[0]], records: cohort(1, 150, "good") });
  assert.equal(largeDescriptive.rating.confidence, "Descriptive only", "larger response volume does not claim model validity");

  const fixedConstructRows = [...cohort(1, 5, ""), ...cohort(2, 5, ""), ...cohort(3, 5, "")].map((record) => ({
    ...record, response_variables: { candidate_impression: "good", issue_sentiment: record.iteration_id === "iteration-2" ? "negative" : "neutral" }
  }));
  const fixedConstruct = build({ records: fixedConstructRows, selection: { sentimentConstruct: "issue_sentiment", iterationId: "iteration-2" } });
  assert.deepEqual(fixedConstruct.predictive.points.map((point) => [point.iterationNumber, point.value]), [[1, 3], [2, 1]], "the selected construct is held fixed across comparable waves");
  const missingSelectedWave = build({ records: fixedConstructRows.map((record) => record.iteration_id === "iteration-2" ? { ...record, response_variables: { candidate_impression: "good" } } : record), selection: { sentimentConstruct: "issue_sentiment", iterationId: "iteration-2" } });
  assert.equal(missingSelectedWave.predictive.status, "NO_HISTORY", "a missing selected construct is not supplied by candidate evidence in the same wave");
  assert.deepEqual(missingSelectedWave.predictive.points, []);
  const aliasRecords = cohort(1, 5, "").map((record) => ({
    ...record, response_variables: {
      candidate_impression: "poor", veeresh_impression: "good",
      party_salience: "TRS", party_leadership: "BRS", issue_priority: "jobs"
    }
  }));
  const aliasScope = build({ iterations: [iterations[0]], records: aliasRecords });
  assert.deepEqual(aliasScope.landscape.candidate.map((item) => [item.value, item.respondents]), [["Uncoded response", 5]], "contradictory aliases cannot silently select a preferred assessment");
  assert.equal(aliasScope.rating.value, null);
  assert.equal(aliasScope.landscape.party[0].value, "BRS", "party_salience joins the party aliases");
  assert.equal(aliasScope.landscape.leadership[0].value, "BRS", "party_leadership joins the leadership aliases");
  assert.equal(aliasScope.issues[0].value, "Employment and jobs", "issue_priority joins only the issue construct");
  const developmentOnly = build({ iterations: [iterations[0]], records: cohort(1, 5, "good", { response_variables: {
    candidate_sentiment: "good", development_priority: "jobs", desired_change: "education"
  } }) });
  assert.equal(developmentOnly.measures.issues.answerBase, 0, "development priorities and desired changes are not silently substituted for issue priorities");
  assert.deepEqual(developmentOnly.issues, []);
  assert.match(dashboardPage, /no substitution from other measures/);

  const rejectedComparisons = new Map(comparisons);
  rejectedComparisons.set("iteration-3", { ...comparisons.get("iteration-3"), status: "NOT_COMPARABLE", reasons: ["GEOGRAPHY_CHANGED"] });
  const rejected = build({ comparisons: rejectedComparisons });
  assert.equal(rejected.predictive.status, "NOT_COMPARABLE", "matching questionnaire metadata cannot override a failed SQL gate");
  assert.equal(rejected.predictive.projectedNextRating, null);
  assert.deepEqual(rejected.predictive.points.map((point) => point.iterationNumber), [3]);
  assert.ok(rejected.predictive.comparability.reasons.includes("GEOGRAPHY_CHANGED"));
  const wrongPredecessor = new Map(comparisons);
  wrongPredecessor.set("iteration-3", { ...comparisons.get("iteration-3"), previousIterationId: "iteration-1" });
  assert.equal(build({ comparisons: wrongPredecessor }).predictive.status, "NOT_COMPARABLE", "even a COMPARABLE row must describe the actual adjacent pair");

  const missingSource = build({ comparisons: new Map() });
  assert.equal(missingSource.predictive.status, "NOT_COMPARABLE", "missing authoritative comparison metadata fails closed");
  assert.equal(missingSource.predictive.projectedNextRating, null);
  const noSource = build({ comparisons: new Map(), selection: { iterationId: "iteration-2" } });
  assert.equal(noSource.predictive.points.length, 1, "instrument-only identity cannot recover a missing source");

  const latestTooSmall = build({ records: [...cohort(1, 5, "good"), ...cohort(2, 5, "good"), ...cohort(3, 4, "poor")] });
  assert.equal(latestTooSmall.predictive.status, "SUPPRESSED");
  assert.deepEqual(latestTooSmall.predictive.points, []);
  assert.equal(latestTooSmall.predictive.projectedNextRating, null);
  const fewRated = build({ records: [...cohort(1, 5, "good"), ...cohort(2, 5, "good"), ...cohort(3, 4, "good"), ...cohort(3, 4, "", { response_variables: { priority: "jobs" } })] });
  assert.equal(fewRated.predictive.status, "SUPPRESSED", "the displayed score itself requires five rated respondents");

  const smallMiddle = build({ records: [...cohort(1, 5, "good"), ...cohort(2, 4, "good"), ...cohort(3, 5, "poor")] });
  assert.equal(smallMiddle.predictive.status, "INSUFFICIENT_COMPARABLE_HISTORY");
  assert.equal(smallMiddle.predictive.projectedNextRating, null);
  assert.deepEqual(smallMiddle.predictive.points.map((point) => point.iterationNumber), [3], "a suppressed middle wave is not bridged");
  const emptyMiddle = build({ records: [...cohort(1, 5, "good"), ...cohort(3, 5, "poor")] });
  assert.deepEqual(emptyMiddle.predictive.points.map((point) => point.iterationNumber), [3], "a wave with no responses is not bridged");
  assert.equal(emptyMiddle.predictive.projectedNextRating, null);
  const numberedGap = build({ iterations: [iterations[0], iterations[2]] });
  assert.equal(numberedGap.predictive.status, "NOT_COMPARABLE");
  assert.equal(numberedGap.predictive.projectedNextRating, null);
  assert.match(numberedGap.predictive.comparability.reasons.join(" "), /consecutive.*missing waves/);
  const noLatestEvidence = build({ records: cohort(1, 5, "good") });
  assert.equal(noLatestEvidence.predictive.status, "NO_HISTORY", "an earlier rated wave is not substituted for the latest wave");
  assert.deepEqual(noLatestEvidence.predictive.points, []);

  const absentMandal = build({ selection: { mandal: "No evidence Mandal", iterationId: "iteration-2" } });
  assert.equal(absentMandal.filters.selectedMandal, "No evidence Mandal");
  assert.equal(absentMandal.suppressed, true, "an empty selected segment is not silently broadened");
  assert.deepEqual(absentMandal.mandalHeatmap, []);
  assert.deepEqual(absentMandal.predictive.points, []);
  const campaignRequired = build({ selection: { campaignId: "" } });
  assert.equal(campaignRequired.predictive.status, "NOT_COMPARABLE");
  assert.equal(campaignRequired.predictive.projectedNextRating, null);
  assert.equal(buildDashboardIntelligence({ ...actor, role_code: "CAMPAIGNER" }, campaigns, iterations, records, selection, comparisons), null);

  // A blocked earlier edge cannot join a valid recent suffix. The latest two
  // comparisons still support their own direction and projection.
  const fourIterations = [...iterations, iteration(4)];
  const suffixMap = new Map(comparisons);
  suffixMap.set("iteration-2", { ...comparisons.get("iteration-2"), status: "NOT_COMPARABLE", reasons: ["COLLECTION_MODE_CHANGED"] });
  suffixMap.set("iteration-4", { iterationId: "iteration-4", campaignId: "campaign-1", iterationNumber: 4, previousIterationId: "iteration-3", status: "COMPARABLE", reasons: [], designDeclared: true });
  const suffix = build({ iterations: fourIterations, records: [...records, ...cohort(4, 5, "poor")], comparisons: suffixMap });
  assert.equal(suffix.predictive.status, "DIRECTIONAL");
  assert.deepEqual(suffix.predictive.points.map((point) => point.iterationNumber), [2, 3, 4]);
  assert.equal(suffix.predictive.comparability.excludedIterations, 1);
  assert.notEqual(suffix.predictive.projectedNextRating, null);

  let queried = false;
  globalThis.roleDashboardTestDb = { async query() { queried = true; return { rows: [] }; } };
  await assert.rejects(() => getRoleDashboard({ id: "outside", role_code: "VIEWER" }), { statusCode: 403 });
  assert.equal(queried, false, "unauthorized roles cannot query dashboard data");
  const requestedSql = [];
  globalThis.roleDashboardTestDb = { async query(sql, values) { requestedSql.push({ sql, values }); return { rows: [] }; } };
  const campaigner = await getRoleDashboard({ id: "campaigner-1", role_code: "CAMPAIGNER" });
  assert.equal(campaigner.intelligence, null);
  assert.ok(requestedSql.every(({ sql, values }) => sql.includes("permitted.campaigner_user_id = $1") && values[0] === "campaigner-1"));
  assert.equal(requestedSql.some(({ sql }) => sql.includes("analytics_iteration_comparability_v1")), false, "campaigners never query research comparability or findings");
  await getRoleDashboard(actor);
  assert.ok(requestedSql.slice(3).every(({ sql, values }) => sql.includes("campaign.campaign_manager_user_id = $1") && values[0] === actor.id), "manager data loading retains its assigned campaign scope");

  const comparisonRequests = [];
  let schemaMissing = false;
  globalThis.roleDashboardTestDb = {
    async query(sql, values) {
      if (sql.includes("FROM analytics_iteration_comparability_v1")) {
        comparisonRequests.push(values);
        if (schemaMissing) throw Object.assign(new Error("relation missing"), { code: "42P01" });
        return { rows: Array.from(comparisons.values()).map((item) => ({
          iteration_id: item.iterationId, campaign_id: item.campaignId,
          iteration_number: item.iterationNumber, previous_iteration_id: item.previousIterationId,
          comparison_status: item.status, comparison_reasons: item.reasons, design_declared: item.designDeclared
        })) };
      }
      if (sql.includes("SELECT campaign.id, campaign.campaign_code")) {
        return { rows: [{ id: "campaign-1", campaign_name: "Study campaign", campaign_code: "C1", program_id: "program-1", program_name: "Study", program_code: "P1", status: "ACTIVE", campaign_manager_user_id: actor.id }] };
      }
      if (sql.includes("SELECT iteration.id, link.campaign_id")) return { rows: iterations };
      if (sql.includes("SELECT * FROM evidence")) return { rows: records };
      return { rows: [] };
    }
  };
  const loaded = await getRoleDashboard(actor, { ...selection, iterationId: "iteration-2" });
  assert.equal(loaded.intelligence.predictive.status, "DIRECTIONAL", "repository actually loads and uses the shared SQL comparison metadata");
  assert.deepEqual(loaded.intelligence.predictive.points.map((point) => point.iterationNumber), [1, 2]);
  assert.deepEqual(comparisonRequests, [[iterations.map((wave) => wave.id)]], "comparison loader receives only authorized Iteration IDs");
  const chosenLoaded = await getRoleDashboard(actor, { ...selection, iterationId: "iteration-2", sentimentConstruct: "issue_sentiment" });
  assert.equal(chosenLoaded.intelligence.sentimentConstruct.key, "issue_sentiment", "the repository loader preserves requested construct selection");
  assert.equal(chosenLoaded.intelligence.rating.value, null, "loader never changes the construct when selected evidence is absent");
  schemaMissing = true;
  const oldSchema = await getRoleDashboard(actor, { ...selection, iterationId: "iteration-2" });
  assert.equal(oldSchema.intelligence.predictive.status, "NOT_COMPARABLE", "an uninstalled SQL gate fails closed through the dashboard loader");
  assert.equal(oldSchema.intelligence.predictive.projectedNextRating, null);
  assert.match(oldSchema.intelligence.predictive.statement, /migration 029/);

  await writeFile(path.join(runtime, "src/server.js"), 'import votersRoutes from "./routes/voters.routes.js";\napp.use("/api", votersRoutes);\n');
  const runInstaller = promisify(execFile);
  await runInstaller(process.execPath, [path.join(here, "install-role-dashboard.js"), runtime]);
  assert.equal(readFileSync(path.join(runtime, "src/repositories/research-comparability.repository.js"), "utf8"), readFileSync(path.resolve(here, "../research-comparability/research-comparability.repository.js"), "utf8"), "installer includes the authoritative shared helper");
  await runInstaller(process.execPath, [path.join(here, "install-role-dashboard.js"), runtime]);
  assert.equal((readFileSync(path.join(runtime, "src/server.js"), "utf8").match(/app\.use\("\/api", roleDashboardRoutes\)/g) || []).length, 1, "installation is idempotent");
  assert.equal((await readdir(path.join(runtime, "src"))).filter((name) => name.includes(".bak-role-dashboard-")).length, 1, "installation preserves a recoverable server backup");
} finally {
  delete globalThis.roleDashboardTestDb;
  await rm(runtime, { recursive: true, force: true });
}

console.log("Role Dashboard authorization, SQL comparison gate, consecutive history, filters and reporting-base behavior passed.");
