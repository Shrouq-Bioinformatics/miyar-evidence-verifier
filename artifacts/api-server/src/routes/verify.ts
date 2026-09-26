import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, workspaceAuditLog, workspaceCases } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  normalizeProviderResult,
} from "../lib/verification";
import {
  createProviderAvailabilityMonitor, requestWithProviderFallback,
  resolveAIProviderConfigs, shouldFallbackForAvailability,
} from "../lib/ai-provider";
import {
  retrieveEvidenceWithSourceRouting,
} from "../lib/source-routing";
import {
  ArabicRetrievalQueryError,
  detectClaimLanguage,
  generateArabicRetrievalQuery,
  type ClaimLanguage,
} from "../lib/multilingual-claim.ts";
import type { AuthenticatedRequest } from "../middlewares/auth";
import { roleInWorkspace } from "../lib/workspaces";
import { isUuidRequestId, matchesAnalysisRequest, serializeCase } from "../lib/case-provenance";

type VerifyBody = {
  claim?: unknown;
  context?: unknown;
  language?: unknown;
  workspaceId?: unknown;
  requestId?: unknown;
};

const router: IRouter = Router();

const allowedContexts = new Set([
  "محتوى دعوي",
  "مادة تربوية",
  "سؤال معاصر",
  "منشور اجتماعي",
  "بحث أكاديمي",
]);
const allowedLanguages = new Set(["العربية", "English", "Français"]);
const MAX_CLAIM_LENGTH = 4_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const availabilityMonitor = createProviderAvailabilityMonitor();

router.get("/verify/status", async (_req, res) => {
  const providers = resolveAIProviderConfigs(process.env);
  let activeProvider = providers[0] ?? null;
  let availability = await availabilityMonitor.get(null);

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    activeProvider = provider;
    availability = await availabilityMonitor.get(provider);
    const nextProvider = providers[index + 1];
    if (
      availability.state === "available" ||
      provider.connection !== "replit_managed_openai" ||
      nextProvider?.connection !== "direct_openai" ||
      !shouldFallbackForAvailability(availability.state)
    ) {
      break;
    }
  }

  res.set("Cache-Control", "no-store");
  res.json({
    service: "preliminary_triage",
    providerConfigured: providers.length > 0,
    providerConnection: activeProvider?.connection ?? "unconfigured",
    availability,
    sourceRetrievalConnected: true,
    canScientificallyVerify: false,
  });
});

