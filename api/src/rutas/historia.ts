import { Router, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { footballFetch, PL_LEAGUE, PL_SEASON } from "../apifootball";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { db: { schema: "premier" } }
);

// ── Tipos de API-Football ────────────────────────────────────────────────────
interface FootballTeam {
  team: {
    id: number;
    name: string;
    code: string;
    country: string;
    founded: number;
    logo: string;
  };
  venue: {
    name: string;
  };
}

// ── Cache simple en memoria para no martillar la API ────────────────────────
let teamsCache: ReturnType<typeof mapTeam>[] | null = null;
let teamsCacheAt = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

function mapTeam(t: FootballTeam) {
  return {
    id: t.team.id,
    name: t.team.name,
    code: t.team.code,
    country: t.team.country,
    founded: t.team.founded,
    logo: t.team.logo,
    venue: t.venue?.name ?? "",
  };
}

// ── GET /api/historia/equipos ────────────────────────────────────────────────
router.get("/equipos", async (_req: Request, res: Response) => {
  try {
    // Devolver cache si sigue vigente
    if (teamsCache && Date.now() - teamsCacheAt < CACHE_TTL) {
      return res.json({ success: true, data: teamsCache });
    }

    const json = await footballFetch<FootballTeam[]>("/teams", {
      league: PL_LEAGUE,
      season: PL_SEASON,
    });

    if (!json.response || json.response.length === 0) {
      return res.status(502).json({ success: false, message: "API-Football no devolvió equipos." });
    }

    const data = json.response
      .map(mapTeam)
      .sort((a, b) => a.name.localeCompare(b.name));

    teamsCache = data;
    teamsCacheAt = Date.now();

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error("[historia/equipos] Error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/historia/timeline/:teamId ──────────────────────────────────────
router.get("/timeline/:teamId", async (req: Request, res: Response) => {
  const teamId = Number(req.params.teamId);

  if (isNaN(teamId)) {
    return res.status(400).json({ success: false, message: "teamId debe ser un número." });
  }

  try {
    const { data, error } = await supabase
      .from("team_timeline_events")
      .select("id, team_id, year, title, description, image_url, order")
      .eq("team_id", teamId)
      .order("year", { ascending: true })
      .order("order", { ascending: true });

    if (error) {
      console.error(`[historia/timeline/${teamId}] Supabase error:`, error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error(`[historia/timeline/${teamId}] Unexpected error:`, err.message);
    return res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
});

export default router;