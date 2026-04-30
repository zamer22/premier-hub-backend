import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

/* 
----------------------------------------------------------------------------------
Interfaces para los parámetros de consulta y cuerpos de solicitud del marketplace.
----------------------------------------------------------------------------------
*/
interface ListadosQuery {
  mios?: string;
  excluir?: string;
}

interface PublicarRequestBody {
  id_usuario: number;
  id_inventario: number;
  precio: number;
}

interface ComprarRequestBody {
  id_comprador: number;
  id_listado: number;
}

interface CancelarParams {
  id_listado: string;
}

interface CancelarRequestBody {
  id_usuario: number;
}

/*
----------------------------------------------------------------------------------
Función auxiliar
----------------------------------------------------------------------------------


function parseNumber
Parámetros:
- value: string | undefined - El valor a parsear, que puede ser una cadena o undefined.
- fallback: number - El valor numérico a retornar si el parseo falla o el valor es undefined.
Returns:
- number - El valor numérico parseado, o el valor de fallback si el parseo no es exitoso.
Descripción:
Esta función intenta convertir una cadena a un número. 
Si el valor es undefined o no se puede convertir a un número válido, retorna el valor de fallback proporcionado. 
*/
function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number(value);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

/*
-----------------------------------------------------------------------------------
Rutas del marketplace
-----------------------------------------------------------------------------------


Ruta GET /listados
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de listados del marketplace.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los listados.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si los parámetros de consulta son inválidos.
Descripción:
Esta ruta devuelve los listados del marketplace.
*/
router.get(
  "/listados",
  async (req: Request<{}, {}, {}, ListadosQuery>, res: Response) => {
    const ownListingsUserId = req.query.mios;

    if (ownListingsUserId) {
      const { data, error } = await supabase.rpc("fn_mis_listados", {
        p_id_usuario: Number(ownListingsUserId),
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
      return;
    }

    const excludedUserId = parseNumber(req.query.excluir, -1);

    const { data, error } = await supabase.rpc("fn_marketplace_listados", {
      p_excluir_usuario: excludedUserId,
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
  },
);

/* 
Ruta POST /publicar
Returns:
- 200 OK con {success: true, data: {...} } donde data es el listado recién creado.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si el item no pertenece al usuario o ya está publicado.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al crear el listado.
Descripción:
Esta ruta permite a un usuario publicar un item en el marketplace. 
Verifica que el item pertenece al usuario y que no esté ya publicado antes de crear el listado.
*/
router.post(
  "/publicar",
  async (req: Request<{}, {}, PublicarRequestBody>, res: Response) => {
    const { id_usuario, id_inventario, precio } = req.body;

    // Verificar que el item pertenece al usuario.
    const { data: item } = await supabase
      .from("inventario_producto")
      .select("id")
      .eq("id", id_inventario)
      .eq("id_usuario", id_usuario)
      .maybeSingle();

    if (!item) {
      res.status(400).json({
        success: false,
        error: "Este item no te pertenece",
      });
      return;
    }

    // Verificar que el item no esté ya publicado.
    const { data: existingListing } = await supabase
      .from("marketplace_listado")
      .select("id_listado")
      .eq("id_inventario", id_inventario)
      .eq("estado", "activo")
      .maybeSingle();

    if (existingListing) {
      res.status(400).json({
        success: false,
        error: "Este item ya está publicado",
      });
      return;
    }

    const { data, error } = await supabase
      .from("marketplace_listado")
      .insert({
        id_vendedor: id_usuario,
        id_inventario,
        precio,
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
  },
);

/* 
Ruta POST /comprar
Returns:
- 200 OK con {success: true, data: {...} } donde data es la transacción recién realizada.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si el item no está disponible para comprar.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al realizar la compra.
Descripción:
Esta ruta permite a un usuario comprar un item del marketplace. 
Verifica que el item esté disponible para comprar antes de realizar la transacción.
*/
router.post(
  "/comprar",
  async (req: Request<{}, {}, ComprarRequestBody>, res: Response) => {
    const { id_comprador, id_listado } = req.body;

    const { data, error } = await supabase.rpc("fn_comprar_marketplace", {
      p_id_comprador: id_comprador,
      p_id_listado: id_listado,
    });

    if (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (!data.success) {
      res.status(400).json(data);
      return;
    }

    res.json(data);
  },
);

/* 
Ruta DELETE /cancelar/:id_listado
Returns:
- 200 OK con {success: true} si la publicación se cancela exitosamente.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si no se puede cancelar la publicación.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al cancelar la publicación.
Descripción:
Esta ruta permite a un usuario cancelar una publicación en el marketplace. 
Verifica que la publicación pertenezca al usuario y que esté activa antes de cancelarla.
*/
router.delete(
  "/cancelar/:id_listado",
  async (
    req: Request<CancelarParams, {}, CancelarRequestBody>,
    res: Response,
  ) => {
    const { id_usuario } = req.body;
    const listingId = Number(req.params.id_listado);

    const { data, error } = await supabase
      .from("marketplace_listado")
      .update({ estado: "cancelado" })
      .eq("id_listado", listingId)
      .eq("id_vendedor", id_usuario)
      .eq("estado", "activo")
      .select()
      .maybeSingle();

    if (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
      return;
    }

    if (!data) {
      res.status(400).json({
        success: false,
        error: "No se pudo cancelar",
      });
      return;
    }

    res.json({ success: true });
  },
);

export { router as marketplaceRouter };
