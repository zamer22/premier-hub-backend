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
      (stats || []).map((item) => [item.player_id as string, Number(item.metric_value || 0)])
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
          correctRank: challengePlayer.correct_rank,
        };
      })
      .filter(Boolean);

    const userId = getSessionUserId(req);
    const { data: rawAttempt } = userId
      ? await supabase
          .from("user_attempts")
          .select("score, dinero_ganado, submitted_order, created_at")
          .eq("challenge_id", challenge.id)
          .eq("id_usuario", userId)
          .maybeSingle()
      : { data: null };

    const attempt = rawAttempt
      ? {
          ...rawAttempt,
          raw_score: rawAttempt.score,
          score: normalizeAttemptScore(rawAttempt.score, mappedPlayers.length),
          dinero_ganado: rawAttempt.dinero_ganado,
        }
      : null;

    return res.json({
      success: true,
      data: {
        challenge_id: challenge.id,
        scheduled_date: challenge.scheduled_date,
        theme: topic.title,
        metric_label: topic.metric_label,
        players: mappedPlayers, // ya vienen ordenados por display_order desde la BD
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

    const { data: rawAttempt, error } = await supabase
      .from("user_attempts")
      .select("score, dinero_ganado, submitted_order, created_at")
      .eq("challenge_id", req.params.challengeId)
      .eq("id_usuario", userId)
      .maybeSingle();

    if (error) throw error;

    return res.json({
      success: true,
      played: !!rawAttempt,
      attempt: rawAttempt
        ? {
            ...rawAttempt,
            raw_score: rawAttempt.score,
            score: normalizeAttemptScore(rawAttempt.score, 10),
            dinero_ganado: rawAttempt.dinero_ganado,
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

    // Obtener jugadores correctos del reto
    const { data: correctPlayers, error: correctPlayersError } = await supabase
      .from("challenge_players")
      .select("player_id, correct_rank")
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

    // Calcular score: posiciones exactas (0-10)
    const rankMap = new Map(
      correctPlayers.map((player) => [player.player_id as string, Number(player.correct_rank)])
    );

    const correctCount = submitted_order.reduce((total, playerId, index) => {
      return total + (rankMap.get(playerId) === index + 1 ? 1 : 0);
    }, 0);

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