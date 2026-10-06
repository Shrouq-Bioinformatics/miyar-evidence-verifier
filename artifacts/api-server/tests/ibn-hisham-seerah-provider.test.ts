import assert from "node:assert/strict";
import { test } from "node:test";
import { createIbnHishamSeerahProvider } from "../src/lib/ibn-hisham-seerah-provider";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

test("Ibn Hisham provider follows matching official TOC entries to direct text", async () => {
  const requestedUrls: string[] = [];
  const provider = createIbnHishamSeerahProvider(async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url.toString());

    if (url.pathname === "/Book/Details") {
      assert.equal(url.searchParams.get("bookId"), "81");
      return htmlResponse(
        "<title>السيرة النبوية</title><main>سيرة ابن هشام، المؤلف عبد الملك بن هشام</main>",
      );
    }
    if (url.pathname === "/BookToc/ViewBookTocLevel") {
      assert.equal(url.searchParams.get("BookId"), "81");
      const parentId = url.searchParams.get("ParentId");
      if (parentId === "0") {
        return htmlResponse(
          [
            '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814221&amp;IsLeaf=False">مَبْعَثُ النَّبِيِّ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ</a>',
            '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814222&amp;IsLeaf=False">وِلَادَةُ النَّبِيِّ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ</a>',
            '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814223&amp;IsLeaf=False">حَدِيثُ النَّبِيِّ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ</a>',
            '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814615&amp;IsLeaf=False">هِجْرَةُ مُسْلِمِي مَكَّةَ</a>',
            '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814631&amp;IsLeaf=False">هِجْرَةُ الرَّسُولِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ</a>',
          ].join(""),
        );
      }
      if (parentId === "814615") {
        return htmlResponse(
          '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814616&amp;IsLeaf=True">خَبَرٌ فِي مَكَّةَ</a>',
        );
      }
      if (parentId === "814616") {
        assert.equal(url.searchParams.get("IsLeaf"), "True");
        return htmlResponse(
          '<title>السيرة النبوية - HadithWeb</title><div id="divMainContent">[خبر في مكة] قال ابن هشام: دار الحديث في مكة ضمن أبواب مختلفة.</div>',
        );
      }
      if (parentId === "814631") {
        return htmlResponse(
          '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814642&amp;IsLeaf=False">حَدِيثُ هِجْرَتِهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ إلَى الْمَدِينَةِ</a>',
        );
      }
      if (parentId === "814642") {
        return htmlResponse(
          '<a href="/BookToc/ViewBookTocLevel?BookId=81&amp;ParentId=814643&amp;IsLeaf=True">حَدِيثُ هِجْرَتِهِ إلَى الْمَدِينَةِ</a>',
        );
      }
      if (parentId === "814643") {
        assert.equal(url.searchParams.get("IsLeaf"), "True");
        return htmlResponse(
          '<title>السيرة النبوية - HadithWeb</title><div id="divMainContent">[حَدِيثُ هِجْرَتِهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ إلَى الْمَدِينَةِ] قال ابن إسحاق: فحدثني من لا أتهم عن عروة بن الزبير، عن عائشة أم المؤمنين. <span>[1/485]</span></div>',
        );
      }
    }
    throw new Error(`Unexpected source URL: ${url.toString()}`);
  });

  assert.equal(provider.supports({ text: "الهجرة", domain: "السيرة" }), true);
  assert.equal(provider.supports({ text: "الهجرة", domain: "الحديث" }), false);

  const result = await provider.retrieve({
    text: "تذكر السيرة النبوية لابن هشام خبر هجرة النبي صلى الله عليه وسلم من مكة إلى المدينة.",
    domain: "السيرة",
  });

  assert.equal(result.status, "available");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.sourceType, "seerah");
  assert.equal(result.evidence[0]?.sourceTitle, "السيرة النبوية لابن هشام");
  assert.match(result.evidence[0]?.excerpt ?? "", /قال ابن إسحاق/);
  assert.match(result.evidence[0]?.reference ?? "", /المجلد 1، الصفحة 485/);
  assert.equal(
    result.evidence[0]?.url,
    "https://sunna.alifta.gov.sa/BookToc/ViewBookTocLevel?BookId=81&ParentId=814643&IsLeaf=True",
  );
  assert.equal(requestedUrls.length, 7);
  assert.equal(
    requestedUrls.some((url) => new URL(url).searchParams.get("ParentId") === "814221"),
    false,
  );
  assert.ok(
    requestedUrls.some((url) => new URL(url).searchParams.get("ParentId") === "814616"),
  );
  assert.ok(
    requestedUrls.every((url) => new URL(url).origin === "https://sunna.alifta.gov.sa"),
  );
});

test("Ibn Hisham provider does not search without a topical claim", async () => {
  let requests = 0;
  const provider = createIbnHishamSeerahProvider(async () => {
    requests += 1;
    throw new Error("unexpected network request");
  });

  const result = await provider.retrieve({
    text: "ذكر ابن هشام",
    domain: "السيرة",
  });

  assert.equal(result.status, "no_results");
  assert.equal(requests, 0);
});

test("Ibn Hisham provider isolates official-source failures", async () => {
  const provider = createIbnHishamSeerahProvider(async () => {
    throw new TypeError("network unavailable");
  });

  const result = await provider.retrieve({
    text: "الهجرة إلى المدينة",
    domain: "السيرة",
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.evidence, []);
});
