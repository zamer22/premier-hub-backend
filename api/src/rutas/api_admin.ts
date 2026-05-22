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

const ADMIN_PRODUCTO_FIELDS = `
  id_producto,
  nombre,
  descripcion,
  costo,
  stock,
  imagen,
  es_nuevo,
  categoria,
  tipo,
  equipo,
  rareza,
  id_temporada,
  css,
  es_de_liga
`;

const ADMIN_LISTADO_FIELDS = `
  id_listado, id_vendedor, id_inventario, precio, estado, fecha_creacion, fecha_venta, id_comprador,
  inventario:inventario_producto(
    id, id_producto,
    producto:producto(nombre, imagen, css, tipo, rareza, categoria, equipo)
  )
`;

const ESTADOS_VALIDOS = ["procesando", "enviado", "en_camino", "entregado", "cancelado"];

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

function normalizarProducto(p: any) {
  return {
    id_producto: p.id_producto,
    nombre: p.nombre,
    descripcion: p.descripcion ?? null,
    costo: Number(p.costo || 0),
    stock: Number(p.stock || 0),
    imagen: p.imagen ?? null,
    es_nuevo: !!p.es_nuevo,
    categoria: p.categoria || "perfil",
    tipo: p.tipo ?? null,
    equipo: p.equipo ?? null,
    rareza: p.rareza ?? null,
    id_temporada: p.id_temporada ?? null,
    css: p.css ?? null,
    es_de_liga: !!p.es_de_liga,
  };
}

function normalizarListado(l: any, vendedoresById: Record<number, string | null> = {}) {
  const inv = Array.isArray(l.inventario) ? l.inventario[0] : l.inventario;
  const prodRaw = inv?.producto ?? null;
  const prod = Array.isArray(prodRaw) ? prodRaw[0] : prodRaw;

  return {
    id_listado: l.id_listado,
    id_vendedor: l.id_vendedor,
    id_inventario: l.id_inventario,
    precio: Number(l.precio),
    estado: l.estado,
    created_at: l.fecha_creacion,
    fecha_creacion: l.fecha_creacion,
    fecha_venta: l.fecha_venta,
    id_comprador: l.id_comprador,
    nombre: prod?.nombre ?? null,
    imagen: prod?.imagen ?? null,
    css: prod?.css ?? null,
    tipo: prod?.tipo ?? null,
    rareza: prod?.rareza ?? null,
    categoria: prod?.categoria ?? null,
    equipo: prod?.equipo ?? null,
    vendedor_nickname: vendedoresById[Number(l.id_vendedor)] ?? null,
  };
}

async function normalizarListados(rows: any[]) {
  const vendedorIds = Array.from(
    new Set(
      rows
        .map((l: any) => Number(l.id_vendedor))
        .filter((id: number) => Number.isFinite(id) && id > 0)
    )
  );

  const vendedoresById: Record<number, string | null> = {};

  if (vendedorIds.length > 0) {
    const { data: vendedores, error } = await supabase
      .from("usuario")
      .select("id_usuario, nickname")
      .in("id_usuario", vendedorIds);

    if (error) throw error;

    (vendedores || []).forEach((v: any) => {
      vendedoresById[Number(v.id_usuario)] = v.nickname ?? null;
    });
  }

  return rows.map(l => normalizarListado(l, vendedoresById));
}

/* ====================== PEDIDOS ADMIN ====================== */

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

