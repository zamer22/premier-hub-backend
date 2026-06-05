import { Router } from "express";
import multer from "multer";
import supabase from "../db";
import { requireAdmin } from "../middleware/requireAuth";

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
const FORUM_BUCKET = "forum-media";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024,
  },
});

const PRODUCTOS_BUCKET = "productosMarketplace";

router.use(requireAdmin);

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
        .filter((id: number) => Number.isFinite(id) && id > 0),
    ),
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

  return rows.map((l) => normalizarListado(l, vendedoresById));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Error interno del servidor";
}

function normalizeSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function signedForumImage(path: string | null) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(FORUM_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data.signedUrl;
}

async function getModerationTarget(event: any) {
  if (event.target_type === "post") {
    const { data } = await supabase
      .from("forum_posts")
      .select(`
        id, subforum_id, id_usuario, title, body, image_path, status, created_at, published_at,
        subforum:forum_subforums(id, slug, name),
        usuario:usuario!forum_posts_id_usuario_fkey(id_usuario, nickname, nombre_usuario, correo)
      `)
      .eq("id", event.target_id)
      .maybeSingle();

    return data ? { ...data, image_url: await signedForumImage(data.image_path) } : null;
  }

  if (event.target_type === "comment") {
    const { data } = await supabase
      .from("forum_comments")
      .select(`
        id, post_id, id_usuario, body, status, created_at, published_at,
        post:forum_posts(id, title),
        usuario:usuario!forum_comments_id_usuario_fkey(id_usuario, nickname, nombre_usuario, correo)
      `)
      .eq("id", event.target_id)
      .maybeSingle();

    return data || null;
  }

  return null;
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
  const { estado, lat_actual, lng_actual, tracking_numero, fecha_estimada, notas_admin } = req.body;

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

router.post("/productos/imagen", upload.single("imagen"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Falta imagen",
    });
  }

  const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };

  const extension = allowedTypes[req.file.mimetype];

  if (!extension) {
    return res.status(400).json({
      success: false,
      error: "Formato de imagen no permitido. Usa JPG, PNG, WEBP o GIF.",
    });
  }

  const filePath = `productos/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const { error } = await supabase.storage.from(PRODUCTOS_BUCKET).upload(filePath, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: false,
  });

  if (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }

  // No usar getPublicUrl(): arma la URL con el SUPABASE_URL interno del backend
  // (http://192.168.1.24:8000) que el navegador no alcanza. Construimos la URL
  // publica con el dominio del tunnel, igual que las fotos de perfil en api_auth.
  const supabasePublicBase = (process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL!).replace(/\/$/, "");
  const publicUrl = `${supabasePublicBase}/storage/v1/object/public/${PRODUCTOS_BUCKET}/${filePath}`;

  res.status(201).json({
    success: true,
    data: {
      path: filePath,
      publicUrl,
    },
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

    result = result.filter(
      (l) =>
        (l.nombre || "").toLowerCase().includes(term) ||
        (l.vendedor_nickname || "").toLowerCase().includes(term) ||
        (!Number.isNaN(numQ) && l.id_listado === numQ),
    );
  }

  res.json({ success: true, data: result });
});

router.post("/marketplace/publicar", async (req, res) => {
  const { id_admin, id_producto, precio } = req.body;

  const adminId = Number(id_admin ?? req.query.id_usuario ?? req.header("x-id-usuario"));
  const productoId = Number(id_producto);
  const precioNum = Number(precio);

  if (!Number.isInteger(adminId) || adminId <= 0) {
    return res.status(400).json({
      success: false,
      error: "id_admin invalido",
    });
  }

  if (!Number.isInteger(productoId) || productoId <= 0) {
    return res.status(400).json({
      success: false,
      error: "id_producto invalido",
    });
  }

  if (!Number.isFinite(precioNum) || precioNum <= 0) {
    return res.status(400).json({
      success: false,
      error: "Precio invalido",
    });
  }

  const { data: prod, error: prodErr } = await supabase
    .from("producto")
    .select("id_producto, nombre, categoria")
    .eq("id_producto", productoId)
    .maybeSingle();

  if (prodErr) return res.status(500).json({ success: false, error: prodErr.message });
  if (!prod) return res.status(404).json({ success: false, error: "Producto no encontrado" });

  let { data: inventario, error: invErr } = await supabase
    .from("inventario_producto")
    .select("id")
    .eq("id_usuario", adminId)
    .eq("id_producto", productoId)
    .limit(1)
    .maybeSingle();

  if (invErr) return res.status(500).json({ success: false, error: invErr.message });

  if (!inventario) {
    const { data: newInv, error: insertInvErr } = await supabase
      .from("inventario_producto")
      .insert({
        id_usuario: adminId,
        id_producto: productoId,
        cantidad: 1,
        es_perfil: prod.categoria === "perfil",
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
      id_vendedor: adminId,
      id_inventario: inventario.id,
      precio: precioNum,
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

  const adminId = req.userId!;

  if (!id_listado || Number.isNaN(id_listado)) {
    return res.status(400).json({
      success: false,
      error: "ID de listado inválido",
    });
  }

  const { data: listado, error: fetchErr } = await supabase
    .from("marketplace_listado")
    .select(`
      id_listado,
      id_vendedor,
      id_inventario,
      estado,
      inventario:inventario_producto(
        id,
        id_usuario,
        id_producto,
        es_perfil
      )
    `)
    .eq("id_listado", id_listado)
    .maybeSingle();

  if (fetchErr) {
    return res.status(500).json({ success: false, error: fetchErr.message });
  }

  if (!listado) {
    return res.status(404).json({ success: false, error: "Listado no encontrado" });
  }

  if (listado.estado !== "activo") {
    return res.status(409).json({
      success: false,
      error: `El listado ya está ${listado.estado} y no puede cancelarse`,
    });
  }

  const inventarioRaw = Array.isArray(listado.inventario)
    ? listado.inventario[0]
    : listado.inventario;

  const inventario = inventarioRaw || null;

  if (!inventario) {
    return res.status(404).json({
      success: false,
      error: "Inventario del listado no encontrado",
    });
  }

  const inventarioId = Number(listado.id_inventario);
  const productoId = Number(inventario.id_producto);

  const esListadoDelAdmin = Number(listado.id_vendedor) === adminId;

  if (!esListadoDelAdmin) {
    const { error } = await supabase
      .from("marketplace_listado")
      .update({ estado: "cancelado" })
      .eq("id_listado", id_listado);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      removed: false,
      data: {
        id_listado,
        estado: "cancelado",
      },
    });
  }

  await supabase
    .from("usuario_equipamiento")
    .update({ marco_inventario_id: null })
    .eq("marco_inventario_id", inventarioId);

  await supabase
    .from("usuario_equipamiento")
    .update({ titulo_inventario_id: null })
    .eq("titulo_inventario_id", inventarioId);

  await supabase
    .from("usuario_equipamiento")
    .update({ trofeo_inventario_id: null })
    .eq("trofeo_inventario_id", inventarioId);

  await supabase
    .from("usuario_equipamiento")
    .update({ banner_inventario_id: null })
    .eq("banner_inventario_id", inventarioId);

  const { error: deleteListadoErr } = await supabase
    .from("marketplace_listado")
    .delete()
    .eq("id_listado", id_listado);

  if (deleteListadoErr) {
    return res.status(500).json({
      success: false,
      error: deleteListadoErr.message,
    });
  }

  const { error: deleteInventarioErr } = await supabase
    .from("inventario_producto")
    .delete()
    .eq("id", inventarioId)
    .eq("id_usuario", adminId)
    .eq("id_producto", productoId);

  if (deleteInventarioErr) {
    return res.status(500).json({
      success: false,
      error: deleteInventarioErr.message,
    });
  }

  res.json({
    success: true,
    removed: true,
    data: {
      id_listado,
      id_inventario: inventarioId,
      id_producto: productoId,
    },
  });
});

router.put("/marketplace/listados/:id_listado", async (req, res) => {
  const id_listado = Number(req.params.id_listado);

  const {
    precio,
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

  const { data: listado, error: listadoErr } = await supabase
    .from("marketplace_listado")
    .select(`
      id_listado,
      estado,
      id_inventario,
      inventario:inventario_producto(
        id,
        id_producto
      )
    `)
    .eq("id_listado", id_listado)
    .maybeSingle();

  if (listadoErr) {
    return res.status(500).json({ success: false, error: listadoErr.message });
  }

  if (!listado) {
    return res.status(404).json({ success: false, error: "Listado no encontrado" });
  }

  if (listado.estado !== "activo") {
    return res.status(409).json({
      success: false,
      error: "Solo se pueden editar listados activos",
    });
  }

  const inventarioRaw = Array.isArray(listado.inventario)
    ? listado.inventario[0]
    : listado.inventario;

  const id_producto = Number(inventarioRaw?.id_producto);

  if (!id_producto || Number.isNaN(id_producto)) {
    return res.status(404).json({
      success: false,
      error: "Producto del listado no encontrado",
    });
  }

  const listadoUpdates: Record<string, any> = {};
  const productoUpdates: Record<string, any> = {};

  if (precio !== undefined) {
    if (!precio || Number(precio) <= 0) {
      return res.status(400).json({
        success: false,
        error: "Precio inválido",
      });
    }

    listadoUpdates.precio = Number(precio);
  }

  if (nombre !== undefined) productoUpdates.nombre = String(nombre).trim();
  if (descripcion !== undefined) productoUpdates.descripcion = descripcion?.trim() || null;
  if (costo !== undefined) productoUpdates.costo = Number(costo);
  if (stock !== undefined) productoUpdates.stock = stock != null && stock !== "" ? Number(stock) : 0;
  if (imagen !== undefined) productoUpdates.imagen = imagen?.trim() || null;
  if (es_nuevo !== undefined) productoUpdates.es_nuevo = !!es_nuevo;
  if (categoria !== undefined) productoUpdates.categoria = categoria || "perfil";
  if (tipo !== undefined) productoUpdates.tipo = tipo || null;
  if (equipo !== undefined) productoUpdates.equipo = equipo?.trim() || null;
  if (rareza !== undefined) productoUpdates.rareza = rareza?.trim() || null;
  if (id_temporada !== undefined) {
    productoUpdates.id_temporada = id_temporada ? Number(id_temporada) : null;
  }
  if (css !== undefined) productoUpdates.css = css?.trim() || null;
  if (es_de_liga !== undefined) productoUpdates.es_de_liga = !!es_de_liga;

  if (!listadoUpdates.precio && Object.keys(productoUpdates).length === 0) {
    return res.status(400).json({
      success: false,
      error: "Nada que actualizar",
    });
  }

  if (Object.keys(listadoUpdates).length > 0) {
    const { error } = await supabase
      .from("marketplace_listado")
      .update(listadoUpdates)
      .eq("id_listado", id_listado);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (Object.keys(productoUpdates).length > 0) {
    if (productoUpdates.nombre !== undefined && !productoUpdates.nombre) {
      return res.status(400).json({
        success: false,
        error: "Nombre inválido",
      });
    }

    if (
      productoUpdates.costo !== undefined &&
      (Number.isNaN(productoUpdates.costo) || productoUpdates.costo < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: "Costo inválido",
      });
    }

    const { error } = await supabase
      .from("producto")
      .update(productoUpdates)
      .eq("id_producto", id_producto);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  const { data, error } = await supabase
    .from("marketplace_listado")
    .select(ADMIN_LISTADO_FIELDS)
    .eq("id_listado", id_listado)
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

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

/* ====================== FORO / MODERACION ADMIN ====================== */

router.get("/forum/subforos", async (_req, res) => {
  const { data, error } = await supabase
    .from("forum_subforums")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data: data || [] });
});

router.post("/forum/subforos", async (req, res) => {
  const adminId = req.userId!;
  const name = String(req.body?.name || "").trim();
  const slug = normalizeSlug(req.body?.slug || name);
  const description = String(req.body?.description || "").trim() || null;

  if (!name || slug.length < 3) {
    return res.status(400).json({ success: false, error: "Nombre o slug invalido" });
  }

  const { data, error } = await supabase
    .from("forum_subforums")
    .insert({
      name,
      slug,
      description,
      created_by: adminId,
    })
    .select("*")
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(201).json({ success: true, data });
});

router.patch("/forum/subforos/:id", async (req, res) => {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (req.body?.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body?.description !== undefined) {
    updates.description = String(req.body.description || "").trim() || null;
  }
  if (req.body?.slug !== undefined) {
    const slug = normalizeSlug(req.body.slug);
    if (slug.length < 3) return res.status(400).json({ success: false, error: "Slug invalido" });
    updates.slug = slug;
  }
  if (req.body?.is_active !== undefined) updates.is_active = req.body.is_active === true;

  const { data, error } = await supabase
    .from("forum_subforums")
    .update(updates)
    .eq("id", Number(req.params.id))
    .select("*")
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data });
});

router.delete("/forum/subforos/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("forum_subforums")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", Number(req.params.id))
    .select("*")
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data });
});

router.get("/forum/moderation", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("moderation_events")
      .select(`
        *,
        usuario:usuario(id_usuario, nickname, nombre_usuario, correo)
      `)
      .eq("scope", "forum")
      .eq("status", "flagged")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const items = (
      await Promise.all(
        (data || []).map(async (event) => ({
          ...event,
          target: await getModerationTarget(event),
        }))
      )
    ).filter((item) => item.target?.status === "pending_review");

    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/forum/moderation/:eventId/resolve", async (req, res) => {
  try {
    const adminId = req.userId!;
    const action = String(req.body?.action || "");
    const notes = String(req.body?.notes || "").trim() || null;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, error: "Accion invalida" });
    }

    const { data: event, error: eventError } = await supabase
      .from("moderation_events")
      .select("*")
      .eq("id", Number(req.params.eventId))
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) return res.status(404).json({ success: false, error: "Alerta no encontrada" });

    const table = event.target_type === "post" ? "forum_posts" : "forum_comments";
    const nextStatus = action === "approve" ? "published" : "rejected";
    const updates: Record<string, unknown> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === "published") updates.published_at = new Date().toISOString();

    const { error: targetError } = await supabase
      .from(table)
      .update(updates)
      .eq("id", Number(event.target_id));

    if (targetError) throw targetError;

    const { error: actionError } = await supabase.from("moderation_actions").insert({
      event_id: event.id,
      admin_id: adminId,
      action,
      notes,
    });

    if (actionError) throw actionError;

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.get("/forum/reports", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("forum_reports")
      .select(`
        *,
        usuario:usuario!forum_reports_id_usuario_fkey(id_usuario, nickname, nombre_usuario, correo)
      `)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const items = await Promise.all(
      (data || []).map(async (report) => ({
        ...report,
        target: await getModerationTarget(report),
      }))
    );

    return res.json({ success: true, data: items });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.put("/forum/reports/:id", async (req, res) => {
  try {
    const adminId = req.userId!;
    const action = String(req.body?.action || req.body?.status || "");

    if (!["approve", "block", "dismissed", "resolved"].includes(action)) {
      return res.status(400).json({ success: false, error: "Accion invalida" });
    }

    const { data: report, error: fetchError } = await supabase
      .from("forum_reports")
      .select("*")
      .eq("id", Number(req.params.id))
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!report) return res.status(404).json({ success: false, error: "Reporte no encontrado" });

    const isBlock = action === "block" || action === "resolved";
    const nextReportStatus = isBlock ? "resolved" : "dismissed";
    const targetTable = report.target_type === "post" ? "forum_posts" : "forum_comments";

    if (isBlock) {
      const { error: targetError } = await supabase
        .from(targetTable)
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", Number(report.target_id));

      if (targetError) throw targetError;
    }

    const { data, error } = await supabase
      .from("forum_reports")
      .update({
        status: nextReportStatus,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("target_type", report.target_type)
      .eq("target_id", Number(report.target_id))
      .eq("status", "open")
      .select("*");

    if (error) throw error;

    await supabase.from("moderation_actions").insert({
      admin_id: adminId,
      action: isBlock ? "reject" : "approve",
      notes: `report:${report.target_type}:${report.target_id}`,
    });

    return res.json({ success: true, data: data || [] });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.get("/forum/users", async (_req, res) => {
  try {
    const [{ data: events, error: eventsError }, { data: restrictions, error: restrictionsError }] =
      await Promise.all([
        supabase
          .from("moderation_events")
          .select("id_usuario, status")
          .eq("scope", "forum")
          .eq("status", "flagged"),
        supabase
          .from("user_restrictions")
          .select("*, usuario:usuario!user_restrictions_id_usuario_fkey(id_usuario, nickname, nombre_usuario, correo)")
          .eq("scope", "forum")
          .eq("active", true)
          .order("created_at", { ascending: false }),
      ]);

    if (eventsError) throw eventsError;
    if (restrictionsError) throw restrictionsError;

    const alertCounts = (events || []).reduce<Record<number, number>>((acc, event: any) => {
      const userId = Number(event.id_usuario);
      acc[userId] = (acc[userId] || 0) + 1;
      return acc;
    }, {});
    const userIds = Object.keys(alertCounts).map(Number);

    let users: any[] = [];
    if (userIds.length) {
      const { data, error } = await supabase
        .from("usuario")
        .select("id_usuario, nickname, nombre_usuario, correo")
        .in("id_usuario", userIds);
      if (error) throw error;
      users = data || [];
    }

    return res.json({
      success: true,
      data: {
        users: users.map((user) => ({
          ...user,
          alert_count: alertCounts[Number(user.id_usuario)] || 0,
          restriction: (restrictions || []).find((restriction: any) => Number(restriction.id_usuario) === Number(user.id_usuario)) || null,
        })),
        restrictions: restrictions || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/forum/users/:userId/restrictions", async (req, res) => {
  try {
    const adminId = req.userId!;
    const userId = Number(req.params.userId);
    const reason = String(req.body?.reason || "").trim() || "Restriccion aplicada por moderacion";

    await supabase
      .from("user_restrictions")
      .update({
        active: false,
        lifted_by: adminId,
        lifted_at: new Date().toISOString(),
      })
      .eq("id_usuario", userId)
      .eq("scope", "forum")
      .eq("active", true);

    const { data, error } = await supabase
      .from("user_restrictions")
      .insert({
        id_usuario: userId,
        scope: "forum",
        restriction_type: "read_only",
        reason,
        active: true,
        created_by: adminId,
      })
      .select("*")
      .single();

    if (error) throw error;

    await supabase.from("moderation_actions").insert({
      admin_id: adminId,
      action: "ban_user",
      notes: `forum:${userId}:${reason}`,
    });

    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.delete("/forum/restrictions/:id", async (req, res) => {
  try {
    const adminId = req.userId!;
    const { data, error } = await supabase
      .from("user_restrictions")
      .update({
        active: false,
        lifted_by: adminId,
        lifted_at: new Date().toISOString(),
      })
      .eq("id", Number(req.params.id))
      .select("*")
      .single();

    if (error) throw error;

    await supabase.from("moderation_actions").insert({
      admin_id: adminId,
      action: "unban_user",
      notes: `forum:${data.id_usuario}`,
    });

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

export default router;
