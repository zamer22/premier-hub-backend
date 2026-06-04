import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/*
----------------------------------------------------------------------------------
Todas las rutas del marketplace requieren sesion valida. El id del usuario se lee
desde req.userId (cookie firmada). Nunca aceptar id_usuario desde body, query o
headers — eso permitia suplantar a otro usuario.
----------------------------------------------------------------------------------
*/
router.use(requireAuth);

/*
----------------------------------------------------------------------------------
Interfaces para los cuerpos de solicitud del marketplace.
----------------------------------------------------------------------------------
*/
interface ListadosQuery {
  mios?: string;
  excluir?: string;
}

interface PublicarRequestBody {
  id_inventario: number;
  precio: number;
}

interface ComprarRequestBody {
  id_listado: number;
}

interface CancelarParams {
  id_listado: string;
}

/*
----------------------------------------------------------------------------------
Funcion auxiliar
----------------------------------------------------------------------------------


function parseNumber
Parametros:
- value: string | undefined - El valor a parsear, que puede ser una cadena o undefined.
- fallback: number - El valor numerico a retornar si el parseo falla o el valor es undefined.
Returns:
- number - El valor numerico parseado, o el valor de fallback si el parseo no es exitoso.
Descripcion:
Esta funcion intenta convertir una cadena a un numero.
Si el valor es undefined o no se puede convertir a un numero valido, retorna el valor de fallback proporcionado.
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
Query:
- mios: si viene cualquier valor (ej. "true" o "1"), devuelve los listados del usuario autenticado.
- excluir: id de usuario cuyos listados queremos excluir (para no mostrarse a si mismo en el feed general).
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de listados del marketplace.
- 500 Internal Server Error si ocurre un error.
Descripcion:
Devuelve los listados del marketplace. Si mios viene en la query usa req.userId
(usuario autenticado por cookie); ya no se acepta el id en la query para evitar
listar listados de otra persona.
*/
router.get(
  "/listados",
  async (req: Request<{}, {}, {}, ListadosQuery>, res: Response) => {
    const wantOwnListings = Boolean(req.query.mios);

    if (wantOwnListings) {
      const { data, error } = await supabase.rpc("fn_mis_listados", {
        p_id_usuario: req.userId!,
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

    const excludedUserId = parseNumber(req.query.excluir, req.userId!);

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
Body:
- id_inventario: id del item en inventario_producto a publicar.
- precio: precio en puntos.
Returns:
- 200 OK con {success: true, data: {...} } con el listado creado.
- 400 Bad Request si el item no pertenece al usuario o ya esta publicado.
- 500 Internal Server Error si ocurre un error al crear el listado.
Descripcion:
Publica un item del inventario del usuario autenticado en el marketplace.
El vendedor siempre es req.userId — nunca se acepta id_usuario del cliente.
*/
router.post(
  "/publicar",
  async (req: Request<{}, {}, PublicarRequestBody>, res: Response) => {
    const id_usuario = req.userId!;
    const { id_inventario, precio } = req.body;

    // Verificar que el item pertenece al usuario autenticado.
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

    // Verificar que el item no este ya publicado.
    const { data: existingListing } = await supabase
      .from("marketplace_listado")
      .select("id_listado")
      .eq("id_inventario", id_inventario)
      .eq("estado", "activo")
      .maybeSingle();

    if (existingListing) {
      res.status(400).json({
        success: false,
        error: "Este item ya esta publicado",
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
Body:
- id_listado: id del listado a comprar.
Returns:
- 200 OK con {success: true, data: {...} } con la transaccion realizada.
- 400 Bad Request si el item no esta disponible para comprar.
- 500 Internal Server Error si ocurre un error.
Descripcion:
El comprador siempre es req.userId — nunca se acepta del cliente.
*/
router.post(
  "/comprar",
  async (req: Request<{}, {}, ComprarRequestBody>, res: Response) => {
    const id_comprador = req.userId!;
    const { id_listado } = req.body;

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
- 200 OK con {success: true} si la publicacion se cancela exitosamente.
- 400 Bad Request si no se puede cancelar la publicacion.
- 500 Internal Server Error si ocurre un error.
Descripcion:
Cancela una publicacion del marketplace. Solo se puede cancelar si pertenece al
usuario autenticado (req.userId) y esta activa.
*/
router.delete(
  "/cancelar/:id_listado",
  async (
    req: Request<CancelarParams>,
    res: Response,
  ) => {
    const id_usuario = req.userId!;
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
