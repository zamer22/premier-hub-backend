import { createClient } from "@supabase/supabase-js";
import { Router } from "express";
import type { Request } from "express";
import { footballFetch, PREMIER_LEAGUE_ID } from "./api_partidos";
import {
  LIVE_DEMO_FIXTURE_ID,
  getLiveDemoActivationById,
  liveDemoActivations,
  liveDemoEvents,
  liveDemoH2H,
  liveDemoLineups,
  liveDemoMatch,
  liveDemoStats,
} from "./liveDemoData";

if (!process.env.SUPABASE_URL) {
  throw new Error("Falta SUPABASE_URL en el archivo .env");
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Falta SUPABASE_SERVICE_KEY en el archivo .env");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    db: { schema: "premier" },
  }
);

export const liveRouter = Router();

let liveInterval: NodeJS.Timeout | null = null;
let currentFixtureId: number | null = null;

const SESSION_COOKIE_NAME = "ph_session";
const LIVE_DETAIL_SYNC_TTL_MS = 45_000;
const liveDetailSyncState = new Map<
  number,
  { syncedAt: number; inFlight: Promise<void> | null }
>();

type LineupInsertRow = {
  fixture_id: number;
  team: "home" | "away";
  player_number: number | null;
  player_name: string;
  player_grid: string | null;
  is_sub: boolean;
};

type StatInsertRow = {
  fixture_id: number;
  label: string;
  home_value: string;
  away_value: string;
};

type H2HInsertRow = {
  fixture_id: number;
  related_fixture_id: number;
  match_date: string | null;
  league: string;
  home_team_id: number | null;
  home_name: string;
  home_logo: string;
  home_goals: number | null;
  away_team_id: number | null;
  away_name: string;
  away_logo: string;
  away_goals: number | null;
};

type LiveChatMessageRow = {
  id: number;
  fixture_id: number;
  id_usuario: number;
  username: string;
  message: string;
  created_at: string;
};

type LiveActivationRow = {
  id: number;
  fixture_id: number;
  type: "poll" | "drop";
  title: string;
  description: string | null;
  payload: any;
  reward_points: number;
  starts_at_minute: number;
  expires_at_minute: number;
  status: string;
  created_at?: string;
};

type LiveActivationClaimRow = {
  id: number;
  activation_id: number;
  id_usuario: number;
  selected_option: string | null;
  is_correct: boolean;
  reward_points: number;
  claimed_at: string;
};

function getSessionUserId(req: Request): number | null {
  const sessionUserId = (
    req.signedCookies as Record<string, string | undefined>
  )?.[SESSION_COOKIE_NAME];

  if (!sessionUserId) {
    return null;
  }

  const parsed = Number(sessionUserId);
  return Number.isNaN(parsed) ? null : parsed;
}

function isDemoFixture(fixtureId: number): boolean {
  return fixtureId === LIVE_DEMO_FIXTURE_ID;
}

function parseMinuteParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getActivationRuntimeStatus(
  activation: Pick<LiveActivationRow, "starts_at_minute" | "expires_at_minute" | "status">,
  minute: number | null,
): string {
  if (activation.status && activation.status !== "active") {
    return activation.status;
  }

  if (minute === null) {
    return activation.status || "active";
  }

  if (minute < activation.starts_at_minute) return "scheduled";
  if (minute >= activation.expires_at_minute) return "expired";
  return "active";
}

async function getClaimedActivationIds(userId: number | null, activationIds: number[]) {
  if (!userId || activationIds.length === 0) return new Set<number>();

  const { data, error } = await supabase
    .from("live_activation_claims")
    .select("activation_id")
    .eq("id_usuario", userId)
    .in("activation_id", activationIds);

  if (error) {
    console.warn(`[liveSync] No se pudieron leer claims: ${error.message}`);
    return new Set<number>();
  }

  return new Set((data || []).map((item: any) => Number(item.activation_id)));
}

function normalizeActivation(activation: LiveActivationRow, minute: number | null, claimed: boolean) {
  return {
    ...activation,
    status: claimed ? "claimed" : getActivationRuntimeStatus(activation, minute),
    claimed,
  };
}

