import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

/*
--------------------------------------------------------------------------------
types para las respuestas de la API-RANKING
--------------------------------------------------------------------------------
*/
type RankingResponse = {
  success: boolean;
  data?: unknown[];
  error?: string;
};

/*
--------------------------------------------------------------------------------
Funciones auxiliares
--------------------------------------------------------------------------------


function getErrorMessage(error: unknown): string
Returns:
- string - El mensaje de error extraído del objeto de error, o un mensaje genérico si el error no es una instancia de Error.
Descripción:
Esta función toma un objeto de error de tipo desconocido y verifica si es una instancia de la clase Error. 
Si lo es, devuelve el mensaje de error contenido en la propiedad 'message'. Si no es una instancia de Error, 
devuelve un mensaje genérico indicando que ocurrió un error interno del servidor. 
*/
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error interno del servidor";
}

/* 
--------------------------------------------------------------------------------
Rutas de ranking
--------------------------------------------------------------------------------


Ruta GET /
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array con el ranking de usuarios.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener el ranking.
Descripción:
Esta ruta devuelve el ranking de usuarios utilizando una función almacenada en la base de datos llamada 'fn_ranking'.
la función 'fn_ranking' se encarga de calcular el ranking de usuarios basado en sus puntos acumulados.
*/
router.get("/", async (_req: Request, res: Response<RankingResponse>) => {
  try {
    const { data, error } = await supabase.rpc("fn_ranking");

    if (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
      return;
    }

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

export { router as rankingRouter };