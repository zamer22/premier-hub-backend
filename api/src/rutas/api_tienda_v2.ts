import { Router } from "express";
import supabase from "../db";

const router = Router();

// Productos filtrados por categoria + temporada activa
router.get("/productos-v2", async (req, res) => {
  const categoria = (req.query.categoria as string) || "perfil";
  const { data: productos, error } = await supabase.rpc("fn_productos_v2", { p_categoria: categoria });
  if (error) return res.status(500).json({ success: false, error: error.message });

  const ids = (productos || []).map((p: any) => p.id_producto);
  let variantesPorProducto: Record<number, any[]> = {};
  let descripcionPorProducto: Record<number, string | null> = {};
  if (ids.length > 0) {
    const [variantesRes, descRes] = await Promise.all([
      supabase.from("producto_variante").select("id_variante, id_producto, talla, stock").in("id_producto", ids),
      supabase.from("producto").select("id_producto, descripcion").in("id_producto", ids),
    ]);
    variantesPorProducto = (variantesRes.data || []).reduce((acc: Record<number, any[]>, v: any) => {
      (acc[v.id_producto] ||= []).push({ id_variante: v.id_variante, talla: v.talla, stock: v.stock });
      return acc;
    }, {});
    descripcionPorProducto = Object.fromEntries((descRes.data || []).map((d: any) => [d.id_producto, d.descripcion ?? null]));
  }

  const enriched = (productos || []).map((p: any) => ({
    ...p,
    descripcion: descripcionPorProducto[p.id_producto] ?? null,
    variantes: variantesPorProducto[p.id_producto] || [],
  }));
  res.json({ success: true, data: enriched });
});

