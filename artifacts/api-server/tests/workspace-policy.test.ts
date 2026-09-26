import assert from "node:assert/strict";
import test from "node:test";
import { allowedInitialCaseStatus, hasMeaningfulReviewerNote, isKnownSavedSource, mayManageWorkspace, mayReview } from "../src/lib/workspace-policy.ts";

test("only workspace owners and reviewers can make review decisions", () => {
  assert.equal(mayReview("owner"), true);
  assert.equal(mayReview("reviewer"), true);
  assert.equal(mayReview("member"), false);
  assert.equal(mayReview(null), false);
});

test("only workspace owners can manage workspace settings", () => {
  assert.equal(mayManageWorkspace("owner"), true);
  assert.equal(mayManageWorkspace("reviewer"), false);
  assert.equal(mayManageWorkspace("member"), false);
  assert.equal(mayManageWorkspace(null), false);
});

test("saved-source API accepts only catalog identifiers", () => {
  assert.equal(isKnownSavedSource("quran"), true);
  assert.equal(isKnownSavedSource("fiqh-academy"), true);
  assert.equal(isKnownSavedSource("https://example.com"), false);
  assert.equal(isKnownSavedSource(undefined), false);
});

test("new client-submitted cases cannot assert supported status", () => {
  assert.equal(allowedInitialCaseStatus("needs_review"), true);
  assert.equal(allowedInitialCaseStatus("insufficient"), true);
  assert.equal(allowedInitialCaseStatus("supported"), false);
  assert.equal(allowedInitialCaseStatus(undefined), false);
});

test("review decisions require a meaningful non-whitespace note", () => {
  assert.equal(hasMeaningfulReviewerNote("   "), false);
  assert.equal(hasMeaningfulReviewerNote("looks good"), false);
  assert.equal(hasMeaningfulReviewerNote("Reviewed source and context"), true);
});