import { Router, Request, Response, NextFunction } from "express";
import supabase from "../db";

const router = Router();

const ADMIN_PEDIDO_FIELDS = `
  id_pedido, id_usuario, id_producto, id_variante, costo,
  direccion_snapshot, lat_destino, lng_destino, estado,
  fecha_pedido, fecha_entrega,
  lat_actual, lng_actual, tracking_numero, fecha_estimada, notas_admin,
  producto:producto(id_producto, nombre, imagen, tipo),
  variante:producto_variante(id_variante, talla),
  usuario:usuario(id_usuario, nickname, nombre_usuario, correo)
`;

const ESTADOS_VALIDOS = ["procesando", "enviado", "en_camino", "entregado", "cancelado"];

// ---------- Middleware: verificar que sea admin ----------
async function verificarAdmin(req: Request, res: Response, next: NextFunction) {
  const idRaw = (req.query.id_usuario ?? req.body?.id_usuario ?? req.header("x-id-usuario")) as string | number | undefined;
  const id = idRaw != null ? Number(idRaw) : NaN;
  if (!id || Number.isNaN(id)) {
    return res.status(401).json({ success: false, error: "Falta id_usuario" });
  }
  const { data, error } = await supabase
    .from("usuario")
    .select("es_admin")
    .eq("id_usuario", id)
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data || !data.es_admin) {
    return res.status(403).json({ success: false, error: "Acceso solo para administradores" });
  }
  next();
}

router.use(verificarAdmin);

// ---------- Lista de pedidos con filtros ----------
router.get("/pedidos", async (req, res) => {
  const { estado, desde, hasta, q } = req.query;

  let query = supabase
    .from("pedido")
    .select(ADMIN_PEDIDO_FIELDS)
    .order("fecha_pedido", { ascending: false })
    .limit(500);

  if (estado && typeof estado === "string" && ESTADOS_VALIDOS.includes(estado)) {
    query = query.eq("estado", estado);
  }
  if (desde && typeof desde === "string") {
    query = query.gte("fecha_pedido", desde);
  }
  if (hasta && typeof hasta === "string") {
    query = query.lte("fecha_pedido", hasta);
  }
  // Búsqueda por id_pedido si q es numérico, o por tracking_numero si es texto
  if (q && typeof q === "string" && q.trim()) {
    const qNum = Number(q);
    if (!Number.isNaN(qNum)) {
      query = query.or(`id_pedido.eq.${qNum},tracking_numero.ilike.%${q}%`);
    } else {
      query = query.ilike("tracking_numero", `%${q}%`);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

// ---------- Detalle (mismo formato) ----------
router.get("/pedido/:id_pedido", async (req, res) => {
  const { data, error } = await supabase
    .from("pedido")
    .select(ADMIN_PEDIDO_FIELDS)
    .eq("id_pedido", Number(req.params.id_pedido))
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: "Pedido no encontrado" });
  res.json({ success: true, data });
});

// ---------- Update libre del admin ----------
router.put("/pedido/:id_pedido", async (req, res) => {
  const id_pedido = Number(req.params.id_pedido);
  const {
    estado, lat_actual, lng_actual,
    tracking_numero, fecha_estimada, notas_admin,
  } = req.body;

  const updates: Record<string, any> = {};

  if (estado !== undefined) {
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, error: "Estado inválido" });
    }
    updates.estado = estado;
    if (estado === "entregado") updates.fecha_entrega = new Date().toISOString();
  }

  if (lat_actual !== undefined) updates.lat_actual = lat_actual != null ? Number(lat_actual) : null;
  if (lng_actual !== undefined) updates.lng_actual = lng_actual != null ? Number(lng_actual) : null;
  if (tracking_numero !== undefined) updates.tracking_numero = tracking_numero || null;
  if (fecha_estimada !== undefined) updates.fecha_estimada = fecha_estimada || null;
  if (notas_admin !== undefined) updates.notas_admin = notas_admin || null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }

  const { data, error } = await supabase
    .from("pedido")
    .update(updates)
    .eq("id_pedido", id_pedido)
    .select(ADMIN_PEDIDO_FIELDS)
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

export default router;
