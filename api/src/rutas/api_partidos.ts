import { Router } from "express";
import type { Request, Response } from "express";

const FOOTBALL_API_BASE_URL =
  process.env.APIFOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
export const PREMIER_LEAGUE_ID = Number(process.env.APIFOOTBALL_LEAGUE_ID) || 39;
export const CURRENT_SEASON = Number(process.env.APIFOOTBALL_SEASON) || 2025;

const FINISHED_API_FOOTBALL_STATUSES = "FT-AET-PEN";

type ApiFootballErrorMap = Record<string, unknown>;

type FootballApiResponse<T = unknown> = {
  response?: T;
  message?: string;
  errors?: ApiFootballErrorMap;
};

type FixtureResponse = unknown[];

type StandingsResponse = Array<{
  league?: {
    standings?: unknown[][];
  };
}>;

type TeamsResponse = Array<{
  team?: {
    id?: number;
    name?: string;
    logo?: string;
    code?: string;
    country?: string;
    founded?: number;
  };
  venue?: {
    name?: string;
  };
}>;

type StandardApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

type EquiposQuery = {
  detalle?: string;
};

type ApiFootballTeam = {
  id?: number;
  name?: string;
  logo?: string;
};

type ApiFootballFixture = {
  fixture?: {
    id?: number;
    date?: string;
    venue?: { name?: string };
  };
  league?: {
    name?: string;
    round?: string;
  };
  teams?: {
    home?: ApiFootballTeam;
    away?: ApiFootballTeam;
  };
  goals?: {
    home?: number | null;
    away?: number | null;
  };
  score?: {
    fulltime?: {
      home?: number | null;
      away?: number | null;
    };
  };
};

type ApiFootballEvent = {
  time?: { elapsed?: number; extra?: number | null };
  team?: ApiFootballTeam;
  player?: { name?: string };
  assist?: { name?: string | null };
  type?: string;
  detail?: string;
  comments?: string | null;
};

type ApiFootballStatistic = {
  type?: string;
  value?: string | number | null;
};

type ApiFootballStatisticTeam = {
  team?: ApiFootballTeam;
  statistics?: ApiFootballStatistic[];
};

type ApiFootballLineupPlayer = {
  player?: {
    name?: string;
    number?: number | null;
  };
};

type ApiFootballLineupTeam = {
  team?: ApiFootballTeam;
  startXI?: ApiFootballLineupPlayer[];
  substitutes?: ApiFootballLineupPlayer[];
};

function getApiFootballHeaders(): Record<string, string> {
  if (!process.env.APIFOOTBALL_KEY) {
    throw new Error("Falta APIFOOTBALL_KEY en el archivo .env");
  }

  return {
    "x-apisports-key": process.env.APIFOOTBALL_KEY,
  };
}

function hasApiErrors(errors: ApiFootballErrorMap | undefined): boolean {
  return Boolean(errors && Object.keys(errors).length > 0);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error interno del servidor";
}

function apiFootballValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function apiFootballScore(
  goalsValue: number | null | undefined,
  fulltimeValue: number | null | undefined,
): number {
  return goalsValue ?? fulltimeValue ?? 0;
}

function normalizeApiFootballFixture(item: ApiFootballFixture) {
  const id = item.fixture?.id;
  const home = item.teams?.home;
  const away = item.teams?.away;

  if (!id || !home?.name || !away?.name) return null;

  return {
    id,
    date: item.fixture?.date || "",
    league: item.league?.name || "",
    stadium: item.fixture?.venue?.name || "Estadio no disponible",
    round: item.league?.round || "",
    homeTeam: {
      id: home.id,
      name: home.name,
      logo: home.logo || "",
      score: apiFootballScore(item.goals?.home, item.score?.fulltime?.home),
    },
    awayTeam: {
      id: away.id,
      name: away.name,
      logo: away.logo || "",
      score: apiFootballScore(item.goals?.away, item.score?.fulltime?.away),
    },
  };
}

function parseApiFootballFixtureId(
  req: Request<{ id: string }>,
  res: Response<StandardApiResponse>,
): number | null {
  const fixtureId = Number(req.params.id);

  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    res.status(400).json({ success: false, error: "ID de partido inválido." });
    return null;
  }

  return fixtureId;
}

function apiFootballTeamSide(
  teamId: number | undefined,
  homeId: number | undefined,
  awayId: number | undefined,
) {
  if (teamId && teamId === homeId) return "home";
  if (teamId && teamId === awayId) return "away";
  return null;
}

