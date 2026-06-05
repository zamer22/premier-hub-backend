import { Router, Request, Response } from "express";

import supabase from "../db";

const router = Router();

type LeaderboardGame = "all" | "wordle" | "missing_xi" | "lab";
type LeaderboardPeriod = "all" | "week" | "month";

type GameResultRow = {
  game_key: string;
  id_usuario: number | string;
  score: number | string | null;
  max_score: number | string | null;
  points: number | string | null;
  played_at: string | null;
};

type UserRow = {
  id_usuario: number | string;
  nickname: string | null;
  nombre_usuario: string | null;
  foto_perfil: string | null;
};

type LeaderboardItem = {
  rank: number;
  id_usuario: number;
  username: string;
  foto_perfil: string | null;
  total_points: number;
  games_played: number;
  total_score: number;
  max_score: number;
  accuracy: number;
  last_played_at: string | null;
  favorite_game: string | null;
};

type LeaderboardResponse = {
  success: boolean;
  data?: LeaderboardItem[];
  me?: LeaderboardItem | null;
  meta?: {
    game: LeaderboardGame;
    period: LeaderboardPeriod;
    limit: number;
    count: number;
    source: "arcade_leaderboard" | "arcade_game_results_view";
  };
  error?: string;
  detail?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Error interno del servidor";
}

function getSessionUserId(req: Request) {
  const rawId = (req as any).signedCookies?.ph_session;
  const userId = Number(rawId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeGame(value: unknown): LeaderboardGame | null {
  const rawValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!rawValue || rawValue === "all" || rawValue === "general") return "all";
  if (rawValue === "wordle" || rawValue === "reto-diario" || rawValue === "reto_diario") {
    return "wordle";
  }
  if (rawValue === "missing_xi" || rawValue === "missing-xi") return "missing_xi";
  if (rawValue === "lab" || rawValue === "laboratorio") return "lab";
  return null;
}

function normalizePeriod(value: unknown): LeaderboardPeriod | null {
  const rawValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!rawValue || rawValue === "all" || rawValue === "historico" || rawValue === "histórico") {
    return "all";
  }
  if (rawValue === "week" || rawValue === "semana") return "week";
  if (rawValue === "month" || rawValue === "mes") return "month";
  return null;
}

function normalizeLimit(value: unknown) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) return 50;
  return Math.min(limit, 100);
}

function getPeriodStartIso(period: LeaderboardPeriod) {
  if (period === "all") return null;

  const start = new Date();
  start.setDate(start.getDate() - (period === "week" ? 7 : 30));
  return start.toISOString();
}

function getUsername(user: UserRow | undefined) {
  return user?.nickname || user?.nombre_usuario || "Usuario";
}

function calculateFavoriteGame(
  gameStats: Map<string, { games: number; points: number }>,
) {
  let favoriteGame: string | null = null;
  let favoriteGames = -1;
  let favoritePoints = -1;

  // El juego "favorito" es el que mas PUNTOS le dio al usuario (no el mas jugado).
  for (const [gameKey, stats] of gameStats) {
    if (
      stats.points > favoritePoints ||
      (stats.points === favoritePoints && stats.games > favoriteGames)
    ) {
      favoriteGame = gameKey;
      favoritePoints = stats.points;
      favoriteGames = stats.games;
    }
  }

  return favoriteGame;
}

// Laboratorio: cada desafio completado es una "jugada" (puntos = puntos_otorgados, fecha = fecha_completado).
// Los datos ya viven en lab_usuario_desafio; no hay que tocar la vista de Supabase.
async function getLabResults(periodStart: string | null): Promise<GameResultRow[]> {
  let query = supabase
    .from("lab_usuario_desafio")
    .select("id_usuario, puntos_otorgados, fecha_completado")
    .eq("completado", true)
    .gt("puntos_otorgados", 0)
    .order("fecha_completado", { ascending: false })
    .limit(5000);

  if (periodStart) query = query.gte("fecha_completado", periodStart);

  const { data, error } = await query;
  if (error) throw error;

  return ((data || []) as Array<{
    id_usuario: number | string;
    puntos_otorgados: number | string | null;
    fecha_completado: string | null;
  }>).map((row) => ({
    game_key: "lab",
    id_usuario: row.id_usuario,
    score: null,
    max_score: null,
    points: row.puntos_otorgados,
    played_at: row.fecha_completado,
  }));
}

