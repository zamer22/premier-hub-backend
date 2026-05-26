import type { Request } from "express";

const SESSION_COOKIE_NAME = "ph_session";

export function getSessionUserId(req: Request): number | null {
  const sessionUserId = (
    req.signedCookies as Record<string, string | undefined>
  )?.[SESSION_COOKIE_NAME];

  if (!sessionUserId) {
    return null;
  }

  const parsed = Number(sessionUserId);
  return Number.isNaN(parsed) ? null : parsed;
}