function mapFootballEvent(event: any, fixtureId: number) {
  const elapsed = event?.time?.elapsed ?? null;
  const extra = event?.time?.extra ?? null;

  return {
    fixture_id: fixtureId,
    minute: elapsed,
    extra,
    display_minute: elapsed ? `${elapsed}${extra ? `+${extra}` : ""}'` : "",
    team_id: event?.team?.id ?? null,
    team_name: event?.team?.name ?? "",
    team_logo: event?.team?.logo ?? "",
    player: event?.player?.name ?? null,
    assist: event?.assist?.name ?? null,
    type: event?.type ?? "",
    detail: event?.detail ?? "",
    comments: event?.comments ?? null,
  };
}

function getFixtureMinute(fixture: any): string {
  const elapsed = fixture?.fixture?.status?.elapsed;
  const extra = fixture?.fixture?.status?.extra;

  if (elapsed && extra) {
    return `${elapsed}+${extra}'`;
  }

  if (elapsed) {
    return `${elapsed}'`;
  }

  return "0'";
}

function mapFixtureToLiveMatchRow(fixture: any) {
  return {
    id: fixture.fixture?.id,
    league: fixture.league?.name ?? "Premier League",
    minute: getFixtureMinute(fixture),
    stadium: fixture.fixture?.venue?.name ?? "",
    status: fixture.fixture?.status?.long ?? "Live",
    home_name: fixture.teams?.home?.name ?? "",
    home_logo: fixture.teams?.home?.logo ?? "",
    home_score: fixture.goals?.home ?? 0,
    away_name: fixture.teams?.away?.name ?? "",
    away_logo: fixture.teams?.away?.logo ?? "",
    away_score: fixture.goals?.away ?? 0,
    updated_at: new Date().toISOString(),
  };
}

async function upsertLiveMatchSummary(fixture: any) {
  const row = mapFixtureToLiveMatchRow(fixture);

  if (!row.id) {
    return null;
  }

  const { error } = await supabase.from("live_matches").upsert(row);

  if (error) {
    throw new Error(`Error guardando live_matches: ${error.message}`);
  }

  return row;
}

async function getPremierLeagueLiveFixtures() {
  const liveJson = await footballFetch<any[]>("/fixtures", { live: "all" });
  const fixtures = liveJson.response || [];

  return fixtures.filter((fixture: any) => fixture.league?.id === PREMIER_LEAGUE_ID);
}

async function getRecentCachedLiveMatches() {
  const minUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("live_matches")
    .select("*")
    .gte("updated_at", minUpdatedAt)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn(`[liveSync] No se pudo leer cache live: ${error.message}`);
    return [];
  }

  return data || [];
}

