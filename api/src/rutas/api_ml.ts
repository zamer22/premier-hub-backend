import { Router } from "express";
import type { Request, Response } from "express";
import { footballFetch, PREMIER_LEAGUE_ID, CURRENT_SEASON } from "./api_partidos";
import supabase from "../db";

const router = Router();

const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:8080";

type PlayerStatResponse = Array<{
  player?: { id?: number; name?: string; age?: number };
  statistics?: Array<{
    team?: { id?: number; name?: string };
    games?: { position?: string; minutes?: number };
    goals?: { total?: number; assists?: number };
  }>;
}>;

type TeamSquadResponse = Array<{
  team?: { id?: number; name?: string };
  players?: Array<{ id?: number; name?: string; age?: number; position?: string }>;
}>;

type FixtureDetail = Array<{
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number; away?: number };
}>;

type FixtureStats = Array<{
  team?: { id?: number };
  statistics?: Array<{ type?: string; value?: number | string | null }>;
}>;

type FixtureLineups = Array<{
  team?: { id?: number };
  startXI?: Array<{ player?: { id?: number; name?: string; pos?: string } }>;
  substitutes?: Array<{ player?: { id?: number; name?: string; pos?: string } }>;
}>;

async function mlFetch(path: string, body: unknown) {
  const res = await fetch(`${ML_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML service error ${res.status}: ${text}`);
  }
  return res.json();
}

function getStat(
  statsRes: FixtureStats,
  teamId: number | undefined,
  statType: string
): number {
  const teamStats = statsRes.find((s) => s.team?.id === teamId);
  const stat = teamStats?.statistics?.find((s) => s.type === statType);
  const val = stat?.value;
  return typeof val === "number" ? val : typeof val === "string" ? parseInt(val) || 0 : 0;
}

