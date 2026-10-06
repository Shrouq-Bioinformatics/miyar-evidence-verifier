import OpenAI from "openai";
import {
  retrieveEvidence,
  retrieveQuranEvidenceByReference,
  type RetrievedEvidence,
} from "./evidence";
import type { EvidenceProviderClaim } from "./evidence-provider";
import { evidenceProviders } from "./evidence-providers";
import {
  checkExplicitHadithReference,
  duplicatesExplicitHadithReference,
  requiresSeerahAuthenticationReview,
} from "./source-safety";

type Domain =
  | "القرآن"
  | "التفسير"
  | "الحديث"
  | "العقيدة"
  | "الفقه"
  | "السيرة"
  | "الشبهات"
  | "المصطلحات"
  | "غير محدد";

type ExtractedClaim = {
  text: string;
  domain: Domain;
};

type ClaimEvaluation = {
  status: "supported" | "insufficient" | "mismatch" | "needs_review";
  reason: string;
  evidenceIndexes: number[];
};

class InvalidStructuredOutputError extends Error {
  constructor() {
    super("OpenAI returned malformed structured output");
    this.name = "InvalidStructuredOutputError";
  }
}

const domains: Domain[] = [
  "القرآن",
  "التفسير",
  "الحديث",
  "العقيدة",
  "الفقه",
  "السيرة",
  "الشبهات",
  "المصطلحات",
  "غير محدد",
];

const extractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "domain"],
        properties: {
          text: { type: "string", minLength: 2, maxLength: 1200 },
          domain: { type: "string", enum: domains },
        },
      },
    },
  },
};

const evaluationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reason", "evidenceIndexes"],
  properties: {
    status: {
      type: "string",
      enum: ["supported", "insufficient", "mismatch", "needs_review"],
    },
    reason: { type: "string", minLength: 2, maxLength: 800 },
    evidenceIndexes: {
      type: "array",
      maxItems: 3,
      items: { type: "integer", minimum: 0, maximum: 2 },
    },
  },
};

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI is not configured");
  }
  return new OpenAI({
    apiKey,
    timeout: 20_000,
    maxRetries: 1,
  });
}

function outputJson<T>(
  client: OpenAI,
  schemaName: string,
  schema: Record<string, unknown>,
  systemPrompt: string,
  input: unknown,
  validate: (value: unknown) => T,
  maxCompletionTokens = 1800,
): Promise<T> {
  return (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          max_completion_tokens: maxCompletionTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema,
            },
          },
        });
        const content = response.choices[0]?.message?.content;
        if (!content) throw new InvalidStructuredOutputError();
        let value: unknown;
        try {
          value = JSON.parse(content);
        } catch {
          throw new InvalidStructuredOutputError();
        }
        return validate(value);
      } catch (error) {
        if (!(error instanceof InvalidStructuredOutputError)) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof InvalidStructuredOutputError
      ? lastError
      : new InvalidStructuredOutputError();
  })();
}

async function extractClaims(
  client: OpenAI,
  content: string,
): Promise<ExtractedClaim[]> {
  return outputJson<ExtractedClaim[]>(
    client,
    "miyar_claim_extraction",
    extractSchema,
    [
      "استخرج الادعاءات الإسلامية المحددة والقابلة للتحقق فقط من النص.",
      "لا تجب عن الادعاءات ولا تؤلف محتوى جديدًا.",
      "أعد نص كل ادعاء كاقتباس حرفي متصل من النص الأصلي؛ لا تصحح الإملاء ولا تبدل الأسماء أو الأرقام أو الإحالات.",
      "حافظ على النفي والتعميم ونسبة القول والمذهب والعالم والمرجع كما وردت.",
      "لا تقسّم الادعاء الواحد إلى أجزاء تفقد سياقه. أعد مصفوفة فارغة إن لم يوجد ادعاء قابل للتحقق.",
      "صنّف المجال بإحدى القيم العربية المحددة في المخطط فقط.",
    ].join(" "),
    { originalContent: content },
    (value) => {
      if (typeof value !== "object" || value === null || !("claims" in value)) {
        throw new InvalidStructuredOutputError();
      }
      const rawClaims = (value as { claims: unknown }).claims;
      if (!Array.isArray(rawClaims) || rawClaims.length > 12) {
        throw new InvalidStructuredOutputError();
      }
      return rawClaims.map((rawClaim): ExtractedClaim => {
        if (typeof rawClaim !== "object" || rawClaim === null) {
          throw new InvalidStructuredOutputError();
        }
        const candidate = rawClaim as Record<string, unknown>;
        if (
          typeof candidate.text !== "string" ||
          !content.includes(candidate.text) ||
          typeof candidate.domain !== "string" ||
          !domains.includes(candidate.domain as Domain)
        ) {
          throw new InvalidStructuredOutputError();
        }
        return {
          text: candidate.text,
          domain: candidate.domain as Domain,
        };
      });
    },
    5000,
  );
}

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/gu, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
    )
    .replace(/[۰-۹]/gu, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
    );
}

