import { Router, Request, Response } from "express";
import supabase from "../db";

const router = Router();

router.get("/ranking", async (_req: Request, res: Response) => {
  const { data, error } = await supabase.rpc("fn_simulador_ranking");
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [], count: (data || []).length });
});

router.post("/simular", async (req: Request, res: Response) => {
  const { id_usuario, partido_data, cambios } = req.body;
  const { data, error } = await supabase
    .from("simulacion")
    .insert({ id_usuario, partido_data, cambios, status: "pendiente" })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

router.get("/simulacion/:id", async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("simulacion")
    .select("*")
    .eq("id_simulacion", req.params.id)
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

export default router;
