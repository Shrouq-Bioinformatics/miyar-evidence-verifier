import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(testDir, "..");
const harnessDir = path.join(artifactDir, "dist", "miyar-e2e-test-harness");
const harnessPath = path.join(harnessDir, "authenticated-integration-entry.mjs");
after(async () => {
  await rm(harnessDir, { recursive: true, force: true });
});

const harness: any = await import(pathToFileURL(harnessPath).href);
const {
  APPROVED_EXTERNAL_DOMAINS,
  db,
  eq,
  inArray,
  resolveAIProviderConfigs,
  retrieveQuranEvidenceByReference,
  sql,
  teamWorkspaces,
  workspaceAuditLog,
  workspaceCaseReviews,
  workspaceCases,
  workspaceEvidence,
  workspaceInvites,
  workspaceMembers,
  workspaceSavedSources,
  createAuthenticatedIntegrationApp,
} = harness;

type FailureMode = "quranenc" | "web_search" | "invalid_classifier" | "ai_analysis";

function identitiesFor(runId: string) {
  return {
    owner: `E2E_TEST_OWNER_${runId}`,
    reviewer: `E2E_TEST_REVIEWER_${runId}`,
    member: `E2E_TEST_MEMBER_${runId}`,
    outsider: `E2E_TEST_OUTSIDER_${runId}`,
  };
}