// Inventario del usuario con flag en_marketplace
router.get("/mis-items/:id_usuario", async (req, res) => {
  const { data, error } = await supabase.rpc("fn_mis_items", {
    p_id_usuario: Number(req.params.id_usuario),
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

// Temporada activa
router.get("/temporada-activa", async (_req, res) => {
  const { data, error } = await supabase
    .from("temporada")
    .select("*")
    .eq("activa", true)
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || null });
});

// Saldo del usuario
router.get("/saldo/:id_usuario", async (req, res) => {
  const { data, error } = await supabase
    .from("usuario")
    .select("dinero")
    .eq("id_usuario", Number(req.params.id_usuario))
    .single();
  if (error) return res.status(404).json({ success: false, error: "Usuario no encontrado" });
  res.json({ success: true, dinero: data.dinero });
});

// Comprar producto de la tienda
router.post("/comprar", async (req, res) => {
  const { id_usuario, id_producto, id_variante, id_direccion } = req.body;
  if (!id_usuario || !id_producto)
    return res.status(400).json({ success: false, error: "Faltan datos" });
  const { data, error } = await supabase.rpc("fn_comprar_producto", {
    p_id_usuario: Number(id_usuario),
    p_id_producto: Number(id_producto),
    p_id_variante: id_variante != null ? Number(id_variante) : null,
    p_id_direccion: id_direccion != null ? Number(id_direccion) : null,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data?.success) return res.status(400).json({ success: false, error: data?.error || "Error al comprar" });
  res.json({ success: true, saldo: data.saldo, id_pedido: data.id_pedido ?? null });
});

// ============ Direcciones de envío ============
router.get("/direcciones/:id_usuario", async (req, res) => {
  const { data, error } = await supabase
    .from("direccion_envio")
    .select("*")
    .eq("id_usuario", Number(req.params.id_usuario))
    .order("es_predeterminada", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

router.post("/direcciones", async (req, res) => {
  const {
    id_usuario, alias, nombre_destinatario, telefono,
    calle, ciudad, estado, codigo_postal, pais,
    lat, lng, es_predeterminada,
  } = req.body;
  if (!id_usuario || !alias || !nombre_destinatario || !calle || !ciudad) {
    return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
  }

  if (es_predeterminada) {
    await supabase
      .from("direccion_envio")
      .update({ es_predeterminada: false })
      .eq("id_usuario", Number(id_usuario));
  }

  const { data, error } = await supabase
    .from("direccion_envio")
    .insert({
      id_usuario: Number(id_usuario),
      alias,
      nombre_destinatario,
      telefono: telefono ?? null,
      calle,
      ciudad,
      estado: estado ?? null,
      codigo_postal: codigo_postal ?? null,
      pais: pais || "MX",
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      es_predeterminada: !!es_predeterminada,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

router.put("/direcciones/:id_direccion", async (req, res) => {
  const id_direccion = Number(req.params.id_direccion);
  const {
    id_usuario, alias, nombre_destinatario, telefono,
    calle, ciudad, estado, codigo_postal, pais,
    lat, lng, es_predeterminada,
  } = req.body;
  if (!id_usuario) return res.status(400).json({ success: false, error: "Falta id_usuario" });

  const { data: existing } = await supabase
    .from("direccion_envio")
    .select("id_direccion")
    .eq("id_direccion", id_direccion)
    .eq("id_usuario", Number(id_usuario))
    .maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: "Dirección no encontrada" });

  if (es_predeterminada) {
    await supabase
      .from("direccion_envio")
      .update({ es_predeterminada: false })
      .eq("id_usuario", Number(id_usuario))
      .neq("id_direccion", id_direccion);
  }

  const updates: Record<string, any> = {};
  if (alias !== undefined) updates.alias = alias;
  if (nombre_destinatario !== undefined) updates.nombre_destinatario = nombre_destinatario;
  if (telefono !== undefined) updates.telefono = telefono;
  if (calle !== undefined) updates.calle = calle;
  if (ciudad !== undefined) updates.ciudad = ciudad;
  if (estado !== undefined) updates.estado = estado;
  if (codigo_postal !== undefined) updates.codigo_postal = codigo_postal;
  if (pais !== undefined) updates.pais = pais;
  if (lat !== undefined) updates.lat = lat != null ? Number(lat) : null;
  if (lng !== undefined) updates.lng = lng != null ? Number(lng) : null;
  if (es_predeterminada !== undefined) updates.es_predeterminada = !!es_predeterminada;

  const { data, error } = await supabase
    .from("direccion_envio")
    .update(updates)
    .eq("id_direccion", id_direccion)
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

router.delete("/direcciones/:id_direccion", async (req, res) => {
  const id_direccion = Number(req.params.id_direccion);
  const id_usuario = Number(req.query.id_usuario);
  if (!id_usuario) return res.status(400).json({ success: false, error: "Falta id_usuario" });

  const { error } = await supabase
    .from("direccion_envio")
    .delete()
    .eq("id_direccion", id_direccion)
    .eq("id_usuario", id_usuario);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

router.put("/direcciones/:id_direccion/predeterminada", async (req, res) => {
  const id_direccion = Number(req.params.id_direccion);
  const { id_usuario } = req.body;
  if (!id_usuario) return res.status(400).json({ success: false, error: "Falta id_usuario" });

  const { data: existing } = await supabase
    .from("direccion_envio")
    .select("id_direccion")
    .eq("id_direccion", id_direccion)
    .eq("id_usuario", Number(id_usuario))
    .maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: "Dirección no encontrada" });

  await supabase
    .from("direccion_envio")
    .update({ es_predeterminada: false })
    .eq("id_usuario", Number(id_usuario))
    .neq("id_direccion", id_direccion);

  const { error } = await supabase
    .from("direccion_envio")
    .update({ es_predeterminada: true })
    .eq("id_direccion", id_direccion);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// ============ Pedidos ============
// Auto-progresión por tiempo (modo demo): procesando → 1min → enviado → 3min → en_camino → 6min → entregado
const UMBRAL_ENVIADO_MIN = 1;
const UMBRAL_EN_CAMINO_MIN = 3;
const UMBRAL_ENTREGADO_MIN = 6;

function calcularEstadoEsperado(fechaPedido: string, estadoActual: string): string {
  if (estadoActual === "cancelado" || estadoActual === "entregado") return estadoActual;
  const minutos = (Date.now() - new Date(fechaPedido).getTime()) / 60000;
  if (minutos < UMBRAL_ENVIADO_MIN) return "procesando";
  if (minutos < UMBRAL_EN_CAMINO_MIN) return "enviado";
  if (minutos < UMBRAL_ENTREGADO_MIN) return "en_camino";
  return "entregado";
}

async function avanzarEstadosPedidos(rows: any[]): Promise<any[]> {
  const ahora = new Date().toISOString();
  const updates: any[] = [];
  const resultado = rows.map((p) => {
    const nuevo = calcularEstadoEsperado(p.fecha_pedido, p.estado);
    if (nuevo === p.estado) return p;
    const upd: Record<string, any> = { estado: nuevo };
    if (nuevo === "entregado") upd.fecha_entrega = ahora;
    updates.push(supabase.from("pedido").update(upd).eq("id_pedido", p.id_pedido));
    return { ...p, estado: nuevo, fecha_entrega: upd.fecha_entrega ?? p.fecha_entrega };
  });
  if (updates.length) Promise.all(updates).catch(() => {});
  return resultado;
}

router.get("/pedidos/:id_usuario", async (req, res) => {
  const { data, error } = await supabase
    .from("pedido")
    .select(`
      id_pedido, id_usuario, id_producto, id_variante, costo,
      direccion_snapshot, lat_destino, lng_destino, estado,
      fecha_pedido, fecha_entrega,
      producto:producto(id_producto, nombre, imagen, tipo),
      variante:producto_variante(id_variante, talla)
    `)
    .eq("id_usuario", Number(req.params.id_usuario))
    .order("fecha_pedido", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  const actualizados = await avanzarEstadosPedidos(data || []);
  res.json({ success: true, data: actualizados });
});

router.get("/pedido/:id_pedido", async (req, res) => {
  const { data, error } = await supabase
    .from("pedido")
    .select(`
      id_pedido, id_usuario, id_producto, id_variante, costo,
      direccion_snapshot, lat_destino, lng_destino, estado,
      fecha_pedido, fecha_entrega,
      producto:producto(id_producto, nombre, imagen, tipo, descripcion),
      variante:producto_variante(id_variante, talla)
    `)
    .eq("id_pedido", Number(req.params.id_pedido))
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: "Pedido no encontrado" });
  const [actualizado] = await avanzarEstadosPedidos([data]);
  res.json({ success: true, data: actualizado });
});

// Editar dirección del pedido (sólo si está en 'procesando')
router.put("/pedido/:id_pedido/direccion", async (req, res) => {
  const id_pedido = Number(req.params.id_pedido);
  const {
    id_usuario, alias, nombre_destinatario, telefono,
    calle, ciudad, estado, codigo_postal, pais, lat, lng,
  } = req.body;

  if (!id_usuario || !alias || !nombre_destinatario || !calle || !ciudad) {
    return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
  }

  const { data: pedido, error: fetchErr } = await supabase
    .from("pedido")
    .select("id_pedido, id_usuario, estado, direccion_snapshot")
    .eq("id_pedido", id_pedido)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
  if (!pedido) return res.status(404).json({ success: false, error: "Pedido no encontrado" });
  if (pedido.id_usuario !== Number(id_usuario)) return res.status(403).json({ success: false, error: "No autorizado" });
  if (pedido.estado !== "procesando") {
    return res.status(400).json({ success: false, error: "La dirección solo se puede editar mientras el pedido está en 'procesando'" });
  }

  const idDireccionPrevio = pedido.direccion_snapshot?.id_direccion ?? null;
  const nuevoSnapshot: Record<string, any> = {
    id_direccion: idDireccionPrevio,
    alias,
    nombre_destinatario,
    telefono: telefono ?? null,
    calle,
    ciudad,
    estado: estado ?? null,
    codigo_postal: codigo_postal ?? null,
    pais: pais || "MX",
    lat: lat != null ? Number(lat) : null,
    lng: lng != null ? Number(lng) : null,
  };

  const { data: updated, error: updErr } = await supabase
    .from("pedido")
    .update({
      direccion_snapshot: nuevoSnapshot,
      lat_destino: nuevoSnapshot.lat,
      lng_destino: nuevoSnapshot.lng,
    })
    .eq("id_pedido", id_pedido)
    .select(`
      id_pedido, id_usuario, id_producto, id_variante, costo,
      direccion_snapshot, lat_destino, lng_destino, estado,
      fecha_pedido, fecha_entrega,
      producto:producto(id_producto, nombre, imagen, tipo, descripcion),
      variante:producto_variante(id_variante, talla)
    `)
    .single();
  if (updErr) return res.status(500).json({ success: false, error: updErr.message });
  res.json({ success: true, data: updated });
});

router.put("/pedido/:id_pedido/estado", async (req, res) => {
  const id_pedido = Number(req.params.id_pedido);
  const { estado } = req.body;
  const validos = ["procesando", "enviado", "en_camino", "entregado", "cancelado"];
  if (!validos.includes(estado)) {
    return res.status(400).json({ success: false, error: "Estado inválido" });
  }

  const updates: Record<string, any> = { estado };
  if (estado === "entregado") updates.fecha_entrega = new Date().toISOString();

  const { error } = await supabase
    .from("pedido")
    .update(updates)
    .eq("id_pedido", id_pedido);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// Agregar puntos de bonus (500 pts por reclamo)
router.post("/bonus", async (req, res) => {
  const { id_usuario } = req.body;
  if (!id_usuario) return res.status(400).json({ success: false, error: "Falta id_usuario" });

  const BONUS = 500;
  const { data: usuario, error: fetchErr } = await supabase
    .from("usuario")
    .select("dinero")
    .eq("id_usuario", Number(id_usuario))
    .single();
  if (fetchErr) return res.status(404).json({ success: false, error: "Usuario no encontrado" });

  const nuevo = Number(usuario.dinero) + BONUS;
  const { error: updateErr } = await supabase
    .from("usuario")
    .update({ dinero: nuevo })
    .eq("id_usuario", Number(id_usuario));
  if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });

  res.json({ success: true, dinero: nuevo, bonus: BONUS });
});

// ============ Comentarios / reseñas (solo items reales) ============
router.get("/comentarios/:id_producto", async (req, res) => {
  const { data, error } = await supabase
    .from("comentario_producto")
    .select(`
      id_comentario, id_producto, id_usuario, calificacion, comentario, fecha_creacion,
      usuario:usuario(nickname, nombre_usuario)
    `)
    .eq("id_producto", Number(req.params.id_producto))
    .order("fecha_creacion", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

router.post("/comentarios", async (req, res) => {
  const { id_usuario, id_producto, calificacion, comentario } = req.body;
  if (!id_usuario || !id_producto || !calificacion || !comentario) {
    return res.status(400).json({ success: false, error: "Faltan datos" });
  }
  const cal = Number(calificacion);
  if (cal < 1 || cal > 5) {
    return res.status(400).json({ success: false, error: "Calificación inválida (1-5)" });
  }
  if (typeof comentario !== "string" || comentario.trim().length < 3) {
    return res.status(400).json({ success: false, error: "El comentario es muy corto" });
  }

  // Validar que sea un producto real
  const { data: prod } = await supabase
    .from("producto")
    .select("categoria")
    .eq("id_producto", Number(id_producto))
    .maybeSingle();
  if (!prod || prod.categoria !== "real") {
    return res.status(400).json({ success: false, error: "Solo se pueden reseñar productos reales" });
  }

  // Validar que el usuario haya comprado el producto
  const { data: compras } = await supabase
    .from("inventario_producto")
    .select("id_inventario")
    .eq("id_usuario", Number(id_usuario))
    .eq("id_producto", Number(id_producto))
    .limit(1);
  if (!compras || compras.length === 0) {
    return res.status(403).json({ success: false, error: "Solo podés reseñar productos que compraste" });
  }

  const { data, error } = await supabase
    .from("comentario_producto")
    .insert({
      id_usuario: Number(id_usuario),
      id_producto: Number(id_producto),
      calificacion: cal,
      comentario: comentario.trim(),
    })
    .select(`
      id_comentario, id_producto, id_usuario, calificacion, comentario, fecha_creacion,
      usuario:usuario(nickname, nombre_usuario)
    `)
    .single();
  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ success: false, error: "Ya dejaste una reseña para este producto" });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
  res.json({ success: true, data });
});

router.delete("/comentarios/:id_comentario", async (req, res) => {
  const id_comentario = Number(req.params.id_comentario);
  const id_usuario = Number(req.query.id_usuario);
  if (!id_usuario) return res.status(400).json({ success: false, error: "Falta id_usuario" });

  const { error } = await supabase
    .from("comentario_producto")
    .delete()
    .eq("id_comentario", id_comentario)
    .eq("id_usuario", id_usuario);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

export default router;