async function getFilteredLeaderboard(
  game: LeaderboardGame,
  period: LeaderboardPeriod,
  limit: number,
  userId: number | null,
) {
  const periodStart = getPeriodStartIso(period);
  const rows: GameResultRow[] = [];

  // Arcade (wordle / missing_xi). Se omite cuando el filtro es solo Laboratorio.
  if (game !== "lab") {
    let query = supabase
      .from("arcade_game_results_view")
      .select("game_key, id_usuario, score, max_score, points, played_at")
      .order("played_at", { ascending: false })
      .limit(5000);

    if (game !== "all") query = query.eq("game_key", game);
    if (periodStart) query = query.gte("played_at", periodStart);

    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data || []) as GameResultRow[]));
  }

  // Laboratorio: entra en "General" (all) y como filtro propio.
  if (game === "all" || game === "lab") {
    rows.push(...(await getLabResults(periodStart)));
  }
  const userIds = Array.from(new Set(rows.map((row) => toNumber(row.id_usuario)))).filter(
    (id) => id > 0,
  );

  let usersById = new Map<number, UserRow>();
  if (userIds.length) {
    const { data: users, error: usersError } = await supabase
      .from("usuario")
      .select("id_usuario, nickname, nombre_usuario, foto_perfil")
      .in("id_usuario", userIds);

    if (usersError) throw usersError;
    usersById = new Map(
      ((users || []) as UserRow[]).map((user) => [toNumber(user.id_usuario), user]),
    );
  }

  const grouped = new Map<
    number,
    {
      id_usuario: number;
      total_points: number;
      games_played: number;
      total_score: number;
      max_score: number;
      last_played_at: string | null;
      gameStats: Map<string, { games: number; points: number }>;
    }
  >();

  for (const row of rows) {
    const idUsuario = toNumber(row.id_usuario);
    if (!idUsuario) continue;

    const current = grouped.get(idUsuario) || {
      id_usuario: idUsuario,
      total_points: 0,
      games_played: 0,
      total_score: 0,
      max_score: 0,
      last_played_at: null,
      gameStats: new Map<string, { games: number; points: number }>(),
    };

    const points = toNumber(row.points);
    current.total_points += points;
    current.games_played += 1;
    current.total_score += toNumber(row.score);
    current.max_score += toNumber(row.max_score);

    if (
      row.played_at &&
      (!current.last_played_at ||
        new Date(row.played_at).getTime() > new Date(current.last_played_at).getTime())
    ) {
      current.last_played_at = row.played_at;
    }

    const gameStats = current.gameStats.get(row.game_key) || { games: 0, points: 0 };
    gameStats.games += 1;
    gameStats.points += points;
    current.gameStats.set(row.game_key, gameStats);
    grouped.set(idUsuario, current);
  }

  const allItems = Array.from(grouped.values())
    .sort((first, second) => {
      const pointsDiff = second.total_points - first.total_points;
      if (pointsDiff !== 0) return pointsDiff;

      const scoreDiff = second.total_score - first.total_score;
      if (scoreDiff !== 0) return scoreDiff;

      return (
        new Date(second.last_played_at || 0).getTime() -
        new Date(first.last_played_at || 0).getTime()
      );
    })
    .map<LeaderboardItem>((item, index) => ({
      rank: index + 1,
      id_usuario: item.id_usuario,
      username: getUsername(usersById.get(item.id_usuario)),
      foto_perfil: usersById.get(item.id_usuario)?.foto_perfil ?? null,
      total_points: item.total_points,
      games_played: item.games_played,
      total_score: item.total_score,
      max_score: item.max_score,
      accuracy:
        item.max_score > 0
          ? Number(((item.total_score / item.max_score) * 100).toFixed(1))
          : 0,
      last_played_at: item.last_played_at,
      favorite_game: calculateFavoriteGame(item.gameStats),
    }));

  return {
    items: allItems.slice(0, limit),
    me: userId ? allItems.find((item) => item.id_usuario === userId) || null : null,
  };
}

router.get(
  ["/", "/arcade"],
  async (req: Request, res: Response<LeaderboardResponse>) => {
    try {
      const game = normalizeGame(req.query.game);
      const period = normalizePeriod(req.query.period);
      const limit = normalizeLimit(req.query.limit);

      if (!game) {
        return res.status(400).json({
          success: false,
          error: "Filtro de juego invalido",
        });
      }

      if (!period) {
        return res.status(400).json({
          success: false,
          error: "Filtro de periodo invalido",
        });
      }

      const userId = getSessionUserId(req);
      const leaderboard = await getFilteredLeaderboard(game, period, limit, userId);

      return res.json({
        success: true,
        data: leaderboard.items,
        me: leaderboard.me,
        meta: {
          game,
          period,
          limit,
          count: leaderboard.items.length,
          source: "arcade_game_results_view",
        },
      });
    } catch (error: unknown) {
      console.error("[leaderboard/arcade]", error);
      return res.status(500).json({
        success: false,
        error: "Error interno al obtener leaderboard",
        detail: process.env.NODE_ENV !== "production" ? getErrorMessage(error) : undefined,
      });
    }
  },
);

export default router;
