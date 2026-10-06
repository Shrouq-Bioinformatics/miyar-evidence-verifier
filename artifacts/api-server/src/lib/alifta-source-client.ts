export const ALIFTA_ORIGIN = "https://sunna.alifta.gov.sa";
export const ALIFTA_SOURCE_NAME =
  "جامع خادم الحرمين الشريفين للسنة النبوية المطهرة — HadithWeb";

export type AliftaBook = {
  index: number;
  id: number;
  title: string;
};

export type AliftaSearchForm = {
  token: string;
  books: readonly AliftaBook[];
};

export type SourceRequestBudget = {
  deadlineAt: number;
  maxRequests: number;
  requests: number;
};

export function createSourceRequestBudget(
  timeoutMs = 10_000,
  maxRequests = 10,
): SourceRequestBudget {
  return {
    deadlineAt: Date.now() + timeoutMs,
    maxRequests,
    requests: 0,
  };
}

export async function requestAliftaHtml(
  fetcher: typeof fetch,
  input: string | URL,
  budget: SourceRequestBudget,
  init: RequestInit = {},
): Promise<{ response: Response; html: string }> {
  const url = new URL(input, ALIFTA_ORIGIN);
  if (url.origin !== ALIFTA_ORIGIN) {
    throw new Error("alifta_origin_rejected");
  }
  if (budget.requests >= budget.maxRequests) {
    throw new Error("alifta_request_budget_exhausted");
  }

  const remainingMs = budget.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error("alifta_request_timeout");
  }

  budget.requests += 1;
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "Mozilla/5.0");
  }
  const response = await fetcher(url.toString(), {
    ...init,
    headers,
    signal: AbortSignal.timeout(Math.min(4_000, remainingMs)),
  });

  const finalUrl = response.url ? new URL(response.url) : url;
  if (finalUrl.origin !== ALIFTA_ORIGIN || !response.ok) {
    throw new Error("alifta_source_request_failed");
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !/html|xhtml/i.test(contentType)) {
    throw new Error("alifta_source_response_not_html");
  }

  return { response, html: await response.text() };
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => {
      const point = Number.parseInt(digits, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const point = Number.parseInt(digits, 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
      switch (entity.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return " ";
      }
    });
}

export function stripHtmlText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function getSetCookieHeader(headers: Headers): string {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values =
    extended.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  return values
    .flatMap((value) => value.split(/,(?=\s*[^;,\s]+=)/g))
    .map((cookie) => cookie.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function getAttribute(tag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ??
    ""
  );
}

export function parseAliftaSearchForm(html: string): AliftaSearchForm | null {
  const decoded = decodeHtmlEntities(html);
  const form = decoded.match(
    /<form\b[^>]*id=["']formSearch["'][^>]*>[\s\S]*?<\/form>/i,
  )?.[0];
  if (!form) return null;

  const tokenTag = [...form.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => getAttribute(tag, "name") === "__RequestVerificationToken");
  const token = tokenTag ? getAttribute(tokenTag, "value") : "";
  if (!token) return null;

  const idsByIndex = new Map<number, number>();
  for (const match of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = getAttribute(tag, "name");
    const indexMatch = name.match(/^Books\[(\d+)\]\.Id$/);
    const id = Number(getAttribute(tag, "value"));
    if (indexMatch && Number.isSafeInteger(id) && id > 0) {
      idsByIndex.set(Number(indexMatch[1]), id);
    }
  }

  const books: AliftaBook[] = [];
  for (const match of form.matchAll(
    /<span\b[^>]*id=["']Books_(\d+)__Selectedspan["'][^>]*>([\s\S]*?)<\/span>/gi,
  )) {
    const index = Number(match[1]);
    const id = idsByIndex.get(index);
    const title = stripHtmlText(match[2]);
    if (id && title) books.push({ index, id, title });
  }

  return { token, books };
}

export function getElementContents(html: string, id: string): string[] {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi",
  );
  return [...html.matchAll(pattern)].map((match) => match[2] ?? "");
}

export function normalizeArabicForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0640\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ى]/g, "ي")
    .toLowerCase();
}
