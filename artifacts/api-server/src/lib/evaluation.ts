import type { RetrievedEvidence } from "./evidence.ts";
import { normalizeProviderResult, type VerifyResult } from "./verification.ts";

export type SafetyFixture = {
  name: string;
  retrievedEvidence: RetrievedEvidence[];
  providerOutput: unknown;
  expected: {
    status: VerifyResult["status"];
    confidence: number;
    evidenceCount: number;
  };
};

export type SafetyEvaluation = {
  total: number;
  passed: number;
  failed: number;
  unsupportedCitationCount: number;
  supportedWithoutEvidenceCount: number;
  confidenceWithoutEvidenceCount: number;
  pass: boolean;
  results: Array<{
    name: string;
    pass: boolean;
    actual: Pick<VerifyResult, "status" | "confidence"> & { evidenceCount: number };
  }>;
};

export function evaluateSafetyFixtures(fixtures: SafetyFixture[]): SafetyEvaluation {
  let unsupportedCitationCount = 0;
  let supportedWithoutEvidenceCount = 0;
  let confidenceWithoutEvidenceCount = 0;
  const results = fixtures.map((fixture) => {
    const normalized = normalizeProviderResult(
      fixture.providerOutput,
      fixture.retrievedEvidence,
    );
    const actual = {
      status: normalized.status,
      confidence: normalized.confidence,
      evidenceCount: normalized.evidence.length,
    };
    if (
      Array.isArray((fixture.providerOutput as { sourceIds?: unknown } | null)?.sourceIds)
      && ((fixture.providerOutput as { sourceIds: unknown[] }).sourceIds.some(
        (id) => typeof id === "string" && !fixture.retrievedEvidence.some((item) => item.id === id),
      ))
    ) {
      unsupportedCitationCount += 1;
    }
    if (normalized.status === "supported" && normalized.evidence.length === 0) {
      supportedWithoutEvidenceCount += 1;
    }
    if (!fixture.retrievedEvidence.length && normalized.confidence !== 0) {
      confidenceWithoutEvidenceCount += 1;
    }
    const pass =
      normalized.status === fixture.expected.status
      && normalized.confidence === fixture.expected.confidence
      && normalized.evidence.length === fixture.expected.evidenceCount;
    return { name: fixture.name, pass, actual };
  });
  const passed = results.filter((result) => result.pass).length;
  return {
    total: fixtures.length,
    passed,
    failed: fixtures.length - passed,
    unsupportedCitationCount,
    supportedWithoutEvidenceCount,
    confidenceWithoutEvidenceCount,
    pass: passed === fixtures.length
      && supportedWithoutEvidenceCount === 0
      && confidenceWithoutEvidenceCount === 0,
    results,
  };
}