router.put("/pedido/:id_pedido", async (req, res) => {
  const id_pedido = Number(req.params.id_pedido);
  const {
    estado,
    lat_actual,
    lng_actual,
    tracking_numero,
    fecha_estimada,
    notas_admin,
  } = req.body;

  const { data: pedidoActual, error: fetchErr } = await supabase
    .from("pedido")
    .select("estado, id_usuario, costo")
    .eq("id_pedido", id_pedido)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
  if (!pedidoActual) return res.status(404).json({ success: false, error: "Pedido no encontrado" });

  if (pedidoActual.estado === "entregado" || pedidoActual.estado === "cancelado") {
    return res.status(409).json({
      success: false,
      error: `El pedido está ${pedidoActual.estado} y no puede modificarse`,
    });
  }

  const updates: Record<string, any> = {};

  if (estado !== undefined) {
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, error: "Estado inválido" });
    }

    updates.estado = estado;

    if (estado === "entregado") {
      updates.fecha_entrega = new Date().toISOString();
    }
  }

  if (lat_actual !== undefined) updates.lat_actual = lat_actual != null ? Number(lat_actual) : null;
  if (lng_actual !== undefined) updates.lng_actual = lng_actual != null ? Number(lng_actual) : null;
  if (tracking_numero !== undefined) updates.tracking_numero = tracking_numero || null;
  if (fecha_estimada !== undefined) updates.fecha_estimada = fecha_estimada || null;
  if (notas_admin !== undefined) updates.notas_admin = notas_admin || null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: "Nada que actualizar" });
  }

  const cancelando = estado === "cancelado" && pedidoActual.estado !== "cancelado";

  const { data, error } = await supabase
    .from("pedido")
    .update(updates)
    .eq("id_pedido", id_pedido)
    .select(ADMIN_PEDIDO_FIELDS)
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  if (cancelando) {
    const { data: usuario, error: usrErr } = await supabase
      .from("usuario")
      .select("dinero")
      .eq("id_usuario", pedidoActual.id_usuario)
      .maybeSingle();

    if (usrErr || !usuario) {
      return res.json({
        success: true,
        data,
        warning: "Pedido cancelado, pero no se pudo leer el saldo del usuario para devolverle los puntos",
      });
    }

    const nuevoSaldo = Number(usuario.dinero || 0) + Number(pedidoActual.costo || 0);

    const { error: updUsrErr } = await supabase
      .from("usuario")
      .update({ dinero: nuevoSaldo })
      .eq("id_usuario", pedidoActual.id_usuario);

    if (updUsrErr) {
      return res.json({
        success: true,
        data,
        warning: "Pedido cancelado, pero la devolución de puntos falló",
      });
    }

    return res.json({
      success: true,
      data,
      refunded: Number(pedidoActual.costo || 0),
    });
  }

  res.json({ success: true, data });
});

/* ====================== PRODUCTOS ADMIN ====================== */

router.get("/productos", async (_req, res) => {
  const { data, error } = await supabase
    .from("producto")
    .select(ADMIN_PRODUCTO_FIELDS)
    .order("id_producto", { ascending: true });

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({
    success: true,
    data: (data || []).map(normalizarProducto),
  });
});

router.post("/productos", async (req, res) => {
  const {
    nombre,
    descripcion,
    costo,
    stock,
    imagen,
    es_nuevo,
    categoria,
    tipo,
    equipo,
    rareza,
    id_temporada,
    css,
    es_de_liga,
  } = req.body;

  if (!nombre || costo == null) {
    return res.status(400).json({
      success: false,
      error: "Nombre y costo son requeridos",
    });
  }

  const { data, error } = await supabase
    .from("producto")
    .insert({
      nombre: String(nombre).trim(),
      descripcion: descripcion?.trim() || null,
      costo: Number(costo),
      stock: stock != null && stock !== "" ? Number(stock) : 0,
      imagen: imagen?.trim() || null,
      es_nuevo: !!es_nuevo,
      categoria: categoria || "perfil",
      tipo: tipo || null,
      equipo: equipo?.trim() || null,
      rareza: rareza?.trim() || null,
      id_temporada: id_temporada ? Number(id_temporada) : null,
      css: css?.trim() || null,
      es_de_liga: !!es_de_liga,
    })
    .select(ADMIN_PRODUCTO_FIELDS)
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.status(201).json({
    success: true,
    data: normalizarProducto(data),
  });
});

/* Alias usado por AdminTienda para ver todos los objetos de tienda */
router.get("/marketplace/catalogo", async (_req, res) => {
  const { data, error } = await supabase
    .from("producto")
    .select(ADMIN_PRODUCTO_FIELDS)
    .order("id_producto", { ascending: true });

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({
    success: true,
    data: (data || []).map(normalizarProducto),
  });
});

/* ====================== MARKETPLACE ADMIN ====================== */

router.get("/marketplace/listados", async (req, res) => {
  const { estado, q } = req.query;

  let query = supabase
    .from("marketplace_listado")
    .select(ADMIN_LISTADO_FIELDS)
    .order("fecha_creacion", { ascending: false })
    .limit(500);

  if (estado && typeof estado === "string" && ["activo", "vendido", "cancelado"].includes(estado)) {
    query = query.eq("estado", estado);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ success: false, error: error.message });

  let result;

  try {
    result = await normalizarListados(data || []);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || "Error cargando vendedores",
    });
  }

  if (q && typeof q === "string" && q.trim()) {
    const term = q.trim().toLowerCase();
    const numQ = Number(term);

    result = result.filter(l =>
      (l.nombre || "").toLowerCase().includes(term) ||
      (l.vendedor_nickname || "").toLowerCase().includes(term) ||
      (!Number.isNaN(numQ) && l.id_listado === numQ)
    );
  }

  res.json({ success: true, data: result });
});

