/**
 * Presentation metadata for governed survey reporting. This catalog contains
 * no credentials, data refreshes, cloud operations or new source-column claims.
 * Every additional visual uses an existing enterprise v2 reporting column.
 */

const observationNote = "Counts are person–Campaign–Iteration observations from the latest connected call with captured structured answers. A person can appear in more than one Iteration. Every displayed cell requires at least five distinct people after filters; withheld cells are unavailable, not zero.";
const answerNote = "Missing answers are excluded. Explicit uncertainty, refusals and uncoded answers remain separate recorded categories. Counts do not become percentages of the visible categories.";
const assessmentNote = "Assessment labels use explicit structured answers; human review is pending. Awareness, suitability and unrelated questions do not supply an absent assessment.";
const coverageNote = "This describes captured survey evidence, not the size or representativeness of the electorate. Unknown demographic values remain separate.";

const outcomeNote = (construct, source, grouping) => `${construct} ${grouping}. Source: ${source}. ${answerNote} ${observationNote}`;
const impressionNote = (grouping) => `${outcomeNote("Candidate impression", "candidate_impression, candidate_sentiment or veeresh_impression", grouping)} ${assessmentNote}`;
const incumbentNote = (grouping) => `${outcomeNote("Incumbent performance assessment", "incumbent_assessment only", grouping)} ${assessmentNote}`;
const issueNote = (grouping) => outcomeNote("Issue priorities", "graduate_issue_priority or issue_priority", grouping);
const partyNote = (grouping) => `${outcomeNote("Recorded party attention", "party_salience_unaided and approved party-attention aliases", grouping)} A party mention records attention to graduates' concerns, not vote choice, party strength or an election forecast.`;
const wholeCampaignNote = "Whole-Campaign operational evidence. Program and Campaign controls apply; age, gender, Mandal, Iteration and Run controls do not apply. Operational coverage is not statistical confidence or population representativeness.";

export const ANSWER_STATE_LABELS = Object.freeze({
  CODED: "Recorded answer",
  MISSING: "No response",
  CANT_SAY: "Can't say",
  REFUSED: "Declined to answer",
  UNCODED: "Uncoded response"
});

/**
 * BAR category/color and HEAT row/column order is deliberate: the outcome
 * dimension must select its conditional answer key in the definition generator.
 * answerBasePartitions identify the complete row base before cell suppression.
 */
