// Adapted from the tested provider in:
// https://github.com/Shrouq-Bioinformatics/miyar-evidence-verifier
// MIT-licensed; see data/upstream-miyar/LICENSE.
import { randomUUID } from "node:crypto";
import {
  retrieveEvidence,
  retrieveQuranEvidenceByReference,
  type RetrievedEvidence,
} from "./evidence";

export const QURANENC_TAFSIR_EDITION = "المختصر في تفسير القرآن الكريم";
const QURANENC_API_BASE =
  "https://quranenc.com/api/v1/translation/aya/arabic_mokhtasar";
const QURANENC_PAGE_BASE =
  "https://quranenc.com/ar/browse/arabic_mokhtasar";
const QURANENC_TIMEOUT_MS = 12_000;

export type QuranEncTafsirResult = {
  status: "available" | "no_results" | "unavailable";
  evidence: RetrievedEvidence[];
  reason?: "http_error" | "timeout" | "request_failed" | "invalid_response";
};

type QuranEncApiResult = {
  sura?: unknown;
  aya?: unknown;
  translation?: unknown;
};

type QuranEncApiPayload = {
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function isExplicitTafsirRequest(claim: string): boolean {
  return /(?:تفسير|التفسير|فسر|فسّر|اشرح|شرح|معنى|معاني|ماذا\s+تعني|tafsir|explain(?:ation)?|meaning|interpret(?:ation)?|commentary|explication|interprét|sens)/iu.test(
    claim,
  );
}

function parseExplicitVerseReference(
  claim: string,
): { surahReference: number | string; ayahNumber: number } | null {
  const normalized = normalizeDigits(claim);
  if (/(?:آية|اية)\s*الكرسي|ayat(?:\s+al)?[-\s]*kursi|verse\s+of\s+the\s+throne/iu.test(normalized)) {
    return { surahReference: 2, ayahNumber: 255 };
  }

  const numericReference =
    /(?:qur['’]?an|quran|القرآن|قرآن|سورة|surah|sura|ayah|verse|آية|الآية)?\s*(\d{1,3})\s*[:/]\s*(\d{1,3})/iu.exec(
      normalized,
    );
  if (numericReference) {
    return {
      surahReference: Number(numericReference[1]),
      ayahNumber: Number(numericReference[2]),
    };
  }

  const namedReference =
    /(?:سورة|surah|sura)\s+(.+?)\s+(?:(?:الآية|آية|ayah|verse)\s*)?(\d{1,3})(?!\d)/iu.exec(
      normalized,
    );
  if (!namedReference) return null;

  const surahReference = namedReference[1]
    .trim()
    .replace(/\s+(?:الآية|آية|ayah|verse)$/iu, "")
    .trim();
  return surahReference
    ? {
        surahReference,
        ayahNumber: Number(namedReference[2]),
      }
    : null;
}

async function retrieveOneTafsir(
  verse: RetrievedEvidence,
  retrievedAt: string,
  fetcher: typeof fetch,
): Promise<
  | { evidence: RetrievedEvidence; reason?: never }
  | { evidence?: never; reason: NonNullable<QuranEncTafsirResult["reason"]> }
> {
  const surahNumber = verse.surahNumber;
  const ayahNumber = verse.ayahNumber;
  if (
    !Number.isSafeInteger(surahNumber) ||
    !Number.isSafeInteger(ayahNumber) ||
    !surahNumber ||
    !ayahNumber
  ) {
    return { reason: "invalid_response" };
  }

  try {
    const response = await fetcher(
      `${QURANENC_API_BASE}/${surahNumber}/${ayahNumber}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(QURANENC_TIMEOUT_MS),
      },
    );
    if (!response.ok) return { reason: "http_error" };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { reason: "invalid_response" };
    }

    const rawResult = isRecord(payload) ? (payload as QuranEncApiPayload).result : undefined;
    if (!isRecord(rawResult)) return { reason: "invalid_response" };
    const result = rawResult as QuranEncApiResult;
    const returnedSurah = Number(result.sura);
    const returnedAyah = Number(result.aya);
    if (
      returnedSurah !== surahNumber ||
      returnedAyah !== ayahNumber ||
      typeof result.translation !== "string" ||
      !result.translation.trim()
    ) {
      return { reason: "invalid_response" };
    }

    const surahName = verse.surahName ?? String(surahNumber);
    return {
      evidence: {
        id: `tafsir-${randomUUID()}`,
        sourceId: "quranenc:arabic_mokhtasar",
        sourceTitle: "QuranEnc",
        sourceType: "tafsir",
        sourceName: "QuranEnc",
        sourceDomain: "quranenc.com",
        sourceProvider: "QuranEnc",
        surahNumber,
        surahName,
        ayahNumber,
        reference: `تفسير سورة ${surahName} (${surahNumber})، الآية ${ayahNumber}`,
        tafsirText: result.translation,
        url: `${QURANENC_PAGE_BASE}/${surahNumber}/${ayahNumber}`,
        edition: QURANENC_TAFSIR_EDITION,
        retrievedAt,
      },
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    return {
      reason:
        errorName === "TimeoutError" || errorName === "AbortError"
          ? "timeout"
          : "request_failed",
    };
  }
}

export async function retrieveQuranEncTafsirEvidence(
  quranEvidence: readonly RetrievedEvidence[],
  {
    retrievedAt = new Date().toISOString(),
    fetcher = fetch,
  }: {
    retrievedAt?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<QuranEncTafsirResult> {
  const selectedVerses = new Map<string, RetrievedEvidence>();
  for (const item of quranEvidence) {
    if (
      item.sourceType === "quran" &&
      Number.isSafeInteger(item.surahNumber) &&
      Number.isSafeInteger(item.ayahNumber) &&
      item.surahNumber &&
      item.ayahNumber
    ) {
      selectedVerses.set(
        `${item.surahNumber}:${item.ayahNumber}`,
        item,
      );
    }
  }
  if (selectedVerses.size === 0) {
    return { status: "no_results", evidence: [] };
  }

  const outcomes = await Promise.all(
    [...selectedVerses.values()].map((verse) =>
      retrieveOneTafsir(verse, retrievedAt, fetcher),
    ),
  );
  const evidence = outcomes.flatMap((outcome) =>
    outcome.evidence ? [outcome.evidence] : [],
  );
  if (evidence.length > 0) return { status: "available", evidence };
  return {
    status: "unavailable",
    evidence: [],
    reason:
      outcomes.find((outcome) => outcome.reason)?.reason ?? "invalid_response",
  };
}

export async function retrieveLocalQuranAndTafsir(
  claim: string,
  {
    retrievedAt = new Date().toISOString(),
    fetcher = fetch,
  }: {
    retrievedAt?: string;
    fetcher?: typeof fetch;
  } = {},
): Promise<{
  localEvidence: RetrievedEvidence[];
  tafsir: QuranEncTafsirResult;
}> {
  const localEvidence = retrieveEvidence(claim, retrievedAt);
  if (isExplicitTafsirRequest(claim)) {
    const reference = parseExplicitVerseReference(claim);
    if (reference) {
      const referencedVerse = retrieveQuranEvidenceByReference(
        reference.surahReference,
        reference.ayahNumber,
        retrievedAt,
      );
      if (
        referencedVerse &&
        !localEvidence.some((item) => item.id === referencedVerse.id)
      ) {
        localEvidence.push(referencedVerse);
      }
    }
  }

  const relevantQuran = localEvidence.filter(
    (item) => item.sourceType === "quran",
  );
  const tafsir = await retrieveQuranEncTafsirEvidence(relevantQuran, {
    retrievedAt,
    fetcher,
  });
  return { localEvidence, tafsir };
}
