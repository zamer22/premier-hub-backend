import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

const SESSION_COOKIE_NAME = "ph_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const SESSION_COOKIE_PATH = "/";
const INITIAL_MONEY = 1000;

interface LoginRequestBody {
  correo: string;
  contrasena: string;
}

interface RegistroRequestBody {
  correo: string;
  nombre_usuario: string;
  nickname: string;
  contrasena: string;
}

interface GoogleSyncRequestBody {
  access_token: string;
}

interface GoogleRegisterRequestBody {
  correo: string;
  nombre_usuario: string;
  nickname: string;
  foto_perfil_url?: string;
}

interface DeleteAccountRequestBody {
  confirmacion: string;
}

interface ProfileUpdateRequestBody {
  nombre_usuario?: string;
  nickname?: string;
}

interface ProfileCustomizationBody {
  marco_inventario_id?: number | null;
  titulo_inventario_id?: number | null;
  banner_inventario_id?: number | null;
  trofeo_inventario_id?: number | null;
}

interface ProfilePhotoBody {
  imageData: string;
  fileName?: string;
}

interface ProfileSavesBody {
  saves: number;
}

type EquipSlotColumn =
  | "marco_inventario_id"
  | "titulo_inventario_id"
  | "banner_inventario_id"
  | "trofeo_inventario_id";

const PROFILE_PICTURES_BUCKET = "profilePictures";
const POINTS_PER_SAVE = 10;

// Crea la cookie ph_session firmada con COOKIE_SECRET. httpOnly = JS del browser no puede leerla.
function setSessionCookie(response: Response, userId: number): void {
  response.cookie(SESSION_COOKIE_NAME, String(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    maxAge: SESSION_DURATION_MS,
    path: SESSION_COOKIE_PATH,
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    path: SESSION_COOKIE_PATH,
  });
}

// Lee ph_session de req.signedCookies y devuelve el id_usuario (o null si no hay sesión).
function getSessionUserId(req: Request): number | null {
  const sessionUserId = (
    req.signedCookies as Record<string, string | undefined>
  )?.[SESSION_COOKIE_NAME];

  if (!sessionUserId) {
    return null;
  }

  const parsed = Number(sessionUserId);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseDataUrl(value: string): { buffer: Buffer; contentType: string; extension: string } {
  const match = value.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);

  if (!match) {
    throw new Error("Formato de imagen invalido");
  }

  const contentType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const extension = contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1];
  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("La imagen debe pesar menos de 5 MB");
  }

  return { buffer, contentType, extension };
}

async function getCustomization(userId: number) {
  const { data, error } = await supabase
    .from("usuario_equipamiento")
    .select("*")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || {
    id_usuario: userId,
    marco_inventario_id: null,
    titulo_inventario_id: null,
    banner_inventario_id: null,
    trofeo_inventario_id: null,
  };
}

async function assertOwnedEquipable(
  userId: number,
  inventoryId: number | null | undefined,
  allowedTypes: string[],
): Promise<void> {
  if (inventoryId === null || inventoryId === undefined) {
    return;
  }

  const { data, error } = await supabase.rpc("fn_mis_items", {
    p_id_usuario: userId,
  });

  if (error) {
    throw error;
  }

  const item = (data || []).find((row: any) => Number(row.id_inventario) === Number(inventoryId));

  if (!item) {
    throw new Error("Ese item no pertenece al usuario");
  }

  if (!allowedTypes.includes(item.tipo)) {
    throw new Error(`El item no se puede equipar como ${allowedTypes.join(", ")}`);
  }
}

function getGoogleDisplayName(authUser: {
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
  };
}): string {
  const email = authUser.email ?? "";
  return (
    authUser.user_metadata?.full_name ??
    authUser.user_metadata?.name ??
    email.split("@")[0]
  );
}

function getGoogleAvatarUrl(authUser: {
  user_metadata?: {
    avatar_url?: string;
    picture?: string;
  };
}): string {
  return authUser.user_metadata?.avatar_url ?? authUser.user_metadata?.picture ?? "";
}

