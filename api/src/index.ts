import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
dotenv.config();

import authRouter      from "./rutas/api_auth";
import rankingRouter   from "./rutas/api_ranking";
import simuladorRouter from "./rutas/api_simulador";
import partidosRouter  from "./rutas/api_partidos";
import noticiasRouter  from "./rutas/api_noticias";
import tiendaRouter    from "./rutas/api_tienda_v2";
import marketplaceRouter from "./rutas/api_marketplace";
import supabase from "./db";

const app    = express();
const PORT   = Number(process.env.PORT) || 4000;
const IS_PROD = process.env.NODE_ENV === "production";

/* ── Middleware ── */
app.use(cors({
  origin: IS_PROD ? process.env.CORS_ORIGIN : "http://localhost:5173",
  credentials: true,
}));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());

/* ── Rutas ── */
app.use("/api/auth",        authRouter);
app.use("/api/ranking",     rankingRouter);
app.use("/api/simulador",   simuladorRouter);
app.use("/api/partidos",    partidosRouter);
app.use("/api/noticias",    noticiasRouter);
app.use("/api/tienda",      tiendaRouter);
app.use("/api/marketplace", marketplaceRouter);

/* ── Health check ── */
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

/* ── Tienda legacy (mantiene compatibilidad) ── */
app.get("/api/tienda/productos", async (_req, res) => {
  const { data, error } = await supabase.from("producto").select("*").order("es_nuevo", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data: data || [] });
});

app.post("/api/tienda/comprar", async (req, res) => {
  const { id_usuario, id_producto } = req.body;
  const { data, error } = await supabase.rpc("fn_comprar_producto", {
    p_id_usuario: id_usuario,
    p_id_producto: id_producto,
  });
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data.success) return res.status(400).json(data);
  res.json(data);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API corriendo en puerto ${PORT}`);
});
