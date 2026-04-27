import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

/* 
--------------------------------------------------------------------------------
types para las respuestas de la API-SIMULADOR
--------------------------------------------------------------------------------
*/
type RankingItem = unknown;

type SimulationRecord = unknown;

type CreateSimulationBody = {
  id_usuario: number;
  partido_data: unknown;
  cambios: unknown;
};

type SimulationParams = {
  id: string;
};

type RankingRouteResponse = {
  success: boolean;
  data?: RankingItem[];
  count?: number;
  error?: string;
};

type SimulationRouteResponse = {
  success: boolean;
  data?: SimulationRecord;
  error?: string;
};

/* 
--------------------------------------------------------------------------------
función para obtener el mensaje de error
--------------------------------------------------------------------------------
 

function getErrorMessage
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
Rutas de simulador
--------------------------------------------------------------------------------


Ruta GET /ranking
Returns:
- 200 OK con {success: true, data: [...], count: number} donde data es un array con el ranking de usuarios y count es el número total de usuarios en el ranking.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener el ranking.
Descripción:
Esta ruta devuelve el ranking de usuarios utilizando una función almacenada en la base de datos llamada 'fn_simulador_ranking'.
la función 'fn_simulador_ranking' se encarga de calcular el ranking de usuarios basado en sus puntos acumulados en el simulador.
*/
router.get(
  "/ranking",
  async (_req: Request, res: Response<RankingRouteResponse>) => {
    try {
      const { data, error } = await supabase.rpc("fn_simulador_ranking");

      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
        return;
      }

      const rankingData = data || [];

      res.json({
        success: true,
        data: rankingData,
        count: rankingData.length,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/* 
Ruta POST /simulacion
Returns:
- 200 OK con {success: true, data: {...} } donde data es el registro de la simulación creada en la base de datos.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al crear la simulación.
Descripción:
Esta ruta permite crear una nueva simulación en la base de datos. Recibe un objeto con el id del usuario, 
los datos del partido y los cambios realizados por el usuario.
La ruta inserta un nuevo registro en la tabla 'simulacion' con el status 'pendiente' y devuelve el registro creado. 
*/
router.post(
  "/simulacion",
  async (
    req: Request<{}, {}, CreateSimulationBody>,
    res: Response<SimulationRouteResponse>,
  ) => {
    try {
      const { id_usuario, partido_data, cambios } = req.body;

      const { data, error } = await supabase
        .from("simulacion")
        .insert({
          id_usuario,
          partido_data,
          cambios,
          status: "pendiente",
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

      res.json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/*
Ruta GET /simulacion/:id
Returns:
- 200 OK con {success: true, data: {...} } donde data es el registro de la simulación solicitada.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener la simulación.
Descripción:
Esta ruta permite obtener los detalles de una simulación específica por su ID.
*/
router.get(
  "/simulacion/:id",
  async (
    req: Request<SimulationParams>,
    res: Response<SimulationRouteResponse>,
  ) => {
    try {
      const simulationId = req.params.id;

      const { data, error } = await supabase
        .from("simulacion")
        .select("*")
        .eq("id_simulacion", simulationId)
        .single();

      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
        return;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

export { router as simuladorRouter };