router.post("/marketplace/publicar", async (req, res) => {
  const { id_admin, id_producto, precio } = req.body;

  if (!id_admin || !id_producto || !precio || Number(precio) <= 0) {
    return res.status(400).json({
      success: false,
      error: "Faltan datos o precio inválido",
    });
  }

  const { data: prod, error: prodErr } = await supabase
    .from("producto")
    .select("id_producto, nombre")
    .eq("id_producto", Number(id_producto))
    .maybeSingle();

  if (prodErr) return res.status(500).json({ success: false, error: prodErr.message });
  if (!prod) return res.status(404).json({ success: false, error: "Producto no encontrado" });

  let { data: inventario, error: invErr } = await supabase
    .from("inventario_producto")
    .select("id")
    .eq("id_usuario", Number(id_admin))
    .eq("id_producto", Number(id_producto))
    .limit(1)
    .maybeSingle();

  if (invErr) return res.status(500).json({ success: false, error: invErr.message });

  if (!inventario) {
    const { data: newInv, error: insertInvErr } = await supabase
      .from("inventario_producto")
      .insert({
        id_usuario: Number(id_admin),
        id_producto: Number(id_producto),
      })
      .select("id")
      .single();

    if (insertInvErr) {
      return res.status(500).json({
        success: false,
        error: insertInvErr.message,
      });
    }

    inventario = newInv;
  }

  const { data: existing } = await supabase
    .from("marketplace_listado")
    .select("id_listado")
    .eq("id_inventario", inventario.id)
    .eq("estado", "activo")
    .maybeSingle();

  if (existing) {
    return res.status(409).json({
      success: false,
      error: `Ya hay un listado activo del admin para "${prod.nombre}"`,
    });
  }

  const { data, error } = await supabase
    .from("marketplace_listado")
    .insert({
      id_vendedor: Number(id_admin),
      id_inventario: inventario.id,
      precio: Number(precio),
    })
    .select(ADMIN_LISTADO_FIELDS)
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  try {
    const [normalizado] = await normalizarListados([data]);
    res.status(201).json({ success: true, data: normalizado });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || "Error cargando vendedor",
    });
  }
});

router.delete("/marketplace/cancelar/:id_listado", async (req, res) => {
  const id_listado = Number(req.params.id_listado);

  const { data: listado, error: fetchErr } = await supabase
    .from("marketplace_listado")
    .select("id_listado, estado")
    .eq("id_listado", id_listado)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
  if (!listado) return res.status(404).json({ success: false, error: "Listado no encontrado" });

  if (listado.estado !== "activo") {
    return res.status(409).json({
      success: false,
      error: `El listado ya está ${listado.estado} y no puede cancelarse`,
    });
  }

  const { error } = await supabase
    .from("marketplace_listado")
    .update({ estado: "cancelado" })
    .eq("id_listado", id_listado);

  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true });
});

router.put("/marketplace/listados/:id_listado", async (req, res) => {
  const id_listado = Number(req.params.id_listado);
  const { precio } = req.body;

  if (!precio || Number(precio) <= 0) {
    return res.status(400).json({
      success: false,
      error: "Precio inválido",
    });
  }

  const { data: listado } = await supabase
    .from("marketplace_listado")
    .select("id_listado, estado")
    .eq("id_listado", id_listado)
    .maybeSingle();

  if (!listado) return res.status(404).json({ success: false, error: "Listado no encontrado" });

  if (listado.estado !== "activo") {
    return res.status(409).json({
      success: false,
      error: "Solo se puede editar el precio de listados activos",
    });
  }

  const { data, error } = await supabase
    .from("marketplace_listado")
    .update({ precio: Number(precio) })
    .eq("id_listado", id_listado)
    .select(ADMIN_LISTADO_FIELDS)
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  try {
    const [normalizado] = await normalizarListados([data]);
    res.json({ success: true, data: normalizado });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || "Error cargando vendedor",
    });
  }
});

export default router;