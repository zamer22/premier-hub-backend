import { Router, Request, Response } from "express";
import supabase from "../db";

const router = Router();

type PlayerRow = {
  id: string;
  name: string;
  photo_url: string | null;
};

type ChallengePlayerRow = {
  player_id: string;
  correct_rank: number;
  display_order: number | null;
};

type StatRow = {
  player_id: string;
  metric_value: number | string | null;
};

type MappedPlayer = {
  id: string;
  name: string;
  initials: string;
  image: string | null;
  photo_url: string | null;
  stat: number;
  correct?: boolean;
  is_correct?: boolean;
  submitted_rank?: number | null;
  correct_rank?: number | null;
};

type AttemptResult = {
  player_id: string;
  submitted_rank: number;
  correct_rank: number | null;
  correct: boolean;
  metric_value: number | null;
};

function getTodayDate() {
  const timeZone = process.env.WORDLE_TIME_ZONE || "America/Mexico_City";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getSessionUserId(req: Request) {
  const rawId = (req as any).signedCookies?.ph_session;
  const userId = Number(rawId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

// score = posiciones exactas (0-10)
// perfecto (10/10) → $500
// bueno    (>8)    → $300
// regular  (>6)    → $150
// cualquier otro   → $50
function calcularDinero(correctCount: number): number {
  if (correctCount === 10) return 500;
  if (correctCount > 8)    return 300;
  if (correctCount > 6)    return 150;
  return 50;
}

function normalizeAttemptScore(rawScore: unknown, totalPlayers: number) {
  const numericScore = Number(rawScore);

  if (!Number.isFinite(numericScore)) return 0;
  if (numericScore <= totalPlayers)   return numericScore;

  if (numericScore <= 100 && totalPlayers > 0) {
    return Math.round((numericScore / 100) * totalPlayers);
  }

  return Math.min(totalPlayers, Math.max(0, Math.round(numericScore)));
}

function getSeedFromString(value: string) {
  let seed = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return seed >>> 0;
}

function createSeededRandom(seedValue: string) {
  let state = getSeedFromString(seedValue) || 1;

  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
}

function shufflePlayers(players: MappedPlayer[], seedValue: string) {
  const shuffled = [...players];
  const random = createSeededRandom(seedValue);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const keptOriginalOrder = shuffled.every((player, index) => player.id === players[index]?.id);
  if (keptOriginalOrder && shuffled.length > 1) {
    const firstPlayer = shuffled.shift();
    if (firstPlayer) shuffled.push(firstPlayer);
  }

  return shuffled;
}

function buildRankMapFromStats(
  challengePlayers: ChallengePlayerRow[],
  stats: StatRow[] | null
) {
  const statsMap = new Map(
    (stats || []).map((item) => [item.player_id, Number(item.metric_value || 0)])
  );

  const hasStatsForAllPlayers = challengePlayers.every((player) =>
    statsMap.has(player.player_id)
  );

  const orderedPlayers = hasStatsForAllPlayers
    ? [...challengePlayers].sort((first, second) => {
        const statDiff =
          (statsMap.get(second.player_id) || 0) - (statsMap.get(first.player_id) || 0);
        if (statDiff !== 0) return statDiff;

        return Number(first.correct_rank) - Number(second.correct_rank);
      })
    : [...challengePlayers].sort(
        (first, second) => Number(first.correct_rank) - Number(second.correct_rank)
      );

  const rankMap = new Map<string, number>();
  orderedPlayers.forEach((player, index) => {
    rankMap.set(player.player_id, index + 1);
  });

  return {
    rankMap,
    correctOrder: orderedPlayers.map((player) => player.player_id),
    statsMap,
  };
}

function buildAttemptResults(
  submittedOrder: string[],
  rankMap: Map<string, number>,
  statsMap: Map<string, number>
): AttemptResult[] {
  return submittedOrder.map((playerId, index) => {
    const submittedRank = index + 1;
    const correctRank = rankMap.get(playerId) || null;

    return {
      player_id: playerId,
      submitted_rank: submittedRank,
      correct_rank: correctRank,
      correct: correctRank === submittedRank,
      metric_value: statsMap.get(playerId) || null,
    };
  });
}

async function buildAttemptFeedback(challengeId: string, submittedOrder: string[]) {
  const { data: challenge, error: challengeError } = await supabase
    .from("challenges")
    .select("topic_id")
    .eq("id", challengeId)
    .single();

  if (challengeError) throw challengeError;

  const { data: correctPlayers, error: correctPlayersError } = await supabase
    .from("challenge_players")
    .select("player_id, correct_rank, display_order")
    .eq("challenge_id", challengeId);

  if (correctPlayersError) throw correctPlayersError;
  if (!correctPlayers?.length) {
    return { score: 0, results: [], correct_order: [] };
  }

  const playerIds = (correctPlayers as ChallengePlayerRow[]).map((player) => player.player_id);
  const { data: stats, error: statsError } = await supabase
    .from("player_topic_stats")
    .select("player_id, metric_value")
    .eq("topic_id", challenge.topic_id)
    .in("player_id", playerIds);

  if (statsError) throw statsError;

  const { rankMap, correctOrder, statsMap } = buildRankMapFromStats(
    correctPlayers as ChallengePlayerRow[],
    stats as StatRow[] | null
  );

  const results = buildAttemptResults(submittedOrder, rankMap, statsMap);

  return {
    score: results.filter((result) => result.correct).length,
    results,
    correct_order: correctOrder,
  };
}

function applyAttemptResultsToPlayers(players: MappedPlayer[], results: AttemptResult[]) {
  const resultMap = new Map(results.map((result) => [result.player_id, result]));

  return players.map((player) => {
    const result = resultMap.get(player.id);

    if (!result) return player;

    return {
      ...player,
      correct: result.correct,
      is_correct: result.correct,
      submitted_rank: result.submitted_rank,
      correct_rank: result.correct_rank,
    };
  });
}

// ============================================================
// GET /daily
// ============================================================
router.get("/daily", async (req: Request, res: Response) => {
  try {
    const today = getTodayDate();

    // Verificar si ya existe reto activo hoy, si no generarlo
    const { data: existing, error: existingError } = await supabase
      .from("challenges")
      .select("id")
      .eq("scheduled_date", today)
      .eq("is_active", true)
      .maybeSingle();

    if (existingError) throw existingError;

    if (!existing) {
      const { error: rpcError } = await supabase.rpc("activate_today_challenge");
      if (rpcError) {
        console.error("[wordle/daily] Error al generar reto del día:", rpcError);
        return res.status(500).json({
          success: false,
          error: "No se pudo generar el desafio de hoy",
        });
      }
    }

    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("id, topic_id, scheduled_date")
      .eq("scheduled_date", today)
      .eq("is_active", true)
      .maybeSingle();

    if (challengeError) throw challengeError;
    if (!challenge) {
      return res.status(404).json({
        success: false,
        error: "No hay desafio activo hoy",
      });
    }

    const { data: topic, error: topicError } = await supabase
      .from("topics")
      .select("id, title, metric_label")
      .eq("id", challenge.topic_id)
      .single();

    if (topicError) throw topicError;

    const { data: challengePlayers, error: challengePlayersError } = await supabase
      .from("challenge_players")
      .select("player_id, correct_rank, display_order")
      .eq("challenge_id", challenge.id)
      .order("display_order", { ascending: true });

    if (challengePlayersError) throw challengePlayersError;
    if (!challengePlayers?.length) {
      return res.status(404).json({
        success: false,
        error: "El desafio no tiene jugadores configurados",
      });
    }

    const orderedChallengePlayers = challengePlayers as ChallengePlayerRow[];
    const playerIds = orderedChallengePlayers.map((item) => item.player_id);

    const [{ data: playerRows, error: playersError }, { data: stats, error: statsError }] =
      await Promise.all([
        supabase.from("players").select("id, name, photo_url").in("id", playerIds),
        supabase
          .from("player_topic_stats")
          .select("player_id, metric_value")
          .eq("topic_id", challenge.topic_id)
          .in("player_id", playerIds),
      ]);

    if (playersError) throw playersError;
    if (statsError) throw statsError;

    const playersMap = new Map(
      (playerRows as PlayerRow[] | null)?.map((player) => [player.id, player]) || []
    );
    const statsMap = new Map(
      ((stats as StatRow[] | null) || []).map((item) => [
        item.player_id,
        Number(item.metric_value || 0),
      ])
    );

    const mappedPlayers = orderedChallengePlayers
      .map((challengePlayer) => {
        const player = playersMap.get(challengePlayer.player_id);
        if (!player) return null;

        return {
          id: player.id,
          name: player.name,
          initials: getInitials(player.name),
          image: player.photo_url,
          photo_url: player.photo_url,
          stat: statsMap.get(player.id) || 0,
        };
      })
      .filter((player): player is MappedPlayer => player !== null);

    const userId = getSessionUserId(req);
    const shuffledPlayers = shufflePlayers(
      mappedPlayers,
      `${challenge.id}:${userId || "guest"}`
    );

    const { data: rawAttempt } = userId
      ? await supabase
          .from("user_attempts")
          .select("score, dinero_ganado, submitted_order, created_at")
          .eq("challenge_id", challenge.id)
          .eq("id_usuario", userId)
          .maybeSingle()
      : { data: null };

    const attemptFeedback = rawAttempt
      ? await buildAttemptFeedback(challenge.id, rawAttempt.submitted_order || [])
      : null;

    const attempt = rawAttempt
      ? {
          ...rawAttempt,
          raw_score: rawAttempt.score,
          score:
            attemptFeedback?.score ??
            normalizeAttemptScore(rawAttempt.score, mappedPlayers.length),
          dinero_ganado: rawAttempt.dinero_ganado,
          ...(attemptFeedback || {}),
        }
      : null;
    const players = attemptFeedback
      ? applyAttemptResultsToPlayers(shuffledPlayers, attemptFeedback.results)
      : shuffledPlayers;

    return res.json({
      success: true,
      data: {
        challenge_id: challenge.id,
        scheduled_date: challenge.scheduled_date,
        theme: topic.title,
        metric_label: topic.metric_label,
        players,
        correct_order: attemptFeedback?.correct_order,
        played: !!attempt,
        attempt: attempt || null,
      },
    });
  } catch (error: any) {
    console.error("[wordle/daily]", error);
    return res.status(500).json({
      success: false,
      error: "Error interno al obtener el desafio",
      detail: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

// ============================================================
// GET /played/:challengeId
// ============================================================
router.get("/played/:challengeId", async (req: Request, res: Response) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: "No autenticado" });
    }

    const challengeId = String(req.params.challengeId);

    const { data: rawAttempt, error } = await supabase
      .from("user_attempts")
      .select("score, dinero_ganado, submitted_order, created_at")
      .eq("challenge_id", challengeId)
      .eq("id_usuario", userId)
      .maybeSingle();

    if (error) throw error;

    const attemptFeedback = rawAttempt
      ? await buildAttemptFeedback(challengeId, rawAttempt.submitted_order || [])
      : null;

    return res.json({
      success: true,
      played: !!rawAttempt,
      attempt: rawAttempt
        ? {
            ...rawAttempt,
            raw_score: rawAttempt.score,
            score: attemptFeedback?.score ?? normalizeAttemptScore(rawAttempt.score, 10),
            dinero_ganado: rawAttempt.dinero_ganado,
            ...(attemptFeedback || {}),
          }
        : null,
    });
  } catch (error: any) {
    console.error("[wordle/played]", error);
    return res.status(500).json({
      success: false,
      error: "Error interno al consultar el intento",
      detail: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

// ============================================================
// POST /submit
// ============================================================
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: "No autenticado" });
    }

    const { challenge_id, submitted_order } = req.body as {
      challenge_id?: string;
      submitted_order?: string[];
    };

    if (!challenge_id || !Array.isArray(submitted_order)) {
      return res.status(400).json({ success: false, error: "Datos invalidos" });
    }

    // Verificar si ya jugó
    const { data: existingAttempt, error: existingAttemptError } = await supabase
      .from("user_attempts")
      .select("id")
      .eq("challenge_id", challenge_id)
      .eq("id_usuario", userId)
      .maybeSingle();

    if (existingAttemptError) throw existingAttemptError;
    if (existingAttempt) {
      return res.status(409).json({
        success: false,
        error: "Ya completaste este desafio",
      });
    }

    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("topic_id")
      .eq("id", challenge_id)
      .single();

    if (challengeError) throw challengeError;

    // Obtener jugadores correctos del reto
    const { data: correctPlayers, error: correctPlayersError } = await supabase
      .from("challenge_players")
      .select("player_id, correct_rank, display_order")
      .eq("challenge_id", challenge_id);

    if (correctPlayersError) throw correctPlayersError;
    if (!correctPlayers?.length) {
      return res.status(404).json({
        success: false,
        error: "Desafio no encontrado",
      });
    }

    // Validar que los jugadores enviados coincidan con los del reto
    const expectedIds = new Set(correctPlayers.map((player) => player.player_id as string));
    const submittedIds = new Set(submitted_order);
    const hasInvalidOrder =
      submitted_order.length !== expectedIds.size ||
      submittedIds.size !== expectedIds.size ||
      submitted_order.some((playerId) => !expectedIds.has(playerId));

    if (hasInvalidOrder) {
      return res.status(400).json({
        success: false,
        error: "El orden enviado no coincide con los jugadores del desafio",
      });
    }

    const { data: stats, error: statsError } = await supabase
      .from("player_topic_stats")
      .select("player_id, metric_value")
      .eq("topic_id", challenge.topic_id)
      .in("player_id", [...expectedIds]);

    if (statsError) throw statsError;

    // Calcular score: posiciones exactas (0-10), usando las metricas del tema como fuente.
    const { rankMap, correctOrder, statsMap } = buildRankMapFromStats(
      correctPlayers as ChallengePlayerRow[],
      stats as StatRow[] | null
    );

    const correctCount = submitted_order.reduce((total, playerId, index) => {
      return total + (rankMap.get(playerId) === index + 1 ? 1 : 0);
    }, 0);
    const results = buildAttemptResults(submitted_order, rankMap, statsMap);

    // Calcular dinero con la escala unificada
    const dineroGanado = calcularDinero(correctCount);

    // Guardar intento
    const { error: insertError } = await supabase.from("user_attempts").insert({
      challenge_id,
      id_usuario: userId,
      submitted_order,
      score: correctCount,
      dinero_ganado: dineroGanado,
    });

    if (insertError) throw insertError;

    // Actualizar dinero del usuario (siempre, mínimo $50)
    const { data: usuario, error: usuarioError } = await supabase
      .from("usuario")
      .select("dinero")
      .eq("id_usuario", userId)
      .single();

    if (usuarioError) throw usuarioError;

    const nuevoSaldo = Number(usuario.dinero || 0) + dineroGanado;

    const { error: updateError } = await supabase
      .from("usuario")
      .update({ dinero: nuevoSaldo })
      .eq("id_usuario", userId);

    if (updateError) throw updateError;

    return res.json({
      success: true,
      data: {
        score: correctCount,
        dinero_ganado: dineroGanado,
        nuevo_saldo: nuevoSaldo,
        results,
        correct_order: correctOrder,
      },
    });
  } catch (error: any) {
    console.error("[wordle/submit]", error);
    return res.status(500).json({
      success: false,
      error: "Error interno al guardar el intento",
      detail: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

export default router;
