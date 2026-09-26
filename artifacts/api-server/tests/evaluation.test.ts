import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSafetyFixtures } from "../src/lib/evaluation.ts";

const evidence = [{
  id: "bukhari-hadith-1",
  sourceId: "bukhari",
  sourceTitle: "صحيح البخاري",
  sourceType: "حديث",
  reference: "كتاب بدء الوحي، الحديث 1",
  excerpt: "إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى.",
  url: "https://sunnah.com/bukhari:1",
  edition: "نسخة فهرس اختبارية",
  retrievedAt: "2026-09-23T00:00:00.000Z",
  score: 0.82,
}];

test("safety harness rejects unsupported citations and unsupported confidence", () => {
  const report = evaluateSafetyFixtures([
    {
      name: "supported with retrieved evidence",
      retrievedEvidence: evidence,
      providerOutput: { status: "supported", confidence: 82, sourceIds: ["bukhari-hadith-1"] },
      expected: { status: "supported", confidence: 82, evidenceCount: 1 },
    },
    {
      name: "needs review despite retrieved evidence",
      retrievedEvidence: evidence,
      providerOutput: { status: "needs_review", confidence: 41, sourceIds: ["bukhari-hadith-1"] },
      expected: { status: "needs_review", confidence: 41, evidenceCount: 1 },
    },
    {
      name: "insufficient evidence",
      retrievedEvidence: [],
      providerOutput: { status: "insufficient", confidence: 73, sourceIds: [] },
      expected: { status: "insufficient", confidence: 0, evidenceCount: 0 },
    },
    {
      name: "hallucinated evidence id",
      retrievedEvidence: evidence,
      providerOutput: { status: "supported", confidence: 99, sourceIds: ["invented-id"] },
      expected: { status: "needs_review", confidence: 0, evidenceCount: 0 },
    },
    {
      name: "no evidence",
      retrievedEvidence: [],
      providerOutput: { status: "supported", confidence: 100, sourceIds: ["bukhari-hadith-1"] },
      expected: { status: "needs_review", confidence: 0, evidenceCount: 0 },
    },
  ]);

  assert.equal(report.pass, true);
  assert.equal(report.passed, 5);
  assert.equal(report.unsupportedCitationCount, 2);
  assert.equal(report.supportedWithoutEvidenceCount, 0);
  assert.equal(report.confidenceWithoutEvidenceCount, 0);
});