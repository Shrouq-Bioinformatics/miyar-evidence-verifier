import assert from "node:assert/strict";
import { test } from "node:test";
import type { RetrievedEvidence } from "../src/lib/evidence";
import {
  checkExplicitHadithReference,
  duplicatesExplicitHadithReference,
  requiresSeerahAuthenticationReview,
} from "../src/lib/source-safety";

function bukhariRecord(number: number): RetrievedEvidence {
  return {
    id: `hadith-${number}`,
    sourceId: "alifta-hadithweb-bukhari",
    sourceTitle: "صحيح البخاري",
    sourceType: "hadith",
    hadithCollection: "bukhari",
    hadithNumber: number,
    reference: `صحيح البخاري، رقم حديث ويب ${number}`,
    excerpt: "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ",
    url: "https://sunna.alifta.gov.sa/BookToc/ViewMatnPage?bookId=1&mainId=5",
    edition: "HadithWeb online record",
    retrievedAt: "2026-10-06T00:00:00.000Z",
  };
}

test("explicit Bukhari number mismatch is not treated as verified", () => {
  const result = checkExplicitHadithReference(
    "حديث «إنما الأعمال بالنيات» رواه البخاري برقم 999999.",
    [bukhariRecord(1)],
  );

  assert.equal(result?.kind, "mismatch");
  assert.match(result?.reason ?? "", /رقم 999999/);
  assert.match(result?.reason ?? "", /قد تختلف الإحالات بين الطبعات/);
  assert.equal(result?.evidence[0]?.hadithNumber, 1);
});

test("matching Arabic-Indic source number remains edition-specific", () => {
  const result = checkExplicitHadithReference(
    "رواه صحيح البخاري رقم ١.",
    [bukhariRecord(1)],
  );

  assert.equal(result?.kind, "match");
  assert.equal(result?.evidence[0]?.hadithNumber, 1);
});

test("an extracted quotation cannot bypass its explicit Hadith number check", () => {
  const reference =
    "قال النبي ﷺ: «إنما الأعمال بالنيات» رواه صحيح البخاري برقم 999999.";

  assert.equal(
    duplicatesExplicitHadithReference("إنما الأعمال بالنيات", reference),
    true,
  );
  assert.equal(
    duplicatesExplicitHadithReference(
      "حديث «إنما الأعمال بالنيات»",
      reference,
    ),
    true,
  );
  assert.equal(
    duplicatesExplicitHadithReference(
      "ثبتت صحة حديث «إنما الأعمال بالنيات»",
      reference,
    ),
    false,
  );
});

test("a Seerah passage never verifies a hadith-authentication claim", () => {
  assert.equal(
    requiresSeerahAuthenticationReview(
      "ذكر ابن هشام خبرًا عن الهجرة، وهذا وحده يثبت صحة الرواية حديثيًا.",
    ),
    true,
  );
  assert.equal(
    requiresSeerahAuthenticationReview(
      "ذكر ابن هشام خبر الهجرة إلى المدينة.",
    ),
    false,
  );
});
