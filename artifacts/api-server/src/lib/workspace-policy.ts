export type WorkspaceRole = "owner" | "reviewer" | "member";

export const savedSourceIds = new Set([
  "quran",
  "bukhari",
  "muslim",
  "bin-baz",
  "altafsir",
  "fiqh-academy",
]);

export function mayReview(role: string | null | undefined): boolean {
  return role === "owner" || role === "reviewer";
}

export function mayManageWorkspace(role: string | null | undefined): boolean {
  return role === "owner";
}

export function isKnownSavedSource(sourceId: unknown): sourceId is string {
  return typeof sourceId === "string" && savedSourceIds.has(sourceId);
}

export function allowedInitialCaseStatus(status: unknown): status is "needs_review" | "insufficient" {
  return status === "needs_review" || status === "insufficient";
}

export function hasMeaningfulReviewerNote(note: unknown, minimumLength = 12): note is string {
  return typeof note === "string" && note.trim().length >= minimumLength;
}