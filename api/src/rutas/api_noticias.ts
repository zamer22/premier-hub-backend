import { Router } from "express";
import type { Request, Response } from "express";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

import supabase from "../db";

const router = Router();

const NEWS_BASE_URL = "https://newsapi.org/v2";
const TEAM_CACHE_MS = 24 * 60 * 60 * 1000; // 24 horas
const ARTICLE_CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas
const SCRAPE_TIMEOUT_MS = 8000; // 8 segundos
const SCRAPE_CANDIDATES_LIMIT = 16; // Limite de artículos a enriquecer con scraping para mejorar el rendimiento general
const RAW_NEWS_PAGE_SIZE = 25; // Máximo permitido por NewsAPI :(
const MAX_SOURCE_PAGES = 4;
const DEFAULT_NEWS_LIMIT = 8; // Límite predeterminado de noticias por página
const MAX_NEWS_LIMIT = 12; // Límite máximo de noticias por página, 12 por no acabarme el API
const MIN_RELEVANCE_SCORE = 3; // Puntuación mínima para considerar una noticia relevante
const NEWS_CACHE_VERSION = "v2";
const NEWS_CACHE_TTL_MS = 1000 * 60 * 20; // 20 minutos
const SCRAPE_VIRTUAL_CONSOLE = new VirtualConsole(); // Evita que JSDOM imprima warnings o errores de scripts al hacer scraping de artículos

/*
-----------------------------------------------------------------------------------
Keywords, las usamos para encontrar noticias relevantes y puntuarlas para decidir cuáles mostrar. 
-----------------------------------------------------------------------------------
*/
const PREMIER_LEAGUE_KEYWORDS = [
  "premier league",
  "english premier league",
  "epl",
  "premierleague",
];

const RELEVANT_NEWS_KEYWORDS = [
  "transferencia",
  "lesion",
  "manager",
  "alineacion",
  "gol",
  "relegacion",
  "suspension",
];

const TEAM_ALIASES: Record<string, string[]> = {
  arsenal: ["gunners"],
  astonvilla: ["villa"],
  bournemouth: ["afc bournemouth", "cherries"],
  brighton: ["brighton & hove albion", "brighton and hove albion", "seagulls"],
  brentford: ["bees"],
  chelsea: ["blues"],
  crystalpalace: ["eagles"],
  everton: ["toffees"],
  fulham: ["cottagers"],
  ipswich: ["ipswich town"],
  leicester: ["leicester city", "foxes"],
  manchestercity: ["man city", "citizens"],
  manchesterunited: ["man united", "man utd", "red devils"],
  newcastle: ["newcastle united", "magpies"],
  nottinghamforest: ["forest"],
  southampton: ["saints"],
  tottenham: ["tottenham hotspur", "spurs"],
  westham: ["west ham united", "hammers"],
  wolverhamptonwanderers: ["wolves", "wolverhampton"],
};

/* 
--------------------------------------------------------------------------------
Tipos e interfaces para las noticias
--------------------------------------------------------------------------------
*/
type EquiposResponse = {
  data?: string[];
};

type NoticiaLimpia = {
  title: string | null;
  description: string | null;
  content: string | null;
  contentTruncated: boolean;
  sourceName: string | null;
  image: string | null;
  url: string | null;
  publishedAt: string | null;
};

type NoticiaTransformada = {
  id: number;
  title: string | null;
  headline: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  image: string | null;
  url: string | null;
  publishedAt: string | null;
  category: string;
  readTime: number;
  teams: string[];
  primaryTeam: string | null;
};

type ScrapedArticle = {
  title: string | null;
  excerpt: string | null;
  content: string | null;
};

type RankedArticle = {
  article: NoticiaLimpia;
  score: number;
};

type NewsApiArticle = {
  title?: unknown;
  description?: unknown;
  content?: unknown;
  source?: {
    name?: unknown;
  };
  urlToImage?: unknown;
  url?: unknown;
  publishedAt?: unknown;
};

type NewsApiResponse = {
  status?: string;
  message?: string;
  totalResults?: number;
  articles?: NewsApiArticle[];
};

type CachedArticle = {
  expiresAt: number;
  article: ScrapedArticle;
};

type NewsSnapshotPayload = {
  success: true;
  count: number;
  page: number;
  limit: number;
  hasMore: boolean;
  data: NoticiaTransformada[];
};

type CachedNewsRow = {
  payload: NewsSnapshotPayload | null;
  updated_at: string | null;
  expires_at: string | null;
};

type NewsQuery = {
  limit?: unknown;
  page?: unknown;
  offset?: unknown;
  team?: unknown;
  search?: unknown;
};

type NewsRouteOptions = {
  offset: number;
  limit: number;
  team: string | null;
  search: string | null;
};

/* 
--------------------------------------------------------------------------------
Funciones auxiliares
--------------------------------------------------------------------------------
*/
let equiposCache: string[] = [];
let lastEquiposFetchAt = 0;
const articleCache = new Map<string, CachedArticle>();
const pendingRefreshes = new Map<string, Promise<NewsSnapshotPayload>>();