router.post("/verify", async (req, res): Promise<void> => {
  if (
    typeof req.body !== "object" ||
    req.body === null ||
    Array.isArray(req.body)
  ) {
    res.status(400).json({ error: "يجب إرسال جسم JSON صالح على هيئة كائن." });
    return;
  }
  const body = req.body as VerifyBody;
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    res.status(401).json({ error: "يلزم تسجيل الدخول للتحليل." });
    return;
  }
  const workspaceId = body.workspaceId === undefined ? userId : body.workspaceId;
  if (typeof workspaceId !== "string") {
    res.status(400).json({ error: "مساحة العمل غير صالحة." });
    return;
  }
  if (!isUuidRequestId(body.requestId)) {
    res.status(400).json({ error: "يلزم إرسال requestId صالح بصيغة UUID." });
    return;
  }
  const requestId = body.requestId.toLowerCase();
  const claim = typeof body.claim === "string" ? body.claim : "";
  const context = body.context === undefined ? "محتوى دعوي" : body.context;
  const language = body.language === undefined ? "العربية" : body.language;

  if (claim.trim().length < 8) {
    res.status(400).json({ error: "يجب أن تحتوي المطالبة على ثمانية أحرف على الأقل." });
    return;
  }
  if (claim.length > MAX_CLAIM_LENGTH) {
    res.status(413).json({ error: "المطالبة طويلة جدًا؛ الحد الأقصى 4000 حرف." });
    return;
  }
  if (typeof context !== "string" || !allowedContexts.has(context)) {
    res.status(400).json({ error: "قيمة السياق غير مدعومة." });
    return;
  }
  if (typeof language !== "string" || !allowedLanguages.has(language)) {
    res.status(400).json({ error: "قيمة اللغة غير مدعومة." });
    return;
  }
  const detectedLanguage = detectClaimLanguage(claim, language);

  // Resolve access before looking up or invoking the analysis provider.
  if (!await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const existingRequest = await db.select().from(workspaceCases).where(and(
    eq(workspaceCases.workspaceId, workspaceId),
    eq(workspaceCases.analysisRequestId, requestId),
  )).limit(1);
  if (existingRequest[0]) {
    if (!matchesAnalysisRequest(existingRequest[0], workspaceId, requestId, claim, context, language)) {
      res.status(409).json({ error: "استُخدم requestId نفسه لمطالبة مختلفة ضمن مساحة العمل." });
      return;
    }
    res.json({ case: serializeCase(existingRequest[0]) });
    return;
  }

  const providers = resolveAIProviderConfigs(process.env);
  if (providers.length === 0) {
    logger.error("No valid OpenAI provider configuration; refusing to present local analysis as complete AI");
    res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير مهيأة. يلزم إعداد المزود قبل استخدام التحليل.",
      code: "AI_NOT_CONFIGURED",
    });
    return;
  }

  let retrievalQuery: string;
  try {
    retrievalQuery = await generateArabicRetrievalQuery(
      claim,
      detectedLanguage as ClaimLanguage,
      providers,
    );
  } catch (error) {
    const reason = error instanceof ArabicRetrievalQueryError
      ? error.reason
      : "request_failed";
    req.log.warn({ reason }, "Could not prepare a safe retrieval query; no case was saved");
    res.status(502).json({
      code: "ARABIC_RETRIEVAL_UNAVAILABLE",
      error: "تعذر تجهيز البحث لهذه المطالبة حاليًا. لم تُحفظ النتيجة؛ حاول مرة أخرى.",
    });
    return;
  }

  const directProvider = providers.find(
    (provider) => provider.connection === "direct_openai",
  ) ?? null;
  const evidenceRetrieval = await retrieveEvidenceWithSourceRouting({
    claim,
    retrievalQuery,
    context,
    language: detectedLanguage,
    provider: directProvider,
  });
  const { local: quranRetrieval, external: externalRetrieval, routing } =
    evidenceRetrieval;
  if (quranRetrieval.tafsir.status === "unavailable") {
    req.log.warn(
      { reason: quranRetrieval.tafsir.reason },
      "QuranEnc tafsir unavailable; continuing with retrieved local Quran evidence",
    );
  }
  if (routing.fallbackUsed) {
    req.log.warn(
      {
        routingCategories: routing.categories,
        routingConfidence: routing.confidence,
        selectedDomains: routing.selectedDomains,
      },
      "Source classifier fell back to the broad approved-domain route",
    );
  }
  if (externalRetrieval.status === "unavailable") {
    req.log.warn(
      {
        reason: externalRetrieval.reason,
        httpStatus: externalRetrieval.httpStatus,
      },
      "Approved-domain web search unavailable; continuing with retrieved local evidence",
    );
  }
  if (providers.length === 0) {
    logger.error("No valid OpenAI provider configuration; refusing to present local analysis as complete AI");
    res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير مهيأة. يلزم إعداد المزود قبل استخدام التحليل.",
      code: "AI_NOT_CONFIGURED",
    });
    return;
  }

  const retrievedEvidence = evidenceRetrieval.retrievedEvidence;
  const systemPrompt = [
    "أنت محرك فرز وتحقق أولي لمحتوى إسلامي. لا تصدر فتوى ولا تنسب حكمًا شرعيًا من عندك.",
    "سجلات retrievedEvidence هي الأدلة الوحيدة المسموح لك بإسناد النتيجة إليها. لا تخترع نصًا أو مرجعًا أو رابطًا.",
    "افصل بين مجموعات الأدلة quran وtafsir وexternal_web وحديث. Quran هو نص Tanzil الأصلي، وtafsir شرح تفسيري من مصدر مستقل وليس قرآنًا ولا يجوز اقتباسه أو عرضه كنص قرآني.",
    "الأدلة الحديثية المحلية من البخاري ومسلم مقتطفات تجريبية محدودة وليست تغطية كاملة للكتابين.",
    "سجلات external_web مواد مسترجعة من نطاق معتمد؛ ملخصها مولّد وليس اقتباسًا حرفيًا من الصفحة.",
    "سجلات collective_fiqh_resolution توثق موقفًا جماعيًا للمجمع في سياق القرار؛ لا تعتبر وجود القرار وحده إثباتًا لصحة الادعاء أو انطباقه، وقيّم نطاقه وتاريخه وسياقه مع استمرار المراجعة البشرية.",
    "اختر supported فقط إذا كان سجل مسترجع يطابق معنى المطالبة مباشرة، مع بقاء المراجعة البشرية مطلوبة.",
    "اختر needs_review للمسائل الفقهية أو المعاصرة أو الحساسة، حتى لو وجدت إشارة جزئية.",
    "لا تستنتج تدين الشخص أو مذهبه أو أي سمة دينية حساسة.",
    "أعد JSON صالحًا فقط بالمفاتيح: status, confidence, evidenceLevel, summary, recommendedAction, humanReviewReason, sourceIds, sourceNotes.",
    'status يجب أن يكون supported أو needs_review أو insufficient.',
    "confidence رقم صحيح من 0 إلى 100. evidenceLevel إحدى: مرتفع، جزئي، غير كافٍ.",
    "sourceIds يجب أن تكون قيم id من سجلات retrievedEvidence فقط. لا تكتب روابط أو مراجع جديدة؛ الرابط الصحيح موجود في سجل الدليل نفسه.",
    "إذا لم توجد مطابقة مباشرة في الأدلة، اختر insufficient أو needs_review ولا تستخدم اسم الكتاب كدليل.",
    `The detected claim language is ${detectedLanguage}. Write summary, recommendedAction, humanReviewReason, and sourceNotes in that language. Evaluate the original user claim directly; any internal retrieval aid is not evidence. Keep source titles and excerpts in their authoritative original language. Do not mention internal source-routing categories, selected domains, confidence values, or retrieval-query wording in user-facing fields.`,
  ].join("\n");

  const userPrompt = JSON.stringify({
    claim,
    context,
    language: detectedLanguage,
    retrievedEvidence,
  });

  let result: ReturnType<typeof normalizeProviderResult>;
  const requestBody = JSON.stringify({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    max_completion_tokens: 900,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const requestResult = await requestWithProviderFallback(providers, (provider) =>
    fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      body: requestBody,
    }),
  );

  if (!requestResult) {
    res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير مهيأة. يلزم إعداد المزود قبل استخدام التحليل.",
      code: "AI_NOT_CONFIGURED",
    });
    return;
  }

  for (const failure of requestResult.failures) {
    availabilityMonitor.record(failure.provider, failure.state);
  }

  if (requestResult.kind === "failure") {
    const state = requestResult.state;
    req.log.error({ provider: requestResult.provider.connection, state }, "OpenAI verification request failed");
    const issue = state === "auth_failed"
      ? { status: 502, code: "AI_AUTH_FAILED", error: "رفض مزود التحليل بيانات الاعتماد؛ يلزم تصحيح إعداد الاتصال." }
      : state === "rate_limited"
        ? { status: 503, code: "AI_RATE_LIMITED", error: "بلغ مزود التحليل حد الطلبات؛ حاول لاحقًا." }
        : state === "timeout"
          ? { status: 504, code: "AI_TIMEOUT", error: "انتهت مهلة مزود التحليل؛ حاول لاحقًا." }
          : { status: 502, code: "AI_UNAVAILABLE", error: "تعذر الوصول إلى مزود التحليل حاليًا." };
    res.status(issue.status).json({ code: issue.code, error: issue.error });
    return;
  }

  if (requestResult.failures.length > 0) {
    req.log.warn({
      failedProvider: requestResult.failures[0].provider.connection,
      failureState: requestResult.failures[0].state,
      fallbackProvider: requestResult.provider.connection,
    }, "Managed OpenAI failed; using configured direct fallback");
  }

  const { provider, response } = requestResult;
  let payload: {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  try {
    payload = await response.json();
  } catch {
    availabilityMonitor.record(provider, "unavailable");
    req.log.error({ provider: provider.connection }, "OpenAI verification response was invalid JSON");
    res.status(502).json({ code: "AI_BAD_RESPONSE", error: "لم تُرجع خدمة التحليل نتيجة قابلة للقراءة." });
    return;
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    availabilityMonitor.record(provider, "unavailable");
    res.status(502).json({ code: "AI_BAD_RESPONSE", error: "لم تُرجع خدمة التحليل نتيجة قابلة للقراءة." });
    return;
  }
  try {
    result = normalizeProviderResult(JSON.parse(content), retrievedEvidence);
  } catch {
    availabilityMonitor.record(provider, "unavailable");
    req.log.error({ provider: provider.connection }, "OpenAI verification response could not be normalized");
    res.status(502).json({ code: "AI_BAD_RESPONSE", error: "لم تُرجع خدمة التحليل نتيجة قابلة للقراءة." });
    return;
  }
  availabilityMonitor.record(provider, "available");
  const hadithCoverageNote = routing.categories.includes("hadith")
    ? {
        "العربية": "الأدلة الحديثية المحلية مقتطفات تجريبية محدودة وليست تغطية كاملة لصحيحي البخاري ومسلم.",
        English: "The local hadith evidence is a limited demo sample, not full coverage of Sahih al-Bukhari or Sahih Muslim.",
        "Français": "Les hadiths locaux sont un échantillon de démonstration limité, et non une couverture complète des recueils Sahih al-Bukhari et Sahih Muslim.",
      }[detectedLanguage]
    : null;
  result.sourceNotes = [
    ...(hadithCoverageNote ? [hadithCoverageNote] : []),
    ...result.sourceNotes,
  ];

  let saved;
  let newlyCreated = true;
  try {
    [saved] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(workspaceCases).values({
        id: randomUUID(),
        claim,
        context,
        language,
        workspaceId,
        status: "needs_review",
        confidence: result.confidence,
        evidenceLevel: result.evidenceLevel,
        summary: result.summary,
        recommendedAction: result.recommendedAction,
        reviewerNote: null,
        sourceIds: result.sourceIds,
        sourceNotes: result.sourceNotes,
        evidence: result.evidence,
        analysisMode: "ai",
        modeNote: result.modeNote,
        analysisVerified: true,
        reviewValidated: false,
        analysisRequestId: requestId,
      }).returning();
      await tx.insert(workspaceAuditLog).values({
        id: randomUUID(),
        workspaceId,
        actorUserId: userId,
        action: "case_ai_analysis_saved",
        caseId: created.id,
        metadata: { status: "needs_review", analysisMode: "ai", requestId },
      });
      return [created];
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code !== "23505") throw error;
    const [duplicate] = await db.select().from(workspaceCases).where(and(
      eq(workspaceCases.workspaceId, workspaceId),
      eq(workspaceCases.analysisRequestId, requestId),
    )).limit(1);
    if (!duplicate) throw error;
    if (!matchesAnalysisRequest(duplicate, workspaceId, requestId, claim, context, language)) {
      res.status(409).json({ error: "استُخدم requestId نفسه لمطالبة مختلفة ضمن مساحة العمل." });
      return;
    }
    saved = duplicate;
    newlyCreated = false;
  }
  res.status(newlyCreated ? 201 : 200).json({ case: serializeCase(saved) });
});

export default router;