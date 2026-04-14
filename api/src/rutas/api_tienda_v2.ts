import { Router } from "express";
import supabase from "../db";

const router = Router();

// Productos filtrados por categoria + temporada activa
router.get("/productos-v2", async (req, res) => {
  const categoria = (req.query.categoria as string) || "perfil";
  const { data, error } = await supabase.rpc("fn_productos_v2", { p_categoria: categoria });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
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
  const { id_usuario, id_producto } = req.body;
  if (!id_usuario || !id_producto)
    return res.status(400).json({ success: false, error: "Faltan datos" });
  const { data, error } = await supabase.rpc("fn_comprar_producto", {
    p_id_usuario: Number(id_usuario),
    p_id_producto: Number(id_producto),
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data?.success) return res.status(400).json({ success: false, error: data?.error || "Error al comprar" });
  res.json({ success: true, saldo: data.nuevo_saldo });
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

export default router;
