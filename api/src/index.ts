import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

import { authRouter } from "./rutas/api_auth";
import { rankingRouter } from "./rutas/api_ranking";
import { simuladorRouter } from "./rutas/api_simulador";
import partidosRouter from "./rutas/api_partidos";
import { noticiasRouter } from "./rutas/api_noticias";
import { tiendaRouter } from "./rutas/api_tienda_v2";
import { marketplaceRouter } from "./rutas/api_marketplace";
import wordleRouter from "./rutas/api_wordle";
import { liveRouter, startFixtureAutoSync } from "./rutas/liveSync";
import historiaRouter from "./rutas/historia";
import historialRouter from "./rutas/partidosPasados";
import adminRouter from "./rutas/api_admin";
import missingXIRouter from "./rutas/api_missing_xi";
import mlRouter from "./rutas/api_ml";
import labRouter from "./rutas/api_lab";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || process.env.DEV_CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

app.use(cookieParser(process.env.COOKIE_SECRET));

/*
Parser de JSON: por defecto limite estricto de 1mb para casi todo. El unico
endpoint que necesita mas es /api/auth/profile/photo (sube una imagen en base64
hasta 5mb -> ~6.7mb en JSON). Se monta un parser dedicado de 8mb solo para esa
ruta y se evita correr el parser de 1mb antes para que no rechace la peticion.
*/
const jsonParser1mb = express.json({ limit: "1mb" });
const jsonParser8mb = express.json({ limit: "8mb" });

app.use((req, res, next) => {
  if (req.path === "/api/auth/profile/photo") {
    return jsonParser8mb(req, res, next);
  }
  return jsonParser1mb(req, res, next);
});

app.use("/api/auth", authRouter);
app.use("/api/ranking", rankingRouter);
app.use("/api/simulador", simuladorRouter);
app.use("/api/noticias", noticiasRouter);
app.use("/api/tienda", tiendaRouter);
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/wordle", wordleRouter);
app.use("/api/historia", historiaRouter);
app.use("/api/partidos/historial", historialRouter);

/* Pon admin antes de routers generales /api */
app.use("/api/admin", adminRouter);
app.use("/api/missing-xi", missingXIRouter);
app.use("/api/ml", mlRouter);
app.use("/api/lab", labRouter);

/* Estos van después porque son más generales */
app.use("/api", partidosRouter);
app.use("/api", liveRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const DEFAULT_FIXTURE_ID = Number(process.env.LIVE_FIXTURE_ID);

if (DEFAULT_FIXTURE_ID && !Number.isNaN(DEFAULT_FIXTURE_ID)) {
  startFixtureAutoSync(DEFAULT_FIXTURE_ID, 60_000);
  console.log(`[index] Auto-sync inicial activado para fixture ${DEFAULT_FIXTURE_ID}`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API corriendo en puerto ${PORT}`);
});