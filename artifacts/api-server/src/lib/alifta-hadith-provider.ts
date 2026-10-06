import type { RetrievedEvidence } from "./evidence";
import type { EvidenceProvider } from "./evidence-provider";
import {
  ALIFTA_ORIGIN,
  ALIFTA_SOURCE_NAME,
  createSourceRequestBudget,
  decodeHtmlEntities,
  getElementContents,
  getSetCookieHeader,
  normalizeArabicForSearch,
  parseAliftaSearchForm,
  requestAliftaHtml,
  stripHtmlText,
} from "./alifta-source-client";

type HadithCollection = "bukhari" | "muslim";

type HadithBook = {
  collection: HadithCollection;
  id: number;
  title: string;
};

type SearchHit = {
  book: HadithBook;
  mainId: number;
  url: string;
};

const HADITH_BOOKS: readonly HadithBook[] = [
  { collection: "bukhari", id: 1, title: "صحيح البخاري" },
  { collection: "muslim", id: 2, title: "صحيح مسلم" },
];

const PROVIDER_ID = "alifta-hadithweb-sahihayn";
const MAX_QUERY_LENGTH = 160;
const MAX_RESULTS = 3;

function quotedPhrase(text: string): string | null {
  const match =
    text.match(/«([^»]{4,500})»/u) ??
    text.match(/“([^”]{4,500})”/u) ??
    text.match(/"([^"]{4,500})"/u);
  return match?.[1]?.trim() || null;
}

