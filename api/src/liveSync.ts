import { createClient } from "@supabase/supabase-js";
import { Router } from "express";
import { footballFetch } from "./apifootball";

if (!process.env.SUPABASE_URL) {
  throw new Error("Falta SUPABASE_URL en el archivo .env");
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Falta SUPABASE_SERVICE_KEY en el archivo .env");
}

// Cliente Supabase apuntando al schema premier
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

// ----------------------------------------------------
// Función principal para sincronizar un fixture por ID
// ----------------------------------------------------
async function syncFixtureById(fixtureId: number) {
  // 1) Traer partido principal
  const fixtureJson = await footballFetch<any[]>("/fixtures", {
    id: fixtureId,
  });

  const f = fixtureJson.response?.[0];

  if (!f) {
    throw new Error(`No se encontró el fixture ${fixtureId}`);
  }

  // Guardar partido principal
  const { error: matchError } = await supabase
    .from("live_matches")
    .upsert({
      id: f.fixture.id,
      league: f.league.name,
      minute: f.fixture.status.elapsed ? `${f.fixture.status.elapsed}'` : "0'",
      stadium: f.fixture.venue?.name ?? "",
      status: f.fixture.status.long,
      home_name: f.teams.home.name,
      home_logo: f.teams.home.logo,
      home_score: f.goals.home ?? 0,
      away_name: f.teams.away.name,
      away_logo: f.teams.away.logo,
      away_score: f.goals.away ?? 0,
      updated_at: new Date().toISOString(),
    });

  if (matchError) {
    throw new Error(`Error guardando live_matches: ${matchError.message}`);
  }

  // 2) Traer lineups
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
    const homeTeamId = lineups[0].team.id;
    const lineupRows: {
      fixture_id: number;
      team: string;
      player_number: number | null;
      player_name: string;
      is_sub: boolean;
    }[] = [];

    for (const teamLineup of lineups) {
      const side = teamLineup.team.id === homeTeamId ? "home" : "away";

      for (const p of teamLineup.startXI ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: p.player.number ?? null,
          player_name: p.player.name,
          is_sub: false,
        });
      }

      for (const p of teamLineup.substitutes ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: p.player.number ?? null,
          player_name: p.player.name,
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

  // 3) Traer estadísticas
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

    const statRows = labels.map((label) => ({
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

  return {
    success: true,
    fixtureId,
    message: "Partido sincronizado correctamente",
  };
}

// ----------------------------------------------------
// Auto-sync
// ----------------------------------------------------
export function startFixtureAutoSync(fixtureId: number, intervalMs = 60_000) {  if (liveInterval) {
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
      console.log(`[liveSync] Sync automático OK para fixture ${fixtureId}`);
    } catch (err: any) {
      console.error(`[liveSync] Error en sync automático ${fixtureId}: ${err.message}`);
    }
  }, intervalMs);

  console.log(
    `[liveSync] Auto-sync iniciado para fixture ${fixtureId} cada ${intervalMs / 1000}s`
  );
}

export function stopFixtureAutoSync() {  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = null;
  console.log("[liveSync] Auto-sync detenido");
}

// ----------------------------------------------------
// POST manual para sincronizar un partido una sola vez
// ----------------------------------------------------
liveRouter.post("/partidos/live/sync/:fixtureId", async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({
        success: false,
        error: "fixtureId inválido",
      });
    }

    const result = await syncFixtureById(fixtureId);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// ----------------------------------------------------
// POST para iniciar auto-sync
// ----------------------------------------------------
liveRouter.post("/partidos/live/start/:fixtureId", async (req, res) => {
  try {
    const fixtureId = Number(req.params.fixtureId);

    if (!fixtureId || Number.isNaN(fixtureId)) {
      return res.status(400).json({
        success: false,
        error: "fixtureId inválido",
      });
    }

    startFixtureAutoSync(fixtureId, 60_000);

    return res.json({
      success: true,
      fixtureId,
      message: "Auto-sync iniciado cada 60 segundos",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// ----------------------------------------------------
// POST para detener auto-sync
// ----------------------------------------------------
liveRouter.post("/partidos/live/stop", async (_req, res) => {
  try {
    stopFixtureAutoSync();

    return res.json({
      success: true,
      message: "Auto-sync detenido",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

// ----------------------------------------------------
// GET estado del auto-sync
// ----------------------------------------------------
liveRouter.get("/partidos/live/autosync/status", async (_req, res) => {
  return res.json({
    success: true,
    running: !!liveInterval,
    fixtureId: currentFixtureId,
  });
});

// ----------------------------------------------------
// GET partidos guardados
// ----------------------------------------------------
liveRouter.get("/partidos/live", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("live_matches")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// GET lineups de un partido
// ----------------------------------------------------
liveRouter.get("/partidos/live/:id/lineups", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("live_lineups")
      .select("*")
      .eq("fixture_id", req.params.id)
      .order("is_sub", { ascending: true })
      .order("player_number", { ascending: true });

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// GET stats de un partido
// ----------------------------------------------------
liveRouter.get("/partidos/live/:id/stats", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("live_stats")
      .select("*")
      .eq("fixture_id", req.params.id);

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});