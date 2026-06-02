import rateLimit from "express-rate-limit";

/*
Limites por IP para proteger endpoints sensibles contra fuerza bruta y abuso.

authLimiter — login, registro, google-sync.
  10 requests por 15 min. Es lo suficientemente alto para que un usuario humano
  no se quede afuera si se equivoca varias veces, pero mata un script de fuerza
  bruta razonable.

accountDeleteLimiter — DELETE /account.
  5 requests por 15 min. Mas estricto porque la accion es destructiva y
  un atacante que logra ejecutarla esta tratando de adivinar la contrasena.

standardHeaders / legacyHeaders: usamos los headers RateLimit-* estandar (RFC).
*/

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Demasiados intentos. Intenta de nuevo en unos minutos." },
});

export const accountDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Demasiados intentos. Intenta de nuevo en unos minutos." },
});
