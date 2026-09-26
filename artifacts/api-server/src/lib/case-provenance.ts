import { detectClaimLanguage } from "./multilingual-claim.ts";

export type CaseProvenanceShape = {
  id: string;
  claim: string;
  context: string;
  language: string;
  status: string;
  confidence: number;
  evidenceLevel: string;
  summary: string | null;
  recommendedAction: string | null;
  reviewerNote: string | null;
  sourceIds: string[];
  sourceNotes: string[];
  evidence: unknown[];
  analysisMode: string;
  modeNote: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  analysisVerified: boolean;
  reviewValidated: boolean;
};

export function isUuidRequestId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function manualIntakeProvenance() {
  return {
    status: "needs_review" as const,
    confidence: 0,
    evidenceLevel: "غير كافٍ",
    summary: null,
    recommendedAction: null,
    reviewerNote: null,
    sourceIds: [] as string[],
    sourceNotes: [] as string[],
    evidence: [] as unknown[],
    analysisMode: "local" as const,
    modeNote: "إدخال يدوي أولي؛ لم يُنفذ تحليل آلي ولم تتم مراجعة بشرية.",
    analysisVerified: false,
    reviewValidated: false,
    analysisRequestId: null,
  };
}

export function manualIntakeCaseFields(input: {
  claim: string;
  context: string;
  language: string;
  workspaceId: string;
}) {
  return {
    claim: input.claim,
    context: input.context,
    language: input.language,
    workspaceId: input.workspaceId,
    ...manualIntakeProvenance(),
  };
}

export function matchesAnalysisRequest(
  item: {
    workspaceId: string;
    analysisRequestId: string | null;
    claim: string;
    context: string;
    language: string;
  },
  workspaceId: string,
  requestId: string,
  claim: string,
  context: string,
  language: string,
): boolean {
  return item.workspaceId === workspaceId
    && item.analysisRequestId === requestId
    && item.claim === claim
    && item.context === context
    && item.language === language;
}

export function serializeCase(item: CaseProvenanceShape) {
  const analysisVerified = item.analysisVerified === true;
  const reviewValidated = item.reviewValidated === true;
  const status = reviewValidated
    ? item.status
    : item.status === "supported" || item.status === "insufficient"
      ? "needs_review"
      : item.status;
  const evidence = analysisVerified
    ? item.evidence.map((excerpt) => ({
        ...(typeof excerpt === "object" && excerpt !== null ? excerpt : { excerpt }),
        provenance: "preliminary",
      }))
    : [];
  return {
    id: item.id,
    claim: item.claim,
    context: item.context,
    language: item.language,
    languageMismatch: analysisVerified
      && detectClaimLanguage(item.claim, item.language) !== item.language,
    status,
    confidence: analysisVerified ? item.confidence : 0,
    evidenceLevel: analysisVerified ? item.evidenceLevel : "غير كافٍ",
    summary: analysisVerified ? item.summary ?? undefined : undefined,
    recommendedAction: analysisVerified ? item.recommendedAction ?? undefined : undefined,
    reviewerNote: reviewValidated ? item.reviewerNote ?? undefined : undefined,
    sources: analysisVerified ? item.sourceIds : [],
    sourceNotes: analysisVerified
      ? ["مصادر ومقتطفات التحليل آلية أولية وغير معتمدة.", ...item.sourceNotes]
      : [],
    evidence,
    analysisMode: analysisVerified ? item.analysisMode : "local",
    modeNote: analysisVerified
      ? item.modeNote
      : "الحالة غير موثقة بتحليل خادمي؛ مخرجاتها الآلية ومصادرها محجوبة.",
    createdAt: item.createdAt.toISOString(),
    reviewedAt: reviewValidated ? item.reviewedAt?.toISOString() : undefined,
    reviewedBy: reviewValidated ? item.reviewedBy ?? undefined : undefined,
    analysisVerified,
    reviewValidated,
    isSample: false,
  };
}