// ── GET /api/ml/clubs ─────────────────────────────────────────────────────────
router.get("/clubs", async (_req: Request, res: Response) => {
  try {
    const { data: cached } = await supabase
      .from("club_pl")
      .select("id, name")
      .eq("season", CURRENT_SEASON);

    if (cached && cached.length > 0) {
      return res.json({ success: true, data: cached });
    }

    type TeamsResponse = Array<{ team?: { id?: number; name?: string } }>;
    const apiData = await footballFetch<TeamsResponse>("/teams", {
      league: PREMIER_LEAGUE_ID,
      season: CURRENT_SEASON,
    });

    const clubs = (apiData.response ?? [])
      .map((t) => ({ id: t.team?.id, name: t.team?.name }))
      .filter((c): c is { id: number; name: string } => !!c.id && !!c.name);

    await supabase.from("club_pl").insert(clubs.map((c) => ({ ...c, season: CURRENT_SEASON })));

    return res.json({ success: true, data: clubs });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


// ── GET /api/ml/match/:fixture_id ─────────────────────────────────────────────
router.get("/match/:fixture_id", async (req: Request, res: Response) => {
  const fixtureId = Number(req.params.fixture_id);
  if (!fixtureId) return res.status(400).json({ success: false, message: "fixture_id inválido" });
  try {
    const [fixtureRes, lineupsRes] = await Promise.all([
      footballFetch<FixtureDetail>("/fixtures", { id: fixtureId }),
      footballFetch<FixtureLineups>("/fixtures/lineups", { fixture: fixtureId }),
    ]);

    const fixture = fixtureRes.response?.[0];
    if (!fixture) return res.status(404).json({ success: false, message: "Partido no encontrado" });

    const homeId = fixture.teams?.home?.id;
    const awayId = fixture.teams?.away?.id;

    return res.json({
      success: true,
      data: {
        fixture_id: fixtureId,
        home_team: fixture.teams?.home,
        away_team: fixture.teams?.away,
        score: { home: fixture.goals?.home ?? 0, away: fixture.goals?.away ?? 0 },
        lineups: {
          home: lineupsRes.response?.find((l) => l.team?.id === homeId) ?? {},
          away: lineupsRes.response?.find((l) => l.team?.id === awayId) ?? {},
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


// ── GET /api/ml/players?club_id=XX ───────────────────────────────────────────
router.get("/players", async (req: Request, res: Response) => {
  const clubId = Number(req.query.club_id);
  if (!clubId) return res.status(400).json({ success: false, message: "club_id requerido" });
  try {
    const data = await footballFetch<TeamSquadResponse>("/players/squads", { team: clubId });
    return res.json({ success: true, data: data.response?.[0]?.players ?? [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/ml/player-stats?player_id=XX ────────────────────────────────────
router.get("/player-stats", async (req: Request, res: Response) => {
  const playerId = Number(req.query.player_id);
  const season = Number(req.query.season) || CURRENT_SEASON;
  if (!playerId) return res.status(400).json({ success: false, message: "player_id requerido" });
  try {
    const data = await footballFetch<PlayerStatResponse>("/players", {
      id: playerId,
      season,
      league: PREMIER_LEAGUE_ID,
    });
    const player = data.response?.[0];
    if (!player) return res.status(404).json({ success: false, message: "Jugador no encontrado" });

    const stats = player.statistics?.[0];
    const minutes = stats?.games?.minutes ?? 0;
    const goals = stats?.goals?.total ?? 0;
    const assists = stats?.goals?.assists ?? 0;
    const per90 = (v: number) => (minutes > 0 ? Math.round((v / minutes) * 90 * 100) / 100 : 0);

    return res.json({
      success: true,
      data: {
        player_id: player.player?.id,
        name: player.player?.name,
        player_age: player.player?.age,
        position: stats?.games?.position ?? "Midfielder",
        minutes_played: minutes,
        goals_per90: per90(goals),
        assists_per90: per90(assists),
        current_club_id: stats?.team?.id,
        current_club_name: stats?.team?.name,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/ml/transfer ─────────────────────────────────────────────────────
router.post("/transfer", async (req: Request, res: Response) => {
  const { player_id, target_club_id, market_value_eur, years_left } = req.body as {
    player_id: number;
    target_club_id: number;
    market_value_eur?: number;
    years_left?: number;
  };
  if (!player_id || !target_club_id) {
    return res.status(400).json({ success: false, message: "player_id y target_club_id requeridos" });
  }
  try {
    const [playerData, targetSquadData] = await Promise.all([
      footballFetch<PlayerStatResponse>("/players", {
        id: player_id,
        season: CURRENT_SEASON,
        league: PREMIER_LEAGUE_ID,
      }),
      footballFetch<TeamSquadResponse>("/players/squads", { team: target_club_id }),
    ]);

    const player = playerData.response?.[0];
    if (!player) return res.status(404).json({ success: false, message: "Jugador no encontrado" });

    const stats = player.statistics?.[0];
    const minutes = stats?.games?.minutes ?? 0;
    const goals = stats?.goals?.total ?? 0;
    const assists = stats?.goals?.assists ?? 0;
    const per90 = (v: number) => (minutes > 0 ? Math.round((v / minutes) * 90 * 100) / 100 : 0);
    const position = stats?.games?.position ?? "Midfielder";

    const targetSquad = targetSquadData.response?.[0]?.players ?? [];
    const positionCount = targetSquad.filter((p) => p.position === position).length;

    const result = await mlFetch("/ml/transfer", {
      player_id,
      target_club_id,
      player_stats: {
        player_age: player.player?.age ?? 25,
        position,
        market_value_eur: market_value_eur ?? 10_000_000,
        years_left: years_left ?? 2,
        goals_per90: per90(goals),
        assists_per90: per90(assists),
        minutes_played: minutes,
      },
      target_club_stats: {
        position_needed: positionCount < 3,
        target_league_position: 10,
      },
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/ml/simulate ─────────────────────────────────────────────────────
router.post("/simulate", async (req: Request, res: Response) => {
  const { transfers } = req.body as {
    transfers: Array<{ player_id: number; from_club_id: number; to_club_id: number }>;
  };
  if (!transfers?.length) {
    return res.status(400).json({ success: false, message: "transfers no puede estar vacío" });
  }
  if (transfers.length > 5) {
    return res.status(400).json({ success: false, message: "Máximo 5 transferencias hipotéticas" });
  }
  try {
    const enriched = await Promise.all(
      transfers.map(async (t) => {
        const data = await footballFetch<PlayerStatResponse>("/players", {
          id: t.player_id,
          season: CURRENT_SEASON,
          league: PREMIER_LEAGUE_ID,
        });
        const stats = data.response?.[0]?.statistics?.[0];
        const minutes = stats?.games?.minutes ?? 0;
        const goals = stats?.goals?.total ?? 0;
        const assists = stats?.goals?.assists ?? 0;
        const per90 = (v: number) =>
          minutes > 0 ? Math.round((v / minutes) * 90 * 100) / 100 : 0;
        return {
          player_id: t.player_id,
          from_club_id: t.from_club_id,
          to_club_id: t.to_club_id,
          player_stats: {
            position: stats?.games?.position ?? "Midfielder",
            goals_per90: per90(goals),
            assists_per90: per90(assists),
          },
        };
      })
    );
    const result = await mlFetch("/ml/simulate", { transfers: enriched });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/ml/rewind ───────────────────────────────────────────────────────
router.post("/rewind", async (req: Request, res: Response) => {
  const { match_id, modifications } = req.body as {
    match_id: number;
    modifications: Array<{ type: string; player_id: number; team: string; minute?: number }>;
  };
  if (!match_id || !modifications?.length) {
    return res.status(400).json({ success: false, message: "match_id y modifications requeridos" });
  }
  try {
    const [fixtureRes, statsRes, lineupsRes] = await Promise.all([
      footballFetch<FixtureDetail>("/fixtures", { id: match_id }),
      footballFetch<FixtureStats>("/fixtures/statistics", { fixture: match_id }),
      footballFetch<FixtureLineups>("/fixtures/lineups", { fixture: match_id }),
    ]);

    const fixture = fixtureRes.response?.[0];
    if (!fixture) return res.status(404).json({ success: false, message: "Partido no encontrado" });

    const homeId = fixture.teams?.home?.id;
    const awayId = fixture.teams?.away?.id;
    const stats = statsRes.response ?? [];

    const matchData = {
      score: { home: fixture.goals?.home ?? 0, away: fixture.goals?.away ?? 0 },
      stats: {
        home_shots_on_target: getStat(stats, homeId, "Shots on Goal"),
        home_shots: getStat(stats, homeId, "Total Shots"),
        home_dangerous_attacks: getStat(stats, homeId, "Dangerous Attacks"),
        away_shots_on_target: getStat(stats, awayId, "Shots on Goal"),
        away_shots: getStat(stats, awayId, "Total Shots"),
        away_dangerous_attacks: getStat(stats, awayId, "Dangerous Attacks"),
        total_attacks:
          getStat(stats, homeId, "Dangerous Attacks") +
            getStat(stats, awayId, "Dangerous Attacks") || 1,
      },
      lineups: {
        home: lineupsRes.response?.find((l) => l.team?.id === homeId) ?? {},
        away: lineupsRes.response?.find((l) => l.team?.id === awayId) ?? {},
      },
    };

    const result = await mlFetch("/ml/rewind", { match_id, match_data: matchData, modifications });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