function parseQuranReference(
  claim: string,
): { surah: string | number; ayah: number } | null {
  const normalized = normalizeDigits(claim);
  const numeric = /(?:سورة|surah|sura)?\s*(\d{1,3})\s*[:/]\s*(\d{1,3})/iu.exec(
    normalized,
  );
  if (numeric) {
    return { surah: Number(numeric[1]), ayah: Number(numeric[2]) };
  }
  const named = /(?:سورة|surah|sura)\s+(.+?)\s+(?:الآية|آية|ayah|verse)\s*(\d{1,3})(?!\d)/iu.exec(
    normalized,
  );
  if (named) {
    return { surah: named[1].trim(), ayah: Number(named[2]) };
  }
  return null;
}

function findExplicitHadithReferenceClaims(content: string): ExtractedClaim[] {
  const pattern =
    /[^.!؟\n]*(?:صحيح\s+)?(?:البخاري|مسلم)[^.!؟\n]*(?:برقم|رقم|حديث)\s*[0-9٠-٩۰-۹]+[^.!؟\n]*[.!؟]?/giu;
  return [...content.matchAll(pattern)]
    .map((match) => match[0].trim())
    .filter(Boolean)
    .map((text) => ({ text, domain: "الحديث" }));
}

function enforceExplicitFiqhDomain(claim: ExtractedClaim): ExtractedClaim {
  if (
    /(?:الفقه|فقهي|المذهب|المذاهب|عند الحنفية|عند المالكية|عند الشافعية|عند الحنابلة|مختصر القدوري)/u.test(
      claim.text,
    )
  ) {
    return { ...claim, domain: "الفقه" };
  }
  return claim;
}

function getRetrievedEvidence(claim: ExtractedClaim): RetrievedEvidence[] {
  if (claim.domain === "التفسير") return [];

  if (claim.domain === "القرآن" || /(?:القرآن|قرآن|سورة|آية|الآية|quran|surah)/iu.test(claim.text)) {
    const reference = parseQuranReference(claim.text);
    if (reference) {
      const exact = retrieveQuranEvidenceByReference(reference.surah, reference.ayah);
      if (exact) return [exact];
      return [];
    }
  }

  if (claim.domain !== "القرآن") return [];
  return retrieveEvidence(claim.text).filter((item) => item.sourceType === "quran");
}

function evidenceMatchesDomain(item: RetrievedEvidence, domain: Domain): boolean {
  const sourceTypeByDomain: Partial<Record<Domain, string>> = {
    "القرآن": "quran",
    "التفسير": "tafsir",
    "الحديث": "hadith",
    "السيرة": "seerah",
  };
  return item.sourceType === sourceTypeByDomain[domain];
}

async function retrieveEvidenceForClaim(
  claim: ExtractedClaim,
): Promise<RetrievedEvidence[]> {
  const retrieved = getRetrievedEvidence(claim);
  const providerClaim: EvidenceProviderClaim = {
    text: claim.text,
    domain: claim.domain,
  };

  for (const provider of evidenceProviders) {
    try {
      if (!provider.supports(providerClaim)) continue;
      const result = await provider.retrieve(providerClaim);
      retrieved.push(...result.evidence);
    } catch {
      // A source failure must not make the public verification endpoint fail.
    }
  }

  const seen = new Set<string>();
  return retrieved.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return evidenceMatchesDomain(item, claim.domain);
  });
}

