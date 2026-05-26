import { footballFetch, PREMIER_LEAGUE_ID } from "../rutas/api_partidos";
import {
  getFixtureMinuteNumber,
  mapFixtureToLiveMatchRow,
  mapFootballEvent,
  mapFootballH2H,
  mapFootballLineups,
  mapFootballStats,
  mapH2HForClient,
} from "./mappers";
import * as repo from "./repository";
import type { LiveActivationRow } from "./types";

type SyncState = {
  syncedAt: number;
  inFlight: Promise<void> | null;
};

const LIVE_DETAIL_SYNC_TTL_MS = 45_000;
const LIVE_CACHE_WINDOW_MS = 15 * 60 * 1000;
const FALLBACK_CACHE_WINDOW_MS = 2 * 60 * 60 * 1000;
const liveDetailSyncState = new Map<number, SyncState>();

let liveInterval: NodeJS.Timeout | null = null;
let currentFixtureId: number | null = null;

function parseMinuteLabel(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function isRecentlyUpdated(value: string | null | undefined, windowMs: number) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= windowMs;
}

function isLiveStatus(row: { minute?: string | null; status?: string | null }) {
  const status = String(row.status || "").toLowerCase();
  const minute = parseMinuteLabel(row.minute);

  if (["match finished", "finished", "full time", "not started", "postponed", "cancelled", "canceled"].some((item) => status.includes(item))) {
    return false;
  }

  return (
    status.includes("live") ||
    status.includes("half") ||
    status.includes("halftime") ||
    status.includes("extra time") ||
    status.includes("penalty") ||
    (minute !== null && minute > 0 && minute < 130)
  );
}

function isApiLiveMatch(row: { minute?: string | null; status?: string | null; updated_at?: string | null }, cacheWindowMs = LIVE_CACHE_WINDOW_MS) {
  return isRecentlyUpdated(row.updated_at, cacheWindowMs) && isLiveStatus(row);
}

function filterLiveList(rows: Awaited<ReturnType<typeof repo.getVisibleLiveMatches>>, cacheWindowMs = LIVE_CACHE_WINDOW_MS) {
  return rows.filter((row) => {
    if (!row.is_visible) return false;
    if (row.is_demo || row.source === "manual") return true;
    return isApiLiveMatch(row, cacheWindowMs);
  });
}

function getActivationRuntimeStatus(
  activation: Pick<LiveActivationRow, "starts_at_minute" | "expires_at_minute" | "status">,
  minute: number | null,
) {
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

function normalizeActivation(activation: LiveActivationRow, minute: number | null, claimed: boolean) {
  return {
    ...activation,
    status: claimed ? "claimed" : getActivationRuntimeStatus(activation, minute),
    claimed,
  };
}

export function parseMinuteParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function getPremierLeagueLiveFixtures() {
  const liveJson = await footballFetch<any[]>("/fixtures", { live: "all" });
  const fixtures = liveJson.response || [];
  return fixtures.filter((fixture: any) => fixture.league?.id === PREMIER_LEAGUE_ID);
}

export async function listLiveMatches() {
  let apiAvailable = false;
  let syncedRealMatches: any[] = [];

  try {
    const liveFixtures = await getPremierLeagueLiveFixtures();
    syncedRealMatches = await Promise.all(liveFixtures.map((fixture) => repo.upsertLiveMatch(mapFixtureToLiveMatchRow(fixture))));
    apiAvailable = true;
  } catch (error: any) {
    console.warn(`[liveService] No se pudo consultar live real: ${error.message}`);
  }

  try {
    const visibleMatches = await repo.getVisibleLiveMatches();
    const visibleManualOrDemo = visibleMatches.filter((row) => row.is_visible && (row.is_demo || row.source === "manual"));

    if (apiAvailable) {
      const syncedIds = new Set(syncedRealMatches.map((row) => Number(row.id)));
      const freshRealMatches = filterLiveList(visibleMatches).filter((row) => syncedIds.has(Number(row.id)));
      return freshRealMatches.length > 0 ? freshRealMatches : visibleManualOrDemo;
    }

    return filterLiveList(visibleMatches, FALLBACK_CACHE_WINDOW_MS);
  } catch (error: any) {
    console.warn(`[liveService] No se pudo leer live visible: ${error.message}`);
    const cached = await repo.getRecentCachedLiveMatches(2);
    return filterLiveList(cached, FALLBACK_CACHE_WINDOW_MS);
  }
}

export async function syncFixtureById(fixtureId: number) {
  const fixtureJson = await footballFetch<any[]>("/fixtures", { id: fixtureId });
  const fixture = fixtureJson.response?.[0];

  if (!fixture) {
    throw new Error(`No se encontro el fixture ${fixtureId}`);
  }

  const homeTeamId = fixture.teams?.home?.id;
  const awayTeamId = fixture.teams?.away?.id;

  if (!homeTeamId || !awayTeamId) {
    throw new Error(`No se pudieron obtener los equipos del fixture ${fixtureId}`);
  }

  await repo.upsertLiveMatch(mapFixtureToLiveMatchRow(fixture));

  const [lineupsJson, statsJson, eventsJson, h2hJson] = await Promise.all([
    footballFetch<any[]>("/fixtures/lineups", { fixture: fixtureId }),
    footballFetch<any[]>("/fixtures/statistics", { fixture: fixtureId }),
    footballFetch<any[]>("/fixtures/events", { fixture: fixtureId }),
    footballFetch<any[]>("/fixtures/headtohead", { h2h: `${homeTeamId}-${awayTeamId}`, last: 5 }),
  ]);

  await Promise.all([
    repo.replaceLineups(fixtureId, mapFootballLineups(lineupsJson.response || [], fixtureId)),
    repo.replaceStats(fixtureId, mapFootballStats(statsJson.response || [], fixtureId)),
    repo.replaceEvents(
      fixtureId,
      (eventsJson.response || []).map((event, index) => mapFootballEvent(event, fixtureId, index)),
    ),
    repo.replaceH2H(fixtureId, mapFootballH2H(h2hJson.response || [], fixtureId)),
  ]);

  return {
    success: true,
    fixtureId,
    minute: getFixtureMinuteNumber(fixture),
    message: "Partido sincronizado correctamente",
  };
}

async function ensureFixtureDetailsSynced(fixtureId: number) {
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
      liveDetailSyncState.set(fixtureId, { syncedAt: Date.now(), inFlight: null });
    })
    .catch((error: any) => {
      liveDetailSyncState.set(fixtureId, { syncedAt: existing?.syncedAt ?? 0, inFlight: null });
      throw error;
    });

  liveDetailSyncState.set(fixtureId, { syncedAt: existing?.syncedAt ?? 0, inFlight });
  return inFlight;
}

