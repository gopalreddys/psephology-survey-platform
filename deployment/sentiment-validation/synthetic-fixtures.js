// Authored engineering expectations, not a human-validated sentiment dataset.
// Repeated phrases across constructs exercise isolation; they are not independent
// observations and cannot support estimates of real-world language accuracy.
const coded = (label) => ({ status: 'CODED', label });
const uncoded = { status: 'UNCODED', label: 'Uncoded response' };
const cantSay = { status: 'CANT_SAY', label: "Can't say" };
const refused = { status: 'REFUSED', label: 'Declined to answer' };
const missing = { status: 'MISSING', label: null };
const mapping = (family, text, expected) => ({ family, text, output: text, expected, type: 'NORMALIZATION_MAPPING' });
const recorded = (family, text, output, expected) => ({ family, text, output, expected, type: 'RECORDED_PROVIDER_OUTPUT' });

const assessments = {
  EN: [
    mapping('EXPLICIT_POSITIVE', 'good', coded('Positive')),
    mapping('EXPLICIT_NEGATIVE', 'poor', coded('Negative')),
    mapping('EXPLICIT_NEUTRAL', 'neutral', coded('Neutral')),
    mapping('EXPLICIT_MIXED', 'mixed', coded('Mixed')),
    mapping('NEGATED_POSITIVE', 'not good', coded('Negative')),
    mapping('NEGATED_NEGATIVE', 'not bad', uncoded),
    mapping('AMBIGUOUS', 'Maybe it is good, but I cannot assess it', uncoded),
    mapping('UNCERTAINTY', "don't know", cantSay),
    mapping('REFUSAL', 'prefer not to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  TE: [
    mapping('EXPLICIT_POSITIVE', 'బాగుంది', coded('Positive')),
    mapping('EXPLICIT_NEGATIVE', 'బాగోలేదు', coded('Negative')),
    mapping('EXPLICIT_NEUTRAL', 'తటస్థం', coded('Neutral')),
    mapping('EXPLICIT_MIXED', 'మిశ్రమం', coded('Mixed')),
    mapping('NEGATED_POSITIVE', 'బాగుంది కాదు', uncoded),
    mapping('NEGATED_NEGATIVE', 'చెడ్డది కాదు', uncoded),
    mapping('AMBIGUOUS', 'బాగుందేమో కానీ నాకు స్పష్టంగా తెలియదు', uncoded),
    mapping('UNCERTAINTY', 'తెలియదు', cantSay),
    recorded('REFUSAL', 'ఈ ప్రశ్నకు సమాధానం చెప్పను', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  HI: [
    mapping('EXPLICIT_POSITIVE', 'अच्छा', coded('Positive')),
    mapping('EXPLICIT_NEGATIVE', 'खराब', coded('Negative')),
    mapping('EXPLICIT_NEUTRAL', 'तटस्थ', coded('Neutral')),
    mapping('EXPLICIT_MIXED', 'मिश्रित', coded('Mixed')),
    mapping('NEGATED_POSITIVE', 'अच्छा नहीं', coded('Negative')),
    mapping('NEGATED_NEGATIVE', 'खराब नहीं', uncoded),
    mapping('AMBIGUOUS', 'शायद ठीक है, लेकिन तय नहीं कर सकता', uncoded),
    mapping('UNCERTAINTY', 'पता नहीं', cantSay),
    recorded('REFUSAL', 'इस प्रश्न का जवाब नहीं दूँगा', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  MIXED: [
    recorded('EXPLICIT_POSITIVE', 'service బాగుంది, good', 'Positive', coded('Positive')),
    recorded('EXPLICIT_NEGATIVE', 'service खराब है, poor', 'Negative', coded('Negative')),
    recorded('EXPLICIT_NEUTRAL', 'overall తటస్థం, neutral', 'Neutral', coded('Neutral')),
    recorded('EXPLICIT_MIXED', 'కొన్ని good, बाकी खराब', 'Mixed', coded('Mixed')),
    mapping('NEGATED_POSITIVE', 'good కాదు', uncoded),
    mapping('NEGATED_NEGATIVE', 'bad नहीं', uncoded),
    mapping('AMBIGUOUS', 'maybe బాగుంది, पर पता नहीं', uncoded),
    recorded('UNCERTAINTY', 'తెలియదు, I do not know', "Can't say", cantSay),
    recorded('REFUSAL', 'answer చెప్పను, prefer not to say', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ]
};

const suitability = {
  EN: [
    mapping('STRONG_FIT', 'very closely', coded('Strong fit')),
    mapping('SOME_FIT', 'somewhat closely', coded('Some fit')),
    mapping('POOR_FIT', 'not at all', coded('Poor fit')),
    mapping('MIXED_FIT', 'mixed', coded('Mixed')),
    mapping('NEGATED_STRONG_FIT', 'not very closely', coded('Poor fit')),
    mapping('NEGATED_POOR_FIT', 'not a poor fit', uncoded),
    mapping('AMBIGUOUS_FIT', 'May fit one criterion but I am unsure about the other', uncoded),
    mapping('UNCERTAINTY', "don't know", cantSay),
    mapping('REFUSAL', 'prefer not to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  TE: [
    recorded('STRONG_FIT', 'ప్రమాణానికి బాగా సరిపోతారు', 'Strong fit', coded('Strong fit')),
    recorded('SOME_FIT', 'ప్రమాణానికి కొంతవరకు సరిపోతారు', 'Some fit', coded('Some fit')),
    recorded('POOR_FIT', 'ప్రమాణానికి సరిపోరు', 'Poor fit', coded('Poor fit')),
    recorded('MIXED_FIT', 'కొన్ని ప్రమాణాలకు సరిపోతారు, మరికొన్నిటికి కాదు', 'Mixed', coded('Mixed')),
    mapping('NEGATED_STRONG_FIT', 'strong fit కాదు', uncoded),
    mapping('NEGATED_POOR_FIT', 'poor fit కాదు', uncoded),
    mapping('AMBIGUOUS_FIT', 'సరిపోతారేమో కానీ స్పష్టంగా తెలియదు', uncoded),
    mapping('UNCERTAINTY', 'తెలియదు', cantSay),
    recorded('REFUSAL', 'ఈ ప్రశ్నకు సమాధానం చెప్పను', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  HI: [
    recorded('STRONG_FIT', 'इस कसौटी पर बहुत अनुकूल हैं', 'Strong fit', coded('Strong fit')),
    recorded('SOME_FIT', 'इस कसौटी पर कुछ हद तक अनुकूल हैं', 'Some fit', coded('Some fit')),
    recorded('POOR_FIT', 'इस कसौटी पर अनुकूल नहीं हैं', 'Poor fit', coded('Poor fit')),
    recorded('MIXED_FIT', 'कुछ कसौटियों पर अनुकूल हैं, कुछ पर नहीं', 'Mixed', coded('Mixed')),
    mapping('NEGATED_STRONG_FIT', 'strong fit नहीं', uncoded),
    mapping('NEGATED_POOR_FIT', 'poor fit नहीं', uncoded),
    mapping('AMBIGUOUS_FIT', 'शायद अनुकूल हैं, लेकिन तय नहीं कर सकता', uncoded),
    mapping('UNCERTAINTY', 'पता नहीं', cantSay),
    recorded('REFUSAL', 'इस प्रश्न का जवाब नहीं दूँगा', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ],
  MIXED: [
    recorded('STRONG_FIT', 'criterionకి strong fit', 'Strong fit', coded('Strong fit')),
    recorded('SOME_FIT', 'criterionకి some fit', 'Some fit', coded('Some fit')),
    recorded('POOR_FIT', 'criterionపై poor fit', 'Poor fit', coded('Poor fit')),
    recorded('MIXED_FIT', 'కొన్ని fit, कुछ नहीं', 'Mixed', coded('Mixed')),
    mapping('NEGATED_STRONG_FIT', 'strong fit కాదు', uncoded),
    mapping('NEGATED_POOR_FIT', 'poor fit नहीं', uncoded),
    mapping('AMBIGUOUS_FIT', 'maybe సరిపోతారు, पर निश्चित नहीं', uncoded),
    recorded('UNCERTAINTY', 'తెలియదు, I do not know', "Can't say", cantSay),
    recorded('REFUSAL', 'answer చెప్పను, prefer not to say', 'Declined to answer', refused),
    mapping('NO_RECORDED_OUTPUT', null, missing)
  ]
};

const constructs = [
  { key: 'candidate_impression', question: 'What is your overall impression of the fictional candidate?', suitability: false },
  { key: 'incumbent_assessment', question: 'How do you assess the fictional public administration?', suitability: false },
  { key: 'issue_sentiment', question: 'How do you assess progress on the stated public issue?', suitability: false },
  { key: 'development_sentiment', question: 'How do you assess the stated development work?', suitability: false },
  { key: 'change_sentiment', question: 'How do you assess the stated expected change?', suitability: false },
  { key: 'candidate_criterion_fit', question: 'How closely does the fictional candidate fit the stated criterion?', suitability: true }
];

const cases = constructs.flatMap((construct) => Object.entries(construct.suitability ? suitability : assessments)
  .flatMap(([language, phrases]) => phrases.map((phrase, index) => ({
    id: `SYN_${language}_${construct.key.toUpperCase()}_${String(index + 1).padStart(2, '0')}`,
    origin: 'SYNTHETIC', language, construct: construct.key, outputKey: construct.key,
    evaluationType: phrase.type, family: phrase.family, questionText: construct.question,
    sourceExcerpt: phrase.text, providerOutput: phrase.output, authoredExpectation: phrase.expected,
    sanitization: null,
    review: { state: 'UNREVIEWED', reviewer1: null, reviewer2: null, adjudication: null }
  }))));
for (const construct of constructs) cases.push({
  id: `SYN_EN_${construct.key.toUpperCase()}_AWARENESS_CONTROL`, origin: 'SYNTHETIC', language: 'EN',
  construct: construct.key, outputKey: construct.key, evaluationType: 'NORMALIZATION_MAPPING',
  family: 'AWARENESS_IS_NOT_ASSESSMENT', questionText: construct.question,
  sourceExcerpt: 'I have heard of the fictional candidate or public issue',
  providerOutput: 'Previously aware', authoredExpectation: uncoded, sanitization: null,
  review: { state: 'UNREVIEWED', reviewer1: null, reviewer2: null, adjudication: null }
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const SYNTHETIC_BENCHMARK = freeze({
  schemaVersion: 'DEMO_SENTIMENT_REVIEW_V1', datasetReference: 'AUTHORED_MULTILINGUAL_CONTRACT_FIXTURES_V1',
  title: 'Authored multilingual demo checks; human review pending', cases
});
