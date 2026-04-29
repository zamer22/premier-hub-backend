import { createClient } from "@supabase/supabase-js";
import { Router } from "express";
import type { Request, Response } from "express";

import { footballFetch } from "./api_partidos";

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
  },
);

export const liveRouter = Router();

let liveInterval: NodeJS.Timeout | null = null;
let currentFixtureId: number | null = null;

/*
--------------------------------------------------------------------------------
types para la funcionalidad de live sync
--------------------------------------------------------------------------------
*/
type StandardResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  fixtureId?: number | null;
  running?: boolean;
};

type FixtureParams = {
  fixtureId: string;
};

type MatchIdParams = {
  id: string;
};

type LineupInsertRow = {
  fixture_id: number;
  team: "home" | "away";
  player_number: number | null;
  player_name: string;
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

type FootballFixtureResponse = {
  response?: Array<{
    fixture?: {
      id?: number;
      status?: {
        elapsed?: number | null;
        long?: string | null;
      };
      venue?: {
        name?: string | null;
      };
    };
    league?: {
      name?: string | null;
    };
    teams?: {
      home?: {
        id?: number | null;
        name?: string | null;
        logo?: string | null;
      };
      away?: {
        id?: number | null;
        name?: string | null;
        logo?: string | null;
      };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
  }>;
};

type FootballLineupsResponse = {
  response?: Array<{
    team?: {
      id?: number | null;
    };
    startXI?: Array<{
      player?: {
        number?: number | null;
        name?: string | null;
      };
    }>;
    substitutes?: Array<{
      player?: {
        number?: number | null;
        name?: string | null;
      };
    }>;
  }>;
};

type FootballStatisticsResponse = {
  response?: Array<{
    statistics?: Array<{
      type?: string | null;
      value?: string | number | null;
    }>;
  }>;
};

type FootballH2HResponse = {
  response?: Array<{
    fixture?: {
      id?: number | null;
      date?: string | null;
    };
    league?: {
      name?: string | null;
    };
    teams?: {
      home?: {
        id?: number | null;
        name?: string | null;
        logo?: string | null;
      };
      away?: {
        id?: number | null;
        name?: string | null;
        logo?: string | null;
      };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
  }>;
};

type LiveH2HRow = {
  related_fixture_id: number | null;
  match_date: string | null;
  league: string | null;
  home_team_id: number | null;
  home_name: string | null;
  home_logo: string | null;
  home_goals: number | null;
  away_team_id: number | null;
  away_name: string | null;
  away_logo: string | null;
  away_goals: number | null;
};

/*
--------------------------------------------------------------------------------
función para obtener el mensaje de error
--------------------------------------------------------------------------------


function getErrorMessage
Returns:
- string - El mensaje de error extraído del objeto de error, o un mensaje genérico si el error no es una instancia de Error.
Descripción:
Esta función toma un objeto de error de tipo desconocido y verifica si es una instancia de la clase Error.
Si lo es, devuelve el mensaje de error contenido en la propiedad 'message'. Si no es una instancia de Error,
devuelve un mensaje genérico indicando que ocurrió un error interno del servidor.
*/
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error interno del servidor";
}

/*
function parseFixtureId
Returns:
- number - El fixtureId convertido a número si es válido.
- Lanza un error si el fixtureId no es un número válido.
Descripción:
Esta función toma un valor de tipo string que representa el fixtureId, intenta convertirlo a un número y verifica si es válido.
*/
function parseFixtureId(value: string): number {
  const fixtureId = Number(value);

  if (!fixtureId || Number.isNaN(fixtureId)) {
    throw new Error("fixtureId inválido");
  }

  return fixtureId;
}

/*
function syncFixtureById
Parámetros:
- fixtureId: number - El ID del fixture que se desea sincronizar.
Returns:
- Promise<{ success: true; fixtureId: number; message: string }> - Un objeto que indica que la sincronización fue exitosa, junto con el fixtureId y un mensaje.
Descripción:
Esta función realiza la sincronización de un partido específico identificado por fixtureId.
Primero, obtiene los datos del fixture desde la API-FOOTBALL utilizando la función footballFetch.
Luego, guarda o actualiza la información del partido en la tabla 'live_matches' de Supabase.
*/
async function syncFixtureById(
  fixtureId: number,
): Promise<{ success: true; fixtureId: number; message: string }> {
  const fixtureJson = await footballFetch<FootballFixtureResponse["response"]>(
    "/fixtures",
    { id: fixtureId },
  );

  const fixture = fixtureJson.response?.[0];

  if (!fixture) {
    throw new Error(`No se encontró el fixture ${fixtureId}`);
  }

  const homeTeamId = fixture.teams?.home?.id ?? null;
  const awayTeamId = fixture.teams?.away?.id ?? null;

  if (!homeTeamId || !awayTeamId) {
    throw new Error(
      `No se pudieron obtener los equipos del fixture ${fixtureId}`,
    );
  }

  const { error: matchError } = await supabase.from("live_matches").upsert({
    id: fixture.fixture?.id ?? fixtureId,
    league: fixture.league?.name ?? "",
    minute: fixture.fixture?.status?.elapsed
      ? `${fixture.fixture.status.elapsed}'`
      : "0'",
    stadium: fixture.fixture?.venue?.name ?? "",
    status: fixture.fixture?.status?.long ?? "",
    home_name: fixture.teams?.home?.name ?? "",
    home_logo: fixture.teams?.home?.logo ?? "",
    home_score: fixture.goals?.home ?? 0,
    away_name: fixture.teams?.away?.name ?? "",
    away_logo: fixture.teams?.away?.logo ?? "",
    away_score: fixture.goals?.away ?? 0,
    updated_at: new Date().toISOString(),
  });

  if (matchError) {
    throw new Error(`Error guardando live_matches: ${matchError.message}`);
  }

  const lineupsJson = await footballFetch<FootballLineupsResponse["response"]>(
    "/fixtures/lineups",
    { fixture: fixtureId },
  );

  const lineups = lineupsJson.response || [];

  const { error: deleteLineupsError } = await supabase
    .from("live_lineups")
    .delete()
    .eq("fixture_id", fixtureId);

  if (deleteLineupsError) {
    throw new Error(
      `Error borrando live_lineups: ${deleteLineupsError.message}`,
    );
  }

  if (lineups.length >= 2) {
    const apiHomeTeamId = lineups[0].team?.id ?? null;
    const lineupRows: LineupInsertRow[] = [];

    for (const teamLineup of lineups) {
      const side: "home" | "away" =
        teamLineup.team?.id === apiHomeTeamId ? "home" : "away";

      for (const player of teamLineup.startXI ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: player.player?.number ?? null,
          player_name: player.player?.name ?? "",
          is_sub: false,
        });
      }

      for (const player of teamLineup.substitutes ?? []) {
        lineupRows.push({
          fixture_id: fixtureId,
          team: side,
          player_number: player.player?.number ?? null,
          player_name: player.player?.name ?? "",
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

  const statsJson = await footballFetch<FootballStatisticsResponse["response"]>(
    "/fixtures/statistics",
    { fixture: fixtureId },
  );

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

    for (const stat of stats[0]?.statistics ?? []) {
      const label = stat.type ?? "";
      if (label) {
        homeStats[label] = String(stat.value ?? "0");
      }
    }

    for (const stat of stats[1]?.statistics ?? []) {
      const label = stat.type ?? "";
      if (label) {
        awayStats[label] = String(stat.value ?? "0");
      }
    }

    const labels = Array.from(
      new Set([...Object.keys(homeStats), ...Object.keys(awayStats)]),
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

  const h2hJson = await footballFetch<FootballH2HResponse["response"]>(
    "/fixtures/headtohead",
    {
      h2h: `${homeTeamId}-${awayTeamId}`,
      last: 5,
    },
  );

  const h2hMatches = h2hJson.response || [];

  const { error: deleteH2HError } = await supabase
    .from("live_h2h")
    .delete()
    .eq("fixture_id", fixtureId);

  if (deleteH2HError) {
    throw new Error(`Error borrando live_h2h: ${deleteH2HError.message}`);
  }

  if (h2hMatches.length > 0) {
    const h2hRows: H2HInsertRow[] = h2hMatches.map((item) => ({
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

/*
function startFixtureAutoSync
Parámetros:
- fixtureId: number - El ID del fixture que se desea sincronizar automáticamente.
- intervalMs: number - El intervalo en milisegundos para realizar la sincronización (por defecto 60 segundos).
Descripción:
Esta función inicia un proceso de sincronización automática para un fixture específico.
Si ya hay un proceso de sincronización en curso, lo detiene antes de iniciar uno nuevo.
Realiza una sincronización inmediata al llamar a syncFixtureById, y luego establece un intervalo para repetir la sincronización cada intervalMs milisegundos.
*/
export function startFixtureAutoSync(
  fixtureId: number,
  intervalMs = 60_000,
): void {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = fixtureId;

  syncFixtureById(fixtureId)
    .then(() => {
      console.log(`[liveSync] Primer sync listo para fixture ${fixtureId}`);
    })
    .catch((error: unknown) => {
      console.error(
        `[liveSync] Error en primer sync ${fixtureId}: ${getErrorMessage(error)}`,
      );
    });

  liveInterval = setInterval(async () => {
    try {
      await syncFixtureById(fixtureId);
      console.log(`[liveSync] Sync automático OK para fixture ${fixtureId}`);
    } catch (error: unknown) {
      console.error(
        `[liveSync] Error en sync automático ${fixtureId}: ${getErrorMessage(error)}`,
      );
    }
  }, intervalMs);

  console.log(
    `[liveSync] Auto-sync iniciado para fixture ${fixtureId} cada ${intervalMs / 1000}s`,
  );
}

/*
function stopFixtureAutoSync
Descripción:
Esta función detiene el proceso de sincronización automática de partidos.
Si hay un intervalo activo, lo limpia y establece liveInterval a null. También resetea currentFixtureId a null.
*/
export function stopFixtureAutoSync(): void {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }

  currentFixtureId = null;
  console.log("[liveSync] Auto-sync detenido");
}

/*
--------------------------------------------------------------------------------
Rutas de live sync
--------------------------------------------------------------------------------


Ruta POST /partidos/live/sync/:fixtureId
Returns:
- 200 OK con {success: true, fixtureId: number, message: string} si la sincronización fue exitosa.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si el fixtureId no es válido.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error durante la sincronización.
Descripción:
Esta ruta permite sincronizar manualmente un partido específico identificado por fixtureId. 
Valida el fixtureId, llama a la función syncFixtureById para realizar la sincronización y devuelve el resultado.
*/
liveRouter.post(
  "/partidos/live/sync/:fixtureId",
  async (req: Request<FixtureParams>, res: Response<StandardResponse>) => {
    try {
      const fixtureId = parseFixtureId(req.params.fixtureId);
      const result = await syncFixtureById(fixtureId);
      res.json(result);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = message === "fixtureId inválido" ? 400 : 500;

      res.status(status).json({
        success: false,
        error: message,
      });
    }
  },
);

/*
Ruta POST /partidos/live/start/:fixtureId
Returns:
- 200 OK con {success: true, fixtureId: number, message: string} si el auto-sync fue iniciado exitosamente.
- 400 Bad Request con {success: false, error: 'mensaje de error'} si el fixtureId no es válido.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al iniciar el auto-sync.
Descripción:
Esta ruta inicia un proceso de sincronización automática para un partido específico identificado por fixtureId.
*/
liveRouter.post(
  "/partidos/live/start/:fixtureId",
  async (req: Request<FixtureParams>, res: Response<StandardResponse>) => {
    try {
      const fixtureId = parseFixtureId(req.params.fixtureId);

      startFixtureAutoSync(fixtureId, 60_000);

      res.json({
        success: true,
        fixtureId,
        message: "Auto-sync iniciado cada 60 segundos",
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const status = message === "fixtureId inválido" ? 400 : 500;

      res.status(status).json({
        success: false,
        error: message,
      });
    }
  },
);

/*
Ruta POST /partidos/live/stop
Returns:
- 200 OK con {success: true, message: string} si el auto-sync fue detenido exitosamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al detener el auto-sync.
Descripción:
Esta ruta detiene el proceso de sincronización automática de partidos.
*/
liveRouter.post(
  "/partidos/live/stop",
  async (_req: Request, res: Response<StandardResponse>) => {
    try {
      stopFixtureAutoSync();

      res.json({
        success: true,
        message: "Auto-sync detenido",
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/*
Ruta GET /partidos/live/autosync/status
Returns:
- 200 OK con {success: true, running: boolean, fixtureId: number} si se obtiene el estado del auto-sync correctamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener el estado del auto-sync.
Descripción:
Esta ruta permite obtener el estado actual del proceso de sincronización automática de partidos.
*/
liveRouter.get(
  "/partidos/live/autosync/status",
  async (_req: Request, res: Response<StandardResponse>) => {
    res.json({
      success: true,
      running: Boolean(liveInterval),
      fixtureId: currentFixtureId,
    });
  },
);

/*
Ruta GET /partidos/live
Returns:
- 200 OK con {success: true, data: Array<LiveMatchRow>} si se obtienen los partidos en vivo correctamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los partidos en vivo.
Descripción:
Esta ruta permite obtener la lista de partidos en vivo.
*/
liveRouter.get(
  "/partidos/live",
  async (_req: Request, res: Response<StandardResponse>) => {
    try {
      const { data, error } = await supabase
        .from("live_matches")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/*
Ruta GET /partidos/live/:id/lineups
Returns:
- 200 OK con {success: true, data: Array<LiveLineupRow>} si se obtienen las alineaciones del partido correctamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener las alineaciones.
Descripción:
Esta ruta permite obtener la lista de jugadores para un partido en vivo específico.
*/
liveRouter.get(
  "/partidos/live/:id/lineups",
  async (req: Request<MatchIdParams>, res: Response<StandardResponse>) => {
    try {
      const { data, error } = await supabase
        .from("live_lineups")
        .select("*")
        .eq("fixture_id", req.params.id)
        .order("is_sub", { ascending: true })
        .order("player_number", { ascending: true });

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/*
Ruta GET /partidos/live/:id/stats
Returns:
- 200 OK con {success: true, data: Array<LiveStatsRow>} si se obtienen las estadísticas del partido correctamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener las estadísticas.
Descripción:
Esta ruta permite obtener las estadísticas para un partido en vivo específico.
*/
liveRouter.get(
  "/partidos/live/:id/stats",
  async (req: Request<MatchIdParams>, res: Response<StandardResponse>) => {
    try {
      const { data, error } = await supabase
        .from("live_stats")
        .select("*")
        .eq("fixture_id", req.params.id);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

/*
Ruta GET /partidos/live/:id/h2h
Returns:
- 200 OK con {success: true, data: Array<LiveH2HRow>} si se obtienen los enfrentamientos entre equipos correctamente.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los enfrentamientos.
Descripción:
Esta ruta permite obtener la lista de enfrentamientos entre equipos para un partido en vivo específico.
*/
liveRouter.get(
  "/partidos/live/:id/h2h",
  async (req: Request<MatchIdParams>, res: Response<StandardResponse>) => {
    try {
      const { data, error } = await supabase
        .from("live_h2h")
        .select("*")
        .eq("fixture_id", req.params.id)
        .order("match_date", { ascending: false });

      if (error) {
        throw error;
      }

      const mapped = ((data || []) as LiveH2HRow[]).map((row) => ({
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

      res.json({
        success: true,
        data: mapped,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);
