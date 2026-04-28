import { Router, Request, Response } from "express";
import { footballFetch } from "../apifootball";

const router = Router();

// ── Tipos de API-Football ────────────────────────────────────────────────────
interface FootballEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: string;   // "Goal" | "Card" | "subst" | "Var"
  detail: string; // "Normal Goal" | "Yellow Card" | "Red Card" | "Substitution 1" ...
  comments: string | null;
}

// ── GET /api/partidos/:fixtureId/eventos ─────────────────────────────────────
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

    // Mapear a un formato limpio para el frontend
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
      type: e.type,       // "Goal" | "Card" | "subst" | "Var"
      detail: e.detail,   // "Normal Goal" | "Own Goal" | "Yellow Card" | "Red Card" etc.
      comments: e.comments ?? null,
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error(`[partidos/${fixtureId}/eventos] Error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;