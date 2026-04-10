import { Router } from "express";
import dotenv from "dotenv";

dotenv.config();

const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY;
const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";

export const PL_LEAGUE = 39;
export const PL_SEASON = 2025;

const FOOTBALL_HEADERS = {
  "x-apisports-key": APIFOOTBALL_KEY,
};

if (!APIFOOTBALL_KEY) {
  throw new Error("Falta la variable de entorno APIFOOTBALL_KEY");
}

export async function footballFetch(
  path: string,
  params: Record<string, string | number | undefined> = {}
) {
  const url = new URL(path, APIFOOTBALL_BASE);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: FOOTBALL_HEADERS,
  });

  const data = await response.json() as { message?: string };

  if (!response.ok) {
    throw new Error(data?.message || `Error en API-Football: ${response.status}`);
  }

  return data;
}

async function getProximosPartidos() {
  const r = await fetch(
    `${APIFOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&next=10`,
    { headers: FOOTBALL_HEADERS }
  );

  const json: any = await r.json();
  return json.response || [];
}

async function getResultados() {
  const r = await fetch(
    `${APIFOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&last=10`,
    { headers: FOOTBALL_HEADERS }
  );

  const json: any = await r.json();
  return json.response || [];
}

async function getStandings() {
  const r = await fetch(
    `${APIFOOTBALL_BASE}/standings?league=${PL_LEAGUE}&season=${PL_SEASON}`,
    { headers: FOOTBALL_HEADERS }
  );

  const json: any = await r.json();
  return json.response?.[0]?.league?.standings?.[0] || [];
}

// Router de football
export const footballRouter = Router();

footballRouter.get("/partidos/proximos", async (_req, res) => {
  try {
    const data = await getProximosPartidos();
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

footballRouter.get("/partidos/resultados", async (_req, res) => {
  try {
    const data = await getResultados();
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

footballRouter.get("/partidos/standings", async (_req, res) => {
  try {
    const data = await getStandings();
    res.json({ success: true, data });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

