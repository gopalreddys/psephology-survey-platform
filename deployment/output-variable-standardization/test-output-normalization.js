import assert from "node:assert/strict";
import { normalizeOutputValue, summarizeOutput, summarizeLabels, selectStructuredOutput, selectDirectRating, summarizeDirectRatings, getSentimentValidation, OUTPUT_KEYS } from "./output-normalization.repository.js";
import { fixtureState, fixtureDb, response } from "../campaign-comparative-analysis/fixtures/analysis-fixtures.js";
import { loadTestRepositories } from "../campaign-comparative-analysis/fixtures/load-test-repositories.js";

const normalize = (value, key = "party_salience_unaided") => normalizeOutputValue(key, value);
for (const value of [" brs ", "BRS.", "TRS", "Bharat Rashtra Samithi", "బీఆర్ఎస్"]) assert.equal(normalize(value).label, "BRS");
for (const value of [null, undefined, "", "   ", "N/A", "not recorded"]) assert.equal(normalize(value).status, "MISSING");
assert.equal(normalize("Can't say").status, "CANT_SAY");
assert.equal(normalize("Can’t say").status, "CANT_SAY");
assert.equal(normalize("prefer not to answer").status, "REFUSED");
assert.equal(normalize("None").label, "None");
assert.equal(normalize("BRS and BJP").status, "UNCODED");
assert.equal(normalize("BRS and BJP").label, "Multiple parties mentioned");
for (const value of ["Not BRS", "BRS కాదు", "BRS नहीं", "no mention of BRS"]) assert.equal(normalize(value).status, "UNCODED");
assert.equal(normalize("BRS failed us", "perceived_issue_leader_aided").status, "UNCODED");
assert.equal(normalize("BRS government", "perceived_issue_leader_aided").label, "BRS");
assert.equal(normalize("KCR", "perceived_issue_leader_aided").label, "K. Chandrashekar Rao");
assert.equal(normalize("not satisfied", "candidate_sentiment").label, "Negative");
for (const value of ["mixed", "both good and bad", "మిశ్రమం", "मिश्रित"]) assert.equal(normalize(value, "candidate_sentiment").label, "Mixed");
for (const value of ["బాగోలేదు", "సంతృప్తి లేదు", "अच्छा नहीं", "असंतुष्ट"]) assert.equal(normalize(value, "candidate_sentiment").label, "Negative");
for (const value of ["చాలా బాగుంది", "बहुत अच्छा।"]) assert.equal(normalize(value, "candidate_sentiment").label, "Positive");
assert.equal(normalize("\tGood\n", "candidate_sentiment").label, "Positive");
for (const value of ["not bad", "not not good", "great, another broken promise", "None"]) assert.equal(normalize(value, "candidate_sentiment").status, "UNCODED");
assert.equal(normalize("good fit", "candidate_criterion_fit").label, "Strong fit");
assert.equal(normalize("good", "candidate_criterion_fit").status, "UNCODED", "Suitability must not inherit impression polarity");
assert.deepEqual(OUTPUT_KEYS.candidate, ["candidate_impression", "candidate_sentiment", "veeresh_impression"]);
assert.equal(selectStructuredOutput({ response_variables: { candidate_impression: "good", veeresh_impression: "bad" } }, OUTPUT_KEYS.candidate).status, "UNCODED");
assert.equal(selectStructuredOutput({ response_variables: { candidate_impression: "good", veeresh_impression: "Positive" } }, OUTPUT_KEYS.candidate).label, "Positive");
assert.equal(getSentimentValidation().status, "HUMAN_REVIEW_PENDING");
assert.match(getSentimentValidation().ruleHash, /^[a-f0-9]{64}$/);
assert.equal(normalize("a long and complicated story", "candidate_sentiment").status, "UNCODED");
// Named-leader polarity uses the existing explicit assessment taxonomy only.
// It does not infer approval from a party/leader name or unstructured praise.
for (const key of ["leader_assessment", "leader_sentiment"]) {
  for (const [value, label] of [["good", "Positive"], ["బాగుంది", "Positive"], ["अच्छा", "Positive"],
    ["not satisfied", "Negative"], ["సంతృప్తి లేదు", "Negative"], ["अच्छा नहीं", "Negative"],
    ["average", "Neutral"], ["తటస్థం", "Neutral"], ["औसत", "Neutral"],
    ["both good and bad", "Mixed"], ["మిశ్రమం", "Mixed"], ["मिश्रित", "Mixed"]]) {
    assert.deepEqual(normalize(value, key), { status: "CODED", label, domain: "assessment", version: "OUTPUT_TAXONOMY_V2" });
  }
  for (const [value, status] of [["no answer", "MISSING"], ["can't say", "CANT_SAY"], ["refused", "REFUSED"],
    ["KCR", "UNCODED"], ["BRS", "UNCODED"], ["previously aware", "UNCODED"],
    ["a capable leader who will win", "UNCODED"], ["not bad", "UNCODED"], ["None", "UNCODED"]]) {
    assert.equal(normalize(value, key).status, status, `${key}: ${value} cannot become inferred sentiment`);
  }
}
assert.equal(selectStructuredOutput({ response_variables: { leader_assessment: "good", leader_sentiment: "bad" } }, ["leader_assessment", "leader_sentiment"]).status, "UNCODED");
assert.equal(selectStructuredOutput({ response_variables: { leader_assessment: "good", leader_sentiment: "Positive" } }, ["leader_assessment", "leader_sentiment"]).label, "Positive");
assert.equal(selectStructuredOutput({ response_variables: { incumbent_assessment: "good", candidate_impression: "good", perceived_issue_leader_aided: "KCR" } }, ["leader_assessment"]).status, "MISSING", "Other assessments and leader mentions cannot supply the exact named-leader answer");
assert.equal(selectStructuredOutput({ response_variables: { "\tLEADER_ASSESSMENT\u00a0": "good", leader_assessment: "bad" } }, ["leader_assessment"]).status, "UNCODED", "Conflicting canonical spelling aliases remain unresolved");
for (const keys of [["development_priority"], ["desired_change"], ["leader_assessment"]]) {
  const values = keys[0] === "leader_assessment" ? ["good", "bad"] : ["jobs", "education"];
  const safe = summarizeOutput(Array.from({ length: 10 }, (_, index) => ({ response_variables: { [keys[0]]: values[index < 5 ? 0 : 1] } })), keys);
  assert.equal(safe.suppressed, false);
  assert.equal(safe.codedCount, 10);
  const sparse = summarizeOutput(Array.from({ length: 10 }, (_, index) => ({ response_variables: { [keys[0]]: values[index < 9 ? 0 : 1] } })), keys);
  assert.equal(sparse.suppressed, true);
  assert.equal(sparse.respondentBase, null);
  assert.deepEqual(sparse.values, [], "New report partitions retain whole-partition suppression");
}
for (const value of [[], {}, ["BRS", "BJP"]]) assert.equal(normalize(value).status, "UNCODED");
const records = ["BRS", "TRS", "Can't say", "not recorded", "prefer not to answer", "a story", "None", null]
  .map((value) => ({ response_variables: { party_salience_unaided: value } }));
