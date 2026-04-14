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

export default router;