// Devuelve el usuario completo (incluyendo es_admin) si hay cookie de sesión válida.
router.get("/me", async (req: Request, res: Response) => {
  const sessionUserId = (
    req.signedCookies as Record<string, string | undefined>
  )?.ph_session;

  if (!sessionUserId) {
    res.status(401).json({ success: false });
    return;
  }

  const { data: user, error } = await supabase
    .from("usuario")
    .select("*")
    .eq("id_usuario", sessionUserId)
    .maybeSingle();

  if (error || !user) {
    res.status(401).json({ success: false });
    return;
  }

  res.json({ success: true, user });
});

router.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

router.patch(
  "/profile",
  async (req: Request<{}, {}, ProfileUpdateRequestBody>, res: Response) => {
    const userId = getSessionUserId(req);

    if (!userId) {
      res.status(401).json({ success: false, error: "Sesion no valida" });
      return;
    }

    const nombreUsuario = req.body.nombre_usuario?.trim();
    const nickname = req.body.nickname?.trim();

    if (!nombreUsuario && !nickname) {
      res.status(400).json({ success: false, error: "No hay cambios para guardar" });
      return;
    }

    if (nickname && !/^[a-zA-Z0-9_]{3,20}$/.test(nickname)) {
      res.status(400).json({
        success: false,
        error: "El nickname debe tener 3 a 20 caracteres y solo usar letras, numeros o guion bajo",
      });
      return;
    }

    if (nickname) {
      const { data: existingNickname, error: nicknameError } = await supabase
        .from("usuario")
        .select("id_usuario")
        .eq("nickname", nickname)
        .neq("id_usuario", userId)
        .maybeSingle();

      if (nicknameError) {
        res.status(500).json({ success: false, error: nicknameError.message });
        return;
      }

      if (existingNickname) {
        res.status(400).json({ success: false, error: "Ese nickname ya esta en uso" });
        return;
      }
    }

    const updates: ProfileUpdateRequestBody = {};
    if (nombreUsuario) updates.nombre_usuario = nombreUsuario;
    if (nickname) updates.nickname = nickname;

    const { data: updatedUser, error } = await supabase
      .from("usuario")
      .update(updates)
      .eq("id_usuario", userId)
      .select("*")
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, user: updatedUser });
  },
);

router.get("/profile/customization", async (req: Request, res: Response) => {
  const userId = getSessionUserId(req);

  if (!userId) {
    res.status(401).json({ success: false, error: "Sesion no valida" });
    return;
  }

  try {
    const data = await getCustomization(userId);
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "No se pudo cargar la personalizacion",
    });
  }
});

router.patch(
  "/profile/customization",
  async (req: Request<{}, {}, ProfileCustomizationBody>, res: Response) => {
    const userId = getSessionUserId(req);

    if (!userId) {
      res.status(401).json({ success: false, error: "Sesion no valida" });
      return;
    }

    const updates: Partial<Record<EquipSlotColumn, number | null>> = {};

    if ("marco_inventario_id" in req.body) {
      updates.marco_inventario_id = req.body.marco_inventario_id ?? null;
    }
    if ("titulo_inventario_id" in req.body) {
      updates.titulo_inventario_id = req.body.titulo_inventario_id ?? null;
    }
    if ("banner_inventario_id" in req.body) {
      updates.banner_inventario_id = req.body.banner_inventario_id ?? null;
    }
    if ("trofeo_inventario_id" in req.body) {
      updates.trofeo_inventario_id = req.body.trofeo_inventario_id ?? null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: "No hay cambios para guardar" });
      return;
    }

    try {
      await assertOwnedEquipable(userId, updates.marco_inventario_id, ["marco"]);
      await assertOwnedEquipable(userId, updates.titulo_inventario_id, ["titulo", "achievement"]);
      await assertOwnedEquipable(userId, updates.banner_inventario_id, ["banner"]);
      await assertOwnedEquipable(userId, updates.trofeo_inventario_id, ["trofeo"]);

      const { data, error } = await supabase
        .from("usuario_equipamiento")
        .upsert(
          {
            id_usuario: userId,
            ...updates,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id_usuario" },
        )
        .select("*")
        .single();

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }

      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "No se pudo guardar la personalizacion",
      });
    }
  },
);

