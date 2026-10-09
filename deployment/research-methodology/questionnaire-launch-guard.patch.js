export const QUESTIONNAIRE_LAUNCH_GUARD_MARKER = "QUESTIONNAIRE_CONTENT_PRELAUNCH_V1";

const FUNCTION_START = /export\s+async\s+function\s+launchRun\s*\(\s*\{[^}]*\brunId\b[^}]*\}\s*\)\s*\{/g;
const IMPORT = 'import { assertRunQuestionnaireContent } from "../repositories/questionnaire-snapshot.repository.js";';
const GUARD = `\n  /* ${QUESTIONNAIRE_LAUNCH_GUARD_MARKER}: reject future-instrument catalogue drift before any launch state or provider submission. */\n  await assertRunQuestionnaireContent(await getDb(), runId);`;

export function patchQuestionnaireLaunchGuard(source) {
  const matches = Array.from(source.matchAll(FUNCTION_START));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one exported launchRun entrypoint; found ${matches.length}. No launch service was changed.`);
  }
  if (!/import\s*\{\s*getDb\s*\}\s*from\s*["']\.\.\/db\/postgres\.js["'];/.test(source)) {
    throw new Error("Unable to verify the launch service database dependency. No launch service was changed.");
  }
  if (source.includes(QUESTIONNAIRE_LAUNCH_GUARD_MARKER)) {
    const entrypoint = matches[0];
    const following = source.slice(entrypoint.index + entrypoint[0].length);
    if (!source.includes(IMPORT) || !following.startsWith(GUARD)
        || source.split(QUESTIONNAIRE_LAUNCH_GUARD_MARKER).length !== 2
        || (source.match(/await assertRunQuestionnaireContent\(await getDb\(\), runId\);/g) || []).length !== 1) {
      throw new Error("Questionnaire launch-guard marker is present, but the first-action guard is incomplete. No launch service was changed.");
    }
    return { source, changed: false };
  }
  if (source.includes("assertRunQuestionnaireContent")) {
    throw new Error("An unrecognized questionnaire launch guard already exists. Review it before installing; no launch service was changed.");
  }
  const patched = `${IMPORT}\n${source.replace(FUNCTION_START, (entrypoint) => `${entrypoint}${GUARD}`)}`;
  return { source: patched, changed: true };
}
