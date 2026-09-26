import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

export type AuthenticatedRequest = Request & {
  userId?: string;
};

export function requestUserId(req: Request): string | null {
  const auth = getAuth(req);
  const authWithClaims = auth as typeof auth & {
    sessionClaims?: { userId?: string };
  };
  return authWithClaims.userId ?? authWithClaims.sessionClaims?.userId ?? null;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const userId = requestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "يلزم تسجيل الدخول للوصول إلى مساحة العمل." });
    return;
  }
  req.userId = userId;
  next();
}