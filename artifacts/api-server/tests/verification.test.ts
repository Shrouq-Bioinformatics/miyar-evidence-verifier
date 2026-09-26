import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  localVerify,
  normalizeProviderResult,
} from "../src/lib/verification.ts";
import { evidenceCatalog, retrieveEvidence } from "../src/lib/evidence.ts";

test("a fake Bukhari attribution is never treated as verified", () => {
  const result = localVerify("روى البخاري أن شرب القهوة بعد الفجر واجب");
  assert.equal(result.status, "needs_review");
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.sourceIds, []);
  assert.match(result.summary, /لم تُجلب مادته|لا يثبت/);
});

test("religiously sensitive generalizations require human review", () => {
  const result = localVerify("كل المسلمين يتصرفون بالطريقة نفسها دائمًا");
  assert.equal(result.status, "needs_review");
  assert.match(result.summary, /تعميم حساس/);
  assert.match(result.humanReviewReason, /جماعة دينية/);
});

test("a contemporary fatwa request is only triaged", () => {
  const result = localVerify("ما حكم العملات الرقمية في فتوى معاصرة؟");
  assert.equal(result.status, "needs_review");
  assert.equal(result.evidenceLevel, "غير كافٍ");
  assert.deepEqual(result.sourceIds, []);
});

test("source names do not become claim-specific sources", () => {
  const result = localVerify("هذا مذكور في القرآن وصحيح مسلم بلا رقم محدد");
  assert.equal(result.status, "needs_review");
  assert.deepEqual(result.sourceIds, []);
  assert.match(result.sourceNotes.join(" "), /لم يعثر مِعيار على دليل كافٍ ضمن المصادر المتاحة حاليًا/);
});