export function extractHadithSearchPhrase(text: string): string | null {
  const quoted = quotedPhrase(text);
  let phrase = quoted ?? text;

  if (!quoted) {
    phrase = phrase
      .replace(
        /(?:صحيح\s*)?(?:البخاري|مسلم)|رواه|روى|حديث|الحديث|برقم|رقم(?:\s+الحديث)?/giu,
        " ",
      )
      .replace(/[0-9٠-٩۰-۹]+/gu, " ");
  }

  phrase = phrase
    .normalize("NFC")
    .replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
    .replace(/[^\p{L}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (phrase.length < 4) return null;
  const words = phrase.split(" ").filter((word) => word.length > 1);
  if (words.length < 2) return null;
  return phrase.slice(0, MAX_QUERY_LENGTH).trim();
}

function booksForClaim(text: string): HadithBook[] {
  const normalized = normalizeArabicForSearch(text);
  const hasBukhari = normalized.includes("البخاري") || /bukhari/i.test(text);
  const hasMuslim = normalized.includes("مسلم") || /muslim/i.test(text);

  if (hasBukhari && hasMuslim) {
    return HADITH_BOOKS.slice();
  }
  if (hasBukhari) {
    return HADITH_BOOKS.filter((book) => book.collection === "bukhari");
  }
  if (hasMuslim) {
    return HADITH_BOOKS.filter((book) => book.collection === "muslim");
  }
  return HADITH_BOOKS.slice();
}

function sourceUnavailable(reason: string) {
  return { status: "unavailable" as const, evidence: [], reason };
}

function sourceNoResults() {
  return { status: "no_results" as const, evidence: [], reason: "no_results" };
}

function parseSearchHits(
  html: string,
  selectedBooks: readonly HadithBook[],
): SearchHit[] {
  const decoded = decodeHtmlEntities(html);
  const byId = new Map(selectedBooks.map((book) => [book.id, book]));
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const match of decoded.matchAll(
    /<a\b[^>]*href=["']([^"']*\/BookToc\/ViewMatnPage\?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1];
    const url = new URL(href, ALIFTA_ORIGIN);
    if (url.origin !== ALIFTA_ORIGIN || url.pathname !== "/BookToc/ViewMatnPage") {
      continue;
    }

    const bookId = Number(
      url.searchParams.get("bookId") ?? url.searchParams.get("BookID"),
    );
    const mainId = Number(url.searchParams.get("mainId"));
    const book = byId.get(bookId);
    if (!book || !Number.isSafeInteger(mainId) || mainId <= 0) continue;
    if (!stripHtmlText(match[2]).includes(book.title)) continue;

    const key = `${bookId}:${mainId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const recordUrl = new URL("/BookToc/ViewMatnPage", ALIFTA_ORIGIN);
    recordUrl.searchParams.set("bookId", String(bookId));
    recordUrl.searchParams.set("mainId", String(mainId));
    hits.push({ book, mainId, url: recordUrl.toString() });
    if (hits.length >= MAX_RESULTS) break;
  }

  return hits;
}

function parseSourceNumber(value: string): number | null {
  const digits = value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return digit;
  });
  const firstNumber = digits.match(/\d+/)?.[0];
  if (!firstNumber) return null;
  const parsed = Number(firstNumber);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseHadithRecord(
  html: string,
  hit: SearchHit,
): RetrievedEvidence | null {
  const decoded = decodeHtmlEntities(html);
  const pageTitle = stripHtmlText(
    decoded.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  );
  if (!pageTitle.startsWith(hit.book.title)) return null;

  const content = getElementContents(decoded, "divMainContent")
    .map(stripHtmlText)
    .sort((left, right) => right.length - left.length)[0];
  const numberText = decoded.match(
    /<span\b[^>]*class=["'][^"']*\bHadithNum\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];
  const hadithNumber = numberText ? parseSourceNumber(stripHtmlText(numberText)) : null;
  if (!content || content.length < 20 || hadithNumber === null) return null;

  return {
    id: `alifta-hadith-${hit.book.id}-${hit.mainId}`,
    sourceId: `alifta-hadithweb-${hit.book.collection}`,
    sourceTitle: hit.book.title,
    sourceType: "hadith",
    sourceName: ALIFTA_SOURCE_NAME,
    sourceVersion: "HadithWeb direct record",
    hadithCollection: hit.book.collection,
    hadithNumber,
    reference: `${hit.book.title}، رقم حديث ويب ${hadithNumber}`,
    excerpt: content.slice(0, 6_000),
    url: hit.url,
    edition: "HadithWeb online record",
    retrievedAt: new Date().toISOString(),
    sourceDomain: "sunna.alifta.gov.sa",
    sourceProvider: PROVIDER_ID,
    pageTitle,
    sourceMetadataStatus: "verified",
  };
}

export function createAliftaHadithProvider(
  fetcher: typeof fetch = fetch,
): EvidenceProvider {
  return {
    id: PROVIDER_ID,
    supports: (claim) => claim.domain === "الحديث",
    async retrieve(claim) {
      const phrase = extractHadithSearchPhrase(claim.text);
      if (!phrase) return sourceNoResults();

      try {
        const budget = createSourceRequestBudget(10_000, 5);
        const formPage = await requestAliftaHtml(
          fetcher,
          `${ALIFTA_ORIGIN}/Search/TextSearchView`,
          budget,
        );
        const form = parseAliftaSearchForm(formPage.html);
        if (!form) return sourceUnavailable("search_form_unavailable");

        const selectedBooks = booksForClaim(claim.text);
        const verifiedBooks = selectedBooks.map((expected) => {
          const actual = form.books.find(
            (book) => book.id === expected.id && book.title === expected.title,
          );
          return actual ? expected : null;
        });
        if (verifiedBooks.some((book) => book === null)) {
          return sourceUnavailable("expected_book_missing");
        }

        const bookIds = selectedBooks.map((book) => book.id);
        const searchUrl = new URL("/Search/TextSearchResult", ALIFTA_ORIGIN);
        searchUrl.search = new URLSearchParams({
          SearchString: phrase,
          SearchType: "EXACT",
          SearchWordType: "Phrase",
          MatnBookSel: "True",
          ServiceBookSel: "False",
          MatnBookCheckAll: "False",
          ServiceBookCheckAll: "False",
          MatnBookId: `${bookIds.join(",")},`,
        }).toString();

        const searchPage = await requestAliftaHtml(
          fetcher,
          searchUrl,
          budget,
          {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              cookie: getSetCookieHeader(formPage.response.headers),
              referer: `${ALIFTA_ORIGIN}/Search/TextSearchView`,
            },
            body: new URLSearchParams({
              __RequestVerificationToken: form.token,
            }),
          },
        );
        const hits = parseSearchHits(searchPage.html, selectedBooks);
        if (hits.length === 0) return sourceNoResults();

        const evidence: RetrievedEvidence[] = [];
        for (const hit of hits) {
          const recordPage = await requestAliftaHtml(
            fetcher,
            hit.url,
            budget,
          );
          const record = parseHadithRecord(recordPage.html, hit);
          if (record) evidence.push(record);
        }

        return evidence.length
          ? { status: "available", evidence }
          : sourceUnavailable("source_record_unavailable");
      } catch {
        return sourceUnavailable("provider_error");
      }
    },
  };
}

export const aliftaHadithProvider = createAliftaHadithProvider();