async function globalE2eCounts() {
  const result: any = await db.execute(sql.raw(`
    WITH e2e_workspaces AS (
      SELECT id FROM team_workspaces WHERE name LIKE 'E2E_TEST_%'
    ),
    e2e_cases AS (
      SELECT id, workspace_id FROM workspace_cases
      WHERE claim LIKE '%E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces)
    )
    SELECT
      (SELECT count(*) FROM team_workspaces WHERE name LIKE 'E2E_TEST_%') AS workspaces,
      (SELECT count(*) FROM workspace_cases WHERE claim LIKE '%E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces)) AS cases,
      (SELECT count(*) FROM workspace_members WHERE user_id LIKE 'E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces)) AS memberships,
      (SELECT count(*) FROM workspace_invites WHERE created_by LIKE 'E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces)) AS invites,
      (SELECT count(*) FROM workspace_evidence WHERE title LIKE '%E2E_TEST_%' OR excerpt LIKE '%E2E_TEST_%' OR reference LIKE '%E2E_TEST_%' OR case_id IN (SELECT id FROM e2e_cases)) AS evidence,
      (SELECT count(*) FROM workspace_case_reviews WHERE reviewer_user_id LIKE 'E2E_TEST_%' OR reviewer_note LIKE '%E2E_TEST_%' OR case_id IN (SELECT id FROM e2e_cases)) AS reviews,
      (SELECT count(*) FROM workspace_audit_log WHERE actor_user_id LIKE 'E2E_TEST_%' OR metadata::text LIKE '%E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces) OR case_id IN (SELECT id FROM e2e_cases)) AS audit,
      (SELECT count(*) FROM workspace_saved_sources WHERE saved_by LIKE 'E2E_TEST_%' OR workspace_id IN (SELECT id FROM e2e_workspaces)) AS saved_sources
  `));
  const row = (result?.rows ?? result)?.[0] ?? {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function approvedEvidence(item: any) {
  if (item.sourceType !== "external_web") return true;
  try {
    const host = new URL(item.url).hostname.toLowerCase();
    return APPROVED_EXTERNAL_DOMAINS.some((domain: string) =>
      host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function evidenceSummary(item: any) {
  return {
    id: item.id,
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    sourceName: item.sourceName,
    sourceTitle: item.sourceTitle,
    sourceDomain: item.sourceDomain,
    sourceSubtype: item.sourceSubtype,
    sourceMetadataStatus: item.sourceMetadataStatus,
    reference: item.reference,
    url: item.url,
    edition: item.edition,
    summary: item.summary,
    surahNumber: item.surahNumber,
    ayahNumber: item.ayahNumber,
    excerpt: typeof item.excerpt === "string" ? item.excerpt.slice(0, 500) : undefined,
  };
}

test("authenticated route integration: permissions, five scenarios, review, and failure paths", {
  timeout: 15 * 60 * 1000,
}, async (t) => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const actors = identitiesFor(runId);
  const allowedSubjects = Object.values(actors);
  const workspaceName = `E2E_TEST_Miyar_${runId}`;
  const report: any = {
    runId,
    databaseGuard: {},
    actors,
    workspace: null,
    checks: [],
    scenarios: [],
    failureScenarios: [],
    manifestBeforeCleanup: null,
    cleanup: "pending",
    testRowsBefore: null,
    testRowsAfter: null,
  };
  const failedChecks: string[] = [];
  const check = (name: string, passed: boolean, detail?: unknown) => {
    const result = passed ? "pass" : "fail";
    report.checks.push({ name, result, detail: detail ?? null });
    if (!passed) failedChecks.push(name);
  };

  let workspaceId: string | null = null;
  let server: any = null;
  const createdCaseIds = new Set<string>();
  let failureMode: FailureMode | null = null;
  const injectedCalls: Record<string, number> = {};
  const nativeFetch = globalThis.fetch;

  const app = createAuthenticatedIntegrationApp(allowedSubjects);
  try {
    if (process.env.NODE_ENV !== "development") {
      throw new Error(`Refusing non-development execution: NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`);
    }
    const databaseResult: any = await db.execute(sql.raw("SELECT current_database() AS name"));
    const databaseRows = databaseResult?.rows ?? databaseResult;
    const databaseName = databaseRows?.[0]?.name;
    if (databaseName !== "heliumdb") {
      throw new Error(`Refusing database ${String(databaseName)}; expected the development database heliumdb.`);
    }
    report.databaseGuard = { nodeEnv: process.env.NODE_ENV, database: databaseName };

    const beforeCounts = await globalE2eCounts();
    report.testRowsBefore = beforeCounts;
    if (Object.values(beforeCounts).some((count: any) => count !== 0)) {
      throw new Error("Existing E2E_TEST_ rows were found. The harness will not modify or delete pre-existing test data.");
    }

    const providers = resolveAIProviderConfigs(process.env);
    report.providers = {
      configuredCount: providers.length,
      hasDirectProvider: providers.some((provider: any) => provider.connection === "direct_openai"),
      hasManagedProvider: providers.some((provider: any) => provider.connection === "replit_managed_openai"),
    };
    check("AI analysis provider configured", providers.length > 0, report.providers);
    check("direct provider available for classifier and approved-domain search",
      providers.some((provider: any) => provider.connection === "direct_openai"),
      report.providers);

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const request = async (actor: string | null, method: string, pathName: string, body?: unknown) => {
      const headers: Record<string, string> = {};
      if (actor) headers["x-e2e-test-clerk-subject"] = actor;
      if (body !== undefined) headers["content-type"] = "application/json";
      try {
        const response = await fetch(`${baseUrl}${pathName}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        const text = await response.text();
        let parsed: any;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          parsed = { raw: text.slice(0, 500) };
        }
        return { status: response.status, body: parsed };
      } catch (error: any) {
        return { status: 0, body: { error: String(error?.message ?? error) } };
      }
    };

    const noIdentity = await request(null, "GET", "/api/workspaces");
    check("test Clerk boundary rejects requests without an identity", noIdentity.status === 401, noIdentity.status);

    const workspaceResponse = await request(actors.owner, "POST", "/api/workspaces", { name: workspaceName });
    if (workspaceResponse.status !== 201 || typeof workspaceResponse.body?.workspace?.id !== "string") {
      throw new Error(`Temporary workspace creation failed: ${JSON.stringify(workspaceResponse.body)}`);
    }
    workspaceId = workspaceResponse.body.workspace.id;
    report.workspace = { id: workspaceId, name: workspaceName };

    const reviewerInvite = await request(actors.owner, "POST", `/api/workspaces/${workspaceId}/invites`, { role: "reviewer" });
    const memberInvite = await request(actors.owner, "POST", `/api/workspaces/${workspaceId}/invites`, { role: "member" });
    const reviewerJoin = await request(actors.reviewer, "POST", "/api/workspaces/join", { code: reviewerInvite.body?.code });
    const memberJoin = await request(actors.member, "POST", "/api/workspaces/join", { code: memberInvite.body?.code });
    check("owner manages invitations and reviewer/member can join", reviewerInvite.status === 201
      && memberInvite.status === 201 && reviewerJoin.status === 200 && memberJoin.status === 200, {
      inviteStatuses: [reviewerInvite.status, memberInvite.status],
      joinStatuses: [reviewerJoin.status, memberJoin.status],
    });
    const memberList = await request(actors.reviewer, "GET", `/api/workspaces/${workspaceId}/members`);
    check("workspace membership and roles are returned", memberList.status === 200
      && memberList.body?.members?.some((member: any) => member.userId === actors.owner && member.role === "owner")
      && memberList.body?.members?.some((member: any) => member.userId === actors.reviewer && member.role === "reviewer")
      && memberList.body?.members?.some((member: any) => member.userId === actors.member && member.role === "member"), memberList.body);
    const reviewerInviteDenied = await request(actors.reviewer, "POST", `/api/workspaces/${workspaceId}/invites`, { role: "member" });
    const memberInviteDenied = await request(actors.member, "POST", `/api/workspaces/${workspaceId}/invites`, { role: "reviewer" });
    const outsiderCases = await request(actors.outsider, "GET", `/api/cases?workspaceId=${encodeURIComponent(workspaceId)}`);
    check("reviewer/member cannot manage invitations; outsider cannot access workspace",
      reviewerInviteDenied.status === 403 && memberInviteDenied.status === 403 && outsiderCases.status === 404,
      { reviewerInvite: reviewerInviteDenied.status, memberInvite: memberInviteDenied.status, outsider: outsiderCases.status });

    const runVerification = async (
      key: string,
      title: string,
      query: string,
      context: string,
      mode: FailureMode | null = null,
      selectedLanguage = "العربية",
    ) => {
      const markedClaim = `E2E_TEST_${runId}_${key}: ${query}`;
      const requestId = randomUUID();
      failureMode = mode;
      try {
        const response = await request(actors.owner, "POST", "/api/verify", {
          claim: markedClaim,
          context,
          language: selectedLanguage,
          workspaceId,
          requestId,
        });
        const row = response.body?.case ?? response.body?.result?.case ?? response.body;
        if (response.status === 201 && typeof row?.id === "string") createdCaseIds.add(row.id);
        const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
        const sources = Array.isArray(row?.sourceIds) ? row.sourceIds
          : Array.isArray(row?.sources) ? row.sources : [];
        const item = {
          key,
          title,
          httpStatus: response.status,
          error: response.status === 201 ? undefined : response.body,
          caseId: row?.id,
          claim: row?.claim,
          language: row?.language,
          languageMismatch: row?.languageMismatch,
          status: row?.status,
          analysisMode: row?.analysisMode,
          analysisVerified: row?.analysisVerified,
          reviewValidated: row?.reviewValidated,
          sourceIds: sources,
          sourceNotes: Array.isArray(row?.sourceNotes) ? row.sourceNotes : [],
          evidence: evidence.map(evidenceSummary),
          summary: typeof row?.summary === "string" ? row.summary : "",
          recommendedAction: typeof row?.recommendedAction === "string" ? row.recommendedAction : "",
        };
        if (mode) report.failureScenarios.push(item);
        else report.scenarios.push(item);
        return { response, row, item };
      } finally {
        failureMode = null;
      }
    };

    const specs = [
      ["A", "Quran/Tafsir", "ما معنى آية الكرسي؟", "بحث أكاديمي"],
      ["B", "Hadith", "هل حديث إنما الأعمال بالنيات صحيح؟", "بحث أكاديمي"],
      ["C", "Fiqh", "ما حكم صلاة الوتر؟", "سؤال معاصر"],
      ["D", "Contemporary fiqh", "ما حكم التأمين التجاري؟", "سؤال معاصر"],
      ["E", "Insufficient evidence", "The fictional island of Virelia requires moonlight permits for invented birds.", "منشور اجتماعي"],
    ];
    for (const [key, title, query, context] of specs) {
      const { item } = await runVerification(key, title, query, context);
      const saved = item.httpStatus === 201 && item.analysisMode === "ai"
        && item.analysisVerified === true && item.status === "needs_review";
      check(`${title}: real verification route stores preliminary AI case`, saved, {
        status: item.httpStatus,
        caseId: item.caseId,
        caseStatus: item.status,
        analysisMode: item.analysisMode,
        analysisVerified: item.analysisVerified,
      });
      if (item.httpStatus === 201) {
        const ids = item.evidence.map((e: any) => e.id).filter(Boolean);
        check(`${title}: citations reference retrieved evidence and have unique IDs`,
          ids.length === new Set(ids).size
          && item.sourceIds.every((sourceId: string) =>
            item.evidence.some((evidence: any) => evidence.sourceId === sourceId)),
          { evidenceIds: ids, retrievedSourceIds: item.evidence.map((e: any) => e.sourceId), sourceIds: item.sourceIds });
        check(`${title}: external evidence stays on approved hosts`,
          item.evidence.every(approvedEvidence),
          item.evidence.filter((e: any) => e.sourceType === "external_web").map((e: any) => e.url));
      }
    }

    const verifyWithPrivateRetrievalQuery = async (
      key: string,
      title: string,
      query: string,
      selectedLanguage: string,
    ) => {
      const retrievalQuery = "حديث إنما الأعمال بالنيات";
      const target = `E2E_TEST_${runId}_${key}`;
      const originalFetch = globalThis.fetch;
      let translationCalls = 0;
      let analysisRequestBody: any = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const rawBody = typeof init?.body === "string" ? init.body : "";
        let body: any = {};
        try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { /* Non-JSON fetch bodies pass through. */ }
        const systemContent = body.messages?.[0]?.content;
        const isTranslation = url.endsWith("/chat/completions")
          && typeof systemContent === "string"
          && systemContent.includes("Translate the supplied claim into one concise Arabic retrieval query")
          && rawBody.includes(target);
        if (isTranslation) {
          translationCalls++;
          return Response.json({
            choices: [{
              message: { content: JSON.stringify({ query: retrievalQuery }) },
            }],
          });
        }
        if (url.endsWith("/chat/completions") && rawBody.includes(target)) {
          analysisRequestBody = body;
        }
        return nativeFetch(input, init);
      }) as typeof fetch;

      try {
        const result = await runVerification(
          key,
          title,
          query,
          "بحث أكاديمي",
          null,
          selectedLanguage,
        );
        return { ...result, retrievalQuery, translationCalls, analysisRequestBody };
      } finally {
        globalThis.fetch = originalFetch;
      }
    };

    const englishInput = "  The hadith 'Actions are judged by intentions' is authentic.  ";
    const englishVerification = await verifyWithPrivateRetrievalQuery(
      "F",
      "English hadith claim",
      englishInput,
      "العربية",
    );
    const frenchInput = "Les actes ne valent que par les intentions. Ce hadith est-il authentique ?";
    const frenchVerification = await verifyWithPrivateRetrievalQuery(
      "G",
      "French hadith claim",
      frenchInput,
      "العربية",
    );
    for (const [label, verification, input, expectedLanguage] of [
      ["English", englishVerification, englishInput, "English"],
      ["French", frenchVerification, frenchInput, "Français"],
    ] as const) {
      const expectedClaim = `E2E_TEST_${runId}_${verification.item.key}: ${input}`;
      const prompt = verification.analysisRequestBody;
      const userMessage = typeof prompt?.messages?.[1]?.content === "string"
        ? JSON.parse(prompt.messages[1].content)
        : {};
      const localBukhari = verification.item.evidence.some((item: any) =>
        item.sourceId === "bukhari"
        && item.url === "https://sunnah.com/bukhari:1"
        && item.excerpt?.includes("إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ"));
      const responseText = JSON.stringify(verification.row);
      check(`${label}: exact original claim preserved; Arabic search aid stays private`,
        verification.response.status === 201
        && verification.item.claim === expectedClaim
        && verification.item.language === "العربية"
        && verification.item.languageMismatch === true
        && verification.translationCalls === 1
        && verification.item.evidence.every(approvedEvidence)
        && localBukhari
        && !responseText.includes(verification.retrievalQuery)
        && !/retrievalQuery|searchQuery|fallbackUsed=|routingCategories|selectedDomains/u.test(responseText),
        {
          status: verification.response.status,
          claimPreserved: verification.item.claim === expectedClaim,
          selectedLanguagePreserved: verification.item.language,
          languageMismatch: verification.item.languageMismatch,
          translationCalls: verification.translationCalls,
          localBukhari,
          evidenceCount: verification.item.evidence.length,
        });
      check(`${label}: final analysis receives original claim and detected output language`,
        prompt?.messages?.[0]?.content?.includes(`The detected claim language is ${expectedLanguage}.`)
        && userMessage.claim === expectedClaim
        && userMessage.language === expectedLanguage
        && !("retrievalQuery" in userMessage),
        {
          detectedLanguageInstruction: prompt?.messages?.[0]?.content,
          userMessageClaimPreserved: userMessage.claim === expectedClaim,
          userMessageLanguage: userMessage.language,
        });
    }

    const scenario = (key: string) => report.scenarios.find((item: any) => item.key === key);
    const a = scenario("A");
    if (a?.httpStatus === 201) {
      const quran = a.evidence.filter((item: any) => item.sourceType === "quran");
      const tafsir = a.evidence.filter((item: any) => item.sourceType === "tafsir");
      const canonical = retrieveQuranEvidenceByReference(2, 255);
      const originalText = Boolean(canonical && quran.some((item: any) =>
        (item.excerpt ?? "") === (canonical.excerpt ?? "")));
      const matchingTafsir = tafsir.some((item: any) =>
        (item.surahNumber === 2 && item.ayahNumber === 255)
        || /2:255|2\/255|2-255/.test(`${item.reference ?? ""} ${item.url ?? ""} ${item.excerpt ?? ""}`));
      check("A: Quran and Tafsir were independently retrieved",
        quran.length > 0 && tafsir.length > 0,
        { evidenceTypes: [...new Set(a.evidence.map((item: any) => item.sourceType))] });
      check("A: Quran 2:255 matches original stored Tanzil text", originalText, { quranCount: quran.length });
      check("A: matching QuranEnc tafsir is separately retrieved", matchingTafsir, {
        tafsir: tafsir.map(evidenceSummary),
      });
    } else {
      check("A: Quran 2:255 and matching tafsir", false, a?.error ?? "no case");
    }

    const b = scenario("B");
    const bHadith = b?.evidence?.filter((item: any) =>
      item.sourceType === "hadith" || item.sourceType === "حديث") ?? [];
    const bukhari = bHadith.some((item: any) =>
      /bukhari|البخاري/i.test([item.sourceName, item.sourceTitle, item.reference, item.edition].filter(Boolean).join(" ")));
    check("B: hadith routing finds existing local Bukhari demo evidence", b?.status === "needs_review" && bukhari, {
      hadithEvidence: bHadith.map(evidenceSummary),
      routing: b?.sourceNotes,
    });
    check("B: local hadith coverage limitation remains visible",
      Boolean(b?.sourceNotes?.some((note: string) => /تجريبية محدودة|ليست تغطية كاملة/.test(note))),
      b?.sourceNotes);

    const c = scenario("C");
    const cExternal = c?.evidence?.filter((item: any) => item.sourceType === "external_web") ?? [];
    check("C: returned external evidence remains on approved hosts",
      c?.httpStatus === 201 && cExternal.every(approvedEvidence),
      { evidenceCount: cExternal.length, domains: cExternal.map((item: any) => item.sourceDomain) });
    if (cExternal.length === 0) report.scenarioNotes = [...(report.scenarioNotes ?? []), "Scenario C returned no external evidence; none was synthesized."];

    const d = scenario("D");
    const dIifa = d?.evidence?.filter((item: any) =>
      item.sourceDomain === "iifa-aifi.org" || (typeof item.url === "string" && (() => {
        try { return new URL(item.url).hostname.endsWith("iifa-aifi.org"); } catch { return false; }
      })())) ?? [];
    const dSubtypeSafe = dIifa.every((item: any) => item.sourceSubtype === "collective_fiqh_resolution");
    check("D: any retrieved IIFA evidence is a collective resolution",
      d?.httpStatus === 201 && dSubtypeSafe,
      { results: dIifa.map(evidenceSummary) });
    if (dIifa.length === 0) report.scenarioNotes = [...(report.scenarioNotes ?? []), "Scenario D selected IIFA but the live search returned no IIFA resolution."];

    const e = scenario("E");
    const eEvidence = e?.evidence ?? [];
    const noQuranOrTafsir = eEvidence.every((item: any) =>
      !["quran", "tafsir"].includes(item.sourceType));
    const eSourcesAreRetrieved = (e?.sourceIds ?? []).every((sourceId: string) =>
      eEvidence.some((item: any) => item.sourceId === sourceId));
    const avoidsFalseVerdict = /عدم الجزم بصحته أو نفيه|لا تعني هذه النتيجة أن المقولة صحيحة أو خاطئة/u
      .test(`${e?.summary ?? ""} ${e?.recommendedAction ?? ""}`);
    const eExternal = eEvidence.filter((item: any) => item.sourceType === "external_web");
    check("E: fictional claim has no unrelated external evidence or false verdict",
      e?.httpStatus === 201 && e.status === "needs_review" && noQuranOrTafsir
      && eSourcesAreRetrieved && eEvidence.every(approvedEvidence)
      && eExternal.length === 0 && avoidsFalseVerdict,
      {
        status: e?.status,
        evidence: eEvidence.map(evidenceSummary),
        sourceIds: e?.sourceIds,
        summary: e?.summary,
        recommendedAction: e?.recommendedAction,
      });
    if (eExternal.length > 0) {
      report.scenarioNotes = [
        ...(report.scenarioNotes ?? []),
        `Scenario E live search returned ${eExternal.length} approved-domain result(s); they were retained as retrieved output, not synthesized, and are not treated as proof of the claim.`,
      ];
    }

    const controlCase = a?.httpStatus === 201 ? a : report.scenarios.find((item: any) => item.httpStatus === 201);
    let controlBeforeFailure: any = null;
    if (controlCase?.caseId) {
      const caseList = await request(actors.reviewer, "GET", `/api/cases?workspaceId=${encodeURIComponent(workspaceId!)}`);
      const openedCase = (caseList.body?.cases ?? []).find((item: any) => item.id === controlCase.caseId);
      controlBeforeFailure = openedCase ? {
        id: openedCase.id,
        status: openedCase.status,
        analysisMode: openedCase.analysisMode,
        analysisVerified: openedCase.analysisVerified,
        evidenceIds: (openedCase.evidence ?? []).map((item: any) => item.id),
        sources: openedCase.sources ?? [],
      } : null;
      check("reviewer can open a saved AI case", caseList.status === 200 && Boolean(openedCase), caseList.status);
    }
    const controlId = controlCase?.caseId;
    let acceptedEvidenceId: string | null = null;
    let rejectedEvidenceId: string | null = null;
    if (controlId) {
      const acceptSubmit = await request(actors.reviewer, "POST", `/api/cases/${controlId}/evidence`, {
        workspaceId,
        title: `E2E_TEST_${runId}_review_accept`,
        excerpt: `E2E_TEST_${runId}: synthetic workflow marker only; not a source or religious evidence.`,
        reference: `E2E_TEST_${runId}_review_accept`,
      });
      const rejectSubmit = await request(actors.owner, "POST", `/api/cases/${controlId}/evidence`, {
        workspaceId,
        title: `E2E_TEST_${runId}_review_reject`,
        excerpt: `E2E_TEST_${runId}: synthetic workflow marker only; not a source or religious evidence.`,
        reference: `E2E_TEST_${runId}_review_reject`,
      });
      const evidenceToAccept = acceptSubmit.body?.evidence;
      const evidenceToReject = rejectSubmit.body?.evidence;
      acceptedEvidenceId = evidenceToAccept?.id ?? null;
      rejectedEvidenceId = evidenceToReject?.id ?? null;
      check("reviewer and owner can submit test-marked evidence; submissions begin pending",
        acceptSubmit.status === 201 && rejectSubmit.status === 201
        && evidenceToAccept?.status === "pending" && evidenceToReject?.status === "pending",
        { reviewer: evidenceToAccept?.status, owner: evidenceToReject?.status });

      const memberEvidenceReview = acceptedEvidenceId
        ? await request(actors.member, "PATCH", `/api/cases/${controlId}/evidence/${acceptedEvidenceId}`, {
            workspaceId, status: "accepted", reviewerNote: `E2E_TEST_${runId} member denied review`,
          })
        : { status: 0, body: {} };
      const memberDecision = await request(actors.member, "PATCH", `/api/cases/${controlId}/decision`, {
        workspaceId, status: "needs_review", reviewerNote: `E2E_TEST_${runId} member denied decision`,
      });
      const acceptReview = acceptedEvidenceId
        ? await request(actors.reviewer, "PATCH", `/api/cases/${controlId}/evidence/${acceptedEvidenceId}`, {
            workspaceId, status: "accepted", reviewerNote: `E2E_TEST_${runId} reviewer accepted synthetic workflow row`,
          })
        : { status: 0, body: {} };
      const rejectReview = rejectedEvidenceId
        ? await request(actors.reviewer, "PATCH", `/api/cases/${controlId}/evidence/${rejectedEvidenceId}`, {
            workspaceId, status: "rejected", reviewerNote: `E2E_TEST_${runId} reviewer rejected synthetic workflow row`,
          })
        : { status: 0, body: {} };
      const ownerDecision = await request(actors.owner, "PATCH", `/api/cases/${controlId}/decision`, {
        workspaceId, status: "needs_review", reviewerNote: `E2E_TEST_${runId} owner decision; not a religious ruling`,
      });
      const reviewerDecision = await request(actors.reviewer, "PATCH", `/api/cases/${controlId}/decision`, {
        workspaceId, status: "needs_review", reviewerNote: `E2E_TEST_${runId} reviewer decision; workspace role only`,
      });
      check("normal member is denied reviewer-only evidence and decision actions",
        memberEvidenceReview.status === 403 && memberDecision.status === 403,
        { evidenceReview: memberEvidenceReview.status, decision: memberDecision.status });
      check("reviewer accepts/rejects evidence; owner/reviewer can record case decisions",
        acceptReview.status === 200 && rejectReview.status === 200
        && ownerDecision.status === 200 && reviewerDecision.status === 200,
        { accept: acceptReview.status, reject: rejectReview.status, ownerDecision: ownerDecision.status, reviewerDecision: reviewerDecision.status });

      const evidenceList = await request(actors.reviewer, "GET",
        `/api/cases/${controlId}/evidence?workspaceId=${encodeURIComponent(workspaceId!)}`);
      const savedAccepted = (evidenceList.body?.evidence ?? []).find((item: any) => item.id === acceptedEvidenceId);
      const savedRejected = (evidenceList.body?.evidence ?? []).find((item: any) => item.id === rejectedEvidenceId);
      check("review notes and accept/reject states persist",
        savedAccepted?.status === "accepted" && savedRejected?.status === "rejected"
        && savedAccepted?.reviewerNote?.includes(`E2E_TEST_${runId}`)
        && savedRejected?.reviewerNote?.includes(`E2E_TEST_${runId}`),
        { accepted: savedAccepted?.status, rejected: savedRejected?.status });

      const finalCases = await request(actors.owner, "GET", `/api/cases?workspaceId=${encodeURIComponent(workspaceId!)}`);
      const finalCase = (finalCases.body?.cases ?? []).find((item: any) => item.id === controlId);
      check("human decision remains separate from stored AI preliminary analysis",
        finalCase?.analysisMode === "ai" && finalCase?.analysisVerified === true
        && finalCase?.reviewValidated === true && finalCase?.reviewedBy === actors.reviewer,
        { analysisMode: finalCase?.analysisMode, analysisVerified: finalCase?.analysisVerified, reviewValidated: finalCase?.reviewValidated, reviewedBy: finalCase?.reviewedBy });

      const auditResponse = await request(actors.reviewer, "GET",
        `/api/cases/${controlId}/audit?workspaceId=${encodeURIComponent(workspaceId!)}`);
      const auditActions = (auditResponse.body?.audit ?? []).map((item: any) => item.action);
      check("case audit contains analysis, evidence submission/review, and human decision events",
        auditResponse.status === 200 && auditActions.includes("case_ai_analysis_saved")
        && auditActions.includes("evidence_submitted") && auditActions.includes("evidence_reviewed")
        && auditActions.includes("case_decision_changed"),
        [...new Set(auditActions)]);
      const reviews = await request(actors.owner, "GET", `/api/reviews?workspaceId=${encodeURIComponent(workspaceId!)}`);
      check("human review records persist", reviews.status === 200
        && (reviews.body?.reviews ?? []).filter((item: any) => item.caseId === controlId).length >= 2,
        reviews.status);

      const syntheticSupported = e?.caseId
        ? await request(actors.owner, "PATCH", `/api/cases/${e.caseId}/decision`, {
            workspaceId, status: "supported", reviewerNote: `E2E_TEST_${runId} cannot support absent evidence`,
          })
        : { status: 0, body: {} };
      check("case cannot be marked supported without accepted evidence", syntheticSupported.status === 409,
        syntheticSupported.status);
    } else {
      check("human review workflow has a saved case to exercise", false, "No scenario case was stored.");
    }

    const failureCases = [
      ["F_QURANENC", "QuranEnc failure", "ما معنى آية الكرسي؟", "بحث أكاديمي", "quranenc"],
      ["F_WEB", "web search failure", "ما حكم صلاة الوتر؟", "سؤال معاصر", "web_search"],
      ["F_CLASSIFIER", "invalid classifier output", "ما حكم صلاة الوتر؟", "سؤال معاصر", "invalid_classifier"],
      ["F_AI", "AI analysis failure", "The fictional island of Virelia requires moonlight permits for invented birds.", "منشور اجتماعي", "ai_analysis"],
    ] as const;
    for (const [key, title, query, context, mode] of failureCases) {
      injectedCalls[key] = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const rawBody = typeof init?.body === "string" ? init.body : "";
        let body: any = {};
        try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { /* Non-JSON fetch bodies pass through. */ }
        const isTarget = rawBody.includes(`E2E_TEST_${runId}_${key}`);
        if (failureMode === "quranenc" && url.startsWith("https://quranenc.com/api/v1/translation/aya/")) {
          injectedCalls[key]++;
          return new Response("injected test-only QuranEnc outage", { status: 503 });
        }
        if (isTarget && failureMode === "web_search"
          && Array.isArray(body.tools) && body.tools.some((tool: any) => tool.type === "web_search")) {
          injectedCalls[key]++;
          return new Response("injected test-only web-search outage", { status: 503 });
        }
        if (isTarget && failureMode === "invalid_classifier"
          && url === "https://api.openai.com/v1/responses" && !Array.isArray(body.tools)) {
          injectedCalls[key]++;
          return Response.json({
            output: [{
              type: "message",
              content: [{
                type: "output_text",
                text: JSON.stringify({ categories: ["E2E_TEST_unapproved_domain"], confidence: 0.99 }),
              }],
            }],
          });
        }
        if (isTarget && failureMode === "ai_analysis"
          && url.endsWith("/chat/completions")
          && !String(body.messages?.[0]?.content ?? "").includes(
            "Translate the supplied claim into one concise Arabic retrieval query",
          )) {
          injectedCalls[key]++;
          return new Response("injected test-only AI analysis outage", { status: 503 });
        }
        return nativeFetch(input, init);
      }) as typeof fetch;
      try {
        const { response, item } = await runVerification(key, title, query, context, mode);
        if (mode === "quranenc") {
          check("failure: QuranEnc outage was injected and did not fabricate tafsir",
            injectedCalls[key] > 0 && response.status === 201
            && item.evidence.some((evidence: any) => evidence.sourceType === "quran")
            && !item.evidence.some((evidence: any) => evidence.sourceType === "tafsir"),
            { injected: injectedCalls[key], status: response.status, types: item.evidence.map((x: any) => x.sourceType) });
        } else if (mode === "web_search") {
          check("failure: web-search outage was injected and did not add external citations",
            injectedCalls[key] > 0 && response.status === 201
            && !item.evidence.some((evidence: any) => evidence.sourceType === "external_web"),
            { injected: injectedCalls[key], status: response.status, types: item.evidence.map((x: any) => x.sourceType) });
        } else if (mode === "invalid_classifier") {
          check("failure: invalid classifier output falls back without exposing routing metadata",
            injectedCalls[key] > 0 && response.status === 201
            && !/fallbackUsed=|routingCategories|selectedDomains/u.test(item.sourceNotes.join(" "))
            && item.evidence.every(approvedEvidence),
            { injected: injectedCalls[key], status: response.status, notes: item.sourceNotes, evidence: item.evidence });
        } else {
          check("failure: AI analysis outage was injected and did not persist a case",
            injectedCalls[key] > 0 && response.status >= 500 && !item.caseId,
            { injected: injectedCalls[key], status: response.status, error: response.body });
        }
      } catch (error: any) {
        check(`${title}: injected failure path completed`, false, String(error?.message ?? error));
      } finally {
        globalThis.fetch = originalFetch;
        failureMode = null;
      }
    }

    if (controlId && controlBeforeFailure) {
      const currentCases = await request(actors.owner, "GET", `/api/cases?workspaceId=${encodeURIComponent(workspaceId!)}`);
      const current = (currentCases.body?.cases ?? []).find((item: any) => item.id === controlId);
      const currentSnapshot = current ? {
        id: current.id,
        status: current.status,
        analysisMode: current.analysisMode,
        analysisVerified: current.analysisVerified,
        evidenceIds: (current.evidence ?? []).map((item: any) => item.id),
        sources: current.sources ?? [],
      } : null;
      check("failure injection did not corrupt the unrelated reviewed case",
        JSON.stringify(currentSnapshot) === JSON.stringify(controlBeforeFailure),
        { before: controlBeforeFailure, after: currentSnapshot });
    }
  } catch (error: any) {
    report.fatal = String(error?.stack ?? error);
  } finally {
    globalThis.fetch = nativeFetch;
    failureMode = null;

    try {
      if (!workspaceId) {
        const possibleRows = await db.select({ id: teamWorkspaces.id })
          .from(teamWorkspaces).where(eq(teamWorkspaces.name, workspaceName)).limit(1);
        workspaceId = possibleRows[0]?.id ?? null;
        if (workspaceId) report.workspace = { id: workspaceId, name: workspaceName, recoveredForCleanup: true };
      }

      if (workspaceId) {
        const workspaces = await db.select({ id: teamWorkspaces.id, name: teamWorkspaces.name })
          .from(teamWorkspaces).where(eq(teamWorkspaces.id, workspaceId));
        const memberships = await db.select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId, role: workspaceMembers.role })
          .from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
        const invites = await db.select({ id: workspaceInvites.id, createdBy: workspaceInvites.createdBy, role: workspaceInvites.role })
          .from(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId));
        const cases = await db.select({ id: workspaceCases.id, claim: workspaceCases.claim, evidence: workspaceCases.evidence })
          .from(workspaceCases).where(eq(workspaceCases.workspaceId, workspaceId));
        const caseIds = [...new Set([...createdCaseIds, ...cases.map((item: any) => item.id)])];
        const manualEvidence = await db.select({ id: workspaceEvidence.id, caseId: workspaceEvidence.caseId, submittedBy: workspaceEvidence.submittedBy, status: workspaceEvidence.status, title: workspaceEvidence.title })
          .from(workspaceEvidence).where(eq(workspaceEvidence.workspaceId, workspaceId));
        const reviews = await db.select({ id: workspaceCaseReviews.id, caseId: workspaceCaseReviews.caseId, reviewerUserId: workspaceCaseReviews.reviewerUserId, status: workspaceCaseReviews.status })
          .from(workspaceCaseReviews).where(eq(workspaceCaseReviews.workspaceId, workspaceId));
        const audit = await db.select({ id: workspaceAuditLog.id, actorUserId: workspaceAuditLog.actorUserId, action: workspaceAuditLog.action, caseId: workspaceAuditLog.caseId })
          .from(workspaceAuditLog).where(eq(workspaceAuditLog.workspaceId, workspaceId));
        const savedSources = await db.select({ id: workspaceSavedSources.id, sourceId: workspaceSavedSources.sourceId })
          .from(workspaceSavedSources).where(eq(workspaceSavedSources.workspaceId, workspaceId));

        report.manifestBeforeCleanup = {
          workspaces,
          memberships,
          invites,
          cases: cases.map((item: any) => ({
            id: item.id,
            claim: item.claim,
            retrievedEvidenceIds: Array.isArray(item.evidence) ? item.evidence.map((e: any) => e.id).filter(Boolean) : [],
          })),
          manualEvidence,
          reviews,
          audit,
          savedSources,
        };

        await db.transaction(async (tx: any) => {
          await tx.delete(workspaceEvidence).where(eq(workspaceEvidence.workspaceId, workspaceId));
          await tx.delete(workspaceCaseReviews).where(eq(workspaceCaseReviews.workspaceId, workspaceId));
          await tx.delete(workspaceAuditLog).where(eq(workspaceAuditLog.workspaceId, workspaceId));
          if (caseIds.length) {
            await tx.delete(workspaceEvidence).where(inArray(workspaceEvidence.caseId, caseIds));
            await tx.delete(workspaceCaseReviews).where(inArray(workspaceCaseReviews.caseId, caseIds));
            await tx.delete(workspaceAuditLog).where(inArray(workspaceAuditLog.caseId, caseIds));
            await tx.delete(workspaceCases).where(inArray(workspaceCases.id, caseIds));
          }
          await tx.delete(workspaceSavedSources).where(eq(workspaceSavedSources.workspaceId, workspaceId));
          await tx.delete(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId));
          await tx.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
          await tx.delete(teamWorkspaces).where(eq(teamWorkspaces.id, workspaceId));
        });
        const remainingWorkspaceRows = {
          workspaces: (await db.select({ id: teamWorkspaces.id }).from(teamWorkspaces).where(eq(teamWorkspaces.id, workspaceId))).length,
          memberships: (await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))).length,
          invites: (await db.select({ id: workspaceInvites.id }).from(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId))).length,
          cases: (await db.select({ id: workspaceCases.id }).from(workspaceCases).where(eq(workspaceCases.workspaceId, workspaceId))).length,
          evidence: (await db.select({ id: workspaceEvidence.id }).from(workspaceEvidence).where(eq(workspaceEvidence.workspaceId, workspaceId))).length,
          reviews: (await db.select({ id: workspaceCaseReviews.id }).from(workspaceCaseReviews).where(eq(workspaceCaseReviews.workspaceId, workspaceId))).length,
          audit: (await db.select({ id: workspaceAuditLog.id }).from(workspaceAuditLog).where(eq(workspaceAuditLog.workspaceId, workspaceId))).length,
          savedSources: (await db.select({ id: workspaceSavedSources.id }).from(workspaceSavedSources).where(eq(workspaceSavedSources.workspaceId, workspaceId))).length,
        };
        report.cleanup = remainingWorkspaceRows;
        report.testRowsAfter = await globalE2eCounts();
        check("all temporary workspace rows removed", Object.values(remainingWorkspaceRows).every((count) => count === 0), remainingWorkspaceRows);
        check("no E2E_TEST_ data remains in development DB", Object.values(report.testRowsAfter).every((count: any) => count === 0), report.testRowsAfter);
      } else {
        report.cleanup = "no test workspace created";
        report.testRowsAfter = await globalE2eCounts();
        check("no E2E_TEST_ data remains in development DB", Object.values(report.testRowsAfter).every((count: any) => count === 0), report.testRowsAfter);
      }
    } catch (error: any) {
      report.cleanup = { error: String(error?.stack ?? error) };
      failedChecks.push("temporary-data cleanup failed");
    }
    if (server) await new Promise<void>((resolve) => server.close(resolve));
  }

  report.injectedFailureCallCounts = injectedCalls;
  t.diagnostic(JSON.stringify(report, null, 2));
  assert.equal(report.fatal, undefined, `Integration harness failed before completion: ${report.fatal ?? ""}`);
  assert.deepEqual(failedChecks, [], `E2E checks failed: ${failedChecks.join("; ")}`);
});