const before = JSON.stringify(records);
const summary = summarizeOutput(records, OUTPUT_KEYS.party);
assert.equal(summary.suppressed, true);
for (const key of ['answerBase','respondentBase','missingCount','cantSayCount','refusedCount','uncodedCount']) assert.equal(summary[key], null);
assert.deepEqual(summary.values, [], 'A sparse partition cannot expose its large complement');
assert.equal(JSON.stringify(records), before, "Original responses are unchanged");
assert.deepEqual(summarizeOutput(records.slice(0, 2), OUTPUT_KEYS.party).values, []);
assert.equal(summarizeOutput(Array.from({ length: 8 }, () => ({ response_variables: {} })), OUTPUT_KEYS.party).missingCount, null);
assert.equal(selectStructuredOutput({ response_variables: { " Party_Salience_Unaided ": "TRS" } }, OUTPUT_KEYS.party).label, "BRS");
assert.equal(selectStructuredOutput({ response_variables: { party_salience: "BJP" } }, OUTPUT_KEYS.party).label, "BJP");
assert.equal(summarizeLabels(["Multiple parties mentioned"]).uncodedCount, null);
for (const values of [Array(9).fill('BRS').concat('BJP'), Array(9).fill('BRS').concat(null)]) {
  const partition = summarizeOutput(values.map((value) => ({ response_variables: { party_salience_unaided: value } })), OUTPUT_KEYS.party);
  assert.equal(partition.suppressed, true);
  assert.deepEqual(partition.values, [], 'A large category cannot disclose its sparse or missing complement');
  for (const key of ['answerBase', 'respondentBase', 'missingCount', 'coveragePct']) assert.equal(partition[key], null);
}
const safePartition = summarizeOutput(Array(5).fill('BRS').concat(Array(5).fill('BJP')).map((value) => ({ response_variables: { party_salience_unaided: value } })), OUTPUT_KEYS.party);
assert.equal(safePartition.suppressed, false);
assert.equal(safePartition.answerBase, 10);
assert.equal(selectDirectRating({ response_variables: { brs_lean_rating: 5, party_lean_rating: 1 } }).status, 'UNRESOLVED');
assert.equal(selectDirectRating({ response_variables: { '\tPARTY_LEAN_RATING\u00a0': '\ufeff4\t' } }).value, 4);
const ratingRows = Array.from({ length: 10 }, (_, index) => ({ response_variables: index < 5 ? { party_lean_rating: 4 } : index === 5 ? { party_lean_rating: 4, brs_lean_rating: 1 } : {} }));
assert.equal(summarizeDirectRatings(ratingRows).value, null, 'Missing and contradictory alias categories remain separately protected');
assert.equal(summarizeDirectRatings(ratingRows).answered, null);