async function trySyncFixtureDetailsBeforeRead(fixtureId: number) {
  try {
    await ensureFixtureDetailsSynced(fixtureId);
  } catch (error: any) {
    console.warn(`[liveService] No se pudieron sincronizar detalles de ${fixtureId}: ${error.message}`);
  }
}

export function startFixtureAutoSync(fixtureId: number, intervalMs = 60_000) {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = fixtureId;

  syncFixtureById(fixtureId)
    .then(() => console.log(`[liveService] Primer sync listo para fixture ${fixtureId}`))
    .catch((err: any) => console.error(`[liveService] Error en primer sync ${fixtureId}: ${err.message}`));

  liveInterval = setInterval(async () => {
    try {
      await syncFixtureById(fixtureId);
      console.log(`[liveService] Sync automatico OK para fixture ${fixtureId}`);
    } catch (err: any) {
      console.error(`[liveService] Error en sync automatico ${fixtureId}: ${err.message}`);
    }
  }, intervalMs);

  console.log(`[liveService] Auto-sync iniciado para fixture ${fixtureId} cada ${intervalMs / 1000}s`);
}

export function stopFixtureAutoSync() {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = null;
  console.log("[liveService] Auto-sync detenido");
}

export function getAutoSyncStatus() {
  return {
    running: Boolean(liveInterval),
    fixtureId: currentFixtureId,
  };
}

export async function getLineups(fixtureId: number) {
  await trySyncFixtureDetailsBeforeRead(fixtureId);
  return repo.getLineups(fixtureId);
}

export async function getStats(fixtureId: number) {
  await trySyncFixtureDetailsBeforeRead(fixtureId);
  return repo.getStats(fixtureId);
}

export async function getStatSnapshots(fixtureId: number) {
  return repo.getStatSnapshots(fixtureId);
}

export async function getEvents(fixtureId: number) {
  await trySyncFixtureDetailsBeforeRead(fixtureId);
  return repo.getEvents(fixtureId);
}

export async function getH2H(fixtureId: number) {
  await trySyncFixtureDetailsBeforeRead(fixtureId);
  const rows = await repo.getH2H(fixtureId);
  return rows.map(mapH2HForClient);
}

export async function getActiveActivations(fixtureId: number, minute: number | null, userId: number | null) {
  const activations = await repo.getActivations(fixtureId);
  const claimedIds = await repo.getClaimedActivationIds(
    userId,
    activations.map((activation) => activation.id),
  );

  return activations
    .map((activation) => normalizeActivation(activation, minute, claimedIds.has(activation.id)))
    .filter((activation) => activation.status === "active")
    .slice(0, 1);
}

export async function getActivationHistory(fixtureId: number, minute: number | null, userId: number | null) {
  if (!userId) return [];

  const activations = await repo.getActivations(fixtureId);
  const activationIds = activations.map((activation) => activation.id);
  const claimsByActivation = await repo.getClaimsByActivation(userId, activationIds);

  return activations
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
}

export async function claimActivation(
  fixtureId: number,
  activationId: number,
  userId: number,
  selectedOption: string | null,
) {
  const activation = await repo.getActivationById(fixtureId, activationId);

  if (!activation) {
    const error = new Error("Activacion no encontrada");
    error.name = "NotFoundError";
    throw error;
  }

  const options = Array.isArray(activation.payload?.options) ? activation.payload.options : [];
  if (activation.type === "poll" && options.length > 0 && !selectedOption) {
    const error = new Error("Selecciona una opcion");
    error.name = "ValidationError";
    throw error;
  }

  const correctOption = activation.payload?.correct_option;
  const hasCorrectAnswer = typeof correctOption === "string" && correctOption.length > 0;
  const isCorrect = hasCorrectAnswer ? selectedOption === correctOption : true;
  const rewardPoints = hasCorrectAnswer && !isCorrect ? 0 : Number(activation.reward_points || 0);

  const claim = await repo.createActivationClaim({
    activation_id: activationId,
    fixture_id: fixtureId,
    id_usuario: userId,
    selected_option: selectedOption,
    is_correct: isCorrect,
    reward_points: rewardPoints,
  });

  const saldo = await repo.addUserMoney(userId, rewardPoints);

  return {
    claim,
    rewardPoints,
    isCorrect,
    saldo,
  };
}

export function getCurrentMinuteFromMatch(matchMinute: string | null | undefined) {
  return parseMinuteLabel(matchMinute);
}

export const liveRepository = repo;