export const ADDITIONAL_INSIGHT_VISUALS = Object.freeze([
  {
    id: "quick-issue-age", sheetRole: "demographic", kind: "BAR",
    category: "age_band", color: "issue_priority",
    answerBase: "quick_issue_age_base", answerBasePartitions: ["age_band"],
    title: "Issue priorities by age", subtitle: "Recorded answers · counts",
    measurementNote: issueNote("by voter-master age band")
  },
  {
    id: "quick-issue-gender", sheetRole: "demographic", kind: "BAR",
    category: "gender", color: "issue_priority",
    answerBase: "quick_issue_gender_base", answerBasePartitions: ["gender"],
    title: "Issue priorities by gender", subtitle: "Recorded answers · counts",
    measurementNote: issueNote("by voter-master gender")
  },
  {
    id: "quick-issue-mandal-heat", sheetRole: "geographic", kind: "HEAT",
    row: "mandal_name", column: "issue_priority",
    answerBase: "quick_issue_mandal_base", answerBasePartitions: ["mandal_name"],
    title: "Issue priorities by Mandal", subtitle: "Recorded answers · count intensity",
    measurementNote: `${issueNote("by voter-master Mandal")} A darker cell means more recorded observations; Mandals with larger samples can have larger counts.`
  },
  {
    id: "quick-candidate-age", sheetRole: "demographic", kind: "BAR",
    category: "age_band", color: "candidate_sentiment",
    answerBase: "quick_candidate_age_base", answerBasePartitions: ["age_band"],
    title: "Candidate impression by age", subtitle: "Recorded answers · counts",
    measurementNote: impressionNote("by voter-master age band")
  },
  {
    id: "quick-candidate-gender", sheetRole: "demographic", kind: "BAR",
    category: "gender", color: "candidate_sentiment",
    answerBase: "quick_candidate_gender_base", answerBasePartitions: ["gender"],
    title: "Candidate impression by gender", subtitle: "Recorded answers · counts",
    measurementNote: impressionNote("by voter-master gender")
  },
  {
    id: "quick-candidate-mandal-heat", sheetRole: "geographic", kind: "HEAT",
    row: "mandal_name", column: "candidate_sentiment",
    answerBase: "quick_candidate_mandal_base", answerBasePartitions: ["mandal_name"],
    title: "Candidate impression by Mandal", subtitle: "Recorded answers · count intensity",
    measurementNote: `${impressionNote("by voter-master Mandal")} Color intensity represents observation counts, not support or voting intention.`
  },
  {
    id: "quick-mandal-incumbent-heat", sheetRole: "geographic", kind: "HEAT",
    row: "mandal_name", column: "respondent_sentiment",
    answerBase: "quick_incumbent_mandal_base", answerBasePartitions: ["mandal_name"],
    title: "Incumbent assessment by Mandal", subtitle: "Recorded answers · count intensity",
    measurementNote: `${incumbentNote("by voter-master Mandal")} A darker cell means more observations, not a stronger average assessment.`
  },
  {
    id: "quick-age-gender-coverage", sheetRole: "demographic", kind: "HEAT",
    row: "age_band", column: "gender",
    title: "Who took part: age and gender", subtitle: "Survey observations · count intensity",
    measurementNote: `${observationNote} Age and gender come from the voter master, not inferred speech or political beliefs. ${coverageNote}`
  },
  {
    id: "quick-mandal-wave-coverage", sheetRole: "geographic", kind: "HEAT",
    row: "mandal_name", column: "quick_iteration_label",
    title: "Survey coverage by Mandal and Iteration", subtitle: "Survey observations · count intensity",
    measurementNote: `${observationNote} Counts show where captured evidence exists in each Iteration. They do not establish opinion change, comparable waves or population coverage. Mandal comes from the voter master.`
  },
  {
    id: "quick-issue-answer-state", sheetRole: "leadership", kind: "BAR",
    category: "issue_priority_status", statusLabels: ANSWER_STATE_LABELS,
    title: "Issue answer coverage", subtitle: "Recorded and missing observations · counts",
    measurementNote: `Answer status for graduate_issue_priority or issue_priority. Recorded answer means a recognized coded category, including an explicit None; it does not imply approval. No response, Can't say, declined and uncoded remain separate. Missing is deliberately included in this coverage chart. ${observationNote}`
  }
]);

