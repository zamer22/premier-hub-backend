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

const app = express();
const PORT = Number(process.env.PORT) || 4000;
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/ranking", rankingRouter);
app.use("/api/simulador", simuladorRouter);
app.use("/api", partidosRouter);
app.use("/api", liveRouter);
app.use("/api/noticias", noticiasRouter);
app.use("/api/tienda", tiendaRouter);
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/wordle", wordleRouter);

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
