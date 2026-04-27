import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

const SESSION_COOKIE_NAME = "ph_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const SESSION_COOKIE_PATH = "/";
const INITIAL_MONEY = 1000;

/*
----------------------------------------------------------------------------
Interaces para los cuerpos de las solicitudes de autenticación.
----------------------------------------------------------------------------
*/
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
}

/* 
----------------------------------------------------------------------------
Funciones auxiliares
----------------------------------------------------------------------------


Function setSessionCookie
Parametros:
- response: Response - El objeto de respuesta de Express para configurar la cookie.
- userId: number - El ID del usuario para almacenar en la cookie de sesión.
Descripción:
Esta función configura una cookie de sesión segura y con firma en la respuesta HTTP. La cookie contiene el ID del usuario y tiene una duración de 7 días. 
Se establece como HttpOnly para mejorar la seguridad, lo que impide que el cliente JavaScript acceda a ella. 
Además, se marca como segura (secure) solo en producción, lo que garantiza que solo se envíe a través de conexiones HTTPS. 
La opción sameSite se establece en 'lax' para ayudar a prevenir ataques CSRF.
*/
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

/* 
Function clearSessionCookie
Parametros:
- response: Response - El objeto de respuesta de Express para borrar la cookie.
Descripción:
Esta función borra la cookie de sesión establecida por setSessionCookie. 
Utiliza el método clearCookie de Express, especificando el mismo nombre y ruta que se usaron para establecer la cookie. 
*/
function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    path: SESSION_COOKIE_PATH,
  });
}

/*
function getGoogleDisplayName
Parametros:
- authUser: object - El objeto de usuario autenticado obtenido de Google, que puede contener información como correo electrónico y metadatos del usuario.
Descripción:
Esta función extrae un nombre para mostrar del usuario autenticado de Google. 
Primero, intenta obtener el nombre completo del usuario desde los metadatos (user_metadata.full_name). 
Si no está disponible, intenta obtener un nombre alternativo (user_metadata.name). 
Si ninguno de estos campos está presente, utiliza la parte local del correo electrónico (antes del símbolo '@') como nombre para mostrar.  
*/
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

/* 
-----------------------------------------------------------------------------
Rutas de autenticación
-----------------------------------------------------------------------------

 
Ruta GET /me
Returns:
- 200 OK con {success: true, user} si el usuario está autenticado correctamente.
- 401 Unauthorized con {success: false} si no hay una sesión válida o el usuario no existe.
Descripción:
Esta ruta verifica si el usuario tiene una cookie de sesión válida. 
Si la cookie está presente, intenta obtener los datos del usuario correspondiente de la base de datos.
*/
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

/* 
Ruta POST /logout
Returns:
- 200 OK con {success: true} después de borrar la cookie de sesión.
Descripción:
Esta ruta cierra la sesión del usuario borrando la cookie de sesión establecida en el navegador. 
Después de llamar a clearSessionCookie, responde con un mensaje de éxito.
*/
router.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

/*  
Ruta POST /login
Parametros:
- correo: string - El correo electrónico del usuario que intenta iniciar sesión.
- contrasena: string - La contraseña del usuario para autenticarse.
Returns:
- 200 OK con {success: true, user} si las credenciales son correctas y el inicio de sesión es exitoso.
- 401 Unauthorized con {success: false, error} si las credenciales son incorrectas o el usuario no existe.
- 500 Internal Server Error con {success: false, error} si ocurre un error en el servidor durante el proceso de autenticación.
Descripción:
Esta ruta maneja el inicio de sesión con correo electrónico y contraseña.
*/
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

/*  
Ruta POST /registro
Parametros:
- correo: string - El correo electrónico del usuario que intenta registrarse.
- nombre_usuario: string - El nombre completo del usuario.
- nickname: string - El nombre de usuario único.
- contrasena: string - La contraseña del usuario para autenticarse.
Returns:
- 200 OK con {success: true, user} si el registro es exitoso.
- 400 Bad Request con {success: false, error} si los datos son inválidos o el usuario ya existe.
- 500 Internal Server Error con {success: false, error} si ocurre un error en el servidor durante el proceso de registro.
Descripción:
Esta ruta maneja el registro de nuevos usuarios con correo electrónico y contraseña.
*/
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

/*
Ruta POST /google-sync
Parametros:
- access_token: string - El token de acceso de Google obtenido en el cliente después de la autenticación con Google.
Returns:
- 200 OK con {success: true, isNew: false, user} si el token es válido y el usuario ya existe en la base de datos.
- 200 OK con {success: true, isNew: true, correo, nombre} si el token es válido pero el usuario no existe en la base de datos (nuevo usuario).
- 400 Bad Request con {success: false, error} si el token no se proporciona o es inválido.
- 401 Unauthorized con {success: false, error} si el token es inválido o no se puede autenticar con Google.
Descripción:
Esta ruta maneja la sincronización de usuarios autenticados con Google. 
Recibe un token de acceso de Google, verifica su validez y extrae la información del usuario. 
Si el usuario ya existe en la base de datos, se establece una sesión y se devuelve la información del usuario. 
Si el usuario no existe, se devuelve un mensaje indicando que es un nuevo usuario junto con su correo y nombre
*/
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
        user: existingUser,
      });
      return;
    }

    res.json({
      success: true,
      isNew: true,
      correo,
      nombre,
    });
  },
);

/*
Ruta POST /google-register
Parametros:
- correo: string - El correo electrónico del usuario autenticado con Google.
- nombre: string - El nombre del usuario extraído de su perfil de Google.
- nickname: string - El nombre de usuario único que el cliente debe proporcionar para el nuevo registro.
Returns:
- 200 OK con {success: true, user} si el registro es exitoso.
- 400 Bad Request con {success: false, error} si los datos son inválidos o el nickname ya está en uso.
- 500 Internal Server Error con {success: false, error} si ocurre un error en el servidor durante el proceso de registro.
Descripción:
Esta ruta maneja el registro de nuevos usuarios autenticados con Google. 
Recibe el correo y nombre del usuario autenticado con Google, junto con un nickname proporcionado por el cliente. 
Verifica que el nickname no esté en uso, luego crea un nuevo registro de usuario en la base de datos con la información proporcionada. 
Después de registrar al usuario, establece una sesión y devuelve la información del nuevo usuario.
*/
router.post(
  "/google-register",
  async (req: Request<{}, {}, GoogleRegisterRequestBody>, res: Response) => {
    const { correo, nombre_usuario: nombre, nickname } = req.body;

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
    res.json({ success: true, user: newUser });
  },
);

export { router as authRouter };
