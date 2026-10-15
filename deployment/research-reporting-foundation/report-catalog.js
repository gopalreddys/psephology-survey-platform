// Research constructs are deliberately separate. Awareness is not approval,
// party attention is not vote intention, and suitability is not sentiment.
export const REPORT_CATALOG = Object.freeze([
  { id: 'party_salience', title: 'Recorded party attention', outputKeys: ['party_salience_unaided', 'party_salience', 'party_attention', 'party_preference'], measureKeys: ['party_salience_unaided'], domain: 'party', caution: 'A recorded party mention is attention, not vote intention or vote share.' },
  { id: 'issue_leadership', title: 'Perceived issue leadership', outputKeys: ['perceived_issue_leader_aided', 'perceived_issue_leader', 'leadership_preference', 'party_leadership'], measureKeys: ['perceived_issue_leader_aided'], domain: 'leadership', caution: 'Aided issue leadership is not named-leader approval or electoral support.' },
  { id: 'incumbent_assessment', title: 'Incumbent performance assessment', outputKeys: ['incumbent_assessment'], measureKeys: ['incumbent_assessment'], domain: 'assessment', caution: 'Performance assessment is distinct from candidate impression and vote choice.' },
  { id: 'candidate_impression', title: 'Candidate impression', outputKeys: ['candidate_impression', 'candidate_sentiment', 'veeresh_impression'], measureKeys: ['candidate_assessment'], domain: 'assessment', targetType: 'CANDIDATE', caution: 'Only the explicitly identified candidate can be assessed; awareness is not a positive impression.' },
  { id: 'candidate_fit', title: 'Candidate suitability', outputKeys: ['candidate_criterion_fit', 'veeresh_criterion_fit'], measureKeys: ['candidate_criterion_fit', 'veeresh_criterion_fit'], domain: 'suitability', targetType: 'CANDIDATE', caution: 'Suitability is a separate construct, not positive or negative sentiment.' },
  { id: 'issue_priority', title: 'Issue priorities', outputKeys: ['graduate_issue_priority', 'issue_priority'], measureKeys: ['graduate_issue_priority'], domain: 'issue', caution: 'Recorded priorities are respondents’ stated concerns, not a causal explanation of electoral choices.' },
  { id: 'development_priority', title: 'Development priorities', outputKeys: ['development_priority', 'priority_development'], measureKeys: ['development_priority'], domain: 'issue', caution: 'Development priorities require their own question; general issue answers are not substituted.' },
  { id: 'expected_change', title: 'Expected changes', outputKeys: ['desired_change', 'expected_change', 'change_priority'], measureKeys: ['desired_change'], domain: 'issue', caution: 'Expected changes require their own question; satisfaction or issue priority is not substituted.' },
  { id: 'scheme_experience', title: 'Government scheme experience', outputKeys: ['scheme_experience', 'scheme_satisfaction'], measureKeys: [], domain: 'assessment', targetType: 'SCHEME', caution: 'A specific scheme and experience measure must be identified. Incumbent assessment is not scheme experience.' },
  { id: 'leader_assessment', title: 'Named-leader assessment', outputKeys: ['leader_assessment', 'leader_sentiment'], measureKeys: ['leader_assessment'], domain: 'assessment', targetType: 'LEADER', caution: 'A specific leader must be identified. Party attention and aided issue leadership are not leader approval.' }
].map((report) => Object.freeze(report)));

export const REPORT_KEYS = Object.freeze(REPORT_CATALOG.map((report) => report.id));
export const RESEARCH_REPORT_RULES_VERSION = 'RESEARCH_REPORT_V2';
export const MINIMUM_RESEARCH_REPORT_BASE = 5;
