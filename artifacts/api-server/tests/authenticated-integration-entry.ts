import express, { type NextFunction, type Request, type Response } from "express";
import {
  db,
  teamWorkspaces,
  workspaceMembers,
  workspaceInvites,
  workspaceCases,
  workspaceEvidence,
  workspaceCaseReviews,
  workspaceAuditLog,
  workspaceSavedSources,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { APPROVED_EXTERNAL_DOMAINS } from "../src/lib/authoritative-web-retrieval.ts";
import { retrieveQuranEvidenceByReference } from "../src/lib/evidence.ts";
import { resolveAIProviderConfigs } from "../src/lib/ai-provider.ts";
import verifyRouter from "../src/routes/verify.ts";
import casesRouter from "../src/routes/cases.ts";
import workspacesRouter from "../src/routes/workspaces.ts";
import workspaceDataRouter from "../src/routes/workspace-data.ts";

type TestIdentityRequest = Request & { userId?: string };

export {
  APPROVED_EXTERNAL_DOMAINS,
  db,
  eq,
  inArray,
  resolveAIProviderConfigs,
  retrieveQuranEvidenceByReference,
  sql,
  teamWorkspaces,
  workspaceAuditLog,
  workspaceCaseReviews,
  workspaceCases,
  workspaceEvidence,
  workspaceInvites,
  workspaceMembers,
  workspaceSavedSources,
};

/**
 * Test-only Clerk boundary: the allowlisted fake subject becomes req.userId.
 * All workspace membership and role checks remain the real route code.
 */
export function createAuthenticatedIntegrationApp(allowedSubjects: readonly string[]) {
  const subjects = new Set(allowedSubjects);
  const app = express();

  app.use(express.json({ limit: "16kb" }));
  app.use((req: TestIdentityRequest, res: Response, next: NextFunction) => {
    const subject = req.get("x-e2e-test-clerk-subject");
    if (!subject || !subjects.has(subject)) {
      res.status(401).json({ error: "test Clerk identity required" });
      return;
    }
    req.userId = subject;
    (req as Request & { log?: Record<string, (...args: unknown[]) => void> }).log = {
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
    };
    next();
  });

  app.use("/api", verifyRouter);
  app.use("/api", casesRouter);
  app.use("/api", workspacesRouter);
  app.use("/api", workspaceDataRouter);
  app.use((
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    res.status(500).json({
      error: "test route request failed",
      type: error instanceof Error ? error.name : "unknown",
    });
  });
  return app;
}