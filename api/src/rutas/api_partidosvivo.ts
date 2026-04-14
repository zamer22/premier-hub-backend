import { Router, Request, Response } from "express";

const router = Router();

const BASE = "https://v3.football.api-sports.io";
const LEAGUE = 39;
const SEASON = 2025;

function getHeaders() {
  if (!process.env.APIFOOTBALL_KEY) {
    throw new Error("Falta APIFOOTBALL_KEY en el archivo .env");
  }

  return {
    "x-apisports-key": process.env.APIFOOTBALL_KEY,
  };
}

async function footballRequest(url: string) {
  const response = await fetch(url, { headers: getHeaders() });
  const json: any = await response.json();

  if (!response.ok) {
    throw new Error(json?.message || `Error HTTP ${response.status}`);
  }

  if (json?.errors && Object.keys(json.errors).length > 0) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json;
}

router.get("/proximos", async (_req: Request, res: Response) => {
  try {
    const json = await footballRequest(
      `${BASE}/fixtures?league=${LEAGUE}&season=${SEASON}&next=10`
    );

    res.json({
      success: true,
      data: json.response || [],
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

router.get("/resultados", async (_req: Request, res: Response) => {
  try {
    const json = await footballRequest(
      `${BASE}/fixtures?league=${LEAGUE}&season=${SEASON}&last=10`
    );

    res.json({
      success: true,
      data: json.response || [],
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

router.get("/standings", async (_req: Request, res: Response) => {
  try {
    const json = await footballRequest(
      `${BASE}/standings?league=${LEAGUE}&season=${SEASON}`
    );

    const standings = json.response?.[0]?.league?.standings?.[0] || [];

    res.json({
      success: true,
      data: standings,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

router.get("/equipos", async (_req: Request, res: Response) => {
  try {
    const json = await footballRequest(
      `${BASE}/teams?league=${LEAGUE}&season=${SEASON}`
    );

    const teams = (json.response || []).map((t: any) => ({
      id: t.team?.id,
      name: t.team?.name,
      logo: t.team?.logo,
      code: t.team?.code,
      country: t.team?.country,
      founded: t.team?.founded,
      venue: t.venue?.name,
    }));

    res.json({
      success: true,
      data: teams,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

export default router;