async function syncFixtureById(fixtureId: number) {
  const fixtureJson = await footballFetch<any[]>("/fixtures", {
    id: fixtureId,
  });

  const f = fixtureJson.response?.[0];

  if (!f) {
    throw new Error(`No se encontro el fixture ${fixtureId}`);
  }

  const homeTeamId = f.teams?.home?.id;
  const awayTeamId = f.teams?.away?.id;

  if (!homeTeamId || !awayTeamId) {
    throw new Error(`No se pudieron obtener los equipos del fixture ${fixtureId}`);
  }

  const { error: matchError } = await supabase
    .from("live_matches")
    .upsert(mapFixtureToLiveMatchRow(f));

  if (matchError) {
    throw new Error(`Error guardando live_matches: ${matchError.message}`);
  }

  const lineupsJson = await footballFetch<any[]>("/fixtures/lineups", {
    fixture: fixtureId,
  });

  const lineups = lineupsJson.response || [];

  const { error: deleteLineupsError } = await supabase
    .from("live_lineups")
    .delete()
    .eq("fixture_id", fixtureId);

  if (deleteLineupsError) {
    throw new Error(`Error borrando live_lineups: ${deleteLineupsError.message}`);
  }

  if (lineups.length >= 2) {
    const apiHomeTeamId = lineups[0].team.id;
    const lineupRows: LineupInsertRow[] = [];

    for (const teamLineup of lineups) {
      const side: "home" | "away" =
        teamLineup.team.id === apiHomeTeamId ? "home" : "away";

      for (const p of teamLineup.startXI ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: p.player.number ?? null,
          player_name: p.player.name ?? "",
          player_grid: p.player.grid ?? null,
          is_sub: false,
        });
      }

      for (const p of teamLineup.substitutes ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: p.player.number ?? null,
          player_name: p.player.name ?? "",
          player_grid: null,
          is_sub: true,
        });
      }
    }

    if (lineupRows.length > 0) {
      const { error: lineupError } = await supabase
        .from("live_lineups")
        .insert(lineupRows);

      if (lineupError) {
        throw new Error(`Error guardando live_lineups: ${lineupError.message}`);
      }
    }
  }

  const statsJson = await footballFetch<any[]>("/fixtures/statistics", {
    fixture: fixtureId,
  });

  const stats = statsJson.response || [];

  const { error: deleteStatsError } = await supabase
    .from("live_stats")
    .delete()
    .eq("fixture_id", fixtureId);

  if (deleteStatsError) {
    throw new Error(`Error borrando live_stats: ${deleteStatsError.message}`);
  }

  if (stats.length >= 2) {
    const homeStats: Record<string, string> = {};
    const awayStats: Record<string, string> = {};

    for (const s of stats[0]?.statistics ?? []) {
      homeStats[s.type] = String(s.value ?? "0");
    }

    for (const s of stats[1]?.statistics ?? []) {
      awayStats[s.type] = String(s.value ?? "0");
    }

    const labels = Array.from(
      new Set([...Object.keys(homeStats), ...Object.keys(awayStats)])
    );

    const statRows: StatInsertRow[] = labels.map((label) => ({
      fixture_id: fixtureId,
      label,
      home_value: homeStats[label] ?? "0",
      away_value: awayStats[label] ?? "0",
    }));

    if (statRows.length > 0) {
      const { error: statsError } = await supabase
        .from("live_stats")
        .insert(statRows);

      if (statsError) {
        throw new Error(`Error guardando live_stats: ${statsError.message}`);
      }
    }
  }

  const h2hJson = await footballFetch<any[]>("/fixtures/headtohead", {
    h2h: `${homeTeamId}-${awayTeamId}`,
    last: 5,
  });

  const h2hMatches = h2hJson.response || [];

  const { error: deleteH2HError } = await supabase
    .from("live_h2h")
    .delete()
    .eq("fixture_id", fixtureId);

  if (deleteH2HError) {
    throw new Error(`Error borrando live_h2h: ${deleteH2HError.message}`);
  }

  if (h2hMatches.length > 0) {
    const h2hRows: H2HInsertRow[] = h2hMatches.map((item: any) => ({
      fixture_id: fixtureId,
      related_fixture_id: item.fixture?.id ?? 0,
      match_date: item.fixture?.date ?? null,
      league: item.league?.name ?? "",
      home_team_id: item.teams?.home?.id ?? null,
      home_name: item.teams?.home?.name ?? "",
      home_logo: item.teams?.home?.logo ?? "",
      home_goals: item.goals?.home ?? 0,
      away_team_id: item.teams?.away?.id ?? null,
      away_name: item.teams?.away?.name ?? "",
      away_logo: item.teams?.away?.logo ?? "",
      away_goals: item.goals?.away ?? 0,
    }));

    const { error: h2hError } = await supabase.from("live_h2h").insert(h2hRows);

    if (h2hError) {
      throw new Error(`Error guardando live_h2h: ${h2hError.message}`);
    }
  }

  return {
    success: true,
    fixtureId,
    message: "Partido sincronizado correctamente",
  };
}

async function ensureFixtureDetailsSynced(fixtureId: number) {
  if (!fixtureId || isDemoFixture(fixtureId)) {
    return;
  }

  const existing = liveDetailSyncState.get(fixtureId);
  const now = Date.now();

  if (existing?.inFlight) {
    return existing.inFlight;
  }

  if (existing && now - existing.syncedAt < LIVE_DETAIL_SYNC_TTL_MS) {
    return;
  }

  const inFlight = syncFixtureById(fixtureId)
    .then(() => {
      liveDetailSyncState.set(fixtureId, {
        syncedAt: Date.now(),
        inFlight: null,
      });
    })
    .catch((error: any) => {
      liveDetailSyncState.set(fixtureId, {
        syncedAt: existing?.syncedAt ?? 0,
        inFlight: null,
      });
      throw error;
    });

  liveDetailSyncState.set(fixtureId, {
    syncedAt: existing?.syncedAt ?? 0,
    inFlight,
  });

  return inFlight;
}

