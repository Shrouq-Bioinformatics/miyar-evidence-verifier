import type { RetrievedEvidence } from "./evidence";
import { normalizeArabicForSearch } from "./alifta-source-client";

type HadithReference = {
  collection: "bukhari" | "muslim";
  number: number;
};

export type HadithReferenceCheck =
  | { kind: "match"; evidence: RetrievedEvidence[] }
  | { kind: "mismatch"; evidence: RetrievedEvidence[]; reason: string };

function normalizeClaimForComparison(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function duplicatesExplicitHadithReference(
  extractedClaim: string,
  explicitReference: string,
): boolean {
  const candidate = normalizeClaimForComparison(extractedClaim);
  const explicit = normalizeClaimForComparison(explicitReference);
  if (candidate.length < 4 || !explicit) return false;
  if (explicit.includes(candidate)) return true;

  const quoted =
    explicitReference.match(/«([^»]+)»/u)?.[1] ??
    explicitReference.match(/“([^”]+)”/u)?.[1] ??
    explicitReference.match(/"([^"]+)"/u)?.[1];
  if (!quoted) return false;
  const normalizedQuote = normalizeClaimForComparison(quoted);
  if (!normalizedQuote || !candidate.includes(normalizedQuote)) return false;

  const surroundingWords = candidate
    .replace(normalizedQuote, " ")
    .split(" ")
    .filter(Boolean);
  const attributionOnlyWords = new Set([
    "حديث",
    "الحديث",
    "قال",
    "رواه",
    "روى",
    "النبي",
    "الرسول",
    "صلى",
    "عليه",
    "وسلم",
    "البخاري",
    "مسلم",
  ]);
  return (
    surroundingWords.length <= 7 &&
    surroundingWords.every((word) => attributionOnlyWords.has(word))
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

function parseHadithReference(text: string): HadithReference | null {
  const numberMatch =
    /(?:برقم|رقم(?:\s+الحديث)?|حديث)\s*[:#]?\s*([0-9٠-٩۰-۹]+)/iu.exec(text);
  if (!numberMatch) return null;
  const number = Number(normalizeDigits(numberMatch[1]));
  if (!Number.isSafeInteger(number) || number < 1) return null;

  const normalized = normalizeArabicForSearch(text);
  const bukhariPosition = Math.max(
    normalized.lastIndexOf("البخاري"),
    normalized.lastIndexOf("bukhari"),
  );
  const muslimPosition = Math.max(
    normalized.lastIndexOf("مسلم"),
    normalized.lastIndexOf("muslim"),
  );
  if (bukhariPosition < 0 && muslimPosition < 0) return null;
  const numberPosition = numberMatch.index ?? 0;
  const collection =
    bukhariPosition < 0
      ? "muslim"
      : muslimPosition < 0
        ? "bukhari"
        : Math.abs(numberPosition - bukhariPosition) <=
            Math.abs(numberPosition - muslimPosition)
          ? "bukhari"
          : "muslim";

  return {
    collection,
    number,
  };
}

export function checkExplicitHadithReference(
  claimText: string,
  evidence: readonly RetrievedEvidence[],
): HadithReferenceCheck | null {
  const reference = parseHadithReference(claimText);
  if (!reference) return null;

  const hadithEvidence = evidence.filter((item) => item.sourceType === "hadith");
  if (hadithEvidence.length === 0) return null;
  const collectionEvidence = hadithEvidence.filter(
    (item) => item.hadithCollection === reference.collection,
  );

  if (collectionEvidence.length === 0) {
    const claimedTitle =
      reference.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم";
    return {
      kind: "mismatch",
      evidence: hadithEvidence.slice(0, 3),
      reason: `الإحالة تذكر ${claimedTitle} لكن النص المسترجع من المصدر يخص مجموعة أخرى؛ لم يُستخدم لإثبات الإحالة.`,
    };
  }

  const matching = collectionEvidence.filter(
    (item) => item.hadithNumber === reference.number,
  );
  if (matching.length > 0) {
    return { kind: "match", evidence: matching };
  }

  const sourceNumber = collectionEvidence[0]?.hadithNumber;
  const claimedTitle =
    reference.collection === "bukhari" ? "صحيح البخاري" : "صحيح مسلم";
  return {
    kind: "mismatch",
    evidence: collectionEvidence.slice(0, 3),
    reason:
      `الرقم ${reference.number} لا يطابق رقم السجل المباشر في HadithWeb` +
      (sourceNumber ? ` (${claimedTitle}، رقم ${sourceNumber})` : "") +
      ". يعرض مِعيار ترقيم هذا المصدر فقط؛ وقد تختلف الإحالات بين الطبعات.",
  };
}

export function requiresSeerahAuthenticationReview(claimText: string): boolean {
  const normalized = normalizeArabicForSearch(claimText).replace(/ة/g, "ه");
  const authenticationTerm =
    /(?:صحه|صحيح|صحح|ثبوت|ثابت|اثبت|يثبت|توثيق|موثق|ضعيف|ضعف|حسن|تحسين)/u.test(
      normalized,
    );
  const hadithContext =
    /(?:حديث|احاديث|اسناد|روايه|حديثيا|المحدثين|التخريج)/u.test(normalized);
  return authenticationTerm && hadithContext;
}
