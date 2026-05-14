import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";

const router = Router();

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

// Convierte query string a número; si falla devuelve fallback.
function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number(value);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

// ?mios=id → listados del usuario | sin parámetros → todos menos el usuario (?excluir=id)
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

// Verifica ownership + no duplicado activo, luego crea el listado en marketplace_listado.
router.post(
  "/publicar",
  async (req: Request<{}, {}, PublicarRequestBody>, res: Response) => {
    const { id_usuario, id_inventario, precio } = req.body;

    // Verifica ownership del item
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

    // No permitir doble publicación activa
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

// RPC fn_comprar_marketplace: atómica — transfiere puntos, cambia dueño del item y cierra el listado.
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

// Marca el listado como cancelado. El triple .eq() garantiza ownership sin SELECT previo.
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