async function trySyncFixtureDetailsBeforeRead(fixtureId: number) {
  try {
    await ensureFixtureDetailsSynced(fixtureId);
  } catch (e: any) {
    console.warn(
      `[liveSync] No se pudieron sincronizar detalles de ${fixtureId}: ${e.message}`
    );
  }
}

export function startFixtureAutoSync(fixtureId: number, intervalMs = 60_000) {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = fixtureId;

  syncFixtureById(fixtureId)
    .then(() => {
      console.log(`[liveSync] Primer sync listo para fixture ${fixtureId}`);
    })
    .catch((err: any) => {
      console.error(`[liveSync] Error en primer sync ${fixtureId}: ${err.message}`);
    });

  liveInterval = setInterval(async () => {
    try {
      await syncFixtureById(fixtureId);
      console.log(`[liveSync] Sync automatico OK para fixture ${fixtureId}`);
    } catch (err: any) {
      console.error(`[liveSync] Error en sync automatico ${fixtureId}: ${err.message}`);
    }
  }, intervalMs);

  console.log(
    `[liveSync] Auto-sync iniciado para fixture ${fixtureId} cada ${intervalMs / 1000}s`
  );
}

export function stopFixtureAutoSync() {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = null;
  console.log("[liveSync] Auto-sync detenido");
}

