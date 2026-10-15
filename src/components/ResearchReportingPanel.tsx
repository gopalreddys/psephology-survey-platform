"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { buildPrintableResearchReport, fieldworkValueLabel, parseResearchReport, researchStatusLabel, type ResearchReport } from "@/lib/research-report";
import styles from "./research-reporting-panel.module.css";
import CallQualitySummary from "./CallQualitySummary";
import InterviewCompletionSummary from "./InterviewCompletionSummary";

function saveReport(report: ResearchReport, format: "json" | "html") {
  const content = format === "json" ? JSON.stringify(report, null, 2) : buildPrintableResearchReport(report);
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.reportId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ResearchReportingPanel({ campaignId, query }: { campaignId: string; query: string }) {
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([campaignId, query, refresh]);

  useEffect(() => {
    const current = ++generation.current;
    const timer = window.setTimeout(() => {
      setError(null);
      void apiFetch(`/api/analytics/campaigns/${encodeURIComponent(campaignId)}/research-report${query ? `?${query}` : ""}`).then((data: unknown) => {
        if (current !== generation.current) return;
        setReport(parseResearchReport(data, campaignId, query));
        setLoadedKey(scopeKey);
      }).catch((reason: unknown) => {
        if (current !== generation.current) return;
        setReport(null);
        setLoadedKey(scopeKey);
        setError(reason instanceof Error ? reason.message : "Research-report checks are unavailable.");
      });
    }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [campaignId, query, scopeKey]);

  const current = loadedKey === scopeKey ? report : null;
  const pending = loadedKey !== scopeKey;
  const defined = current?.reports.filter((item) => item.definitionStatus === "CONTRACT_RECORDED").length || 0;
  const captured = current?.reports.filter((item) => item.captureStatus === "DESCRIPTIVE_AVAILABLE").length || 0;
  const distributions = current?.reports.filter((item) => item.captureStatus === "DESCRIPTIVE_AVAILABLE"
    && !item.suppressed && item.distribution.length > 0
    && item.distribution.every((row) => row.percentage !== null)) || [];
  const diagnostics = current?.fieldworkDiagnostics;

  return <section className={styles.panel} aria-label="Research methodology and reporting checks" aria-busy={pending}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>RESEARCH COVERAGE</span><h2>Methodology and report checks</h2><p>Question definitions, captured answers and validation are checked separately.</p></div>
      <div className={styles.actions}>
        <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={pending}><RefreshCw size={14} />Refresh checks</button>
        <button type="button" onClick={() => current && saveReport(current, "html")} disabled={!current || pending}><FileCheck2 size={14} />Printable report</button>
        <button type="button" onClick={() => current && saveReport(current, "json")} disabled={!current || pending}><Download size={14} />Report JSON</button>
      </div>
    </header>
    {pending ? <p role="status">Checking this selected research scope…</p> : error ? <div role="alert" className={styles.warning}><strong>Research checks unavailable</strong><p>Do not interpret an unavailable check as a pass. The reporting API may need installation, or this scope could not be verified.</p><details><summary>Technical detail</summary><p>{error}</p></details></div> : current ? <>
      {current.scope.fieldworkStatus !== "CLOSED" && <p role="status" className={styles.note}>{current.scope.fieldworkStatus === "IN_PROGRESS" ? "Fieldwork is still open. This report is a partial snapshot." : "Select an Iteration to inspect its research evidence."}</p>}
      <div className={styles.metrics}>
        <article><span>Definitions</span><strong>{defined}/{current.reports.length}</strong><small>Fully specified report contracts</small></article>
        <article><span>Captured answers</span><strong>{captured}/{current.reports.length}</strong><small>Display threshold met · not validation</small></article>
        <article><span>Actual methods</span><strong>{researchStatusLabel(current.methodology.declarationStatus)}</strong><small>Declaration is not a sampling engine</small></article>
        <article><span>Human validation</span><strong>{researchStatusLabel(current.methodology.humanValidation)}</strong><small>No automatic research sign-off</small></article>
      </div>
      {current.scope.iterationId && <CallQualitySummary key={current.scope.iterationId} campaignId={campaignId} iterationId={current.scope.iterationId} refreshKey={current.reportId} />}
      {current.scope.iterationId && <InterviewCompletionSummary key={`coverage-${current.scope.iterationId}`} campaignId={campaignId} iterationId={current.scope.iterationId} refreshKey={current.reportId} />}
      <details className={styles.details}><summary>Captured answer distributions · {distributions.length} available</summary>
        <p>Recorded answers in this filtered Iteration, across all Runs. Missing answers are excluded; explicit uncertainty and refusals remain in the answered base. Withheld results are not zero.</p>
        {distributions.length ? <div className={styles.distributions}>{distributions.map((item) => <figure key={item.id} className={styles.distribution} aria-label={`${item.title} recorded answer distribution`}>
          <figcaption><h3>{item.title}</h3><p>{item.target ? `${item.target.type.toLowerCase()}: ${item.target.name}` : "Untargeted question"}</p><small>{item.answerBase} non-missing answers · unweighted · human review pending</small></figcaption>
          <ol className={styles.answerRows}>{item.distribution.map((row) => <li key={row.value}>
            <div className={styles.answerLabel}><span>{row.value}</span><strong>{row.respondents} <small>({row.percentage === null ? "Unavailable" : `${row.percentage.toFixed(1)}%`})</small></strong></div>
            <div className={styles.answerTrack} aria-hidden="true"><span style={{ width: `${row.percentage}%` }} /></div>
          </li>)}</ol>
          <details className={styles.measurement}><summary>How it’s measured</summary><p>Exact frozen output keys: {item.outputVariables.join(", ")}. Percentages use all {item.answerBase} non-missing answers, not just the substantive categories. Each displayed category meets the five-person minimum; an unsafe partition and its linked totals are withheld in full.</p>{item.target && <p>Frozen target: {item.target.name} · {item.target.id}. Assessments of other targets are not combined.</p>}<p>{item.caution}</p></details>
        </figure>)}</div> : <p className={styles.note}>No disclosure-safe distributions are available for this selection. See Report coverage and evidence for missing definitions, missing answers or withheld results.</p>}
      </details>
      <details className={styles.details}><summary>Report coverage and evidence</summary><p>{current.scope.description} Run selection changes operations only; research answers cover the entire selected Iteration.</p><div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Report coverage table"><table><thead><tr><th>Report</th><th>Question contract</th><th>Recorded answers</th><th>What is needed</th></tr></thead><tbody>{current.reports.map((item) => <tr key={item.id}><th scope="row">{item.title}{item.target?.name && <small>{item.target.name}</small>}<small>{item.outputVariables.join(", ") || "Output variables not defined"}</small></th><td>{researchStatusLabel(item.definitionStatus)}</td><td>{researchStatusLabel(item.captureStatus)}<small>{item.answerBase === null ? "Answer base unavailable" : `${item.answerBase} answered`}{item.respondentBase === null ? "" : ` / ${item.respondentBase} respondents`}</small></td><td>{item.message}<small>{item.caution}</small></td></tr>)}</tbody></table></div></details>
      {diagnostics && <details className={styles.details}><summary>Contact cohort and response coverage</summary>
        <p>Distinct database voter IDs retained in Run 1, inspected across all retry Runs — not verified unique people. Run selection does not narrow these Iteration-wide diagnostics.</p>
        <dl><dt>Coverage status</dt><dd>{researchStatusLabel(diagnostics.status)}{diagnostics.reason !== "NONE" && ` · ${researchStatusLabel(diagnostics.reason)}`}</dd><dt>Last stored cohort event (UTC)</dt><dd>{diagnostics.observedAt || "Not recorded"}</dd><dt>Cohort source</dt><dd>{researchStatusLabel(diagnostics.sources.cohort)}</dd><dt>Demographic source</dt><dd>Current voter master · not frozen selection-time attributes</dd><dt>Historical eligible frame</dt><dd>Not recorded</dd><dt>Probability sampling</dt><dd>Not verified</dd><dt>Formal response rate / validated completions</dt><dd>Unavailable / unavailable</dd><dt>Analysis-base alignment</dt><dd>{researchStatusLabel(diagnostics.sources.analysisBaseAlignment)}</dd><dt>Outside initial cohort</dt><dd>{researchStatusLabel(diagnostics.sources.outsideInitialCohort)}</dd></dl>
        {(diagnostics.sources.analysisBaseAlignment === "MISMATCH" || diagnostics.sources.outsideInitialCohort === "OBSERVED") && <p className={styles.warning}>The initial contact cohort and all-Run answer evidence need reconciliation. Do not combine their denominators or infer a completed-interview rate.</p>}
        <h3 className={styles.subheading}>Observed coverage stages</h3><p>Status: {researchStatusLabel(diagnostics.coverage.status)} · Retained cohort base: {fieldworkValueLabel(diagnostics.coverage.selectedBase, diagnostics.coverage.status)}</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Contact coverage stages"><table><thead><tr><th>Stage</th><th>Unique database voter records</th><th>Share of retained cohort</th></tr></thead><tbody>{diagnostics.coverage.stages.map((row) => <tr key={row.key}><th scope="row">{row.title}</th><td>{fieldworkValueLabel(row.participants, diagnostics.coverage.status)}</td><td>{fieldworkValueLabel(row.percentage, diagnostics.coverage.status, "percent")}</td></tr>)}</tbody></table></div>
        <p className={styles.note}>{diagnostics.coverage.yield ? `${diagnostics.coverage.yield.label}: ${diagnostics.coverage.yield.numerator} / ${diagnostics.coverage.yield.denominator} (${fieldworkValueLabel(diagnostics.coverage.yield.percentage, diagnostics.coverage.status, "percent")})` : `Structured-record yield: ${diagnostics.coverage.status === "AVAILABLE" && diagnostics.coverage.selectedBase === 0 ? "Not calculable (zero retained cohort)" : fieldworkValueLabel(null, diagnostics.coverage.status)}`}. Not a validated completed-survey or AAPOR response rate.</p>
        <h3 className={styles.subheading}>Observed operational outcomes</h3><p>Status: {researchStatusLabel(diagnostics.outcomes.status)} · Retained cohort base: {fieldworkValueLabel(diagnostics.outcomes.base, diagnostics.outcomes.status)}</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Contact operational outcomes"><table><thead><tr><th>Outcome</th><th>Unique database voter records</th><th>Share of retained cohort</th></tr></thead><tbody>{diagnostics.outcomes.rows.map((row) => <tr key={row.key}><th scope="row">{row.title}</th><td>{fieldworkValueLabel(row.participants, diagnostics.outcomes.status)}</td><td>{fieldworkValueLabel(row.percentage, diagnostics.outcomes.status, "percent")}</td></tr>)}</tbody></table></div>
        <p>Composition compares the retained cohort with its connected structured-record subset, using current-master attributes. Differences are percentage points, not electorate bias estimates. Zero is an observed count; withheld and unavailable are not zero.</p>
        {(["gender", "ageBand", "mandal"] as const).map((key) => {
          const partition = diagnostics.demographics[key];
          const title = key === "ageBand" ? "Age band" : key === "mandal" ? "Mandal" : "Gender";
          return <section key={key} className={styles.composition} aria-label={`${title} cohort composition`}><h3 className={styles.subheading}>{title} composition</h3><p>Status: {researchStatusLabel(partition.status)} · Retained cohort: {fieldworkValueLabel(partition.selectedBase, partition.status)} · Connected structured records: {fieldworkValueLabel(partition.structuredBase, partition.status)}</p>{partition.rows.length ? <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${title} composition table`}><table><thead><tr><th>Category</th><th>Retained cohort</th><th>Cohort share</th><th>Structured records</th><th>Structured share</th><th>Composition difference</th></tr></thead><tbody>{partition.rows.map((row) => <tr key={row.category}><th scope="row">{row.category}</th><td>{fieldworkValueLabel(row.selected, partition.status)}</td><td>{fieldworkValueLabel(row.selectedPct, partition.status, "percent")}</td><td>{fieldworkValueLabel(row.structured, partition.status)}</td><td>{fieldworkValueLabel(row.structuredPct, partition.status, "percent")}</td><td>{fieldworkValueLabel(row.differencePp, partition.status, "difference")}</td></tr>)}</tbody></table></div> : <p className={styles.note}>{partition.status === "WITHHELD" ? "Whole composition partition withheld; category labels and complementary values are not disclosed." : partition.status === "AVAILABLE" ? "No retained records in this filtered cohort." : "Composition source unavailable."}</p>}</section>;
        })}
        <ul>{diagnostics.limitations.map((item) => <li key={item}>{item}</li>)}</ul><h3 className={styles.subheading}>Coverage next actions</h3><ul>{diagnostics.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>}
      <details className={styles.details}><summary>Methodology, provenance and limitations</summary><ul>{current.checks.map((check) => <li key={check.id}><strong>{researchStatusLabel(check.status)}</strong> · {check.message}</li>)}</ul><dl><dt>Questionnaire</dt><dd>{current.sources.questionnaire.code || "Not recorded"} · version {current.sources.questionnaire.version ?? "Not recorded"}</dd><dt>Question content</dt><dd>{researchStatusLabel(current.sources.questionnaire.status)}</dd><dt>Weighting pipeline</dt><dd>{researchStatusLabel(current.methodology.weighting.status)}</dd><dt>Formal response rate</dt><dd>{researchStatusLabel(current.methodology.standardizedResponseRate)}</dd><dt>Latest stored evidence</dt><dd>{current.sources.latestEvidenceAt || "Not recorded"}</dd><dt>Report generated</dt><dd>{current.generatedAt}</dd></dl><ul>{current.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
      <details className={styles.details}><summary>Next research actions</summary><ol>{current.nextActions.map((item) => <li key={item}>{item}</li>)}</ol></details>
      <p className={styles.note}>Aggregate responding-cohort evidence only. No constituency vote-share estimate, participant score or automatic sign-off. Printable reports can be saved as PDF from your browser.</p>
    </> : <p>Research checks are not available.</p>}
  </section>;
}