test("model-supported output is conservatively demoted and unmeasured", () => {
  const result = normalizeProviderResult({
    status: "supported",
    confidence: 99,
    evidenceLevel: "مرتفع",
    summary: "المطالبة صحيحة بحسب صحيح البخاري.",
    sourceIds: ["bukhari"],
    sourceNotes: ["ورد في البخاري."],
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.confidence, 0);
  assert.equal(result.evidenceLevel, "غير كافٍ");
  assert.deepEqual(result.sourceIds, []);
  assert.match(result.summary, /ملخص أولي من النموذج/);
  assert.match(result.summary, /لم يعثر مِعيار على دليل كافٍ ضمن المصادر المتاحة حاليًا/);
  assert.match(result.humanReviewReason, /خُفّضت/);
});

test("provider summaries remain visible but explicitly preliminary", () => {
  const result = normalizeProviderResult({
    status: "needs_review",
    summary: "قد تكون المسألة محل خلاف.",
  });
  assert.match(result.summary, /ملخص أولي من النموذج: قد تكون المسألة محل خلاف/);
  assert.match(result.modeNote, /للفرز الأولي فقط/);
});

test("retrieval returns bounded, claim-specific evidence", () => {
  const evidence = retrieveEvidence("ورد في صحيح البخاري أن الأعمال بالنيات.");
  assert.equal(evidence[0]?.id, "bukhari-hadith-1");
  assert.ok((evidence[0]?.score ?? 0) <= 1);
  assert.ok(evidence[0]?.reference.includes("حديث 1"));
  assert.ok(evidence[0]?.url.startsWith("https://"));
});

test("the complete Tanzil corpus has valid stable verse records", () => {
  const quranRecords = evidenceCatalog().filter(
    (record) => record.sourceType === "quran",
  );
  assert.equal(quranRecords.length, 6236);
  assert.equal(new Set(quranRecords.map((record) => record.surahNumber)).size, 114);
  assert.equal(
    quranRecords.filter((record) => record.surahNumber === 1).length,
    7,
  );
  assert.ok(
    quranRecords.every(
      (record) =>
        record.id === `quran-${record.surahNumber}-${record.ayahNumber}` &&
        Number.isInteger(record.surahNumber) &&
        (record.surahNumber ?? 0) >= 1 &&
        (record.surahNumber ?? 0) <= 114 &&
        Number.isInteger(record.ayahNumber) &&
        (record.ayahNumber ?? 0) >= 1 &&
        Boolean(record.surahName) &&
        record.sourceName === "Tanzil Project" &&
        record.sourceVersion === "1.1" &&
        record.url === "https://tanzil.net/",
    ),
  );
});

test("Arabic Quran searches match with or without diacritics", () => {
  const withDiacritics = retrieveEvidence(
    "يَا أَيُّهَا الَّذِينَ آمَنُوا أَوْفُوا بِالْعُقُودِ",
  );
  const withoutDiacritics = retrieveEvidence("يا ايها الذين امنوا اوفوا بالعقود");
  assert.ok(withDiacritics.some((item) => item.id === "quran-5-1"));
  assert.ok(withoutDiacritics.some((item) => item.id === "quran-5-1"));
});

test("the previous Quran demo search still retrieves Quran 16:90", () => {
  const evidence = retrieveEvidence(
    "إِنَّ اللَّهَ يَأْمُرُ بِالْعَدْلِ وَالإِحْسَانِ وَإِيتَاءِ ذِي الْقُرْبَىٰ",
  );
  assert.ok(evidence.some((item) => item.id === "quran-16-90"));
});

test("exact Quran phrases outrank and exclude weaker word-overlap matches", () => {
  const cases = [
    {
      claim: "إن الله يأمر بالعدل والإحسان",
      expectedId: "quran-16-90",
    },
    {
      claim: "وهو الذي جعل لكم النجوم",
      expectedId: "quran-6-97",
    },
  ];

  for (const { claim, expectedId } of cases) {
    const quranEvidence = retrieveEvidence(claim).filter(
      (item) => item.sourceType === "quran",
    );
    assert.deepEqual(
      quranEvidence.map((item) => item.id),
      [expectedId],
    );
    assert.equal(quranEvidence[0]?.score, 1);
  }
});

test("common Arabic words alone do not retrieve Quran evidence", () => {
  const evidence = retrieveEvidence("هو الذي إن الله لكم من في");
  assert.deepEqual(
    evidence.filter((item) => item.sourceType === "quran"),
    [],
  );
});

test("a partial distinctive Quran phrase still retrieves its verse", () => {
  const evidence = retrieveEvidence("تهتدوا بها في ظلمات البر والبحر");
  assert.ok(evidence.some((item) => item.id === "quran-6-97"));
});

test("distinctive token overlap works when the words are not an exact phrase", () => {
  const claim = "زيتونة مباركة لا شرقية ولا غربية";
  const evidence = retrieveEvidence(claim);
  const matchingVerse = evidence.find((item) => item.id === "quran-24-35");

  assert.ok(matchingVerse);
  assert.ok(!matchingVerse.excerpt.includes(claim));
  assert.ok(matchingVerse.score < 1);
});

test("a verse outside the previous demo excerpts can be retrieved", () => {
  const evidence = retrieveEvidence("وهو الذي جعل لكم النجوم لتهتدوا بها");
  assert.ok(evidence.some((item) => item.id === "quran-6-97"));
});

test("Quran evidence preserves the exact Tanzil text returned for display", () => {
  const rawTanzilText = readFileSync(
    new URL(
      "../data/tanzil-quran/text-v1.1/quran-simple-clean.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const rawVerseLine = rawTanzilText
    .split(/\r?\n/)
    .find((line) => line.startsWith("5|1|"));
  assert.ok(rawVerseLine);

  const evidence = retrieveEvidence("يا ايها الذين امنوا اوفوا بالعقود").find(
    (item) => item.id === "quran-5-1",
  );
  assert.ok(evidence);
  assert.equal(evidence.sourceTitle, "Quran / القرآن الكريم");
  assert.equal(evidence.reference, "سورة المائدة (5)، الآية 1");
  assert.equal(evidence.excerpt, rawVerseLine.slice("5|1|".length));
});

test("an unrelated statement does not retrieve Quran citations", () => {
  const evidence = retrieveEvidence("الطائرة تطير بسرعة فوق البحر");
  assert.deepEqual(
    evidence.filter((item) => item.sourceType === "quran"),
    [],
  );
});

test("the Sahih Muslim demo search remains available", () => {
  const evidence = retrieveEvidence("الدين النصيحة لمن؟");
  assert.equal(evidence[0]?.id, "muslim-faith-55");
});

test("provider cannot cite evidence that was not retrieved", () => {
  const evidence = retrieveEvidence("إنما الأعمال بالنيات");
  const result = normalizeProviderResult(
    {
      status: "supported",
      confidence: 90,
      evidenceLevel: "مرتفع",
      sourceIds: ["made-up-evidence-id", "bukhari-hadith-1"],
    },
    evidence,
  );
  assert.deepEqual(result.sourceIds, ["bukhari"]);
  assert.deepEqual(result.evidence.map((item) => item.id), ["bukhari-hadith-1"]);
});

test("a fabricated external evidence ID cannot be accepted", () => {
  const result = normalizeProviderResult({
    status: "supported",
    confidence: 95,
    sourceIds: ["external-web-not-retrieved"],
  }, []);

  assert.equal(result.status, "needs_review");
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.sourceIds, []);
  assert.deepEqual(result.evidence, []);
});

test("no accepted evidence produces the explicit available-sources limitation", () => {
  const result = normalizeProviderResult({
    status: "insufficient",
    summary: "لم أجد مرجعًا.",
    sourceIds: [],
  }, []);

  assert.equal(result.confidence, 0);
  assert.match(result.summary, /لم يعثر مِعيار على دليل كافٍ ضمن المصادر المتاحة حاليًا/);
  assert.match(result.summary, /لا تعني هذه النتيجة أن المقولة صحيحة أو خاطئة/);
});

test("model-provided URLs are removed from free-form result text", () => {
  const result = normalizeProviderResult({
    status: "needs_review",
    summary: "راجع هذا المصدر https://evil.example/fake.",
    sourceNotes: ["مصدر آخر: [صفحة](https://evil.example/page)"],
  }, []);

  assert.doesNotMatch(result.summary, /https?:\/\//);
  assert.doesNotMatch(result.sourceNotes.join(" "), /https?:\/\//);
  assert.deepEqual(result.evidence, []);
});