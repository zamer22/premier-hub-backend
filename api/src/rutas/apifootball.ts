import { Router } from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

const FOOTBALL_API_BASE_URL = "https://v3.football.api-sports.io";

export const PL_LEAGUE = 39;
export const PL_SEASON = 2025;

const apiFootballKey = process.env.APIFOOTBALL_KEY;

if (!apiFootballKey) {
  throw new Error("Falta la variable de entorno APIFOOTBALL_KEY");
}

const FOOTBALL_HEADERS: Record<string, string> = {
  "x-apisports-key": apiFootballKey,
};

/*
--------------------------------------------------------------------------------
types para las respuestas de la API-FOOTBALL
--------------------------------------------------------------------------------
*/
type ApiFootballErrorMap = Record<string, unknown>;

type FootballApiResponse<T = unknown> = {
  response?: T;
  message?: string;
  errors?: ApiFootballErrorMap;
};

type FixtureResponse = unknown[];
type StandingsGroup = Array<{
  league?: {
    standings?: unknown[][];
  };
}>;

type StandardApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
};

/*
--------------------------------------------------------------------------------
funciones auxiliares
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
function hasApiErrors
Parámetros:
- errors: ApiFootballErrorMap | undefined - Un objeto que representa los errores devueltos por la API-FOOTBALL, o undefined si no hay errores.
Returns:
- boolean - true si el objeto de errores no es undefined y contiene al menos una clave, o false en caso contrario.
Descripción:
Esta función verifica si el objeto de errores devuelto por la API-FOOTBALL contiene errores.
*/
function hasApiErrors(errors: ApiFootballErrorMap | undefined): boolean {
  return Boolean(errors && Object.keys(errors).length > 0);
}

/*
function footballFetch
Parámetros:
- path: string - La ruta de la API a la que se desea acceder.
- params: Record<string, string | number | undefined> - Un objeto con los parámetros de la solicitud.
Returns:
- Promise<FootballApiResponse<T>> - Una promesa que resuelve en la respuesta de la API.
Descripción:
Esta función realiza una solicitud a la API de Football y devuelve la respuesta procesada.
*/
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
    headers: FOOTBALL_HEADERS,
  });

  const data = (await response.json()) as FootballApiResponse<T>;

  if (!response.ok) {
    throw new Error(
      data.message || `Error en API-Football: ${response.status}`,
    );
  }

  if (hasApiErrors(data.errors)) {
    throw new Error(`Error en API-Football: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

/*
function getFixtures
Parámetros:
- type: "next" | "last" - Un string que indica si se desean obtener los próximos partidos ("next") o los últimos resultados ("last").
- amount: number - El número de partidos a obtener (por defecto es 10).
Returns:
- Promise<FixtureResponse> - Una promesa que resuelve en un array de partidos.
Descripción:
Esta función obtiene los partidos de la Premier League utilizando la función footballFetch para realizar la solicitud a la API-FOOTBALL.
Dependiendo del valor del parámetro 'type', se obtendrán los próximos partidos o los últimos resultados.
*/
async function getFixtures(
  type: "next" | "last",
  amount = 10,
): Promise<FixtureResponse> {
  const json = await footballFetch<FixtureResponse>("/fixtures", {
    league: PL_LEAGUE,
    season: PL_SEASON,
    [type]: amount,
  });

  return json.response || [];
}

// function getUpcomingMatches, trae los próximos partidos de la Premier League utilizando la función getFixtures con el tipo "next" y una cantidad de 10 partidos.
async function getUpcomingMatches(): Promise<FixtureResponse> {
  return getFixtures("next", 10);
}

// function getRecentResults, trae los últimos resultados de la Premier League utilizando la función getFixtures con el tipo "last" y una cantidad de 10 partidos.
async function getRecentResults(): Promise<FixtureResponse> {
  return getFixtures("last", 10);
}

/*
function getStandings
Returns:
- Promise<unknown[]> - Una promesa que resuelve en un array con la clasificación de la Premier League.
*/
async function getStandings(): Promise<unknown[]> {
  const json = await footballFetch<StandingsGroup>("/standings", {
    league: PL_LEAGUE,
    season: PL_SEASON,
  });

  return json.response?.[0]?.league?.standings?.[0] || [];
}

export const footballRouter = Router();

/*
--------------------------------------------------------------------------------
Rutas de API-FOOTBALL
--------------------------------------------------------------------------------


Ruta GET /partidos/proximos
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los próximos partidos de la Premier League.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los partidos.
Descripción:
Esta ruta devuelve los próximos partidos de la Premier League utilizando la API-FOOTBALL.
*/
footballRouter.get(
  "/partidos/proximos",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      const data = await getUpcomingMatches();

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
Ruta GET /partidos/resultados
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los últimos partidos de la Premier League con sus resultados.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los partidos.
Descripción:
Esta ruta devuelve los últimos partidos de la Premier League con sus resultados utilizando la API-FOOTBALL.
*/
footballRouter.get(
  "/partidos/resultados",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      const data = await getRecentResults();

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
Ruta GET /partidos/standings
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array con la clasificación de la Premier League.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener la clasificación.
Descripción:
Esta ruta devuelve las clasificaciones de los equipos de la Premier League utilizando la API-FOOTBALL.
*/
footballRouter.get(
  "/partidos/standings",
  async (_req: Request, res: Response<StandardApiResponse>) => {
    try {
      const data = await getStandings();

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