export async function footballFetch<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<FootballApiResponse<T>> {
  const url = new URL(path, FOOTBALL_API_BASE_URL);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: getApiFootballHeaders(),
    signal: AbortSignal.timeout(12_000),
  });

  const data = (await response.json()) as FootballApiResponse<T>;

  if (!response.ok) {
    throw new Error(data.message || `Error en API-Football: ${response.status}`);
  }

  if (hasApiErrors(data.errors)) {
    throw new Error(`Error en API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

async function getFixtures(type: "next" | "last", amount = 10): Promise<FixtureResponse> {
  const json = await footballFetch<FixtureResponse>("/fixtures", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
    [type]: amount,
  });

  return json.response || [];
}

async function getStandings(): Promise<unknown[]> {
  const json = await footballFetch<StandingsResponse>("/standings", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
  });

  return json.response?.[0]?.league?.standings?.[0] || [];
}

async function getTeams(): Promise<TeamsResponse> {
  const json = await footballFetch<TeamsResponse>("/teams", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
  });

  return json.response || [];
}

async function getApiFootballFixtureSides(fixtureId: number) {
  const json = await footballFetch<ApiFootballFixture[]>("/fixtures", { id: fixtureId });
  const fixture = json.response?.[0];

  return {
    homeId: fixture?.teams?.home?.id,
    awayId: fixture?.teams?.away?.id,
  };
}

async function getApiFootballPastMatches() {
  const json = await footballFetch<ApiFootballFixture[]>("/fixtures", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
    status: FINISHED_API_FOOTBALL_STATUSES,
  });

  return (json.response || [])
    .map(normalizeApiFootballFixture)
    .filter((match): match is NonNullable<ReturnType<typeof normalizeApiFootballFixture>> => Boolean(match))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function getApiFootballMatchEvents(fixtureId: number) {
  const json = await footballFetch<ApiFootballEvent[]>("/fixtures/events", { fixture: fixtureId });

  return (json.response || []).map((event) => ({
    minute: event.time?.elapsed ?? 0,
    extra: event.time?.extra ?? null,
    team: {
      id: event.team?.id ?? 0,
      name: event.team?.name ?? "",
      logo: event.team?.logo ?? "",
    },
    player: event.player?.name ?? "",
    assist: event.assist?.name ?? null,
    type: event.type ?? "",
    detail: event.detail ?? "",
    comments: event.comments ?? null,
  }));
}

async function getApiFootballMatchStats(fixtureId: number) {
  const [{ homeId, awayId }, json] = await Promise.all([
    getApiFootballFixtureSides(fixtureId),
    footballFetch<ApiFootballStatisticTeam[]>("/fixtures/statistics", { fixture: fixtureId }),
  ]);

  const teams = json.response || [];
  const homeStats =
    teams.find((item) => apiFootballTeamSide(item.team?.id, homeId, awayId) === "home")?.statistics ||
    teams[0]?.statistics ||
    [];
  const awayStats =
    teams.find((item) => apiFootballTeamSide(item.team?.id, homeId, awayId) === "away")?.statistics ||
    teams[1]?.statistics ||
    [];

  const labels = new Set(
    [...homeStats, ...awayStats]
      .map((stat) => stat.type)
      .filter((label): label is string => typeof label === "string" && Boolean(label)),
  );

  return Array.from(labels).map((label) => ({
    label,
    home_value: apiFootballValue(homeStats.find((stat) => stat.type === label)?.value),
    away_value: apiFootballValue(awayStats.find((stat) => stat.type === label)?.value),
  }));
}

async function getApiFootballMatchLineups(fixtureId: number) {
  const [{ homeId, awayId }, json] = await Promise.all([
    getApiFootballFixtureSides(fixtureId),
    footballFetch<ApiFootballLineupTeam[]>("/fixtures/lineups", { fixture: fixtureId }),
  ]);

  return (json.response || []).flatMap((lineup, index) => {
    const detectedSide = apiFootballTeamSide(lineup.team?.id, homeId, awayId);
    const team = detectedSide || (index === 0 ? "home" : "away");

    const starters = (lineup.startXI || []).map((item) => ({
      player_number: item.player?.number ?? null,
      player_name: item.player?.name ?? "",
      is_sub: false,
      team,
    }));

    const substitutes = (lineup.substitutes || []).map((item) => ({
      player_number: item.player?.number ?? null,
      player_name: item.player?.name ?? "",
      is_sub: true,
      team,
    }));

    return [...starters, ...substitutes];
  });
}

const router = Router();

router.get(
  "/partidos/api-football/pasados",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      res.json({
        success: true,
        data: await getApiFootballPastMatches(),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/api-football/historial/:id/eventos",
  async (req: Request<{ id: string }>, res: Response<StandardApiResponse>) => {
    const fixtureId = parseApiFootballFixtureId(req, res);
    if (!fixtureId) return;

    try {
      res.json({
        success: true,
        data: await getApiFootballMatchEvents(fixtureId),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/api-football/historial/:id/stats",
  async (req: Request<{ id: string }>, res: Response<StandardApiResponse>) => {
    const fixtureId = parseApiFootballFixtureId(req, res);
    if (!fixtureId) return;

    try {
      res.json({
        success: true,
        data: await getApiFootballMatchStats(fixtureId),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/api-football/historial/:id/lineups",
  async (req: Request<{ id: string }>, res: Response<StandardApiResponse>) => {
    const fixtureId = parseApiFootballFixtureId(req, res);
    if (!fixtureId) return;

    try {
      res.json({
        success: true,
        data: await getApiFootballMatchLineups(fixtureId),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/proximos",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      res.json({
        success: true,
        data: await getFixtures("next", 10),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/resultados",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      res.json({
        success: true,
        data: await getFixtures("last", 10),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/standings",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      res.json({
        success: true,
        data: await getStandings(),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

router.get(
  "/partidos/equipos",
  async (req: Request<{}, {}, {}, EquiposQuery>, res: Response<StandardApiResponse>) => {
    try {
      const teams = await getTeams();

      if (req.query.detalle === "true") {
        res.json({
          success: true,
          data: teams.map((item) => ({
            id: item.team?.id,
            name: item.team?.name,
            logo: item.team?.logo,
            code: item.team?.code,
            country: item.team?.country,
            founded: item.team?.founded,
            venue: item.venue?.name,
          })),
        });
        return;
      }

      res.json({
        success: true,
        data: teams
          .map((item) => item.team?.name)
          .filter((name): name is string => typeof name === "string" && Boolean(name)),
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },
);

export default router;
export { router as partidosRouter };