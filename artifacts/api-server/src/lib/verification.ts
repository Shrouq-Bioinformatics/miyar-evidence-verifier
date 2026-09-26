import type { RetrievedEvidence } from "./evidence";

export type VerifyResult = {
  status: "supported" | "needs_review" | "insufficient";
  confidence: number;
  evidenceLevel: "مرتفع" | "جزئي" | "غير كافٍ";
  summary: string;
  recommendedAction: string;
  humanReviewReason: string;
  sourceIds: string[];
  sourceNotes: string[];
  evidence: RetrievedEvidence[];
  analysisMode: "ai" | "local";
  modeNote: string;
};

type ProviderResult = Partial<Omit<VerifyResult, "analysisMode" | "modeNote" | "evidence">>;

const PRELIMINARY_LIMITATION =
  "هذا فرز أولي مساعد للمراجعة: وجود الدليل أو ملخص المصدر لا يغني عن مراجعة اللفظ والسياق بواسطة مختص.";
const NO_EVIDENCE_LIMITATION =
  "لم يعثر مِعيار على دليل كافٍ ضمن المصادر المتاحة حاليًا. لا تعني هذه النتيجة أن المقولة صحيحة أو خاطئة، وقد تتطلب مراجعة مصادر إضافية أو مختص.";

function nonEmpty(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const withoutMarkdownUrls = value.replace(
    /\[([^\]]*)\]\((?:https?:\/\/|www\.)[^)]*\)/giu,
    "$1",
  );
  const sanitized = withoutMarkdownUrls
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/giu, "")
    .replace(/\s+([.,!?،؛؟])/gu, "$1")
    .trim();
  return sanitized || fallback;
}

export function localVerify(claim: string): VerifyResult {
  const namesSource =
    /(البخاري|صحيح\s+مسلم|(?:^|[\s،,.؟])مسلم(?:$|[\s،,.؟])|القرآن|القران|سورة|آية|ايه|رواه|\b\d{1,3}\s*:\s*\d{1,3}\b|bukhari|muslim|quran)/i.test(
      claim,
    );
  const isContemporary =
    /(حكم|فتوى|معاصر|العملات|التأمين|الذكاء الاصطناعي|العملات الرقمية|التلقيح|modern|ruling|fatwa|crypto)/i.test(
      claim,
    );
  const isSensitiveGeneralization =
    /(كل|جميع|دائمًا|ابداً|أبدًا).{0,24}(المسلمين|المسلمات|المتدينين|المتدينات|السنة|الشيعة|الصوفية)|(المسلمين|المسلمات|المتدينين|المتدينات|السنة|الشيعة|الصوفية).{0,24}(كلهم|جميعهم|دائمًا)/i.test(
      claim,
    );
  const needsReview = namesSource || isContemporary || isSensitiveGeneralization;

  let summary = "لا يمكن التحقق من المطالبة بالقواعد المحلية. هذه ليست نتيجة بحث في المصادر.";
  if (namesSource) {
    summary =
      "ورد اسم مصدر أو إحالة في النص، لكن لم تُجلب مادته ولم تُطابق المطالبة معه. ذكر المرجع لا يثبت صحة النسبة.";
  } else if (isSensitiveGeneralization) {
    summary =
      "رُصد تعميم حساس عن جماعة دينية. لا يجوز اعتباره حقيقة أو استنتاج سمات الأفراد منه، ويلزم تحريره ومراجعته بشريًا.";
  } else if (isContemporary) {
    summary = "رُصدت مسألة فقهية أو معاصرة تحتاج إلى مختص. لم يتم التحقق من أي دليل.";
  }

  return {
    status: needsReview ? "needs_review" : "insufficient",
    confidence: 0,
    evidenceLevel: "غير كافٍ",
    summary,
    recommendedAction: needsReview
      ? "أحِل المطالبة إلى مراجع شرعي أو جهة مختصة، واطلب إحالة محددة قابلة للفحص."
      : "اطلب من صاحب المحتوى مرجعًا محددًا أو لا تنشر الادعاء بصيغته الحالية.",
    humanReviewReason: isSensitiveGeneralization
      ? "المطالبة تعمم سمة حساسة على جماعة دينية، ولا يصح اعتماد هذا الاستنتاج آليًا."
      : needsReview
        ? "ذِكر مصدر أو موضوع فقهي لا يعوض استرجاع النص وفحصه بواسطة مختص."
        : "لا يوجد دليل محدد كافٍ، ولا ينبغي بناء استنتاج ديني على فرز آلي.",
    sourceIds: [],
    sourceNotes: [NO_EVIDENCE_LIMITATION],
    evidence: [],
    analysisMode: "local",
    modeNote:
      "فرز محلي أولي فقط: التحليل الذكي غير مستخدم، ولا توجد خدمة استرجاع مصادر متصلة.",
  };
}

