import { Router } from "express";
import type { Request, Response } from "express";

const FOOTBALL_API_BASE_URL =
  process.env.APIFOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
export const PREMIER_LEAGUE_ID = Number(process.env.APIFOOTBALL_LEAGUE_ID) || 39;
export const CURRENT_SEASON = Number(process.env.APIFOOTBALL_SEASON) || 2025;

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

const router = Router();

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