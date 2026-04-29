import { Router, Request, Response } from "express";
import { footballFetch } from "./api_partidos";
import supabase from "../db";

const router = Router();

// ── Tipos API-Football ────────────────────────────────────────────────────────
interface FootballEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments: string | null;
}

// ── GET /api/partidos/historial/pasados ───────────────────────────────────────
router.get("/pasados", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("past_matches")
      .select("*")
      .order("archived_at", { ascending: false })
      .limit(10);

    if (error) return res.json({ success: false, message: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    console.error("[historial/pasados] Error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/partidos/historial/:fixtureId/stats ──────────────────────────────
router.get("/:fixtureId/stats", async (req: Request, res: Response) => {
  const fixtureId = Number(req.params.fixtureId);
  if (isNaN(fixtureId)) {
    return res.status(400).json({ success: false, message: "fixtureId debe ser un número." });
  }

  try {
    const { data, error } = await supabase
      .from("past_stats")
      .select("label, home_value, away_value")
      .eq("fixture_id", fixtureId)
      .order("id", { ascending: true });

    if (error) return res.json({ success: false, message: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    console.error(`[historial/${fixtureId}/stats] Error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/partidos/historial/:fixtureId/lineups ────────────────────────────
router.get("/:fixtureId/lineups", async (req: Request, res: Response) => {
  const fixtureId = Number(req.params.fixtureId);
  if (isNaN(fixtureId)) {
    return res.status(400).json({ success: false, message: "fixtureId debe ser un número." });
  }

  try {
    const { data, error } = await supabase
      .from("past_lineups")
      .select("team, player_number, player_name, is_sub")
      .eq("fixture_id", fixtureId)
      .order("is_sub", { ascending: true })
      .order("player_number", { ascending: true });

    if (error) return res.json({ success: false, message: error.message });
    return res.json({ success: true, data });
  } catch (err: any) {
    console.error(`[historial/${fixtureId}/lineups] Error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/partidos/historial/:fixtureId/eventos ────────────────────────────
router.get("/:fixtureId/eventos", async (req: Request, res: Response) => {
  const fixtureId = Number(req.params.fixtureId);
  if (isNaN(fixtureId)) {
    return res.status(400).json({ success: false, message: "fixtureId debe ser un número." });
  }

  try {
    const json = await footballFetch<FootballEvent[]>("/fixtures/events", {
      fixture: fixtureId,
    });

    if (!json.response) {
      return res.json({ success: true, data: [] });
    }

    const data = json.response.map((e) => ({
      minute: e.time.elapsed,
      extra: e.time.extra ?? null,
      team: {
        id: e.team.id,
        name: e.team.name,
        logo: e.team.logo,
      },
      player: e.player.name,
      assist: e.assist?.name ?? null,
      type: e.type,
      detail: e.detail,
      comments: e.comments ?? null,
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error(`[historial/${fixtureId}/eventos] Error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;