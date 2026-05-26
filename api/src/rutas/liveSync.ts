import { Router } from "express";
import { getSessionUserId } from "../live/session";
import {
  claimActivation,
  getActivationHistory,
  getActiveActivations,
  getAutoSyncStatus,
  getEvents,
  getH2H,
  getLineups,
  getStatSnapshots,
  getStats,
  listLiveMatches,
  liveRepository,
  parseMinuteParam,
  startFixtureAutoSync,
  stopFixtureAutoSync,
  syncFixtureById,
} from "../live/service";
import type { ApiResponse } from "../live/types";

export { startFixtureAutoSync, stopFixtureAutoSync };

export const liveRouter = Router();

function getErrorStatus(error: Error) {
  if (error.name === "DuplicateClaimError") return 409;
  if (error.name === "UnauthorizedError") return 401;
  if (error.name === "NotFoundError") return 404;
  if (error.name === "ValidationError") return 400;
  return 500;
}

function parseFixtureId(value: string) {
  const fixtureId = Number(value);
  return !fixtureId || Number.isNaN(fixtureId) ? null : fixtureId;
}

function sendError(res: any, error: unknown) {
  const normalized = error instanceof Error ? error : new Error("Error interno del servidor");
  return res.status(getErrorStatus(normalized)).json({
    success: false,
    error: normalized.message,
  });
}

liveRouter.post("/partidos/live/sync/:fixtureId", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.fixtureId);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    const result = await syncFixtureById(fixtureId);
    return res.json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.post("/partidos/live/start/:fixtureId", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.fixtureId);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    startFixtureAutoSync(fixtureId, 60_000);

    return res.json({
      success: true,
      fixtureId,
      message: "Auto-sync iniciado cada 60 segundos",
    });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.post("/partidos/live/stop", async (_req, res) => {
  try {
    stopFixtureAutoSync();
    return res.json({ success: true, message: "Auto-sync detenido" });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/autosync/status", async (_req, res: any) => {
  return res.json({
    success: true,
    ...getAutoSyncStatus(),
  } satisfies ApiResponse);
});

liveRouter.get("/partidos/live/config", async (_req, res) => {
  try {
    return res.json({ success: true, data: await liveRepository.getLiveConfig() });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live", async (_req, res) => {
  try {
    return res.json({ success: true, data: await listLiveMatches() });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/lineups", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await getLineups(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/stats", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await getStats(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/stat-snapshots", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await getStatSnapshots(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/h2h", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await getH2H(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/events", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await getEvents(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/activations", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    const minute = parseMinuteParam(req.query.minute);
    const userId = getSessionUserId(req);

    return res.json({ success: true, data: await getActiveActivations(fixtureId, minute, userId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/activations/history", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    const minute = parseMinuteParam(req.query.minute);
    const userId = getSessionUserId(req);

    return res.json({ success: true, data: await getActivationHistory(fixtureId, minute, userId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.post("/partidos/live/:id/activations/:activationId/claim", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    const activationId = Number(req.params.activationId);
    const userId = getSessionUserId(req);
    const selectedOptionRaw = req.body?.selected_option ?? req.body?.selectedOption ?? null;
    const selectedOption =
      selectedOptionRaw === null || selectedOptionRaw === undefined
        ? null
        : String(selectedOptionRaw).trim();

    if (!fixtureId || !activationId || Number.isNaN(activationId)) {
      return res.status(400).json({ success: false, error: "Parametros invalidos" });
    }

    if (!userId) {
      return res.status(401).json({ success: false, error: "Sesion no valida" });
    }

    const result = await claimActivation(fixtureId, activationId, userId, selectedOption);

    return res.status(201).json({
      success: true,
      data: result.claim,
      reward_points: result.rewardPoints,
      is_correct: result.isCorrect,
      saldo: result.saldo,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.get("/partidos/live/:id/chat", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });

    return res.json({ success: true, data: await liveRepository.getChatMessages(fixtureId) });
  } catch (error) {
    return sendError(res, error);
  }
});

liveRouter.post("/partidos/live/:id/chat", async (req, res) => {
  try {
    const fixtureId = parseFixtureId(req.params.id);
    const userId = getSessionUserId(req);
    const message = String(req.body?.message ?? "").trim();

    if (!fixtureId) return res.status(400).json({ success: false, error: "fixtureId invalido" });
    if (!userId) return res.status(401).json({ success: false, error: "Sesion no valida" });
    if (!message) return res.status(400).json({ success: false, error: "El mensaje no puede estar vacio" });
    if (message.length > 280) {
      return res.status(400).json({ success: false, error: "El mensaje debe tener maximo 280 caracteres" });
    }

    return res.status(201).json({
      success: true,
      data: await liveRepository.createChatMessage(fixtureId, userId, message),
    });
  } catch (error) {
    return sendError(res, error);
  }
});
