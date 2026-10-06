import type { RetrievedEvidence } from "./evidence";

export type EvidenceProviderClaim = {
  text: string;
  domain: string;
};

export type EvidenceProviderResult = {
  status: "available" | "no_results" | "unavailable";
  evidence: readonly RetrievedEvidence[];
  reason?: string;
};

export interface EvidenceProvider {
  readonly id: string;
  supports(claim: EvidenceProviderClaim): boolean;
  retrieve(claim: EvidenceProviderClaim): Promise<EvidenceProviderResult>;
}