liveRouter.post("/partidos/live/sync/:fixtureId", async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    const result = await syncFixtureById(fixtureId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.post("/partidos/live/start/:fixtureId", async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    startFixtureAutoSync(fixtureId, 60_000);

    return res.json({
      success: true,
      fixtureId,
      message: "Auto-sync iniciado cada 60 segundos",
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.post("/partidos/live/stop", async (_req, res) => {
  try {
    stopFixtureAutoSync();
    return res.json({ success: true, message: "Auto-sync detenido" });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/autosync/status", async (_req, res) => {
  return res.json({
    success: true,
    running: !!liveInterval,
    fixtureId: currentFixtureId,
  });
});

liveRouter.get("/partidos/live", async (_req, res) => {
  let realMatches: any[] = [];

  try {
    const liveFixtures = await getPremierLeagueLiveFixtures();
    const syncedMatches = await Promise.all(
      liveFixtures.map((fixture) => upsertLiveMatchSummary(fixture))
    );

    realMatches = syncedMatches.filter(Boolean);
  } catch (e: any) {
    console.warn(`[liveSync] No se pudo consultar live real: ${e.message}`);
    realMatches = await getRecentCachedLiveMatches();
  }

  return res.json({
    success: true,
    data: [...realMatches, { ...liveDemoMatch, updated_at: new Date().toISOString() }],
  });
});

liveRouter.get("/partidos/live/:id/lineups", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (isDemoFixture(fixtureId)) {
      return res.json({ success: true, data: liveDemoLineups });
    }

    await trySyncFixtureDetailsBeforeRead(fixtureId);

    const { data, error } = await supabase
      .from("live_lineups")
      .select("*")
      .eq("fixture_id", fixtureId)
      .order("is_sub", { ascending: true })
      .order("player_number", { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/stats", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (isDemoFixture(fixtureId)) {
      return res.json({ success: true, data: liveDemoStats });
    }

    await trySyncFixtureDetailsBeforeRead(fixtureId);

    const { data, error } = await supabase
      .from("live_stats")
      .select("*")
      .eq("fixture_id", fixtureId);

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/h2h", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (isDemoFixture(fixtureId)) {
      return res.json({ success: true, data: liveDemoH2H });
    }

    await trySyncFixtureDetailsBeforeRead(fixtureId);

    const { data, error } = await supabase
      .from("live_h2h")
      .select("*")
      .eq("fixture_id", fixtureId)
      .order("match_date", { ascending: false });

    if (error) throw error;

    const mapped = (data || []).map((row: any) => ({
      fixture_id: row.related_fixture_id,
      date: row.match_date,
      league: row.league,
      status: "Finalizado",
      home: {
        id: row.home_team_id,
        name: row.home_name,
        logo: row.home_logo,
        goals: row.home_goals ?? 0,
      },
      away: {
        id: row.away_team_id,
        name: row.away_name,
        logo: row.away_logo,
        goals: row.away_goals ?? 0,
      },
    }));

    return res.json({ success: true, data: mapped });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/events", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    if (isDemoFixture(fixtureId)) {
      return res.json({ success: true, data: liveDemoEvents });
    }

    const eventsJson = await footballFetch<any[]>("/fixtures/events", {
      fixture: fixtureId,
    });

    return res.json({
      success: true,
      data: (eventsJson.response || []).map((event) => mapFootballEvent(event, fixtureId)),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/activations", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);
    const minute = parseMinuteParam(req.query.minute);
    const userId = getSessionUserId(req);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    let activations: LiveActivationRow[] = [];

    if (isDemoFixture(fixtureId)) {
      activations = liveDemoActivations as unknown as LiveActivationRow[];
    } else {
      const { data, error } = await supabase
        .from("live_activations")
        .select("*")
        .eq("fixture_id", fixtureId)
        .order("starts_at_minute", { ascending: true });

      if (error) throw error;
      activations = (data || []) as LiveActivationRow[];
    }

    const claimedIds = await getClaimedActivationIds(
      userId,
      activations.map((activation) => activation.id),
    );

    const normalized = activations
      .map((activation) => normalizeActivation(activation, minute, claimedIds.has(activation.id)))
      .filter((activation) => activation.status === "active")
      .slice(0, 1);

    return res.json({ success: true, data: normalized });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/activations/history", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);
    const minute = parseMinuteParam(req.query.minute);
    const userId = getSessionUserId(req);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    if (!userId) {
      return res.json({ success: true, data: [] });
    }

    let activations: LiveActivationRow[] = [];

    if (isDemoFixture(fixtureId)) {
      activations = liveDemoActivations as unknown as LiveActivationRow[];
    } else {
      const { data, error } = await supabase
        .from("live_activations")
        .select("*")
        .eq("fixture_id", fixtureId)
        .order("starts_at_minute", { ascending: true });

      if (error) throw error;
      activations = (data || []) as LiveActivationRow[];
    }

    const activationIds = activations.map((activation) => activation.id);
    const { data: claims, error: claimsError } = await supabase
      .from("live_activation_claims")
      .select("id, activation_id, id_usuario, selected_option, is_correct, reward_points, claimed_at")
      .eq("id_usuario", userId)
      .in("activation_id", activationIds);

    if (claimsError) throw claimsError;

    const claimsByActivation = new Map(
      ((claims || []) as LiveActivationClaimRow[]).map((claim) => [Number(claim.activation_id), claim]),
    );

    const history = activations
      .map((activation) => {
        const claim = claimsByActivation.get(activation.id);
        const runtimeStatus = getActivationRuntimeStatus(activation, minute);

        if (!claim && runtimeStatus !== "expired" && runtimeStatus !== "resolved") {
          return null;
        }

        return {
          ...activation,
          status: claim
            ? claim.is_correct
              ? "correct"
              : claim.reward_points > 0
                ? "claimed"
                : "participated"
            : runtimeStatus,
          claimed: Boolean(claim),
          claim: claim || null,
        };
      })
      .filter(Boolean);

    return res.json({ success: true, data: history });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.post("/partidos/live/:id/activations/:activationId/claim", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);
    const activationId = Number(req.params.activationId);
    const userId = getSessionUserId(req);
    const selectedOptionRaw = req.body?.selected_option ?? req.body?.selectedOption ?? null;
    const selectedOption = selectedOptionRaw === null || selectedOptionRaw === undefined
      ? null
      : String(selectedOptionRaw).trim();

    if (!fixtureId || Number.isNaN(fixtureId) || !activationId || Number.isNaN(activationId)) {
      return res.status(400).json({ success: false, error: "Parametros invalidos" });
    }

    if (!userId) {
      return res.status(401).json({ success: false, error: "Sesion no valida" });
    }

    let activation: LiveActivationRow | null = null;

    if (isDemoFixture(fixtureId)) {
      activation = getLiveDemoActivationById(activationId) as LiveActivationRow | null;
    } else {
      const { data, error } = await supabase
        .from("live_activations")
        .select("*")
        .eq("fixture_id", fixtureId)
        .eq("id", activationId)
        .maybeSingle();

      if (error) throw error;
      activation = data as LiveActivationRow | null;
    }

    if (!activation) {
      return res.status(404).json({ success: false, error: "Activacion no encontrada" });
    }

    const options = Array.isArray(activation.payload?.options) ? activation.payload.options : [];
    if (activation.type === "poll" && options.length > 0 && !selectedOption) {
      return res.status(400).json({ success: false, error: "Selecciona una opcion" });
    }

    const correctOption = activation.payload?.correct_option;
    const hasCorrectAnswer = typeof correctOption === "string" && correctOption.length > 0;
    const isCorrect = hasCorrectAnswer ? selectedOption === correctOption : true;
    const rewardPoints = hasCorrectAnswer && !isCorrect ? 0 : Number(activation.reward_points || 0);

    const { data: claim, error: claimError } = await supabase
      .from("live_activation_claims")
      .insert({
        activation_id: activationId,
        fixture_id: fixtureId,
        id_usuario: userId,
        selected_option: selectedOption,
        is_correct: isCorrect,
        reward_points: rewardPoints,
      })
      .select("id, activation_id, id_usuario, selected_option, is_correct, reward_points, claimed_at")
      .single();

    if (claimError) {
      if (claimError.code === "23505") {
        return res.status(409).json({ success: false, error: "Activacion ya reclamada" });
      }

      throw claimError;
    }

    let saldo: number | null = null;
    if (rewardPoints > 0) {
      const { data: usuario, error: userError } = await supabase
        .from("usuario")
        .select("dinero")
        .eq("id_usuario", userId)
        .single();

      if (userError) throw userError;

      saldo = Number(usuario.dinero || 0) + rewardPoints;
      const { error: updateError } = await supabase
        .from("usuario")
        .update({ dinero: saldo })
        .eq("id_usuario", userId);

      if (updateError) throw updateError;
    }

    return res.status(201).json({
      success: true,
      data: claim,
      reward_points: rewardPoints,
      is_correct: isCorrect,
      saldo,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.get("/partidos/live/:id/chat", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    const { data, error } = await supabase
      .from("live_chat_messages")
      .select("id, fixture_id, id_usuario, username, message, created_at")
      .eq("fixture_id", fixtureId)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) throw error;

    return res.json({
      success: true,
      data: ((data || []) as LiveChatMessageRow[]).reverse(),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

liveRouter.post("/partidos/live/:id/chat", async (req, res) => {
  try {
    const fixtureId = Number(req.params.id);
    const userId = getSessionUserId(req);
    const message = String(req.body?.message ?? "").trim();

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({ success: false, error: "fixtureId invalido" });
    }

    if (!userId) {
      return res.status(401).json({ success: false, error: "Sesion no valida" });
    }

    if (!message) {
      return res.status(400).json({ success: false, error: "El mensaje no puede estar vacio" });
    }

    if (message.length > 280) {
      return res.status(400).json({ success: false, error: "El mensaje debe tener maximo 280 caracteres" });
    }

    const { data: user, error: userError } = await supabase
      .from("usuario")
      .select("id_usuario, nickname, nombre_usuario")
      .eq("id_usuario", userId)
      .maybeSingle();

    if (userError || !user) {
      return res.status(401).json({ success: false, error: "Usuario no encontrado" });
    }

    const username = user.nickname || user.nombre_usuario || "Usuario";
    const { data, error } = await supabase
      .from("live_chat_messages")
      .insert({
        fixture_id: fixtureId,
        id_usuario: userId,
        username,
        message,
      })
      .select("id, fixture_id, id_usuario, username, message, created_at")
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