router.post(
  "/profile/photo",
  async (req: Request<{}, {}, ProfilePhotoBody>, res: Response) => {
    const userId = getSessionUserId(req);

    if (!userId) {
      res.status(401).json({ success: false, error: "Sesion no valida" });
      return;
    }

    try {
      const parsed = parseDataUrl(req.body.imageData || "");
      const safeName = (req.body.fileName || "profile")
        .replace(/\.[^.]+$/u, "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40) || "profile";
      const path = `${userId}/${Date.now()}-${safeName}.${parsed.extension}`;

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_PICTURES_BUCKET)
        .upload(path, parsed.buffer, {
          contentType: parsed.contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        res.status(500).json({ success: false, error: uploadError.message });
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from(PROFILE_PICTURES_BUCKET)
        .getPublicUrl(path);

      const publicUrl = publicUrlData.publicUrl;
      const { data: updatedUser, error: updateError } = await supabase
        .from("usuario")
        .update({ foto_perfil: publicUrl })
        .eq("id_usuario", userId)
        .select("*")
        .single();

      if (updateError) {
        res.status(500).json({ success: false, error: updateError.message });
        return;
      }

      res.json({ success: true, url: publicUrl, user: updatedUser });
    } catch (error: unknown) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "No se pudo subir la foto",
      });
    }
  },
);

router.post(
  "/profile/saves",
  async (req: Request<{}, {}, ProfileSavesBody>, res: Response) => {
    const userId = getSessionUserId(req);

    if (!userId) {
      res.status(401).json({ success: false, error: "Sesion no valida" });
      return;
    }

    const saves = Number(req.body.saves);

    if (!Number.isInteger(saves) || saves < 0) {
      res.status(400).json({
        success: false,
        error: "La cantidad de atajadas debe ser un numero entero mayor o igual a 0",
      });
      return;
    }

    const pointsEarned = saves * POINTS_PER_SAVE;

    const { data: usuario, error: fetchError } = await supabase
      .from("usuario")
      .select("dinero")
      .eq("id_usuario", userId)
      .single();

    if (fetchError) {
      res.status(404).json({ success: false, error: "Usuario no encontrado" });
      return;
    }

    const nuevoDinero = Number(usuario.dinero || 0) + pointsEarned;

    const { data: updatedUser, error: updateError } = await supabase
      .from("usuario")
      .update({ dinero: nuevoDinero })
      .eq("id_usuario", userId)
      .select("dinero")
      .single();

    if (updateError) {
      res.status(500).json({ success: false, error: updateError.message });
      return;
    }

    res.json({
      success: true,
      pointsEarned,
      dinero: Number(updatedUser.dinero),
    });
  },
);

router.delete(
  "/account",
  async (req: Request<{}, {}, DeleteAccountRequestBody>, res: Response) => {
    const userId = getSessionUserId(req);

    if (!userId) {
      res.status(401).json({ success: false, error: "Sesion no valida" });
      return;
    }

    const { data: user, error: userError } = await supabase
      .from("usuario")
      .select("id_usuario,nickname")
      .eq("id_usuario", userId)
      .maybeSingle();

    if (userError || !user) {
      clearSessionCookie(res);
      res.status(401).json({ success: false, error: "Usuario no encontrado" });
      return;
    }

    const expectedConfirmation = `ELIMINAR ${user.nickname}`;
    if (req.body.confirmacion !== expectedConfirmation) {
      res.status(400).json({
        success: false,
        error: "La confirmacion no coincide",
      });
      return;
    }

    const { data: inventoryItems, error: inventoryLookupError } = await supabase
      .from("inventario_producto")
      .select("id")
      .eq("id_usuario", userId);

    if (inventoryLookupError) {
      res.status(500).json({ success: false, error: inventoryLookupError.message });
      return;
    }

    const inventoryIds = (inventoryItems || []).map((item) => item.id);

    const cleanupSteps = [
      () => supabase.from("marketplace_listado").delete().eq("id_vendedor", userId),
      () => inventoryIds.length
        ? supabase.from("marketplace_listado").delete().in("id_inventario", inventoryIds)
        : Promise.resolve({ error: null }),
      () => supabase.from("simulacion").delete().eq("id_usuario", userId),
      () => supabase.from("inventario_producto").delete().eq("id_usuario", userId),
      () => supabase.from("usuario").delete().eq("id_usuario", userId),
    ];

    for (const cleanup of cleanupSteps) {
      const { error } = await cleanup();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }

    clearSessionCookie(res);
    res.json({ success: true });
  },
);

