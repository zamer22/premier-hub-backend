import type { Request, Response, NextFunction } from "express";
import supabase from "../db";

const SESSION_COOKIE_NAME = "ph_session";

/*
Extension del tipo Request de Express para incluir userId.
Las rutas que pasan por requireAuth pueden leer req.userId como number garantizado.
*/
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

/*
Funcion getSessionUserId
Lee el id de usuario desde la cookie de sesion firmada (ph_session).
Devuelve null si no hay sesion valida. NO escribe en la respuesta.
Usar en rutas con autenticacion opcional (por ejemplo, contenido publico que
muestra estado distinto si el visitante esta logueado).
*/
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

/*
Middleware requireAuth
Exige que la peticion traiga una cookie de sesion firmada valida.
Si la cookie es valida, monta req.userId y llama a next().
Si no, responde 401 y corta el flujo.
NO acepta id_usuario desde body, query ni headers — solo cookie firmada.
*/
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = getSessionUserId(req);

  if (!userId) {
    res.status(401).json({ success: false, error: "Sesion no valida" });
    return;
  }

  req.userId = userId;
  next();
}

/*
Middleware requireAdmin
Exige sesion valida (requireAuth) y que el usuario tenga es_admin = true en la BD.
Consulta la columna usuario.es_admin con el id que viene de la cookie firmada.
Nunca confiar en datos del cliente para decidir si alguien es admin.
*/
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getSessionUserId(req);

  if (!userId) {
    res.status(401).json({ success: false, error: "Sesion no valida" });
    return;
  }

  const { data, error } = await supabase
    .from("usuario")
    .select("es_admin")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  if (!data || !data.es_admin) {
    res.status(403).json({ success: false, error: "Acceso solo para administradores" });
    return;
  }

  req.userId = userId;
  next();
}