async function evaluateEvidence(
  client: OpenAI,
  claim: ExtractedClaim,
  evidence: readonly RetrievedEvidence[],
): Promise<ClaimEvaluation> {
  return outputJson<ClaimEvaluation>(
    client,
    "miyar_evidence_evaluation",
    evaluationSchema,
    [
      "قارن الادعاء بالنصوص المسترجعة فقط. لا تستخدم معرفتك السابقة ولا تعتبر إجابة النموذج دليلًا.",
      "لا تصف الادعاء بموثق إلا إذا كان نص مصدر مسترجع محدد يدعمه مباشرة ويحفظ نطاقه ونسبته وإحالته.",
      "المصدر المرتبط بالموضوع لا يكفي. لا يحول ورود خبر في السيرة إلى تصحيح حديثي، ولا يحول تعريف المصطلح إلى حكم فقهي، ولا يثبت مصدر واحد إجماعًا أو تعميمًا.",
      "إذا كانت الإحالة الصريحة لا تطابق النص المسترجع، اختر mismatch. إذا لم يثبت النص الادعاء، اختر insufficient. عند الحاجة إلى تقدير شرعي أو سياق بشري اختر needs_review.",
      "evidenceIndexes هي فهارس النصوص التي تدعم السبب مباشرة، وتبدأ من صفر. لا تختر أي سجل غير مسترجع.",
      "اكتب reason بالعربية، بدقة، ولا تذكر نتيجة لا تسندها النصوص.",
    ].join(" "),
    {
      claim: claim.text,
      domain: claim.domain,
      evidence: evidence.map((item, index) => ({
        index,
        sourceTitle: item.sourceTitle,
        locator: item.reference,
        excerpt: item.excerpt ?? item.tafsirText ?? "",
      })),
    },
    (value) => {
      if (typeof value !== "object" || value === null) {
        throw new InvalidStructuredOutputError();
      }
      const candidate = value as Record<string, unknown>;
      if (
        !["supported", "insufficient", "mismatch", "needs_review"].includes(
          String(candidate.status),
        ) ||
        typeof candidate.reason !== "string" ||
        !Array.isArray(candidate.evidenceIndexes) ||
        candidate.evidenceIndexes.some(
          (index) =>
            !Number.isInteger(index) || Number(index) < 0 || Number(index) > 2,
        )
      ) {
        throw new InvalidStructuredOutputError();
      }
      return {
        status: candidate.status as ClaimEvaluation["status"],
        reason: candidate.reason,
        evidenceIndexes: candidate.evidenceIndexes as number[],
      };
    },
  );
}

function publicEvidence(item: RetrievedEvidence) {
  const isQuran = item.sourceType === "quran";
  const isTafsir = item.sourceType === "tafsir";
  return {
    sourceTitle: isQuran
      ? "القرآن الكريم — Tanzil"
      : isTafsir
        ? `${item.sourceName ?? item.sourceTitle} — ${item.edition}`
        : item.sourceType === "hadith" || item.sourceType === "seerah"
          ? `${item.sourceTitle} — ${item.sourceName ?? "مصدر مباشر"}`
          : item.sourceTitle,
    locator:
      isQuran && item.surahName && item.ayahNumber
        ? `سورة ${item.surahName}، الآية ${item.ayahNumber}`
        : item.reference,
    excerpt: item.excerpt ?? item.tafsirText ?? "",
    url: item.url || null,
  };
}

function fallbackClaim(content: string) {
  return {
    id: "claim-1",
    text: content,
    status: "needs_review" as const,
    reason:
      "تعذر استخراج ادعاءات قابلة للتحقق بثقة من النص؛ يلزم تقسيمه ومراجعته بشريًا.",
    domain: "غير محدد" as const,
    evidence: [],
  };
}

function resultSummary(counts: {
  supported: number;
  insufficient: number;
  mismatch: number;
  needsReview: number;
}): string {
  const total =
    counts.supported +
    counts.insufficient +
    counts.mismatch +
    counts.needsReview;
  if (total === 0) {
    return "لم يجد مِعيار ادعاءً محددًا قابلًا للتحقق في النص المرسل.";
  }
  return `اكتمل فحص ${total} ادعاء: ${counts.supported} موثق، ${counts.insufficient} بدليل غير كافٍ، ${counts.mismatch} بإحالة متعارضة، و${counts.needsReview} يحتاج إلى مراجعة بشرية.`;
}

