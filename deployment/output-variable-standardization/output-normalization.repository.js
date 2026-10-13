import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// This same audited rule source generates the database normalization function.
// Raw responses are never overwritten and a named party is not a vote intention.
const ruleSource = readFileSync(new URL("./normalization-rules.json", import.meta.url), "utf8");
const rules = JSON.parse(ruleSource);
export const SENTIMENT_RULESET_HASH = createHash("sha256")
  .update(ruleSource).update("\n").update(readFileSync(new URL(import.meta.url))).digest("hex");
for (const domain of rules.domains) {
  if (domain.categoryDomain) domain.categories = [...rules.domains.find((item) => item.name === domain.categoryDomain).categories, ...domain.categories];
}
export const NORMALIZATION_VERSION = rules.version;
export const DISCLOSURE_POLICY_VERSION = "WHOLE_PARTITION_V1";
export const MINIMUM_REPORTING_BASE = rules.minimumAnswerBase;
export const DIRECT_RATING_KEYS = Object.freeze(["brs_lean_rating", "party_lean_rating", "party_lean_strength"]);
// Exact ECMAScript trim set: PostgreSQL's default btrim omits tabs, NBSP and BOM.
const SQL_TRIM_CHARACTERS = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`;
export function canonicalOutputKeySql(expression) {
  // Only trusted static SQL identifiers may be interpolated, never request text.
  if (!/^[a-z_][a-z_0-9]*(\.[a-z_][a-z_0-9]*)?$/.test(expression)) throw new Error("Invalid output-key SQL identifier");
  return `lower(btrim(${expression}, ${SQL_TRIM_CHARACTERS}))`;
}
// Describes a recorded numeric response only. Aliases are not permission to
// infer support from party attention, suitability, or a different construct.
export function selectDirectRating(record) {
  const variables = record?.response_variables || {};
  const values = [];
  for (const [key, raw] of Object.entries(variables)) {
    if (!DIRECT_RATING_KEYS.includes(key.trim().toLowerCase())) continue;
    if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) continue;
    const value = typeof raw === "number" || (typeof raw === "string" && /^[1-5]$/.test(raw.trim())) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 1 || value > 5) return { status: "UNRESOLVED", value: null };
    values.push(value);
  }
  if (!values.length) return { status: "MISSING", value: null };
  if (new Set(values).size !== 1) return { status: "UNRESOLVED", value: null };
  return { status: "RECORDED", value: values[0] };
}
export function summarizeDirectRatings(records) {
  const selected = records.map(selectDirectRating);
  const counts = new Map();
  for (const item of selected) counts.set(item.status === "RECORDED" ? String(item.value) : item.status, (counts.get(item.status === "RECORDED" ? String(item.value) : item.status) || 0) + 1);
  const ratings = selected.filter((item) => item.status === "RECORDED").map((item) => item.value);
  const suppressed = ratings.length < MINIMUM_REPORTING_BASE || [...counts.values()].some((value) => value > 0 && value < MINIMUM_REPORTING_BASE);
  return { value: suppressed ? null : Number((ratings.reduce((total, value) => total + value, 0) / ratings.length).toFixed(1)),
    answered: suppressed ? null : ratings.length, scale: 5, suppressed, measureId: "DIRECT_RECORDED_FIVE_POINT_V1",
    disclosurePolicy: DISCLOSURE_POLICY_VERSION, basis: "Recorded explicit 1–5 answers; contradictory aliases withheld, not inferred party alignment" };
}
export function buildDirectRatingSqlFunction() {
  return `CREATE OR REPLACE FUNCTION analytics_direct_rating_v1(response_values jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $direct_rating$
DECLARE item record; current_value numeric; selected_value numeric;
BEGIN
 IF jsonb_typeof(response_values) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
 FOR item IN SELECT key, value FROM jsonb_each(response_values)
   WHERE lower(btrim(key, ${SQL_TRIM_CHARACTERS})) = ANY(ARRAY[${DIRECT_RATING_KEYS.map((key) => `'${key}'`).join(",")}]) LOOP
   IF item.value = 'null'::jsonb OR (jsonb_typeof(item.value) = 'string' AND btrim(item.value #>> '{}', ${SQL_TRIM_CHARACTERS}) = '') THEN CONTINUE; END IF;
   IF jsonb_typeof(item.value) = 'string' AND btrim(item.value #>> '{}', ${SQL_TRIM_CHARACTERS}) !~ '^[1-5]$' THEN RETURN NULL; END IF;
   IF jsonb_typeof(item.value) NOT IN ('string','number') THEN RETURN NULL; END IF;
   current_value := btrim(item.value #>> '{}', ${SQL_TRIM_CHARACTERS})::numeric;
   IF current_value <> trunc(current_value) OR current_value < 1 OR current_value > 5 THEN RETURN NULL; END IF;
   IF selected_value IS NOT NULL AND selected_value <> current_value THEN RETURN NULL; END IF;
   selected_value := current_value;
 END LOOP;
 RETURN selected_value;
END;
$direct_rating$;
CREATE OR REPLACE FUNCTION analytics_direct_rating_status_v1(response_values jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $direct_status$
 SELECT CASE WHEN analytics_direct_rating_v1(response_values) IS NOT NULL THEN 'RECORDED'
   WHEN EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(response_values)='object' THEN response_values ELSE '{}'::jsonb END) item
     WHERE lower(btrim(item.key, ${SQL_TRIM_CHARACTERS}))=ANY(ARRAY[${DIRECT_RATING_KEYS.map((key) => `'${key}'`).join(",")}])
       AND item.value <> 'null'::jsonb
       AND NOT (jsonb_typeof(item.value)='string' AND btrim(item.value #>> '{}', ${SQL_TRIM_CHARACTERS})='')) THEN 'UNRESOLVED'
   ELSE 'MISSING' END;
$direct_status$;`;
}
export function reportingCategoryLabels(keys) {
  const requested = Array.isArray(keys) ? keys : [keys];
  const selected = rules.domains.find((domain) => domain.keys.some((key) => requested.includes(key)));
  if (!selected) return [];
  return [...new Set([...selected.categories.map((category) => category.label), selected.multipleLabel,
    "Can't say", "Declined to answer", "Uncoded response", ...(!["assessment", "suitability"].includes(selected.name) ? ["None"] : [])])];
}
export const OUTPUT_KEYS = {
  party: ["party_salience_unaided", "party_salience", "party_attention", "party_preference"],
  leadership: ["perceived_issue_leader_aided", "perceived_issue_leader", "leadership_preference", "party_leadership"],
  candidate: ["candidate_impression", "candidate_sentiment", "veeresh_impression"],
  candidateFit: ["candidate_criterion_fit", "veeresh_criterion_fit"],
  issue: ["graduate_issue_priority", "issue_priority"],
  development: ["development_priority", "priority_development"],
  change: ["desired_change", "expected_change", "change_priority"]
};
export const SENTIMENT_CONSTRUCTS = [
  { key: "candidate_impression", label: "Candidate impression", outputKeys: OUTPUT_KEYS.candidate, type: "SENTIMENT" },
  { key: "incumbent_assessment", label: "Incumbent performance assessment", outputKeys: ["incumbent_assessment"], type: "SENTIMENT" },
  { key: "issue_sentiment", label: "Issue assessment", outputKeys: ["issue_sentiment"], type: "SENTIMENT" },
  { key: "development_sentiment", label: "Development assessment", outputKeys: ["development_sentiment"], type: "SENTIMENT" },
  { key: "change_sentiment", label: "Expected-change assessment", outputKeys: ["change_sentiment"], type: "SENTIMENT" },
  { key: "candidate_criterion_fit", label: "Candidate criterion fit (suitability, not sentiment)", outputKeys: OUTPUT_KEYS.candidateFit, type: "SUITABILITY" }
];
export function getSentimentValidation() {
  return {
    status: "HUMAN_REVIEW_PENDING",
    method: "EXPLICIT_LABEL_MAPPING",
    normalizationVersion: NORMALIZATION_VERSION,
    ruleHash: SENTIMENT_RULESET_HASH,
    message: "Human review pending. Descriptive coding of explicit structured outputs; not a validated NLP model or electoral prediction."
  };
}
const domains = new Map(rules.domains.flatMap((domain) => domain.keys.map((key) => [key, domain])));
const matches = (pattern, text) => new RegExp(pattern, "i").test(text);

export function normalizeOutputValue(key, value) {
  const domain = domains.get(String(key || "").trim().toLowerCase());
  const result = (status, label) => ({ status, label, domain: domain?.name || "recorded", version: rules.version });
  if (value === null || value === undefined || value === "") return result("MISSING", null);
  if (!["string", "number", "boolean"].includes(typeof value)) {
    return result("UNCODED", "Uncoded response");
  }
  const text = String(value).trim().replaceAll("’", "'").replaceAll("‘", "'").replace(/\s+/g, " ").replace(/[.!?।]+$/, "").toLowerCase();
  if (!text || matches(rules.missingPattern, text)) return result("MISSING", null);
  if (matches(rules.cantSayPattern, text)) return result("CANT_SAY", "Can't say");
  if (matches(rules.refusedPattern, text)) return result("REFUSED", "Declined to answer");
  if (matches(rules.nonePattern, text)) return ["assessment", "suitability"].includes(domain?.name)
    ? result("UNCODED", "Uncoded response") : result("CODED", "None");
  if (!domain) {
    if (text === "uncoded response" || rules.domains.some((item) => item.multipleLabel.toLowerCase() === text)) return result("UNCODED", String(value).trim());
    // Non-taxonomy short structured outputs retain their recorded value.
    return result(text.length > 80 ? "UNCODED" : "CODED", text.length > 80 ? "Uncoded response" : String(value).trim().replace(/\s+/g, " "));
  }
  const found = domain.categories.filter((category) => matches(category.pattern, text));
  if (found.length > 1) return result("UNCODED", domain.multipleLabel);
  if (found.length === 1) {
    if (domain.selectionPattern && !matches(domain.selectionPattern, text)) return result("UNCODED", "Uncoded response");
    if (["party", "candidate", "leadership"].includes(domain.name) && matches(rules.negatedEntityPattern, text)) return result("UNCODED", "Uncoded response");
    return result("CODED", found[0].label);
  }
  return result("UNCODED", "Uncoded response");
}

export function normalizedLabel(key, value) {
  return normalizeOutputValue(key, value).label;
}

function summary(results, respondentBase) {
  const counts = { missingCount: 0, cantSayCount: 0, refusedCount: 0, uncodedCount: 0 };
  const labels = new Map();
  for (const result of results) {
    if (result.status === "MISSING") { counts.missingCount += 1; continue; }
    if (result.status === "CANT_SAY") counts.cantSayCount += 1;
    if (result.status === "REFUSED") counts.refusedCount += 1;
    if (result.status === "UNCODED") counts.uncodedCount += 1;
    const key = result.label.toLowerCase();
    const entry = labels.get(key) || { value: result.label, respondents: 0 };
    entry.respondents += 1;
    labels.set(key, entry);
  }
  counts.missingCount += Math.max(0, respondentBase - results.length);
  const answerBase = results.filter((result) => result.status !== "MISSING").length;
  // Do not publish a large complement beside a withheld small category. The
  // complete construct partition includes missing answers and its denominators.
  const suppressed = answerBase < rules.minimumAnswerBase || [...labels.values()].some((entry) => entry.respondents < rules.minimumAnswerBase)
    || (counts.missingCount > 0 && counts.missingCount < rules.minimumAnswerBase);
  const metadata = {
    answerBase: suppressed ? null : answerBase, respondentBase: suppressed ? null : respondentBase,
    ...Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, suppressed ? null : value])), suppressed,
    codedCount: suppressed ? null : answerBase - counts.cantSayCount - counts.refusedCount - counts.uncodedCount,
    coveragePct: suppressed ? null : respondentBase ? Number((100 * answerBase / respondentBase).toFixed(1)) : 0,
    normalizationVersion: rules.version,
    disclosurePolicy: DISCLOSURE_POLICY_VERSION,
    denominatorLabel: "Recorded non-missing answers, including explicit uncertainty, refusals and uncoded responses"
  };
  return { ...metadata, values: suppressed ? [] : [...labels.values()].sort((a, b) => b.respondents - a.respondents || a.value.localeCompare(b.value)).map((entry) => ({
    ...entry, ...metadata,
    percentage: suppressed ? null : Number((100 * entry.respondents / answerBase).toFixed(1))
  })) };
}

export function selectStructuredOutput(record, keys) {
  const selectedKeys = Array.isArray(keys) ? keys : [keys];
  const variables = record.response_variables || {};
  const found = [];
  for (const key of selectedKeys) {
    const matchingKeys = Object.keys(variables).filter((item) => item.trim().toLowerCase() === key.trim().toLowerCase());
    const result = matchingKeys.length > 1 && new Set(matchingKeys.map((item) => JSON.stringify(variables[item]))).size > 1
      ? { ...normalizeOutputValue(key, {}), status: "UNCODED", label: "Uncoded response" }
      : normalizeOutputValue(key, variables[matchingKeys[0]]);
    if (result.status !== "MISSING") found.push({ ...result, sourceKey: key });
  }
  if (!found.length) return { ...normalizeOutputValue(selectedKeys[0], null), sourceKeys: [] };
  if (["assessment", "suitability"].includes(found[0].domain)
    && new Set(found.map((result) => `${result.status}:${result.label}`)).size > 1) {
    return { ...found[0], status: "UNCODED", label: "Uncoded response", sourceKeys: found.map((result) => result.sourceKey) };
  }
  return { ...found[0], sourceKeys: found.map((result) => result.sourceKey) };
}

export function summarizeOutput(records, keys, options = {}) {
  const results = records.map((record) => options.derive
    ? normalizeOutputValue("", options.derive(record)) : selectStructuredOutput(record, keys));
  return summary(results, records.length);
}

export function summarizeLabels(labels, respondentBase = labels.length) {
  return summary(labels.map((label) => normalizeOutputValue("", label)), respondentBase);
}
// No external model, secret or inference is used. SQL and JavaScript share rules.
export function buildNormalizationSqlFunction() {
  const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
  // PostgreSQL's btrim/space class omits JS-trimmable NBSP/BOM characters.
  const whitespace = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  const trimmedRaw = `btrim(raw_value #>> '{}', ${quote(whitespace)})`;
  const collapsedRaw = `regexp_replace(${trimmedRaw}, ${quote("[" + whitespace + "]+")}, ' ', 'g')`;
  const cases = rules.domains.map((domain) => `WHEN output_key = ANY(ARRAY[${domain.keys.map(quote).join(",")}]) THEN
    domain_name := ${quote(domain.name)}; multiple_label := ${quote(domain.multipleLabel)};
${domain.categories.map((category) => `    IF text_value ~* ${quote(category.pattern)} THEN labels := array_append(labels, ${quote(category.label)}); END IF;`).join("\n")}${domain.selectionPattern ? `\n    IF cardinality(labels) = 1 AND NOT text_value ~* ${quote(domain.selectionPattern)} THEN labels := ARRAY[]::text[]; END IF;` : ""}`).join("\n");
  const domainSql = rules.domains.map((domain) => `WHEN output_key = ANY(ARRAY[${domain.keys.map(quote).join(",")}]) THEN ${quote(domain.name)}`).join("\n");
  return `CREATE OR REPLACE FUNCTION analytics_normalize_output_v1(output_key text, raw_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $normalize$
DECLARE
 text_value text; domain_name text := 'recorded'; labels text[] := ARRAY[]::text[];
 multiple_label text; status_value text; label_value text;
BEGIN
 output_key := lower(btrim(COALESCE(output_key, ''), ${quote(whitespace)}));
 domain_name := CASE
${domainSql}
 ELSE 'recorded' END;
 IF raw_value IS NULL OR raw_value = 'null'::jsonb THEN RETURN jsonb_build_object('status','MISSING','label',NULL,'domain',domain_name,'version',${quote(rules.version)}); END IF;
 IF jsonb_typeof(raw_value) NOT IN ('string','number','boolean') THEN RETURN jsonb_build_object('status','UNCODED','label','Uncoded response','domain',domain_name,'version',${quote(rules.version)}); END IF;
 text_value := lower(regexp_replace(translate(${collapsedRaw}, ${quote("’‘")}, ${quote("''")}), '[.!?।]+$', ''));
 IF text_value = '' OR text_value ~* ${quote(rules.missingPattern)} THEN status_value := 'MISSING';
 ELSIF text_value ~* ${quote(rules.cantSayPattern)} THEN status_value := 'CANT_SAY'; label_value := ${quote("Can't say")};
 ELSIF text_value ~* ${quote(rules.refusedPattern)} THEN status_value := 'REFUSED'; label_value := 'Declined to answer';
 ELSIF text_value ~* ${quote(rules.nonePattern)} THEN
   IF domain_name IN ('assessment','suitability') THEN status_value := 'UNCODED'; label_value := 'Uncoded response';
   ELSE status_value := 'CODED'; label_value := 'None'; END IF;
 ELSE
 CASE
${cases}
 ELSE NULL; END CASE;
 IF cardinality(labels) > 1 THEN status_value := 'UNCODED'; label_value := multiple_label;
 ELSIF cardinality(labels) = 1 AND NOT (domain_name IN ('party','candidate','leadership') AND text_value ~* ${quote(rules.negatedEntityPattern)}) THEN status_value := 'CODED'; label_value := labels[1];
 ELSIF domain_name = 'recorded' AND text_value = ANY(ARRAY[${rules.domains.map((domain) => quote(domain.multipleLabel.toLowerCase())).join(",")}]) THEN status_value := 'UNCODED'; label_value := ${trimmedRaw};
 ELSIF domain_name = 'recorded' AND length(text_value) <= 80 AND NOT text_value = ANY(ARRAY[${['Uncoded response', ...rules.domains.map((domain) => domain.multipleLabel)].map((label) => quote(label.toLowerCase())).join(",")}]) THEN status_value := 'CODED'; label_value := ${collapsedRaw};
 ELSE status_value := 'UNCODED'; label_value := 'Uncoded response'; END IF;
 END IF;
 RETURN jsonb_build_object('status',status_value,'label',label_value,'domain',domain_name,'version',${quote(rules.version)});
END;
$normalize$;
`;
}
