import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

const FOOTBALL_API_BASE_URL = "https://v3.football.api-sports.io";
const PREMIER_LEAGUE_ID = 39;
const CURRENT_SEASON = 2025;

/*
--------------------------------------------------------------------------------
types para las respuestas de la API-FOOTBALL
--------------------------------------------------------------------------------
*/
type ApiSportsFixtureResponse = {
  response?: unknown[];
  errors?: unknown;
};

type ApiSportsStandingsResponse = {
  response?: Array<{
    league?: {
      standings?: unknown[][];
    };
  }>;
  errors?: unknown;
};

type ApiSportsTeamsResponse = {
  response?: Array<{
    team?: {
      name?: unknown;
    };
  }>;
  errors?: unknown;
};

/*
--------------------------------------------------------------------------------
Funciones auxiliares
--------------------------------------------------------------------------------


function getApiSportsHeaders
Returns:
- Record<string, string> - Un objeto con los encabezados necesarios para autenticar las solicitudes a la API-FOOTBALL, 
incluyendo la clave de API obtenida de las variables de entorno.
Descripción:
Esta función construye y retorna un objeto con los encabezados HTTP necesarios para realizar solicitudes a la API-FOOTBALL. 
Incluye la clave de API que se espera esté almacenada en las variables de entorno bajo el nombre 'APIFOOTBALL_KEY'. 
Si la clave no está presente, el código lanzará un error en tiempo de ejecución debido al uso del operador de aserción no nula (!).
*/
function getApiSportsHeaders(): Record<string, string> {
  return {
    "x-apisports-key": process.env.APIFOOTBALL_KEY!,
  };
}

/*
function fetchApiSportsJson
Parámetros:
- url: string - La URL completa a la que se realizará la solicitud GET, incluyendo los parámetros de consulta necesarios.
Returns:
- Promise<T> - Una promesa que se resuelve con el resultado parseado como JSON de la respuesta de la API-FOOTBALL, tipado como T.
Descripción:
Esta función realiza una solicitud HTTP GET a la URL especificada utilizando la función fetch, 
incluyendo los encabezados de autenticación necesarios para la API-FOOTBALL. 
Si la respuesta no es exitosa (status code fuera del rango 200-299), lanza un error con un mensaje que incluye el código de estado. 
Si la respuesta es exitosa, parsea el cuerpo de la respuesta como JSON y lo retorna tipado como T.
*/
async function fetchApiSportsJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: getApiSportsHeaders(),
  });

  if (!response.ok) {
    throw new Error(`API-FOOTBALL respondió con status ${response.status}`);
  }

  return (await response.json()) as T;
}

/*
function getErrorMessage
Parámetros:
- error: unknown - El error capturado, que puede ser de cualquier tipo.
Returns:
- string - El mensaje de error extraído del objeto de error si es una instancia de Error, o un mensaje genérico si no lo es.
Descripción:
Esta función toma un error de tipo desconocido y verifica si es una instancia de la clase Error.
*/
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error interno del servidor";
}

/*
---------------------------------------------------------------------------------
Rutas de partidos
---------------------------------------------------------------------------------


Ruta GET /proximos
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los próximos partidos de la Premier League.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los partidos.
Descripción:
Esta ruta devuelve los próximos partidos de la Premier League utilizando la API-FOOTBALL.
*/
router.get("/proximos", async (_req: Request, res: Response) => {
  try {
    const url =
      `${FOOTBALL_API_BASE_URL}/fixtures` +
      `?league=${PREMIER_LEAGUE_ID}` +
      `&season=${CURRENT_SEASON}` +
      "&next=10";

    const json = await fetchApiSportsJson<ApiSportsFixtureResponse>(url);

    res.json({
      success: true,
      data: json.response || [],
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/*
Ruta GET /resultados
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los últimos partidos de la Premier League con sus resultados.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los partidos.
Descripción:
Esta ruta devuelve los últimos partidos de la Premier League con sus resultados utilizando la API-FOOTBALL.
*/
router.get("/resultados", async (_req: Request, res: Response) => {
  try {
    const url =
      `${FOOTBALL_API_BASE_URL}/fixtures` +
      `?league=${PREMIER_LEAGUE_ID}` +
      `&season=${CURRENT_SEASON}` +
      "&last=10";

    const json = await fetchApiSportsJson<ApiSportsFixtureResponse>(url);

    res.json({
      success: true,
      data: json.response || [],
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/*
Ruta GET /standings
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de las clasificaciones de la Premier League.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener las clasificaciones.
Descripción:
Esta ruta devuelve las clasificaciones de la Premier League utilizando la API-FOOTBALL.
*/
router.get("/standings", async (_req: Request, res: Response) => {
  try {
    const url =
      `${FOOTBALL_API_BASE_URL}/standings` +
      `?league=${PREMIER_LEAGUE_ID}` +
      `&season=${CURRENT_SEASON}`;

    const json = await fetchApiSportsJson<ApiSportsStandingsResponse>(url);
    const standings = json.response?.[0]?.league?.standings?.[0] || [];

    res.json({
      success: true,
      data: standings,
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/* 
Ruta GET /equipos
Returns:
- 200 OK con {success: true, data: [...] } donde data es un array de los nombres de los equipos de la Premier League.
- 500 Internal Server Error con {success: false, error: 'mensaje de error'} si ocurre un error al obtener los equipos.
Descripción:
Esta ruta devuelve los nombres de los equipos de la Premier League utilizando la API-FOOTBALL.
*/
router.get("/equipos", async (_req: Request, res: Response) => {
  try {
    const url =
      `${FOOTBALL_API_BASE_URL}/teams` +
      `?league=${PREMIER_LEAGUE_ID}` +
      `&season=${CURRENT_SEASON}`;

    const json = await fetchApiSportsJson<ApiSportsTeamsResponse>(url);

    const teamNames = (json.response || [])
      .map((item) => item.team?.name)
      .filter(
        (name): name is string => typeof name === "string" && Boolean(name),
      );

    res.json({
      success: true,
      data: teamNames,
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

export { router as partidosRouter };