router.post(
  "/login",
  async (req: Request<{}, {}, LoginRequestBody>, res: Response) => {
    const { correo, contrasena } = req.body;

    const { data, error } = await supabase.rpc("fn_login", {
      p_identificador: correo,
      p_contrasena: contrasena,
    });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (!data.success) {
      res.status(401).json(data);
      return;
    }

    setSessionCookie(res, data.user.id_usuario);
    res.json(data);
  },
);

router.post(
  "/registro",
  async (req: Request<{}, {}, RegistroRequestBody>, res: Response) => {
    const { correo, nombre_usuario, nickname, contrasena } = req.body;

    const { data, error } = await supabase.rpc("fn_registro", {
      p_nombre_usuario: nombre_usuario,
      p_correo: correo,
      p_contrasena: contrasena,
      p_nickname: nickname,
    });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (!data.success) {
      res.status(400).json(data);
      return;
    }

    setSessionCookie(res, data.user.id_usuario);
    res.json(data);
  },
);

// Verifica el access_token de Google. Si el correo ya existe → sesión; si no → isNew: true para que el front pida nickname.
router.post(
  "/google-sync",
  async (req: Request<{}, {}, GoogleSyncRequestBody>, res: Response) => {
    const { access_token: accessToken } = req.body;

    if (!accessToken) {
      res.status(400).json({
        success: false,
        error: "Token requerido",
      });
      return;
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !authUser) {
      res.status(401).json({
        success: false,
        error: "Token inválido",
      });
      return;
    }

    const correo = authUser.email;
    if (!correo) {
      res.status(400).json({
        success: false,
        error: "El usuario de Google no tiene correo disponible",
      });
      return;
    }

    const nombre = getGoogleDisplayName(authUser);
    const avatarUrl = getGoogleAvatarUrl(authUser);

    const { data: existingUser } = await supabase
      .from("usuario")
      .select("*")
      .eq("correo", correo)
      .maybeSingle();

    if (existingUser) {
      setSessionCookie(res, existingUser.id_usuario);
      res.json({
        success: true,
        isNew: false,
        user: { ...existingUser, avatar_url: avatarUrl },
      });
      return;
    }

    res.json({
      success: true,
      isNew: true,
      correo,
      nombre,
      foto_perfil_url: avatarUrl,
    });
  },
);

router.post(
  "/google-register",
  async (req: Request<{}, {}, GoogleRegisterRequestBody>, res: Response) => {
    const { correo, nombre_usuario: nombre, nickname, foto_perfil_url: avatarUrl } = req.body;

    if (!correo || !nickname) {
      res.status(400).json({
        success: false,
        error: "Datos incompletos",
      });
      return;
    }

    const { data: existingNickname } = await supabase
      .from("usuario")
      .select("id_usuario")
      .eq("nickname", nickname)
      .maybeSingle();

    if (existingNickname) {
      res.status(400).json({
        success: false,
        error: "Ese nickname ya está en uso",
      });
      return;
    }

    const { data: newUser, error } = await supabase
      .from("usuario")
      .insert({
        nombre_usuario: nombre,
        correo,
        contrasena: "",
        nickname,
        dinero: INITIAL_MONEY,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
      return;
    }

    setSessionCookie(res, newUser.id_usuario);
    res.json({ success: true, user: { ...newUser, avatar_url: avatarUrl || "" } });
  },
);

export { router as authRouter };
