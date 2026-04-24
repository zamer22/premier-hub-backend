import { Router } from "express";
import dotenv from "dotenv";

dotenv.config();

const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY;
const APIFOOTBALL_BASE = process.env.APIFOOTBALL_BASE_URL || "https://v3.football.api-sports.io";

export const PL_LEAGUE = Number(process.env.APIFOOTBALL_LEAGUE_ID) || 39;
export const PL_SEASON = Number(process.env.APIFOOTBALL_SEASON) || 2025;

if (!APIFOOTBALL_KEY) {
  throw new Error("Falta la variable de entorno APIFOOTBALL_KEY");
}

const FOOTBALL_HEADERS = {
  "x-apisports-key": APIFOOTBALL_KEY,
};

type FootballApiResponse<T = unknown> = {
  response?: T;
  message?: string;
  errors?: Record<string, unknown>;
};

export async function footballFetch<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<FootballApiResponse<T>> {
  const url = new URL(path, APIFOOTBALL_BASE);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: FOOTBALL_HEADERS,
  });

  const data = (await response.json()) as FootballApiResponse<T>;

  if (!response.ok) {
    throw new Error(data?.message || `Error en API-Football: ${response.status}`);
  }

  if (data?.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`Error en API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

async function getFixtures(type: "next" | "last", amount = 10) {
  const json = await footballFetch<any[]>("/fixtures", {
    league: PL_LEAGUE,
    season: PL_SEASON,
    [type]: amount,
  });

  return json.response || [];
}

async function getProximosPartidos() {
  return getFixtures("next", 10);
}

async function getResultados() {
  return getFixtures("last", 10);
}

async function getStandings() {
  const json = await footballFetch<any[]>("/standings", {
    league: PL_LEAGUE,
    season: PL_SEASON,
  });

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