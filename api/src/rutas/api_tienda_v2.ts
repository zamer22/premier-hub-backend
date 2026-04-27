import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

const DEFAULT_CATEGORY = "perfil";
const BONUS_POINTS = 500;

/*
--------------------------------------------------------------------------------
types para las respuestas de la API-TIENDA
--------------------------------------------------------------------------------
*/
type ProductosQuery = {
  categoria?: string;
};

type UserParams = {
  id_usuario: string;
};

type ComprarBody = {
  id_usuario: number | string;
  id_producto: number | string;
};

type BonusBody = {
  id_usuario: number | string;
};

type StandardListResponse = {
  success: boolean;
  data?: unknown[];
  error?: string;
};

type TemporadaResponse = {
  success: boolean;
  data?: unknown | null;
  error?: string;
};

type SaldoResponse = {
  success: boolean;
  dinero?: number;
  error?: string;
};

type ComprarResponse = {
  success: boolean;
  saldo?: number;
  error?: string;
};

type BonusResponse = {
  success: boolean;
  dinero?: number;
  bonus?: number;
  error?: string;
};

/*
--------------------------------------------------------------------------------
Funciones auxiliares
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
function parseNumber
Returns:
- number - El valor convertido a número si es una cadena, o el mismo número si ya es de tipo number.
Descripción:
Esta función toma un valor que puede ser una cadena o un número. Si el valor es una cadena, intenta convertirlo a número utilizando la función Number(). 
Si el valor ya es de tipo number, lo devuelve tal cual. 
*/
function parseNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

/*
--------------------------------------------------------------------------------
Funciones auxiliares
--------------------------------------------------------------------------------


Ruta GET /productos-v2
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de productos filtrados por categoría.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los productos.
Descripción:
Esta ruta devuelve los productos disponibles en la tienda filtrados por categoría. Si no se especifica una categoría, se utiliza una categoría por defecto.
*/
router.get(
  "/productos-v2",
  async (
    req: Request<{}, {}, {}, ProductosQuery>,
    res: Response<StandardListResponse>,
  ) => {
    try {
      const categoria = req.query.categoria || DEFAULT_CATEGORY;

      const { data, error } = await supabase.rpc("fn_productos_v2", {
        p_categoria: categoria,
      });

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
  },
);

/*
Ruta GET /mis-items/:id_usuario
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los productos que el usuario ha comprado.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los productos del usuario.
Descripción:
Esta ruta devuelve los productos que un usuario ha comprado utilizando una función almacenada en la base de datos llamada 'fn_mis_items'.
la función 'fn_mis_items' se encarga de obtener los productos asociados a un usuario específico basado en su id_usuario.
*/
router.get(
  "/mis-items/:id_usuario",
  async (req: Request<UserParams>, res: Response<StandardListResponse>) => {
    try {
      const userId = parseNumber(req.params.id_usuario);

      const { data, error } = await supabase.rpc("fn_mis_items", {
        p_id_usuario: userId,
      });

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
  },
);

/*
Ruta GET /temporada-activa
Returns:
- 200 OK con {success: true, data: {...} } donde data es el registro de la temporada activa en la base de datos.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener la temporada activa.
Descripción:
Esta ruta devuelve la temporada activa utilizando una consulta a la tabla 'temporada' en la base de datos.
*/
router.get(
  "/temporada-activa",
  async (_req: Request, res: Response<TemporadaResponse>) => {
    try {
      const { data, error } = await supabase
        .from("temporada")
        .select("*")
        .eq("activa", true)
        .maybeSingle();

      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
        return;
      }

      res.json({
        success: true,
        data: data || null,
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
Ruta GET /saldo/:id_usuario
Returns:
- 200 OK con {success: true, dinero: number} donde dinero es el saldo actual del usuario.
- 404 Not Found con {success: false, error: 'Usuario no encontrado'} si el usuario no existe.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener el saldo del usuario.
Descripción:
Esta ruta devuelve el saldo actual de un usuario específico utilizando una consulta a la tabla 'usuario' en la base de datos.
*/
router.get(
  "/saldo/:id_usuario",
  async (req: Request<UserParams>, res: Response<SaldoResponse>) => {
    try {
      const userId = parseNumber(req.params.id_usuario);

      const { data, error } = await supabase
        .from("usuario")
        .select("dinero")
        .eq("id_usuario", userId)
        .single();

      if (error) {
        res.status(404).json({
          success: false,
          error: "Usuario no encontrado",
        });
        return;
      }

      res.json({
        success: true,
        dinero: Number(data.dinero),
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
Ruta POST /comprar
Returns:
- 200 OK con {success: true, saldo: number} donde saldo es el nuevo saldo del usuario después de la compra.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si faltan datos en la solicitud o si ocurre un error al comprar el producto (por ejemplo, saldo insuficiente).
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al procesar la compra.
Descripción:
Esta ruta permite a un usuario comprar un producto en la tienda. Recibe el id_usuario y el id_producto en el cuerpo de la solicitud.
*/
router.post(
  "/comprar",
  async (req: Request<{}, {}, ComprarBody>, res: Response<ComprarResponse>) => {
    try {
      const { id_usuario, id_producto } = req.body;

      if (!id_usuario || !id_producto) {
        res.status(400).json({
          success: false,
          error: "Faltan datos",
        });
        return;
      }

      const { data, error } = await supabase.rpc("fn_comprar_producto", {
        p_id_usuario: parseNumber(id_usuario),
        p_id_producto: parseNumber(id_producto),
      });

      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
        return;
      }

      if (!data?.success) {
        res.status(400).json({
          success: false,
          error: data?.error || "Error al comprar",
        });
        return;
      }

      res.json({
        success: true,
        saldo: data.nuevo_saldo,
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
Ruta POST /bonus
Returns:
- 200 OK con {success: true, dinero: number, bonus: number} donde dinero es el nuevo saldo del usuario después de recibir el bonus y bonus es la cantidad de puntos bonus otorgados.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si falta el id_usuario en la solicitud.
- 404 Not Found con {success: false, error: 'Usuario no encontrado'} si el usuario no existe.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al procesar el bonus.
Descripción:
Esta ruta permite otorgar un bonus de puntos a un usuario específico. Recibe el id_usuario en el cuerpo de la solicitud. 
La ruta actualiza el saldo del usuario sumando una cantidad fija de puntos bonus y devuelve el nuevo saldo junto con la cantidad de bonus otorgada.
Por ahora es mas que nada para testing, pero en el futuro se puede ampliar para otorgar diferentes tipos de bonus o para condiciones específicas.
*/
router.post(
  "/bonus",
  async (req: Request<{}, {}, BonusBody>, res: Response<BonusResponse>) => {
    try {
      const { id_usuario } = req.body;

      if (!id_usuario) {
        res.status(400).json({
          success: false,
          error: "Falta id_usuario",
        });
        return;
      }

      const userId = parseNumber(id_usuario);

      const { data: usuario, error: fetchError } = await supabase
        .from("usuario")
        .select("dinero")
        .eq("id_usuario", userId)
        .single();

      if (fetchError) {
        res.status(404).json({
          success: false,
          error: "Usuario no encontrado",
        });
        return;
      }

      const nuevoDinero = Number(usuario.dinero) + BONUS_POINTS;

      const { error: updateError } = await supabase
        .from("usuario")
        .update({ dinero: nuevoDinero })
        .eq("id_usuario", userId);

      if (updateError) {
        res.status(500).json({
          success: false,
          error: updateError.message,
        });
        return;
      }

      res.json({
        success: true,
        dinero: nuevoDinero,
        bonus: BONUS_POINTS,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

export { router as tiendaRouter };