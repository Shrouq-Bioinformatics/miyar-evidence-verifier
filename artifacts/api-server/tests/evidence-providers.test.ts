import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceProviders } from "../src/lib/evidence-providers";

test("the central registry contains only unique, source-specific live providers", () => {
  const ids = evidenceProviders.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);

  const providersFor = (domain: string) =>
    evidenceProviders.filter((provider) =>
      provider.supports({ text: "اختبار نطاق المصدر", domain }),
    );

  assert.deepEqual(
    providersFor("التفسير").map((provider) => provider.id),
    ["quranenc-arabic-mokhtasar-tafsir"],
  );
  assert.deepEqual(
    providersFor("الحديث").map((provider) => provider.id),
    ["alifta-hadithweb-sahihayn"],
  );
  assert.deepEqual(
    providersFor("السيرة").map((provider) => provider.id),
    ["alifta-hadithweb-ibn-hisham-seerah"],
  );

  for (const unavailableDomain of [
    "العقيدة",
    "الفقه",
    "الشبهات",
    "المصطلحات",
  ]) {
    assert.deepEqual(providersFor(unavailableDomain), []);
  }
});
