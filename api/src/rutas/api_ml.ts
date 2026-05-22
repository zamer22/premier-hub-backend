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
  fixture?: { date?: string; status?: { short?: string } };
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

type FixtureEvents = Array<{
  time?: { elapsed?: number; extra?: number | null };
  team?: { id?: number; name?: string };
  player?: { id?: number; name?: string };
  type?: string;
  detail?: string;
}>;


async function mlFetch(path: string, body: unknown) {
  const res = await fetch(`${ML_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(28_000),
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


// ── Clasificación de eventos de API-Football ──────────────────────────────────
// kind: tipo normalizado | removable: si el usuario puede quitarlo en el what-if
type EventKind =
  | "goal" | "penalty" | "own_goal" | "red_card"
  | "missed_penalty" | "yellow_card" | "substitution" | "var";

function classifyEvent(type: string | undefined, detail: string | undefined): {
  kind: EventKind;
  removable: boolean;
  label: string;
} {
  const d = detail ?? "";
  if (type === "Goal") {
    if (d === "Own Goal")       return { kind: "own_goal", removable: true,  label: "Gol en propia" };
    if (d === "Penalty")        return { kind: "penalty",  removable: true,  label: "Gol de penal" };
    if (d === "Missed Penalty") return { kind: "missed_penalty", removable: false, label: "Penal fallado" };
    return { kind: "goal", removable: true, label: "Gol" };
  }
  if (type === "Card") {
    if (d === "Red Card")           return { kind: "red_card", removable: true, label: "Tarjeta roja" };
    if (d === "Second Yellow card") return { kind: "red_card", removable: true, label: "Doble amarilla" };
    return { kind: "yellow_card", removable: false, label: "Tarjeta amarilla" };
  }
  if (type === "subst") return { kind: "substitution", removable: false, label: "Cambio" };
  if (type === "Var")   return { kind: "var", removable: false, label: d || "Revisión VAR" };
  return { kind: "var", removable: false, label: d || type || "Evento" };
}

// ── GET /api/ml/match/:fixture_id ─────────────────────────────────────────────
// Devuelve datos del partido + alineaciones + TODOS los eventos clasificados
router.get("/match/:fixture_id", async (req: Request, res: Response) => {
  const fixtureId = Number(req.params.fixture_id);
  if (!fixtureId) return res.status(400).json({ success: false, message: "fixture_id inválido" });
  try {
    const [fixtureRes, lineupsRes, eventsRes] = await Promise.all([
      footballFetch<FixtureDetail>("/fixtures", { id: fixtureId }),
      footballFetch<FixtureLineups>("/fixtures/lineups", { fixture: fixtureId }),
      footballFetch<FixtureEvents>("/fixtures/events", { fixture: fixtureId }),
    ]);

    const fixture = fixtureRes.response?.[0];
    if (!fixture) return res.status(404).json({ success: false, message: "Partido no encontrado" });

    const homeId = fixture.teams?.home?.id;
    const awayId = fixture.teams?.away?.id;

    const rawEvents = eventsRes.response ?? [];
    const events = rawEvents
      .map((e, i) => {
        const isHome  = e.team?.id === homeId;
        const minute  = (e.time?.elapsed ?? 0) + (e.time?.extra ?? 0);
        const c       = classifyEvent(e.type, e.detail ?? undefined);
        const detail  = c.kind === "substitution" && e.player?.name
          ? `Sale ${e.player.name}`
          : "";
        return {
          id:          `${i}-${minute}-${e.player?.id ?? "x"}`,
          minute,
          team:        isHome ? "home" : "away",
          team_name:   e.team?.name ?? "",
          player_name: e.player?.name ?? "Desconocido",
          kind:        c.kind,
          removable:   c.removable,
          label:       c.label,
          detail,
        };
      })
      .sort((a, b) => a.minute - b.minute);

    // Duración real del partido (incluye tiempo añadido) para ponderar rojas
    const maxMinute = events.reduce((m, e) => Math.max(m, e.minute), 90);
    const matchMinutes = maxMinute + 2;

    return res.json({
      success: true,
      data: {
        fixture_id: fixtureId,
        home_team: fixture.teams?.home,
        away_team: fixture.teams?.away,
        score: { home: fixture.goals?.home ?? 0, away: fixture.goals?.away ?? 0 },
        match_minutes: matchMinutes,
        lineups: {
          home: lineupsRes.response?.find((l) => l.team?.id === homeId) ?? {},
          away: lineupsRes.response?.find((l) => l.team?.id === awayId) ?? {},
        },
        events,
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

// ── GET /api/ml/iconic-matches ────────────────────────────────────────────────

const ICONIC_MATCHES_FALLBACK = [
  { fixture_id: 157112,  label: "Southampton 0-9 Leicester · Oct 2019" },
  { fixture_id: 592357,  label: "Manchester United 9-0 Southampton · Feb 2021" },
  { fixture_id: 867981,  label: "Liverpool 9-0 Bournemouth · Ago 2022" },
  { fixture_id: 868033,  label: "Manchester City 6-3 Manchester United · Oct 2022" },
  { fixture_id: 868201,  label: "Liverpool 7-0 Manchester United · Mar 2023" },
  { fixture_id: 157071,  label: "Manchester City 8-0 Watford · Sep 2019" },
  { fixture_id: 1035096, label: "Sheffield Utd 0-8 Newcastle · Sep 2023" },
  { fixture_id: 592172,  label: "Aston Villa 7-2 Liverpool · Oct 2020" },
  { fixture_id: 710643,  label: "Manchester United 0-5 Liverpool · Oct 2021" },
  { fixture_id: 592177,  label: "Manchester United 1-6 Tottenham · Oct 2020" },
  { fixture_id: 1035454, label: "Arsenal 5-0 Chelsea · Abr 2024" },
  { fixture_id: 1208261, label: "Nottingham Forest 7-0 Brighton · Feb 2025" },
  { fixture_id: 868024,  label: "Tottenham 6-2 Leicester · Sep 2022" },
  { fixture_id: 1208191, label: "Tottenham 3-6 Liverpool · Dic 2024" },
];

router.get("/iconic-matches", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${ML_URL}/ml/iconic-matches`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`ML service error ${r.status}`);
    const data = await r.json();
    const matches = (data.matches ?? []).map((m: any) => ({
      fixture_id: m.fixture_id,
      label: `${m.title} · ${m.date}`,
    }));
    return res.json({ success: true, data: matches.length > 0 ? matches : ICONIC_MATCHES_FALLBACK });
  } catch {
    return res.json({ success: true, data: ICONIC_MATCHES_FALLBACK });
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
  // Valor de mercado mínimo realista para traspasos de la PL
  if (market_value_eur !== undefined && market_value_eur < 500_000) {
    return res.status(400).json({
      success: false,
      message: "El valor de mercado mínimo esperado es €0.5M. Deja el campo vacío para usar el estimado del modelo.",
    });
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
// modifications: [{ kind: "goal"|"penalty"|"own_goal"|"red_card", team, minute }]
router.post("/rewind", async (req: Request, res: Response) => {
  const { match_id, modifications, match_minutes } = req.body as {
    match_id: number;
    match_minutes?: number;
    modifications: Array<{ kind: string; team: string; minute?: number }>;
  };
  if (!match_id || !modifications?.length) {
    return res.status(400).json({ success: false, message: "match_id y modifications requeridos" });
  }
  try {
    const [fixtureRes, statsRes] = await Promise.all([
      footballFetch<FixtureDetail>("/fixtures", { id: match_id }),
      footballFetch<FixtureStats>("/fixtures/statistics", { fixture: match_id }),
    ]);

    const fixture = fixtureRes.response?.[0];
    if (!fixture) return res.status(404).json({ success: false, message: "Partido no encontrado" });

    const homeId = fixture.teams?.home?.id;
    const awayId = fixture.teams?.away?.id;
    const stats = statsRes.response ?? [];

    const matchData = {
      score: { home: fixture.goals?.home ?? 0, away: fixture.goals?.away ?? 0 },
      match_minutes: match_minutes && match_minutes > 0 ? match_minutes : 95,
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
    };

    // Clasificar modificaciones — el minuto se conserva para ponderar rojas
    const removedGoals: Array<{ team: string; minute: number }> = [];
    const removedRedCards: Array<{ team: string; minute: number }> = [];

    for (const mod of modifications) {
      const minute = mod.minute ?? 0;
      if (mod.kind === "goal" || mod.kind === "penalty") {
        removedGoals.push({ team: mod.team, minute });
      } else if (mod.kind === "own_goal") {
        // Autogol: el gol cuenta para el rival del equipo del evento
        removedGoals.push({ team: mod.team === "home" ? "away" : "home", minute });
      } else if (mod.kind === "red_card") {
        removedRedCards.push({ team: mod.team, minute });
      }
    }

    const result = await mlFetch("/ml/rewind", {
      match_id,
      match_data: matchData,
      removed_goals: removedGoals,
      removed_red_cards: removedRedCards,
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