export function normalizeProviderResult(
  input: unknown,
  retrievedEvidence: RetrievedEvidence[] = [],
): VerifyResult {
  const parsed =
    typeof input === "object" && input !== null ? (input as ProviderResult) : {};
  const providerStatus =
    parsed.status === "supported" ||
    parsed.status === "needs_review" ||
    parsed.status === "insufficient"
      ? parsed.status
      : "insufficient";
  const allowedEvidenceIds = new Set(retrievedEvidence.map((item) => item.id));
  const evidenceIds = Array.isArray(parsed.sourceIds)
    ? parsed.sourceIds.filter((id): id is string => typeof id === "string" && allowedEvidenceIds.has(id))
    : [];
  const acceptedEvidence = retrievedEvidence.filter((item) => evidenceIds.includes(item.id));
  const hasAcceptedEvidence = acceptedEvidence.length > 0;
  const status = providerStatus === "supported" && evidenceIds.length === 0
    ? "needs_review"
    : providerStatus;
  const providerSummary = nonEmpty(parsed.summary, "لم يقدم النموذج ملخصًا قابلًا للاستخدام.");
  const providerNotes = Array.isArray(parsed.sourceNotes)
    ? parsed.sourceNotes
        .filter((note): note is string => typeof note === "string" && Boolean(note.trim()))
        .map((note) => nonEmpty(note, ""))
        .filter(Boolean)
        .slice(0, 3)
        .map((note) => `ملاحظة أولية من النموذج: ${note.trim()}`)
    : [];

  return {
    status,
    confidence: hasAcceptedEvidence
      ? Math.max(0, Math.min(100, Math.round(typeof parsed.confidence === "number" ? parsed.confidence : 0)))
      : 0,
    evidenceLevel: hasAcceptedEvidence &&
      (parsed.evidenceLevel === "مرتفع" || parsed.evidenceLevel === "جزئي")
      ? parsed.evidenceLevel
      : "غير كافٍ",
    summary: `ملخص أولي من النموذج: ${providerSummary} ${
      hasAcceptedEvidence ? PRELIMINARY_LIMITATION : NO_EVIDENCE_LIMITATION
    }`,
    recommendedAction: nonEmpty(
      parsed.recommendedAction,
      "لا تعتمد النتيجة؛ استرجع النص المحدد وراجعه مع مختص قبل النشر.",
    ),
    humanReviewReason:
      providerStatus === "supported"
        ? "اقترح النموذج أنها مدعومة، وتوجد سجلات أدلة مسترجعة؛ خُفّضت دلالة النتيجة إلى اعتماد مشروط بمراجعة بشرية."
        : nonEmpty(
            parsed.humanReviewReason,
            "لا توجد نصوص مسترجعة مرتبطة بالمطالبة، وتحتاج النتيجة إلى مراجعة بشرية.",
          ),
    sourceIds: [...new Set(
      retrievedEvidence
        .filter((item) => evidenceIds.includes(item.id))
        .map((item) => item.sourceId),
    )],
    sourceNotes: [
      ...providerNotes,
      hasAcceptedEvidence
        ? `قُبلت ${acceptedEvidence.length} سجلات أدلة قابلة للتتبع من المصادر المسترجعة.`
        : "لم تُقبل إحالة من سجلات الأدلة المسترجعة؛ لا يثبت ذكر المصدر المطالبة.",
    ],
    evidence: acceptedEvidence,
    analysisMode: "ai",
    modeNote:
      "استخدم النموذج مع مقتطفات مسترجعة للفرز الأولي فقط. درجة الثقة تقدير غير مُعاير وليست نتيجة دقة علمية.",
  };
}