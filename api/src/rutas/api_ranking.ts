import { Router, Request, Response } from "express";
import supabase from "../db";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const { data, error } = await supabase.rpc("fn_ranking");
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

export default router;
