import { Router, Request, Response } from "express";
import supabase from "../db";

const router = Router();

function setSessionCookie(res: Response, id_usuario: number) {
  res.cookie("ph_session", String(id_usuario), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

/* Verificar sesión activa */
router.get("/me", async (req: Request, res: Response) => {
  const id = (req as any).signedCookies?.ph_session;
  if (!id) return res.status(401).json({ success: false });
  const { data, error } = await supabase.from("usuario").select("*").eq("id_usuario", id).maybeSingle();
  if (error || !data) return res.status(401).json({ success: false });
  res.json({ success: true, user: data });
});

/* Cerrar sesión */
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("ph_session", { path: "/" });
  res.json({ success: true });
});

/* Login con correo/contraseña */
router.post("/login", async (req: Request, res: Response) => {
  const { correo, contrasena } = req.body;
  const { data, error } = await supabase.rpc("fn_login", {
    p_identificador: correo,
    p_contrasena: contrasena,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data.success) return res.status(401).json(data);
  setSessionCookie(res, data.user.id_usuario);
  res.json(data);
});

/* Registro con correo/contraseña */
router.post("/registro", async (req: Request, res: Response) => {
  const { correo, nombre_usuario, nickname, contrasena } = req.body;
  const { data, error } = await supabase.rpc("fn_registro", {
    p_nombre_usuario: nombre_usuario,
    p_correo: correo,
    p_contrasena: contrasena,
    p_nickname: nickname,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data.success) return res.status(400).json(data);
  setSessionCookie(res, data.user.id_usuario);
  res.json(data);
});

/* OAuth Google — sincronizar usuario */
router.post("/google-sync", async (req: Request, res: Response) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ success: false, error: "Token requerido" });

  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(access_token);
  if (authError || !authUser) return res.status(401).json({ success: false, error: "Token inválido" });

  const correo = authUser.email!;
  const nombre = authUser.user_metadata?.full_name || authUser.user_metadata?.name || correo.split("@")[0];

  const { data: existing } = await supabase.from("usuario").select("*").eq("correo", correo).maybeSingle();
  if (existing) {
    setSessionCookie(res, existing.id_usuario);
    return res.json({ success: true, isNew: false, user: existing });
  }

  res.json({ success: true, isNew: true, correo, nombre });
});

/* OAuth Google — crear cuenta nueva con nickname */
router.post("/google-register", async (req: Request, res: Response) => {
  const { correo, nombre, nickname } = req.body;
  if (!correo || !nickname) return res.status(400).json({ success: false, error: "Datos incompletos" });

  const { data: existe } = await supabase.from("usuario").select("id_usuario").eq("nickname", nickname).maybeSingle();
  if (existe) return res.status(400).json({ success: false, error: "Ese nickname ya está en uso" });

  const { data: newUser, error } = await supabase
    .from("usuario")
    .insert({ nombre_usuario: nombre, correo, contrasena: "", nickname, dinero: 1000 })
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  setSessionCookie(res, newUser.id_usuario);
  res.json({ success: true, user: newUser });
});

export default router;