export async function verifyPublicContent(content: string) {
  const client = getOpenAIClient();
  let extractedClaims: ExtractedClaim[] = [];
  let extractionFailed = false;
  try {
    extractedClaims = await extractClaims(client, content);
  } catch (error) {
    if (!(error instanceof InvalidStructuredOutputError)) throw error;
    extractionFailed = true;
  }

  const claimsByText = new Map<string, ExtractedClaim>();
  const explicitHadithClaims = findExplicitHadithReferenceClaims(content);
  for (const claim of explicitHadithClaims) {
    if (!claimsByText.has(claim.text)) claimsByText.set(claim.text, claim);
  }
  for (const extracted of extractedClaims.map(enforceExplicitFiqhDomain)) {
    if (
      extracted.domain === "الحديث" &&
      explicitHadithClaims.some((reference) =>
        duplicatesExplicitHadithReference(extracted.text, reference.text),
      )
    ) {
      continue;
    }
    if (!claimsByText.has(extracted.text)) {
      claimsByText.set(extracted.text, extracted);
    }
  }
  const claimsToVerify = [...claimsByText.values()];
  if (claimsToVerify.length === 0 && extractionFailed && content.trim()) {
    const fallback = fallbackClaim(content);
    return {
      status: "COMPLETE" as const,
      originalContent: content,
      summary: "تعذر تحليل النص آليًا؛ أُحيل إلى المراجعة البشرية دون اختلاق دليل.",
      claims: [fallback],
      counts: { supported: 0, insufficient: 0, mismatch: 0, needsReview: 1 },
    };
  }

  const claims = await Promise.all(
    claimsToVerify.map(async (claim, index) => {
      const retrieved = await retrieveEvidenceForClaim(claim);
      const id = `claim-${index + 1}`;
      if (retrieved.length === 0) {
        return {
          id,
          text: claim.text,
          status: "insufficient" as const,
          reason: claim.domain === "القرآن"
            ? "لم يجد مِعيار نصًا مسترجعًا مطابقًا لهذه الإحالة في نص القرآن المعتمد."
            : claim.domain === "الحديث"
              ? "لم يُسترجع نص مطابق من صحيح البخاري أو صحيح مسلم؛ لم يُستبدل الرقم ولم يُستنتج تصحيح الحديث."
              : claim.domain === "التفسير"
                ? "لم يُسترجع نص تفسير مطابق من QuranEnc؛ ولا يكفي نص الآية وحده لإثبات تفسيرها."
              : claim.domain === "السيرة"
                ? "لم يُسترجع موضع مطابق من نص السيرة النبوية لابن هشام؛ ولا يثبت نص السيرة صحة الحديث."
                : "المصدر المعتمد لهذا المجال غير متصل في النسخة الحالية، لذلك لا يتوفر دليل مسترجع لهذا الادعاء.",
          domain: claim.domain,
          evidence: [],
        };
      }

      const hadithReferenceCheck = checkExplicitHadithReference(
        claim.text,
        retrieved,
      );
      if (hadithReferenceCheck?.kind === "mismatch") {
        return {
          id,
          text: claim.text,
          status: "mismatch" as const,
          reason: hadithReferenceCheck.reason,
          domain: claim.domain,
          evidence: hadithReferenceCheck.evidence
            .slice(0, 3)
            .map(publicEvidence),
        };
      }
      const evaluationEvidence =
        hadithReferenceCheck?.kind === "match"
          ? hadithReferenceCheck.evidence
          : retrieved;

      if (
        claim.domain === "السيرة" &&
        requiresSeerahAuthenticationReview(claim.text)
      ) {
        return {
          id,
          text: claim.text,
          status: "needs_review" as const,
          reason:
            "وجود الخبر في مصدر السيرة يثبت وروده في ذلك النص فقط؛ ولا يكفي لتصحيح الحديث أو الحكم على إسناده.",
          domain: claim.domain,
          evidence: retrieved.slice(0, 3).map(publicEvidence),
        };
      }

      let evaluation: ClaimEvaluation;
      try {
        evaluation = await evaluateEvidence(
          client,
          claim,
          evaluationEvidence.slice(0, 3),
        );
      } catch (error) {
        if (!(error instanceof InvalidStructuredOutputError)) throw error;
        return {
          id,
          text: claim.text,
          status: "needs_review" as const,
          reason: "تعذر تقييم صلة النص المسترجع بالادعاء؛ لم يُصنّف الادعاء على أنه موثق.",
          domain: claim.domain,
          evidence: [],
        };
      }
      const selectedEvidence = evaluation.evidenceIndexes
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < evaluationEvidence.length,
        )
        .map((value) => evaluationEvidence[value])
        .filter((item) => Boolean(item?.excerpt || item?.tafsirText));
      const status =
        evaluation.status === "supported" && selectedEvidence.length === 0
          ? "needs_review"
          : evaluation.status;
      return {
        id,
        text: claim.text,
        status,
        reason:
          status === "needs_review" && evaluation.status === "supported"
            ? "لم يحدد التقييم نصًا مسترجعًا يدعم النتيجة؛ يلزم فحص بشري."
            : evaluation.reason,
        domain: claim.domain,
        evidence: selectedEvidence.map(publicEvidence),
      };
    }),
  );

  const counts = {
    supported: claims.filter((claim) => claim.status === "supported").length,
    insufficient: claims.filter((claim) => claim.status === "insufficient").length,
    mismatch: claims.filter((claim) => claim.status === "mismatch").length,
    needsReview: claims.filter((claim) => claim.status === "needs_review").length,
  };
  return {
    status: "COMPLETE" as const,
    originalContent: content,
    summary: resultSummary(counts),
    claims,
    counts,
  };
}
