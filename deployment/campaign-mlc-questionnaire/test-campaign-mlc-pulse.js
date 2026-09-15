import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const specification = JSON.parse(await readFile(path.join(packageRoot, "campaign-mlc-pulse-v1.json"), "utf8"));
assert.equal(specification.questions.length, 10);
assert.equal(new Set(specification.questions.map((question) => question.questionCode)).size, 10);
for (const [index, question] of specification.questions.entries()) {
  assert.equal(question.questionOrder, index + 1);
  assert.ok(question.questionText && question.questionTextTelugu);
  assert.ok(question.analysisCategory && question.outputVariables.length);
  if (question.questionType === "SINGLE_CHOICE") {
    assert.ok(question.options.length >= 4);
    assert.ok(question.options.every((option) => option.value && option.label));
  }
  assert.doesNotMatch(question.questionText, /vote\s+for|cast\s+your\s+vote|support\s+(Veeresh|BRS)/i);
}
for (const order of [4, 10]) {
  assert.equal(specification.questions[order - 1].requiredForCompletion, false);
}
const partyOptions = new Set(specification.questions[7].options.map((option) => option.value));
for (const group of ["BJP", "BRS", "Congress", "Left parties", "Independent or graduate group", "None", "Not enough information"]) {
  assert.ok(partyOptions.has(group));
}
console.log("Campaign MLC questionnaire draft tests passed.");
