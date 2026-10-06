import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAliftaHadithProvider,
  extractHadithSearchPhrase,
} from "../src/lib/alifta-hadith-provider";

const searchForm = `
  <form method="post" id="formSearch">
    <input name="__RequestVerificationToken" value="test-csrf-token" />
    <input type="hidden" name="Books[0].Id" value="1" />
    <span id="Books_0__Selectedspan">صحيح البخاري</span>
    <input type="hidden" name="Books[1].Id" value="2" />
    <span id="Books_1__Selectedspan">صحيح مسلم</span>
  </form>`;

const bukhariRecord = `
  <html><head><title>صحيح البخاري - HadithWeb</title></head>
  <body>
    <span class="HadithNum">1</span>
    <div id="divMainContent">إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى</div>
  </body></html>`;

function htmlResponse(
  html: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

test("HadithWeb retrieves a direct Bukhari record from its exact book index", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const provider = createAliftaHadithProvider(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });

    if (url.pathname === "/Search/TextSearchView") {
      return htmlResponse(searchForm, {
        "set-cookie": "alifta-session=source-session; Path=/; HttpOnly",
      });
    }
    if (url.pathname === "/Search/TextSearchResult") {
      assert.equal(init?.method, "POST");
      assert.equal(url.searchParams.get("MatnBookId"), "1,");
      assert.equal(url.searchParams.get("SearchType"), "EXACT");
      assert.equal(url.searchParams.get("SearchWordType"), "Phrase");
      assert.match(String(init?.body), /test-csrf-token/);
      assert.match(String(new Headers(init?.headers).get("cookie")), /alifta-session=source-session/);
      return htmlResponse(
        '<a href="/BookToc/ViewMatnPage?bookId=1&amp;mainId=5">صحيح البخاري — إنما الأعمال بالنيات</a>',
      );
    }
    if (url.pathname === "/BookToc/ViewMatnPage") {
      assert.equal(url.searchParams.get("bookId"), "1");
      assert.equal(url.searchParams.get("mainId"), "5");
      return htmlResponse(bukhariRecord);
    }
    throw new Error(`Unexpected source URL: ${url.toString()}`);
  });

  assert.equal(
    extractHadithSearchPhrase("حديث «إنما الأعمال بالنيات» رواه البخاري برقم 1"),
    "إنما الأعمال بالنيات",
  );
  assert.equal(provider.supports({ text: "حديث", domain: "الحديث" }), true);
  assert.equal(provider.supports({ text: "حديث", domain: "السيرة" }), false);

  const result = await provider.retrieve({
    text: "حديث «إنما الأعمال بالنيات» رواه البخاري برقم 1",
    domain: "الحديث",
  });

  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.sourceTitle, "صحيح البخاري");
  assert.equal(result.evidence[0]?.sourceType, "hadith");
  assert.equal(result.evidence[0]?.hadithCollection, "bukhari");
  assert.equal(result.evidence[0]?.hadithNumber, 1);
  assert.match(result.evidence[0]?.excerpt ?? "", /الأَعْمَالُ بِالنِّيَّاتِ/);
  assert.equal(
    result.evidence[0]?.url,
    "https://sunna.alifta.gov.sa/BookToc/ViewMatnPage?bookId=1&mainId=5",
  );
  assert.equal(calls.length, 3);
});

test("HadithWeb rejects results from a different Sahih collection", async () => {
  const provider = createAliftaHadithProvider(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/Search/TextSearchView") {
      return htmlResponse(searchForm);
    }
    if (url.pathname === "/Search/TextSearchResult") {
      return htmlResponse(
        '<a href="/BookToc/ViewMatnPage?bookId=2&amp;mainId=55">صحيح مسلم — متن مطابق</a>',
      );
    }
    throw new Error(`Unexpected source URL: ${url.toString()}`);
  });

  const result = await provider.retrieve({
    text: "حديث «إنما الأعمال بالنيات» رواه البخاري برقم 1",
    domain: "الحديث",
  });

  assert.equal(result.status, "no_results");
  assert.deepEqual(result.evidence, []);
});

test("HadithWeb request failures are isolated as unavailable", async () => {
  const provider = createAliftaHadithProvider(async () => {
    throw new TypeError("network unavailable");
  });

  const result = await provider.retrieve({
    text: "حديث «إنما الأعمال بالنيات» رواه البخاري برقم 1",
    domain: "الحديث",
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.evidence, []);
});