/* 
function normalizeComparable: Normaliza un texto para comparaciones, eliminando acentos, caracteres especiales y convirtiendo a minúsculas.
*/
function normalizeComparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
function shortenText: Acorta un texto a una longitud máxima, intentando cortar en un espacio para no truncar palabras.
Parámetros:
- value: string - El texto a acortar.
- maxLength: number - La longitud máxima permitida para el texto acortado.
Returns:
- string - El texto acortado, con "..." al final si se recorto.
Descripción:
Esta función verifica si el texto excede la longitud máxima permitida. 
Si es así, intenta cortar el texto en el último espacio antes del límite para evitar truncar palabras. 
Si no encuentra un espacio adecuado, corta directamente en el límite. Luego agrega "..." al final para indicar que el texto ha sido truncado.
*/
function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(" ");
  const safeCut = lastSpace > maxLength * 0.6 ? lastSpace : maxLength;

  return `${sliced.slice(0, safeCut).trim()}...`;
}

/*
function normalizeReadableText: Limpia y normaliza un texto para ser mostrado, eliminando espacios extra y caracteres no imprimibles.
Parámetros:
- value: string | null | undefined - El texto a normalizar, que puede ser una cadena, null o undefined.
Returns:
- string | null - El texto normalizado, o null si el resultado es una cadena vacía o el valor original era null/undefined.
Descripción:
Esta función reemplaza los espacios en blanco no separables por espacios normales, 
colapsa múltiples espacios en uno solo y recorta los espacios al inicio y al final del texto.
*/
function normalizeReadableText(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/*
function normalizeQueryText: Normaliza un texto de consulta, eliminando espacios extra y asegurando que sea una cadena válida.
Parámetros:
- value: unknown - El valor a normalizar, que puede ser de cualquier tipo.
Returns:
- string | null - El texto normalizado, o null si el valor no es una cadena o el resultado es una cadena vacía.
Descripción:
Esta función verifica si el valor es una cadena. Si no lo es, retorna null. La diferencia con normalizeReadableText es que esta función no reemplaza los espacios no separables, 
para preservar la intención de búsqueda del usuario (por ejemplo, "manchester united" vs "manchesterunited").
*/
function normalizeQueryText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/*
function parseNumber: Función auxiliar para parsear números de parámetros de consulta, con valor por defecto.
Parámetros:
- value: string | undefined - El valor a parsear, que puede ser una cadena o undefined.
- fallback: number - El valor numérico a retornar si el parseo falla o el valor es undefined.
Returns:
- number - El valor numérico parseado, o el valor de fallback si el parseo no es exitoso.
Descripción:
Esta función intenta convertir una cadena a un número. Si el valor es undefined o no se puede convertir a un número válido, 
retorna el valor de fallback proporcionado. Se usa principalmente para parsear parámetros de consulta como "limit" o "page" que deben ser números, 
pero pueden venir como cadenas o no estar presentes.
*/
function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsedValue = Number.parseInt(`${value || ""}`, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

/*
function parseNonNegativeInteger: Similar a parsePositiveInteger pero permite cero como valor válido. 
Se usa para parámetros como "offset" que pueden ser cero o un número positivo.
*/
function parseNonNegativeInteger(value: unknown): number | null {
  const parsedValue = Number.parseInt(`${value || ""}`, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }
  return parsedValue;
}

/*
function parseLimitParam: Función específica para parsear el parámetro "limit" de la consulta, aplicando un límite máximo para evitar solicitudes excesivas.
Parámetros:
- value: unknown - El valor del parámetro "limit" a parsear, que puede ser de cualquier tipo.
Returns:
- number - El valor numérico parseado para "limit", con un valor predeterminado y un límite máximo aplicado.
Descripción:
Esta función utiliza parsePositiveInteger para convertir el valor a un número entero positivo, con un valor predeterminado de DEFAULT_NEWS_LIMIT.
Luego, aplica un límite máximo de MAX_NEWS_LIMIT para evitar que el cliente solicite demasiadas noticias en una sola petición, 
lo que podría afectar el rendimiento.
*/
function parseLimitParam(value: unknown): number {
  const parsedValue = parsePositiveInteger(value, DEFAULT_NEWS_LIMIT);
  return Math.min(parsedValue, MAX_NEWS_LIMIT);
}

/*
function quoteNewsQueryTerm: Función auxiliar para citar términos de búsqueda en la API de noticias.
Parámetros:
- value: string - El término de búsqueda a citar.
Returns:
- string - El término de búsqueda citado, o una cadena vacía si el valor no es válido.
Descripción:
Esta función elimina las comillas dobles del valor y trimea el resultado. Si el resultado es una cadena vacía, retorna una cadena vacía.
De lo contrario, si el término contiene espacios, lo envuelve en comillas dobles para preservar su integridad en la consulta.
*/
function quoteNewsQueryTerm(value: string): string {
  const cleaned = value.replace(/"/g, "").trim();

  if (!cleaned) {
    return "";
  }

  return /\s/u.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/*
function buildQueryGroup: Función auxiliar para construir grupos de términos de búsqueda en la API de noticias.
Parámetros:
- values: string[] - Un array de términos de búsqueda.
Returns:
- string | null - El grupo de términos de búsqueda construido, o null si no hay términos válidos.
Descripción:
Esta función toma un array de términos de búsqueda y los procesa para crear un grupo válido. 
Elimina los términos duplicados y vacíos, y los envuelve en comillas dobles si contienen espacios.
*/
function buildQueryGroup(values: string[]): string | null {
  const uniqueTerms = Array.from(
    new Set(values.map((value) => quoteNewsQueryTerm(value)).filter(Boolean)),
  );

  if (uniqueTerms.length === 0) {
    return null;
  }

  if (uniqueTerms.length === 1) {
    return uniqueTerms[0];
  }

  return `(${uniqueTerms.join(" OR ")})`;
}

/*
function getTeamQueryTerms: Función auxiliar para obtener los términos de búsqueda asociados a un equipo específico.
Parámetros:
- team: string - El nombre del equipo para el cual obtener términos de búsqueda.
Returns:
- string[] - Un array de términos de búsqueda asociados al equipo.
Descripción:
Esta función normaliza el nombre del equipo y obtiene sus alias, devolviendo un array con todos los términos válidos.
*/
function getTeamQueryTerms(team: string): string[] {
  const normalizedTeam = normalizeComparable(team);
  const aliases = TEAM_ALIASES[normalizedTeam] || [];
  return Array.from(new Set([team, ...aliases]));
}

/*
function buildNewsApiQuery: Función para construir la consulta API de noticias basada en las opciones proporcionadas.
Parámetros:
- options: { team: string | null; search: string | null } - Las opciones para construir la consulta.
Returns:
- string - La consulta API de noticias construida.
Descripción:
Esta función construye una consulta API de noticias combinando grupos de términos de búsqueda,
incluyendo términos específicos del equipo y términos de búsqueda generales.
*/
function buildNewsApiQuery(options: {
  team: string | null;
  search: string | null;
}): string {
  const groups = [
    buildQueryGroup([
      "Premier League",
      "English Premier League",
      "EPL",
      "football",
    ]),
  ];

  if (options.team) {
    groups.unshift(buildQueryGroup(getTeamQueryTerms(options.team)));
  }

  if (options.search) {
    groups.unshift(buildQueryGroup([options.search]));
  }

  return groups
    .filter((group): group is string => Boolean(group))
    .join(" AND ");
}

/*
function buildNewsCacheKey: Función para construir la clave de caché para la API de noticias basada en las opciones proporcionadas.
Parámetros:
- options: NewsRouteOptions - Las opciones para construir la clave de caché.
Returns:
- string - La clave de caché construida.
Descripción:
Esta función construye una clave de caché única para cada combinación de opciones proporcionadas.
*/
function buildNewsCacheKey(options: NewsRouteOptions): string {
  return [
    NEWS_CACHE_VERSION,
    `offset=${options.offset}`,
    `limit=${options.limit}`,
    `team=${normalizeComparable(options.team || "all")}`,
    `search=${normalizeComparable(options.search || "")}`,
  ].join("|");
}

/*
function buildArticleSearchText: Función para construir el texto de búsqueda para un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual construir el texto de búsqueda.
Returns:
- string - El texto de búsqueda construido.
Descripción:
Esta función normaliza los campos del artículo y los une en un solo string para facilitar la búsqueda.
*/
function buildArticleSearchText(article: NoticiaLimpia): string {
  return normalizeComparable(
    [
      article.title,
      article.description,
      article.content,
      article.sourceName,
      article.url,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/*
function matchesSearchTerms: Función para verificar si un artículo de noticias coincide con los términos de búsqueda.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual verificar la coincidencia.
- search: string | null - Los términos de búsqueda.
Returns:
- boolean - true si el artículo coincide con los términos de búsqueda, false en caso contrario.
Descripción:
Esta función verifica si el texto de búsqueda coincide con los campos del artículo.
*/
function matchesSearchTerms(
  article: NoticiaLimpia,
  search: string | null,
): boolean {
  if (!search) {
    return true;
  }

  const haystack = buildArticleSearchText(article);
  const terms = normalizeComparable(search).split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  return terms.every((term) => haystack.includes(term));
}

/*
function getTeamPatterns: Función para obtener los patrones de búsqueda para un equipo específico.
Parámetros:
- team: string - El nombre del equipo.
Returns:
- string[] - Un array de patrones de búsqueda.
Descripción:
Esta función normaliza el nombre del equipo y obtiene sus alias, devolviendo un array de strings para usar en la búsqueda.
*/
function getTeamPatterns(team: string): string[] {
  const normalizedTeam = normalizeComparable(team);
  const aliases = TEAM_ALIASES[normalizedTeam] || [];

  return Array.from(
    new Set(
      [team, normalizedTeam, ...aliases]
        .map((value) => normalizeComparable(value))
        .filter(Boolean),
    ),
  );
}

/*
function matchesTeam: Función para verificar si un texto coincide con los patrones de búsqueda para un equipo específico.
Parámetros:
- text: string - El texto para el cual verificar la coincidencia.
- team: string - El nombre del equipo.
Returns:
- boolean - true si el texto coincide con los patrones de búsqueda, false en caso contrario.
Descripción:
Esta función utiliza los patrones de búsqueda obtenidos para el equipo y verifica si alguno coincide con el texto proporcionado.
*/
function matchesTeam(text: string, team: string): boolean {
  return getTeamPatterns(team).some((pattern) => {
    const safePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${safePattern}(\\s|$)`, "i").test(text);
  });
}

/*
function matchesRequestedTeam: Función para verificar si un artículo de noticias coincide con el equipo solicitado.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual verificar la coincidencia.
- team: string | null - El nombre del equipo.
Returns:
- boolean - true si el artículo coincide con el equipo solicitado, false en caso contrario.
Descripción:
Esta función verifica si el texto de búsqueda del artículo coincide con los patrones de búsqueda para el equipo solicitado.
*/
function matchesRequestedTeam(
  article: NoticiaLimpia,
  team: string | null,
): boolean {
  if (!team) {
    return true;
  }

  return matchesTeam(buildArticleSearchText(article), team);
}

/*
function getArticleDedupKey: Función para obtener una clave única para deduplicar artículos.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual obtener la clave.
Returns:
- string - La clave única para el artículo.
Descripción:
Esta función normaliza los campos del artículo y los une para crear una clave única.
*/
function getArticleDedupKey(article: NoticiaLimpia): string {
  return normalizeComparable(
    [article.url, article.title, article.publishedAt].filter(Boolean).join(" "),
  );
}

/*
function getStableArticleId: Función para obtener un ID estable para un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual obtener el ID.
- fallbackIndex: number - El índice de reserva para generar un ID en caso de no poder obtener uno estable.
Returns:
- number - El ID estable para el artículo.
Descripción:
Esta función utiliza la clave única del artículo para generar un ID estable basado en un algoritmo de hash.
*/
function getStableArticleId(
  article: NoticiaLimpia,
  fallbackIndex: number,
): number {
  const seed = getArticleDedupKey(article) || `${fallbackIndex + 1}`;
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  const stableHash = hash >>> 0;
  return stableHash === 0 ? fallbackIndex + 1 : stableHash;
}

/*
function extractTeams: Función para extraer los equipos mencionados en un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual extraer los equipos.
- equipos: string[] - La lista de equipos para buscar.
Returns:
- string[] - La lista de equipos encontrados en el artículo.
Descripción:
Esta función normaliza el texto del artículo y verifica si contiene alguno de los nombres de los equipos.
*/
function extractTeams(article: NoticiaLimpia, equipos: string[]): string[] {
  const text = normalizeComparable(
    [article.title, article.description, article.content, article.sourceName]
      .filter(Boolean)
      .join(" "),
  );

  return equipos.filter((team) => matchesTeam(text, team));
}

/*
function buildHeadline: Función para construir el titular de un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual construir el titular.
Returns:
- string | null - El titular del artículo o null si no se puede construir.
Descripción:
Esta función toma el título del artículo y lo limpia para crear un titular adecuado.
*/
function buildHeadline(article: NoticiaLimpia): string | null {
  const base = article.title || article.description || article.content;

  if (!base) {
    return null;
  }

  const cleaned = base
    .replace(/\s+[|:-]\s+[^|:-]{2,40}$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  return shortenText(cleaned, 96);
}

/*
function buildSummary: Función para construir un resumen de un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual construir el resumen.
Returns:
- string | null - El resumen del artículo o null si no se puede construir.
Descripción:
Esta función toma la descripción o el contenido del artículo y lo limpia para crear un resumen adecuado.
*/
function buildSummary(article: NoticiaLimpia): string | null {
  const base = article.description || article.content || article.title;

  if (!base) {
    return null;
  }

  return shortenText(base, 180);
}

/*
function buildContent: Función para construir el contenido de un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual construir el contenido.
Returns:
- string | null - El contenido del artículo o null si no se puede construir.
Descripción:
Esta función toma la descripción y el contenido del artículo y los limpia para crear un contenido adecuado.
*/
function buildContent(article: NoticiaLimpia): string | null {
  const { description, content } = article;

  if (content && description) {
    const normalizedContent = normalizeComparable(content);
    const normalizedDescription = normalizeComparable(description);

    if (
      normalizedContent.includes(normalizedDescription) ||
      normalizedDescription.includes(normalizedContent)
    ) {
      return content.length >= description.length ? content : description;
    }

    return `${description} ${content}`.trim();
  }

  return content || description || null;
}

/*
function hasEnoughBody: Función para verificar si un artículo de noticias tiene suficiente contenido.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias para el cual verificar el contenido.
Returns:
- boolean - true si el artículo tiene suficiente contenido, false en caso contrario.
Descripción:
Esta función verifica si el artículo tiene suficiente contenido para ser considerado completo.
*/
function hasEnoughBody(article: NoticiaLimpia): boolean {
  if (article.contentTruncated) {
    return false;
  }

  const contentLength = article.content?.length || 0;
  const descriptionLength = article.description?.length || 0;
  const totalLength = Math.max(contentLength, descriptionLength);

  return totalLength >= 260;
}

/*
async function scrapeArticle: Función para extraer información de un artículo de noticias.
Parámetros:
- url: string - La URL del artículo de noticias a extraer.
Returns:
- Promise<ScrapedArticle> - Una promesa que resuelve en el artículo extraído.
Descripción:
Esta función extrae la información de un artículo de noticias desde una URL específica.
*/
async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  const cachedArticle = articleCache.get(url);

  if (cachedArticle && cachedArticle.expiresAt > Date.now()) {
    return cachedArticle.article;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36 PremierHubBot/1.0",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      return { title: null, excerpt: null, content: null };
    }

    const html = await response.text();
    const dom = new JSDOM(html, {
      url,
      virtualConsole: SCRAPE_VIRTUAL_CONSOLE,
    });
    const parsedArticle = new Readability(dom.window.document).parse();

    const scrapedArticle: ScrapedArticle = {
      title: normalizeReadableText(parsedArticle?.title),
      excerpt: normalizeReadableText(parsedArticle?.excerpt),
      content: normalizeReadableText(parsedArticle?.textContent),
    };

    articleCache.set(url, {
      expiresAt: Date.now() + ARTICLE_CACHE_MS,
      article: scrapedArticle,
    });

    return scrapedArticle;
  } catch {
    return { title: null, excerpt: null, content: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

/*
async function enrichArticle: Función para enriquecer un artículo de noticias con información adicional.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias a enriquecer.
Returns:
- Promise<NoticiaLimpia> - Una promesa que resuelve en el artículo enriquecido.
Descripción:
Esta función enriquece el artículo de noticias con información adicional obtenida de fuentes externas.
*/
async function enrichArticle(article: NoticiaLimpia): Promise<NoticiaLimpia> {
  if (!article.url || hasEnoughBody(article)) {
    return article;
  }

  const scrapedArticle = await scrapeArticle(article.url);

  if (!scrapedArticle.content) {
    return article;
  }

  const description = normalizeReadableText(
    article.description ||
      scrapedArticle.excerpt ||
      shortenText(scrapedArticle.content, 220),
  );

  return {
    ...article,
    title: article.title || scrapedArticle.title,
    description,
    content: scrapedArticle.content,
    contentTruncated: false,
  };
}

/*
async function enrichCandidates: Función para enriquecer un conjunto de candidatos a artículos de noticias.
Parámetros:
- candidates: RankedArticle[] - El conjunto de candidatos a enriquecer.
Returns:
- Promise<RankedArticle[]> - Una promesa que resuelve en el conjunto de candidatos enriquecidos.
Descripción:
Esta función enriquece los artículos de noticias candidatos con información adicional obtenida de fuentes externas.
*/
async function enrichCandidates(
  candidates: RankedArticle[],
): Promise<RankedArticle[]> {
  const subset = candidates.slice(0, SCRAPE_CANDIDATES_LIMIT);

  const enrichedSubset = await Promise.all(
    subset.map(async (candidate) => ({
      ...candidate,
      article: await enrichArticle(candidate.article),
    })),
  );

  return [...enrichedSubset, ...candidates.slice(SCRAPE_CANDIDATES_LIMIT)];
}

/*
async function getEquipos: Función para obtener la lista de equipos de fútbol.
Returns:
- Promise<string[]> - Una promesa que resuelve en la lista de equipos.
Descripción:
Esta función obtiene la lista de equipos de fútbol desde una fuente externa.
*/
async function getEquipos(): Promise<string[]> {
  const now = Date.now();

  if (equiposCache.length > 0 && now - lastEquiposFetchAt < TEAM_CACHE_MS) {
    return equiposCache;
  }

  const port = process.env.PORT || 4000;
  const json = (await fetch(
    `http://localhost:${port}/api/partidos/equipos`,
  ).then((r) => r.json())) as EquiposResponse;

  equiposCache = (json.data || [])
    .map((team) => (typeof team === "string" ? team.trim() : ""))
    .filter(Boolean);

  lastEquiposFetchAt = now;
  return equiposCache;
}

/*
async function cleanNewsArticle: Función para limpiar un artículo de noticias.
Parámetros:
- rawArticle: NewsApiArticle - El artículo de noticias sin procesar.
Returns:
- NoticiaLimpia - El artículo de noticias limpio.
Descripción:
Esta función limpia un artículo de noticias, eliminando caracteres innecesarios y normalizando el texto.
*/
function cleanNewsArticle(rawArticle: NewsApiArticle): NoticiaLimpia {
  const cleanText = (
    value: unknown,
  ): { value: string | null; truncated: boolean } => {
    if (typeof value !== "string") {
      return { value: null, truncated: false };
    }

    const truncated = /\[\+\d+\s+chars\]\s*$/i.test(value);
    const cleaned = value
      .replace(/\s*\[\+\d+\s+chars\]\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      value: cleaned.length > 0 ? cleaned : null,
      truncated,
    };
  };

  const title = cleanText(rawArticle.title);
  const description = cleanText(rawArticle.description);
  const content = cleanText(rawArticle.content);
  const sourceName = cleanText(rawArticle.source?.name);
  const image = cleanText(rawArticle.urlToImage);
  const url = cleanText(rawArticle.url);
  const publishedAt = cleanText(rawArticle.publishedAt);

  return {
    title: title.value,
    description: description.value,
    content: content.value,
    contentTruncated: content.truncated,
    sourceName: sourceName.value,
    image: image.value,
    url: url.value,
    publishedAt: publishedAt.value,
  };
}

/*
async function getRelevancia: Función para calcular la relevancia de un artículo de noticias.
Parámetros:
- article: NoticiaLimpia - El artículo de noticias.
- equipos: string[] - La lista de equipos de fútbol.
Returns:
- number - La puntuación de relevancia.
Descripción:
Esta función calcula la relevancia de un artículo de noticias en función de su contenido y la presencia de equipos de fútbol.
*/
function getRelevancia(article: NoticiaLimpia, equipos: string[]): number {
  const title = normalizeComparable(article.title || "");
  const description = normalizeComparable(article.description || "");
  const content = normalizeComparable(article.content || "");
  const source = normalizeComparable(article.sourceName || "");
  const text = [title, description, content, source].join(" ");

  let score = 0;

  if (PREMIER_LEAGUE_KEYWORDS.some((keyword) => text.includes(keyword))) {
    score += 5;
  }

  equipos.forEach((team) => {
    if (matchesTeam(text, team)) {
      score += 4;
    }

    if (matchesTeam(title, team)) {
      score += 2;
    }
  });

  RELEVANT_NEWS_KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword.toLowerCase())) {
      score += 1;
    }
  });

  if (text.includes("nba") || text.includes("nfl")) {
    score -= 5;
  }

  return score;
}

/*
async function compareRankedArticles: Función para comparar dos artículos de noticias clasificados.
Parámetros:
- a: RankedArticle - El primer artículo de noticias.
- b: RankedArticle - El segundo artículo de noticias.
Returns:
- number - El resultado de la comparación.
Descripción:
Esta función compara dos artículos de noticias clasificados y devuelve un valor que indica su orden relativo.
*/
function compareRankedArticles(a: RankedArticle, b: RankedArticle): number {
  const bodyDelta =
    (b.article.content?.length || b.article.description?.length || 0) -
    (a.article.content?.length || a.article.description?.length || 0);

  if (bodyDelta !== 0) {
    return bodyDelta;
  }

  return b.score - a.score;
}

/*
async function dedupeRankedArticles: Función para eliminar artículos de noticias duplicados de una lista clasificada.
Parámetros:
- candidates: RankedArticle[] - La lista de artículos de noticias clasificados.
Returns:
- RankedArticle[] - La lista de artículos de noticias sin duplicados.
Descripción:
Esta función elimina artículos de noticias duplicados de una lista clasificada.
*/
function dedupeRankedArticles(candidates: RankedArticle[]): RankedArticle[] {
  const seenKeys = new Set<string>();

  return candidates.filter((candidate) => {
    const dedupKey = getArticleDedupKey(candidate.article);

    if (!dedupKey) {
      return true;
    }

    if (seenKeys.has(dedupKey)) {
      return false;
    }

    seenKeys.add(dedupKey);
    return true;
  });
}

/*
async function fetchNewsApiPage: Función para obtener una página de artículos de noticias desde la API.
Parámetros:
- options: { team: string | null; search: string | null } - Las opciones de búsqueda.
- page: number - El número de página.
Returns:
- Promise<NewsApiResponse> - La promesa que resuelve en la respuesta de la API.
Descripción:
Esta función obtiene una página de artículos de noticias desde la API, aplicando los filtros y ordenamiento necesarios.
*/
async function fetchNewsApiPage(
  options: { team: string | null; search: string | null },
  page: number,
): Promise<NewsApiResponse> {
  const query = encodeURIComponent(buildNewsApiQuery(options));
  const url =
    `${NEWS_BASE_URL}/everything?q=${query}` +
    "&language=es" +
    "&sortBy=publishedAt" +
    `&pageSize=${RAW_NEWS_PAGE_SIZE}` +
    `&page=${page}`;

  const response = await fetch(url, {
    headers: {
      "X-Api-Key": process.env.NEWS_API_KEY!,
    },
  });

  return (await response.json()) as NewsApiResponse;
}

/*
async function transformRankedArticles: Función para transformar una lista de artículos de noticias clasificados en una lista de noticias transformadas.
Parámetros:
- candidates: RankedArticle[] - La lista de artículos de noticias clasificados.
- equipos: string[] - La lista de equipos de fútbol.
Returns:
- Promise<NoticiaTransformada[]> - La promesa que resuelve en la lista de noticias transformadas.
Descripción:
Esta función transforma una lista de artículos de noticias clasificados en una lista de noticias transformadas.
*/
async function transformRankedArticles(
  candidates: RankedArticle[],
  equipos: string[],
): Promise<NoticiaTransformada[]> {
  const sortedCandidates = dedupeRankedArticles([...candidates]).sort(
    compareRankedArticles,
  );
  const enrichedCandidates = await enrichCandidates(sortedCandidates);

  return dedupeRankedArticles(enrichedCandidates)
    .filter((item) => hasEnoughBody(item.article))
    .sort(compareRankedArticles)
    .map((item, index) => {
      const article = item.article;
      const teams = extractTeams(article, equipos);

      return {
        id: getStableArticleId(article, index),
        title: article.title,
        headline: buildHeadline(article),
        summary: buildSummary(article),
        content: buildContent(article),
        source: article.sourceName,
        image: article.image,
        url: article.url,
        publishedAt: article.publishedAt,
        category: "Premier League",
        readTime: 3,
        teams,
        primaryTeam: teams[0] || null,
      };
    })
    .filter(
      (article) =>
        Boolean(article.headline) &&
        Boolean(article.summary) &&
        Boolean(article.publishedAt),
    );
}

/*
function isMissingNewsCacheTable: Función para verificar si la tabla de cache de noticias no existe.
Parámetros:
- error: { message?: string; code?: string } | null - El error ocurrido.
Returns:
- boolean - Indica si la tabla de cache de noticias no existe.
Descripción:
Esta función verifica si la tabla de cache de noticias no existe en la base de datos.
*/
function isMissingNewsCacheTable(
  error: { message?: string; code?: string } | null,
): boolean {
  const message = `${error?.message || ""}`.toLowerCase();

  return (
    error?.code === "42P01" ||
    (message.includes("noticias_cache") &&
      (message.includes("does not exist") ||
        message.includes("could not find")))
  );
}

/*
function isCacheExpired: Función para verificar si el cache de noticias ha expirado.
Parámetros:
- expiresAt: string | null - La fecha de expiración del cache.
Returns:
- boolean - Indica si el cache ha expirado.
Descripción:
Esta función verifica si el cache de noticias ha expirado comparando la fecha de expiración con la fecha actual.
*/
function isCacheExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return true;
  }

  const expirationTime = Date.parse(expiresAt);
  return Number.isNaN(expirationTime) || expirationTime <= Date.now();
}

/*
function readNewsSnapshot: Función para leer una instantánea de noticias del cache.
Parámetros:
- cacheKey: string - La clave del cache.
Returns:
- Promise<{ payload: NewsSnapshotPayload; updatedAt: string | null; expiresAt: string | null } | null> - La promesa que resuelve en la instantánea de noticias o null si no se encuentra.
Descripción:
Esta función lee una instantánea de noticias del cache en Supabase.
*/
async function readNewsSnapshot(cacheKey: string): Promise<{
  payload: NewsSnapshotPayload;
  updatedAt: string | null;
  expiresAt: string | null;
} | null> {
  const { data, error } = await supabase
    .from("noticias_cache")
    .select("payload, updated_at, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle<CachedNewsRow>();

  if (error) {
    if (!isMissingNewsCacheTable(error)) {
      console.error(
        "[api/noticias] Error leyendo cache en Supabase:",
        error.message,
      );
    }
    return null;
  }

  if (!data?.payload || !Array.isArray(data.payload.data)) {
    return null;
  }

  return {
    payload: data.payload,
    updatedAt: data.updated_at || null,
    expiresAt: data.expires_at || null,
  };
}

/*
function persistNewsSnapshot: Función para guardar una instantánea de noticias en el cache.
Parámetros:
- cacheKey: string - La clave del cache.
- payload: NewsSnapshotPayload - El payload de la instantánea de noticias.
Returns:
- Promise<void> - La promesa que resuelve cuando se guarda la instantánea en el cache.
Descripción:
Esta función guarda una instantánea de noticias en el cache en Supabase.
*/
async function persistNewsSnapshot(
  cacheKey: string,
  payload: NewsSnapshotPayload,
): Promise<void> {
  const now = new Date();

  const { error } = await supabase.from("noticias_cache").upsert(
    {
      cache_key: cacheKey,
      payload,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + NEWS_CACHE_TTL_MS).toISOString(),
    },
    { onConflict: "cache_key" },
  );

  if (error && !isMissingNewsCacheTable(error)) {
    console.error(
      "[api/noticias] Error guardando cache en Supabase:",
      error.message,
    );
  }
}

/*
function buildNewsSnapshot: Función para construir una instantánea de noticias.
Parámetros:
- options: NewsRouteOptions - Las opciones para la consulta de noticias.
Returns:
- Promise<NewsSnapshotPayload> - La promesa que resuelve en la instantánea de noticias.
Descripción:
Esta función construye una instantánea de noticias basada en las opciones proporcionadas.
*/
async function buildNewsSnapshot(
  options: NewsRouteOptions,
): Promise<NewsSnapshotPayload> {
  const equipos = await getEquipos();
  const requiredResults = options.offset + options.limit + 1;
  const rankedPool: RankedArticle[] = [];

  let sourcePage = 1;
  let sourceHasMore = true;
  let transformedArticles: NoticiaTransformada[] = [];

  while (sourceHasMore && sourcePage <= MAX_SOURCE_PAGES) {
    const json = await fetchNewsApiPage(options, sourcePage);

    if (json.status !== "ok") {
      throw new Error(json.message || "No se pudieron obtener noticias");
    }

    const rankedArticles = (json.articles || [])
      .map((rawArticle) => {
        const article = cleanNewsArticle(rawArticle);
        const score = getRelevancia(article, equipos);
        return { article, score };
      })
      .filter((item) => item.score >= MIN_RELEVANCE_SCORE)
      .filter((item) => matchesRequestedTeam(item.article, options.team))
      .filter((item) => matchesSearchTerms(item.article, options.search));

    rankedPool.push(...rankedArticles);
    transformedArticles = await transformRankedArticles(rankedPool, equipos);

    const reachedRequestedPage = transformedArticles.length >= requiredResults;
    const totalResults =
      typeof json.totalResults === "number" ? json.totalResults : null;

    sourceHasMore =
      (json.articles || []).length === RAW_NEWS_PAGE_SIZE &&
      (totalResults === null || sourcePage * RAW_NEWS_PAGE_SIZE < totalResults);

    if (reachedRequestedPage) {
      break;
    }

    sourcePage += 1;
  }

  const pageItems = transformedArticles.slice(
    options.offset,
    options.offset + options.limit,
  );
  const canFetchMoreFromSource =
    sourceHasMore && sourcePage <= MAX_SOURCE_PAGES;

  return {
    success: true,
    count: pageItems.length,
    page: Math.floor(options.offset / Math.max(1, options.limit)) + 1,
    limit: options.limit,
    hasMore:
      transformedArticles.length > options.offset + options.limit ||
      canFetchMoreFromSource,
    data: pageItems,
  };
}

/*
function refreshNewsSnapshot: Función para refrescar la instantánea de noticias en el cache.
Parámetros:
- cacheKey: string - La clave del cache.
- options: NewsRouteOptions - Las opciones para la consulta de noticias.
Returns:
- Promise<NewsSnapshotPayload> - La promesa que resuelve en la instantánea de noticias actualizada.
Descripción:
Esta función refresca la instantánea de noticias en el cache, actualizando su contenido y fecha de expiración.
*/
async function refreshNewsSnapshot(
  cacheKey: string,
  options: NewsRouteOptions,
): Promise<NewsSnapshotPayload> {
  const pendingRefresh = pendingRefreshes.get(cacheKey);

  if (pendingRefresh) {
    return pendingRefresh;
  }

  const refreshPromise = (async () => {
    const payload = await buildNewsSnapshot(options);
    await persistNewsSnapshot(cacheKey, payload);
    return payload;
  })().finally(() => {
    pendingRefreshes.delete(cacheKey);
  });

  pendingRefreshes.set(cacheKey, refreshPromise);
  return refreshPromise;
}

/*
-------------------------------------------------------
Rutas de noticias
--------------------------------------------------------


Ruta GET /api/noticias: Endpoint para obtener noticias de fútbol.
Parámetros de consulta:
- team: string (opcional) - El nombre del equipo para filtrar las noticias.
- search: string (opcional) - Términos de búsqueda para filtrar las noticias.
- page: number (opcional) - El número de página para paginación (predeterminado: 1).
- limit: number (opcional) - El número de resultados por página (predeterminado: 10, máximo: 50).
- offset: number (opcional) - El desplazamiento para paginación (anula el parámetro page si se proporciona).
Descripción:
Este endpoint devuelve una lista de noticias de fútbol filtradas por equipo y términos de búsqueda, con soporte para paginación. 
Utiliza un sistema de caché para mejorar el rendimiento y reducir la carga en la API de noticias.
*/
router.get("/", async (req: Request<{}, {}, {}, NewsQuery>, res: Response) => {
  const limit = parseLimitParam(req.query.limit);
  const page = parsePositiveInteger(req.query.page, 1);
  const explicitOffset = parseNonNegativeInteger(req.query.offset);

  const options: NewsRouteOptions = {
    offset: explicitOffset ?? (page - 1) * limit,
    limit,
    team: normalizeQueryText(req.query.team),
    search: normalizeQueryText(req.query.search),
  };

  const cacheKey = buildNewsCacheKey(options);
  let cachedSnapshot: Awaited<ReturnType<typeof readNewsSnapshot>> = null;

  try {
    cachedSnapshot = await readNewsSnapshot(cacheKey);

    if (cachedSnapshot?.payload) {
      const stale = isCacheExpired(cachedSnapshot.expiresAt);

      if (stale) {
        void refreshNewsSnapshot(cacheKey, options).catch((refreshError) => {
          console.error(
            "[api/noticias] Error refrescando cache en segundo plano:",
            refreshError,
          );
        });
      }

      res.json({
        ...cachedSnapshot.payload,
        cached: true,
        stale,
        cachedAt: cachedSnapshot.updatedAt,
      });
      return;
    }

    const freshSnapshot = await refreshNewsSnapshot(cacheKey, options);

    res.json({
      ...freshSnapshot,
      cached: false,
      stale: false,
      cachedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (cachedSnapshot?.payload) {
      res.json({
        ...cachedSnapshot.payload,
        cached: true,
        stale: true,
        fallback: true,
        cachedAt: cachedSnapshot.updatedAt,
      });
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Error interno al obtener noticias";

    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export { router as noticiasRouter };
