import assert from "node:assert/strict";
import test from "node:test";
import {
  isUuidRequestId,
  manualIntakeCaseFields,
  matchesAnalysisRequest,
  serializeCase,
} from "../src/lib/case-provenance.ts";

const uuid = "c0b8a910-0ee0-4db3-9c31-532e6b66cc6a";

const savedCase = (overrides: Record<string, unknown> = {}) => ({
  id: "case-1",
  claim: "claim text",
  context: "context",
  language: "العربية",
  status: "supported",
  confidence: 99,
  evidenceLevel: "مرتفع",
  summary: "model text",
  recommendedAction: "review",
  reviewerNote: "client-forged reviewer note",
  sourceIds: ["trusted-source"],
  sourceNotes: ["model source note"],
  evidence: [{ id: "excerpt-1", excerpt: "trusted excerpt" }],
  analysisMode: "ai",
  modeNote: "preliminary",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  reviewedAt: null,
  reviewedBy: null,
  analysisVerified: false,
  reviewValidated: false,
  ...overrides,
});

test("manual intake discards forged AI, status, citations, and reviewer fields", () => {
  const attackerInput = {
    claim: "claim text",
    context: "context",
    language: "العربية",
    workspaceId: "workspace-1",
    status: "supported",
    confidence: 100,
    evidenceLevel: "مرتفع",
    summary: "client-forged model result",
    sources: ["forged-source"],
    evidence: [{ excerpt: "forged excerpt" }],
    analysisMode: "ai",
    reviewedBy: "victim-user",
    analysisVerified: true,
    reviewValidated: true,
  };
  const accepted = manualIntakeCaseFields(attackerInput);
  assert.equal(accepted.status, "needs_review");
  assert.equal(accepted.confidence, 0);
  assert.equal(accepted.evidenceLevel, "غير كافٍ");
  assert.equal(accepted.summary, null);
  assert.deepEqual(accepted.sourceIds, []);
  assert.deepEqual(accepted.evidence, []);
  assert.equal(accepted.analysisMode, "local");
  assert.equal(accepted.analysisVerified, false);
  assert.equal(accepted.reviewValidated, false);
  assert.equal(accepted.analysisRequestId, null);
  assert.equal("reviewedBy" in accepted, false);
});

test("unvalidated legacy decisions are served as needs_review without unverified citations", () => {
  for (const status of ["supported", "insufficient"]) {
    const result = serializeCase(savedCase({ status }));
    assert.equal(result.status, "needs_review");
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.sourceNotes, []);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.reviewValidated, false);
    assert.equal(result.confidence, 0);
    assert.equal(result.evidenceLevel, "غير كافٍ");
    assert.equal(result.summary, undefined);
    assert.equal(result.analysisMode, "local");
    assert.equal(result.reviewerNote, undefined);
    assert.equal(result.reviewedBy, undefined);
  }
});

test("only verified analysis excerpts are served and are labelled preliminary", () => {
  const result = serializeCase(savedCase({ analysisVerified: true }));
  assert.deepEqual(result.sources, ["trusted-source"]);
  assert.match(result.sourceNotes[0], /أولية وغير معتمدة/);
  assert.deepEqual(result.evidence[0], {
    id: "excerpt-1",
    excerpt: "trusted excerpt",
    provenance: "preliminary",
  });
});

test("verified multilingual cases retain the selected language and expose only a mismatch flag", () => {
  const claim = "The hadith is authentic and reported by Bukhari.";
  const result = serializeCase(savedCase({
    claim,
    language: "العربية",
    analysisVerified: true,
  }));

  assert.equal(result.claim, claim);
  assert.equal(result.language, "العربية");
  assert.equal(result.languageMismatch, true);
  assert.equal("retrievalQuery" in result, false);
});

test("review validation preserves reviewer decision; request idempotency stays workspace-scoped", () => {
  const reviewed = serializeCase(savedCase({ reviewValidated: true }));
  assert.equal(reviewed.status, "supported");

  const existing = {
    workspaceId: "workspace-1",
    analysisRequestId: uuid,
    claim: "claim text",
    context: "context",
    language: "العربية",
  };
  assert.equal(matchesAnalysisRequest(existing, "workspace-1", uuid, "claim text", "context", "العربية"), true);
  assert.equal(matchesAnalysisRequest(existing, "workspace-2", uuid, "claim text", "context", "العربية"), false);
  assert.equal(matchesAnalysisRequest(existing, "workspace-1", uuid, "different claim", "context", "العربية"), false);
  assert.equal(isUuidRequestId(uuid), true);
  assert.equal(isUuidRequestId("not-a-uuid"), false);
});