/** Concise chart text plus on-demand measurement notes for the existing visuals. */
export const EXISTING_VISUAL_NOTES = Object.freeze({
  "quick-unique-respondents": {
    title: "Survey participants", subtitle: "Distinct people · selected evidence",
    measurementNote: "Distinct people with a connected call and captured structured answers in the selected Campaigns and Iterations. A person is counted once across that selection. Fewer than five people are withheld as unavailable, not zero. This is not the total electorate or the number of call attempts."
  },
  "quick-evidence-observations": {
    title: "Survey observations", subtitle: "Person × Campaign × Iteration · counts",
    measurementNote: observationNote
  },
  "quick-incumbent-answer-base": {
    title: "Incumbent answers recorded", subtitle: "Non-missing observations · counts",
    measurementNote: `${incumbentNote("in the current selection")} This count is the full non-missing answered base, including uncertainty, declined and uncoded responses.`
  },
  "quick-candidate-answer-base": {
    title: "Candidate answers recorded", subtitle: "Non-missing observations · counts",
    measurementNote: `${impressionNote("in the current selection")} This count is the full non-missing answered base, including uncertainty, declined and uncoded responses.`
  },
  "quick-incumbent-count": {
    title: "Incumbent performance", subtitle: "Recorded answers · counts · review pending",
    measurementNote: incumbentNote("in the current selection")
  },
  "quick-party-count": {
    title: "Party attention", subtitle: "Recorded answers · counts",
    measurementNote: partyNote("in the current selection")
  },
  "quick-candidate-count": {
    title: "Candidate impression", subtitle: "Recorded answers · counts · review pending",
    measurementNote: impressionNote("in the current selection")
  },
  "quick-leadership-count": {
    title: "Issue responsiveness", subtitle: "Recorded answers · counts",
    measurementNote: `${outcomeNote("Who respondents say addresses graduate concerns", "perceived_issue_leader_aided and approved issue-leadership aliases", "in the current selection")} This question records perceived responsiveness; it does not measure approval of a named political leader or vote choice.`
  },
  "quick-issue-count": {
    title: "Issue priorities", subtitle: "Recorded answers · counts",
    measurementNote: issueNote("in the current selection")
  },
  "quick-incumbent-missing": {
    title: "Incumbent answer not recorded", subtitle: "Missing observations · counts",
    measurementNote: `Observations without a recorded incumbent_assessment answer. An explicit Can't say, refusal or uncoded answer is not missing and is excluded from this count. ${observationNote}`
  },
  "quick-candidate-missing": {
    title: "Candidate answer not recorded", subtitle: "Missing observations · counts",
    measurementNote: `Observations without a recorded candidate impression answer. Awareness or suitability does not fill a missing impression. An explicit Can't say, refusal or uncoded answer is not missing. ${observationNote}`
  },
  "quick-age-count": {
    title: "Age profile", subtitle: "Survey observations · counts",
    measurementNote: `Voter-master age bands are 18–29, 30–39, 40–49 and 50+; missing ages and ages below 18 remain Unknown. ${observationNote} ${coverageNote}`
  },
  "quick-age-incumbent": {
    title: "Incumbent performance by age", subtitle: "Recorded answers · counts · review pending",
    measurementNote: incumbentNote("by voter-master age band")
  },
  "quick-gender-count": {
    title: "Gender profile", subtitle: "Survey observations · counts",
    measurementNote: `Gender comes from the voter master. Unknown and Other / self-described remain separate categories. ${observationNote} ${coverageNote}`
  },
  "quick-gender-party": {
    title: "Party attention by gender", subtitle: "Recorded answers · counts",
    measurementNote: partyNote("by voter-master gender")
  },
  "quick-mandal-party": {
    title: "Party attention by Mandal", subtitle: "Recorded answers · counts",
    measurementNote: partyNote("by voter-master Mandal")
  },
  "quick-mandal-party-heat": {
    title: "Party attention across Mandals", subtitle: "Recorded answers · count intensity",
    measurementNote: `${partyNote("by voter-master Mandal")} A darker cell means more observations; Mandals with larger samples can have larger counts.`
  },
  "quick-constituency-incumbent": {
    title: "Incumbent assessment by constituency", subtitle: "Recorded answers · count intensity",
    measurementNote: incumbentNote("by recorded constituency")
  },
  "quick-mandal-party-map": {
    title: "Party attention map", subtitle: "Qualified counts · approximate demo centroids",
    measurementNote: "Point size shows recorded party-attention counts from already-qualified Mandal × party × Campaign × Iteration cells. Missing party answers are excluded; uncertainty, declined and uncoded remain when reportable. Points use approximate Serilingampally demo centroids, not verified respondent locations or Mandal boundaries. The geographic rollup does not support age or gender filters. Counts do not imply voting intention or party strength."
  },
  "quick-map-evidence-table": {
    title: "Map evidence", subtitle: "Qualified Mandal and party cells · counts",
    measurementNote: "Each source row is a Mandal × party × Campaign × Iteration cell that already contains at least five distinct people. Missing party answers are excluded. Rows provide the recorded counts behind the map, not respondent details, vote share or numeric party strength. Age and gender filtering is unavailable for this geographic rollup."
  },
  "quick-incumbent-movement": {
    title: "Incumbent assessment change", subtitle: "Positive answers · percentage-point change",
    measurementNote: "Current minus previous Iteration percentage of Positive incumbent_assessment answers. The denominator is every non-missing recorded answer, including uncertainty, refusals and uncoded responses. Only consecutive waves that pass the recorded methodology and frozen-questionnaire comparison gate are eligible, with at least five answered measures in each wave. Unavailable changes remain null; missing waves are not bridged. Full Iterations and all Runs only; no demographic, Mandal or party filtering. Human review is pending; this is descriptive change, not a causal effect or forecast."
  },
  "quick-candidate-movement": {
    title: "Candidate impression change", subtitle: "Positive answers · percentage-point change",
    measurementNote: "Current minus previous Iteration percentage of Positive candidate impression answers. The denominator is every non-missing impression answer, including uncertainty, refusals and uncoded responses. Awareness and suitability are separate constructs. Consecutive waves must pass the recorded methodology and frozen-questionnaire comparison gate, with at least five answered measures in each wave. Unavailable changes remain null; missing waves are not bridged. Full Iterations and all Runs only; no demographic, Mandal or party filtering. Human review is pending; this is descriptive change, not a causal effect or forecast."
  },
  "quick-wave-evidence": {
    title: "Iteration evidence", subtitle: "People and answered bases · full Iterations",
    measurementNote: "Standalone evidence for each Campaign and Iteration: distinct people and reportable non-missing incumbent/candidate answer bases. An adequate standalone base does not make the wave comparable to another wave. Answer bases below five remain unavailable. All Runs are included; demographic, Mandal, constituency and party filters do not apply."
  },
  "quick-movement-reasons": {
    title: "Comparison availability", subtitle: "Recorded comparison gate · full Iterations",
    measurementNote: "Recorded reasons why a Campaign's adjacent Iterations can or cannot be compared, including methodology, frozen instruments, missing preceding evidence and inadequate answer bases. Baseline has no previous-wave change. Unavailable is not zero. This view includes full Iterations and all Runs; demographic, Mandal, constituency and party filters do not apply."
  },
  "quick-quality-connection": {
    title: "Calls connected", subtitle: "% of call attempts · whole Campaign",
    measurementNote: `100 × summed connected_calls ÷ summed call_attempts. A zero denominator produces no available percentage. ${wholeCampaignNote}`
  },
  "quick-quality-output": {
    title: "Answers captured", subtitle: "% of connected calls · whole Campaign",
    measurementNote: `100 × summed responses_captured ÷ summed connected_calls. A response set means a nonempty structured-output object, not an answer to every survey question. A zero denominator produces no available percentage. ${wholeCampaignNote}`
  },
  "quick-quality-transcript": {
    title: "Transcripts captured", subtitle: "% of connected calls · whole Campaign",
    measurementNote: `100 × summed transcripts_captured ÷ summed connected_calls. Coverage requires a nonempty transcript; the dashboard contains no transcript text. A zero denominator produces no available percentage. ${wholeCampaignNote}`
  },
  "quick-quality-callback": {
    title: "Callbacks received", subtitle: "% of call attempts · whole Campaign",
    measurementNote: `100 × summed callbacks_received ÷ summed call_attempts. This measures received call-execution callbacks, not participants asking to be called again. A zero denominator produces no available percentage. ${wholeCampaignNote}`
  },
  "quick-quality-demographics": {
    title: "Demographic fields complete", subtitle: "% of required fields · whole Campaign",
    measurementNote: `100 × (summed known-gender people + summed known-age people + summed known-Mandal people) ÷ (3 × summed respondent base). This is completeness of three fields, not the percentage of people with every field complete. A zero denominator produces no available percentage. ${wholeCampaignNote}`
  },
  "quick-quality-evidence": {
    title: "Fieldwork evidence", subtitle: "Operational counts · whole Campaign",
    measurementNote: `Campaign totals for call attempts, connected calls, callbacks, transcripts, captured response sets and distinct people. These use different operational record types and are not a single respondent funnel. Evidence-quality labels describe operational qualification. ${wholeCampaignNote}`
  },
  "quick-comparability-registry": {
    title: "Survey methods and comparison checks", subtitle: "Actual recorded declarations · Campaign scope",
    measurementNote: "Displays actual recorded sampling, weighting, fieldwork and comparison declarations for each Campaign and Iteration. Undeclared methods are not assumed comparable. A weighting declaration does not apply statistical weights to these charts. Campaign filters this registry; Program does not because the registry has no verified Program field. Demographic, Mandal and Run filtering is unavailable."
  }
});