const state = fixtureState();
const { analytics, campaign } = await loadTestRepositories(fixtureDb(state));
const actor = { id: "admin", role_code: "ADMIN" };
state.records = Array.from({ length: 10 }, (_, index) => response("i2", `r-${index}`, "jobs", {
  response_variables: index === 0 ? Object.fromEntries(["veeresh_impression", "veeresh_criterion_fit", "incumbent_assessment", "issue_sentiment", "development_sentiment", "change_sentiment"].map((key) => [key, "good"])) : { graduate_issue_priority: "jobs" }
}));
let result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.sentimentAnalysis.assessedRespondents, null);
assert.equal(result.sentimentAnalysis.measure.suppressed, true, "One person's six answers cannot bypass a five-person minimum");
assert.deepEqual(result.sentimentAnalysis.distribution, []);
assert.equal(result.partyStrengthAnalysis.estimate.value, null);
assert.equal(result.iterationDashboard.headlineMetrics[0].value, null);
assert.equal(result.outputMeasures.candidate_assessment.answerBase, null);
assert.equal(result.sentimentAnalysis.construct, "candidate_impression");
assert.equal(result.sentimentAnalysis.validation.status, "HUMAN_REVIEW_PENDING");
state.records = Array.from({ length: 10 }, (_, index) => response("i2", `r-${index}`, "jobs", {
  response_variables: { candidate_criterion_fit: "good fit", incumbent_assessment: "good", issue_sentiment: "bad" }
}));
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.sentimentAnalysis.codedAnswers, null, "Fit, incumbent and issue answers never substitute for candidate impression");
assert.deepEqual(result.sentimentAnalysis.distribution, []);
let incumbent = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2", sentimentConstruct: "incumbent_assessment" });
assert.equal(incumbent.sentimentAnalysis.codedAnswers, 10);
assert.equal(incumbent.sentimentAnalysis.distribution[0].value, "Positive");
assert.equal(incumbent.sentimentAnalysis.measure.answerBase, 10, "A single selected construct uses one answer per person");
assert.equal(incumbent.sentimentAnalysis.confidence, "Human review pending");
const issue = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2", sentimentConstruct: "issue_sentiment" });
assert.equal(issue.sentimentAnalysis.distribution[0].value, "Negative");
await assert.rejects(analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2", sentimentConstruct: "candidate_criterion_fit" }), (error) => error.statusCode === 400);
state.records.forEach((record) => { record.response_variables = { candidate_impression: "mixed" }; });
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.sentimentAnalysis.distribution[0].value, "Mixed");
assert.equal(result.partyStrengthAnalysis.estimate.value, null, "Mixed is not silently converted to a neutral midpoint score");
state.records.forEach((record) => { record.response_variables = { candidate_impression: "good", candidate_criterion_fit: "good fit" }; });
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.candidateAnalysis.impression[0].value, "Positive", "Candidate cards accept generic impression keys");
assert.equal(result.candidateAnalysis.criterionFit[0].value, "Strong fit", "Suitability cards accept generic fit keys");
assert.equal(result.iterationDashboard.candidateFit[0].value, "Strong fit");
state.records.forEach((record) => { record.response_variables.veeresh_impression = "bad"; record.response_variables.veeresh_criterion_fit = "poor fit"; });
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.sentimentAnalysis.codedAnswers, 0, "Contradictory aliases cannot supply a judgment");
assert.equal(result.candidateAnalysis.impression[0].value, "Uncoded response");
assert.equal(result.candidateAnalysis.criterionFit[0].value, "Uncoded response");
assert.ok(result.sentimentAnalysis.measure.values.every((item) => item.suppressed && item.percentage === null), "Suppressed measure values cannot retain reportable percentages");
state.records.forEach((record, index) => { record.response_variables = { candidate_impression: index < 4 ? "good" : "Can't say" }; });
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.sentimentAnalysis.codedAnswers, null);
assert.equal(result.sentimentAnalysis.measure.answerBase, null);
assert.equal(result.sentimentAnalysis.measure.suppressed, true);
assert.deepEqual(result.sentimentAnalysis.distribution, []);
assert.ok(result.sentimentAnalysis.measure.values.every((item) => item.suppressed && item.percentage === null), "Four coded and six uncertain answers cannot supply a five-assessed-person judgment");
state.records = Array.from({ length: 10 }, (_, index) => response("i2", `r-${index}`, "jobs", {
  response_variables: { graduate_issue_priority: "opaque story", brs_lean_rating: true, veeresh_awareness: "yes" }
}));
result = await analytics.getCampaignStrategicAnalytics("campaign", actor, { iterationId: "i2" });
assert.equal(result.partyLeanIndex.value, null, "Boolean values are not direct ratings");
assert.equal(result.outputMeasures.candidate_assessment.answerBase, null, "Awareness is not an assessment");
assert.ok(result.nextIterationPlan.every((item) => !/uncoded.*diagnosis/i.test(item.title)));
state.records = ["i1", "i2"].flatMap((id) => Array.from({ length: 10 }, (_, index) => response(id, `r-${index}`, "story", { response_variables: { party_salience_unaided: "opaque story" } })));
const comparison = await campaign.getCampaignAnalysis("campaign", actor);
assert.equal(comparison.comparison.questions[0].comparable, false, "Coding noise is not substantive party movement");
assert.equal(comparison.comparison.questions[0].largestShift, null);
console.log("Output normalization, denominators, sparse judgments and provenance tests passed.");
