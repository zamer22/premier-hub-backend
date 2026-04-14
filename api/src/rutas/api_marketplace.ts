import { Router } from "express";
import supabase from "../db";

const router = Router();

// Listados activos del marketplace
router.get("/listados", async (req, res) => {
  const mios = req.query.mios;

  if (mios) {
    const { data, error } = await supabase.rpc("fn_mis_listados", {
      p_id_usuario: Number(mios),
    });
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, data: data || [] });
  }

  const excluir = req.query.excluir ? Number(req.query.excluir) : -1;
  const { data, error } = await supabase.rpc("fn_marketplace_listados", {
    p_excluir_usuario: excluir,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

// Publicar item en marketplace
router.post("/publicar", async (req, res) => {
  const { id_usuario, id_inventario, precio } = req.body;

  // Verificar que el item pertenece al usuario
  const { data: item } = await supabase
    .from("inventario_producto")
    .select("id")
    .eq("id", id_inventario)
    .eq("id_usuario", id_usuario)
    .maybeSingle();

  if (!item) return res.status(400).json({ success: false, error: "Este item no te pertenece" });

  // Verificar que no esté ya publicado
  const { data: yaListado } = await supabase
    .from("marketplace_listado")
    .select("id_listado")
    .eq("id_inventario", id_inventario)
    .eq("estado", "activo")
    .maybeSingle();

  if (yaListado) return res.status(400).json({ success: false, error: "Este item ya está publicado" });

  const { data, error } = await supabase
    .from("marketplace_listado")
    .insert({ id_vendedor: id_usuario, id_inventario, precio })
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// Comprar item del marketplace (transaccion via SQL function)
router.post("/comprar", async (req, res) => {
  const { id_comprador, id_listado } = req.body;
  const { data, error } = await supabase.rpc("fn_comprar_marketplace", {
    p_id_comprador: id_comprador,
    p_id_listado: id_listado,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data.success) return res.status(400).json(data);
  res.json(data);
});

// Cancelar publicacion
router.delete("/cancelar/:id_listado", async (req, res) => {
  const { id_usuario } = req.body;
  const { data, error } = await supabase
    .from("marketplace_listado")
    .update({ estado: "cancelado" })
    .eq("id_listado", Number(req.params.id_listado))
    .eq("id_vendedor", id_usuario)
    .eq("estado", "activo")
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(400).json({ success: false, error: "No se pudo cancelar" });
  res.json({ success: true });
});

export default router;
