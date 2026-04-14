import { Router, Request, Response } from "express";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import supabase from "../db";

const router = Router();

const NEWS_BASE = "https://newsapi.org/v2";

const PREMIER_LEAGUE = [
  "premier league",
  "english premier league",
  "epl",
  "premierleague",
];

const KEYWORDS = [
  "transferencia",
  "lesion",
  "manager",
  "alineacion",
  "gol",
  "relegacion",
  "suspension",
];

const CACHE_EQUIPOS_MS = 1000 * 60 * 60 * 24;
const ARTICLE_CACHE_MS = 1000 * 60 * 60 * 6;
const SCRAPE_TIMEOUT_MS = 8000;
const SCRAPE_CANDIDATES = 16;
const RAW_NEWS_PAGE_SIZE = 25;
const MAX_SOURCE_PAGES = 4;
const DEFAULT_NEWS_LIMIT = 8;
const MAX_NEWS_LIMIT = 12;
const SCRAPE_VIRTUAL_CONSOLE = new VirtualConsole();
const MIN_SCORE = 3;
const NEWS_CACHE_VERSION = "v2";
const NEWS_CACHE_TTL_MS =
  1000 * 60 * (Number(process.env.NEWS_CACHE_TTL_MINUTES) || 20);

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

const TEAM_ALIASES: Record<string, string[]> = {
  arsenal: ["gunners"],
  "aston villa": ["villa"],
  bournemouth: ["afc bournemouth", "cherries"],
  brighton: ["brighton & hove albion", "brighton and hove albion", "seagulls"],
  brentford: ["bees"],
  chelsea: ["blues"],
  "crystal palace": ["eagles"],
  everton: ["toffees"],
  fulham: ["cottagers"],
  ipswich: ["ipswich town"],
  leicester: ["leicester city", "foxes"],
  "manchester city": ["man city", "citizens"],
  "manchester united": ["man united", "man utd", "red devils"],
  newcastle: ["newcastle united", "magpies"],
  "nottingham forest": ["forest"],
  southampton: ["saints"],
  tottenham: ["tottenham hotspur", "spurs"],
  "west ham": ["west ham united", "hammers"],
  "wolverhampton wanderers": ["wolves", "wolverhampton"],
};

/* --------------------------------------------------------------
   CACHE EN MEMORIA
--------------------------------------------------------------- */

let equiposCache: string[] = [];
let lastFetchEquipos = 0;

const articleCache = new Map<string, CachedArticle>();
const newsRefreshPromises = new Map<string, Promise<NewsSnapshotPayload>>();

/* --------------------------------------------------------------
   FUNCIONES DE AYUDA
--------------------------------------------------------------- */

/*
funcion para normalizar texto y poder comparar cadenas sin que afecten
mayusculas, acentos, signos o espacios repetidos
retorna: texto limpio y comparable
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
funcion para recortar texto sin cortarlo tan feo a la mitad
retorna: texto original o texto acortado con "..."
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
funcion para limpiar texto legible obtenido del api o del scraping
retorna: string limpio o null si no hay contenido util
*/
function normalizeReadableText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  return cleaned.length > 0 ? cleaned : null;
}

function normalizeQueryText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parsePageParam(value: unknown): number {
  const numeric = Number.parseInt(`${value || ""}`, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function parseLimitParam(value: unknown): number {
  const numeric = Number.parseInt(`${value || ""}`, 10);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_NEWS_LIMIT;
  }

  return Math.min(numeric, MAX_NEWS_LIMIT);
}

function parseOffsetParam(value: unknown): number | null {
  const numeric = Number.parseInt(`${value || ""}`, 10);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return numeric;
}

function quoteNewsQueryTerm(value: string): string {
  const cleaned = value.replace(/"/g, "").trim();

  if (!cleaned) {
    return "";
  }

  return /\s/u.test(cleaned) ? `"${cleaned}"` : cleaned;
}

function buildQueryGroup(values: string[]): string | null {
  const uniqueTerms = Array.from(
    new Set(
      values
        .map((value) => quoteNewsQueryTerm(value))
        .filter(Boolean),
    ),
  );

  if (uniqueTerms.length === 0) {
    return null;
  }

  if (uniqueTerms.length === 1) {
    return uniqueTerms[0];
  }

  return `(${uniqueTerms.join(" OR ")})`;
}

function getTeamQueryTerms(team: string): string[] {
  const normalizedTeam = normalizeComparable(team);
  const aliases = TEAM_ALIASES[normalizedTeam] || [];

  return Array.from(new Set([team, ...aliases]));
}

function buildNewsApiQuery(options: { team: string | null; search: string | null }): string {
  const groups = [
    buildQueryGroup(["Premier League", "English Premier League", "EPL", "football"]),
  ];

  if (options.team) {
    groups.unshift(buildQueryGroup(getTeamQueryTerms(options.team)));
  }

  if (options.search) {
    groups.unshift(buildQueryGroup([options.search]));
  }

  return groups.filter((group): group is string => Boolean(group)).join(" AND ");
}

function buildNewsCacheKey(options: {
  offset: number;
  limit: number;
  team: string | null;
  search: string | null;
}): string {
  return [
    NEWS_CACHE_VERSION,
    `offset=${options.offset}`,
    `limit=${options.limit}`,
    `team=${normalizeComparable(options.team || "all")}`,
    `search=${normalizeComparable(options.search || "")}`,
  ].join("|");
}

function buildArticleText(article: NoticiaLimpia): string {
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

function matchesSearchTerms(article: NoticiaLimpia, search: string | null): boolean {
  if (!search) {
    return true;
  }

  const haystack = buildArticleText(article);
  const terms = normalizeComparable(search).split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  return terms.every((term) => haystack.includes(term));
}

function matchesRequestedTeam(article: NoticiaLimpia, team: string | null): boolean {
  if (!team) {
    return true;
  }

  return matchesTeam(buildArticleText(article), team);
}

function getArticleDedupKey(article: NoticiaLimpia): string {
  return normalizeComparable(
    [article.url, article.title, article.publishedAt]
      .filter(Boolean)
      .join(" "),
  );
}

function getStableArticleId(article: NoticiaLimpia, fallbackIndex: number): number {
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
funcion para obtener las variantes o aliases de un equipo
ejemplo: "manchester city" tambien puede matchear con "man city"
retorna: lista unica de patrones normalizados
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
funcion para revisar si un texto menciona a cierto equipo
retorna: true si encuentra el equipo o alguno de sus aliases
*/
function matchesTeam(text: string, team: string): boolean {
  return getTeamPatterns(team).some((pattern) => {
    const safePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${safePattern}(\\s|$)`, "i").test(text);
  });
}

/*
funcion para extraer que equipos aparecen mencionados dentro de una noticia
retorna: lista de equipos detectados
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
funcion para construir un headline corto y limpio para la noticia
prioriza titulo, luego descripcion, luego contenido
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
funcion para generar un resumen corto de la noticia
retorna: descripcion resumida o null si no hay texto
*/
function buildSummary(article: NoticiaLimpia): string | null {
  const base = article.description || article.content || article.title;

  if (!base) {
    return null;
  }

  return shortenText(base, 180);
}

/*
funcion para generar el contenido final a mostrar
si descripcion y contenido son muy parecidos, se queda con el mas completo
si ambos aportan algo, los concatena
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
funcion para validar si una noticia ya trae suficiente cuerpo de texto
si viene truncada o muy corta, luego intentaremos enriquecerla con scraping
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
funcion para hacer scraping del contenido completo de una noticia
usa readability para sacar titulo, extracto y texto principal
retorna: datos scrapeados o nulls si falla
*/
async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  const cached = articleCache.get(url);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.article;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

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
    const parsed = new Readability(dom.window.document).parse();

    const scrapedArticle: ScrapedArticle = {
      title: normalizeReadableText(parsed?.title),
      excerpt: normalizeReadableText(parsed?.excerpt),
      content: normalizeReadableText(parsed?.textContent),
    };

    articleCache.set(url, {
      expiresAt: Date.now() + ARTICLE_CACHE_MS,
      article: scrapedArticle,
    });

    return scrapedArticle;
  } catch {
    return { title: null, excerpt: null, content: null };
  } finally {
    clearTimeout(timeout);
  }
}

/*
funcion para enriquecer una noticia con scraping si el api la trae muy corta
retorna: noticia original o noticia enriquecida
*/
async function enrichArticle(article: NoticiaLimpia): Promise<NoticiaLimpia> {
  if (!article.url) {
    return article;
  }

  if (hasEnoughBody(article)) {
    return article;
  }

  const scraped = await scrapeArticle(article.url);

  if (!scraped.content) {
    return article;
  }

  const description = normalizeReadableText(
    article.description || scraped.excerpt || shortenText(scraped.content, 220),
  );

  return {
    ...article,
    title: article.title || scraped.title,
    description,
    content: scraped.content,
    contentTruncated: false,
  };
}

/*
funcion para enriquecer solo un subconjunto de noticias candidatas
esto ayuda a no scrape ar todas y no hacer tan pesado el endpoint
*/
async function enrichCandidates(candidates: RankedArticle[]): Promise<RankedArticle[]> {
  const subset = candidates.slice(0, SCRAPE_CANDIDATES);

  const enrichedSubset = await Promise.all(
    subset.map(async (candidate) => ({
      ...candidate,
      article: await enrichArticle(candidate.article),
    })),
  );

  return [...enrichedSubset, ...candidates.slice(SCRAPE_CANDIDATES)];
}

/*
funcion para obtener la lista de equipos de la premier league desde el APIfootball
retorna: lista de nombres de equipos
funcionamiento:
- usa cache simple para evitar pegarle al endpoint a cada request
- si el cache sigue vigente, regresa eso
- si no, consulta el endpoint local y actualiza cache
*/
async function getEquipos(): Promise<string[]> {
  const now = Date.now();

  if (equiposCache.length > 0 && now - lastFetchEquipos < CACHE_EQUIPOS_MS) {
    return equiposCache;
  }

  const port = process.env.PORT || 4000;
  const json = (await fetch(`http://localhost:${port}/api/partidos/equipos`).then((r) =>
    r.json(),
  )) as EquiposResponse;

  equiposCache = (json.data || [])
    .map((team) => (typeof team === "string" ? team.trim() : ""))
    .filter(Boolean);

  lastFetchEquipos = now;

  return equiposCache;
}

/*
funcion para limpiar noticias que vienen del News API
parametro: noticia - objeto crudo del api
retorna: objeto con campos limpios y banderas utiles
funcionamiento:
- limpia campos de texto
- detecta si content viene truncado con "[+123 chars]"
- deja cada valor en null si no sirve
*/
function limpiaNoticias(noticia: NewsApiArticle): NoticiaLimpia {
  const limpiar = (
    valor: unknown,
  ): { value: string | null; truncated: boolean } => {
    if (typeof valor !== "string") {
      return { value: null, truncated: false };
    }

    const truncated = /\[\+\d+\s+chars\]\s*$/i.test(valor);

    const limpio = valor
      .replace(/\s*\[\+\d+\s+chars\]\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      value: limpio.length > 0 ? limpio : null,
      truncated,
    };
  };

  const title = limpiar(noticia?.title);
  const description = limpiar(noticia?.description);
  const content = limpiar(noticia?.content);
  const sourceName = limpiar(noticia?.source?.name);
  const image = limpiar(noticia?.urlToImage);
  const url = limpiar(noticia?.url);
  const publishedAt = limpiar(noticia?.publishedAt);

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
funcion para calcular la relevancia de una noticia
parametro: article - objeto de noticia limpio, equipos - lista de equipos
retorna: puntaje de relevancia
funcionamiento:
- concatena titulo, descripcion, contenido y fuente
- suma puntos por señales directas de premier league
- suma puntos por menciones de equipos
- suma puntos por keywords relevantes
- resta puntos por señales de otros deportes que no interesan
*/
function getRelevancia(article: NoticiaLimpia, equipos: string[]): number {
  const title = normalizeComparable(article.title || "");
  const description = normalizeComparable(article.description || "");
  const content = normalizeComparable(article.content || "");
  const source = normalizeComparable(article.sourceName || "");

  const text = [title, description, content, source].join(" ");

  let score = 0;

  if (PREMIER_LEAGUE.some((keyword) => text.includes(keyword))) {
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

  KEYWORDS.forEach((keyword) => {
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
funcion para comparar noticias candidatas
prioriza las que tengan mas cuerpo de texto y, en empate, mayor score
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

function dedupeRankedArticles(candidates: RankedArticle[]): RankedArticle[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const dedupKey = getArticleDedupKey(candidate.article);

    if (!dedupKey) {
      return true;
    }

    if (seen.has(dedupKey)) {
      return false;
    }

    seen.add(dedupKey);
    return true;
  });
}

async function fetchNewsApiPage(
  options: { team: string | null; search: string | null },
  page: number,
): Promise<NewsApiResponse> {
  const query = encodeURIComponent(buildNewsApiQuery(options));
  const url =
    `${NEWS_BASE}/everything?q=${query}` +
    "&language=es" +
    "&sortBy=publishedAt" +
    `&pageSize=${RAW_NEWS_PAGE_SIZE}` +
    `&page=${page}`;

  return (await fetch(url, {
    headers: {
      "X-Api-Key": process.env.NEWS_API_KEY!,
    },
  }).then((response) => response.json())) as NewsApiResponse;
}

async function transformRankedArticles(
  candidates: RankedArticle[],
  equipos: string[],
): Promise<NoticiaTransformada[]> {
  const sortedCandidates = dedupeRankedArticles([...candidates]).sort(compareRankedArticles);
  const enrichedCandidates = await enrichCandidates(sortedCandidates);

  return dedupeRankedArticles(enrichedCandidates)
    .filter((item) => hasEnoughBody(item.article))
    .sort(compareRankedArticles)
    .map((item, index) => {
      const article = item.article;
      const teams = extractTeams(article, equipos);
      const summary = buildSummary(article);
      const content = buildContent(article);

      return {
        id: getStableArticleId(article, index),
        title: article.title,
        headline: buildHeadline(article),
        summary,
        content,
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

function isMissingNewsCacheTable(error: { message?: string; code?: string } | null): boolean {
  const message = `${error?.message || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    (message.includes("noticias_cache") &&
      (message.includes("does not exist") || message.includes("could not find")))
  );
}

function isCacheExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return true;
  }

  const expirationTime = Date.parse(expiresAt);
  return Number.isNaN(expirationTime) || expirationTime <= Date.now();
}

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
      console.error("[api/noticias] Error leyendo cache en Supabase:", error.message);
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
    console.error("[api/noticias] Error guardando cache en Supabase:", error.message);
  }
}

async function buildNewsSnapshot(options: {
  offset: number;
  limit: number;
  team: string | null;
  search: string | null;
}): Promise<NewsSnapshotPayload> {
  const equipos = await getEquipos();
  const requiredResults = options.offset + options.limit + 1;
  const rankedPool: RankedArticle[] = [];
  let sourcePage = 1;
  let sourceHasMore = true;
  let transformed: NoticiaTransformada[] = [];

  while (sourceHasMore && sourcePage <= MAX_SOURCE_PAGES) {
    const json = await fetchNewsApiPage(options, sourcePage);

    if (json.status !== "ok") {
      throw new Error(json.message || "No se pudieron obtener noticias");
    }

    const rankedArticles = (json.articles || [])
      .map((raw) => {
        const article = limpiaNoticias(raw);
        const score = getRelevancia(article, equipos);

        return {
          article,
          score,
        };
      })
      .filter((item) => item.score >= MIN_SCORE)
      .filter((item) => matchesRequestedTeam(item.article, options.team))
      .filter((item) => matchesSearchTerms(item.article, options.search));

    rankedPool.push(...rankedArticles);
    transformed = await transformRankedArticles(rankedPool, equipos);

    const reachedRequestedPage = transformed.length >= requiredResults;
    const totalResults = typeof json.totalResults === "number" ? json.totalResults : null;
    sourceHasMore =
      (json.articles || []).length === RAW_NEWS_PAGE_SIZE &&
      (totalResults === null || sourcePage * RAW_NEWS_PAGE_SIZE < totalResults);

    if (reachedRequestedPage) {
      break;
    }

    sourcePage += 1;
  }

  const pageItems = transformed.slice(options.offset, options.offset + options.limit);
  const canFetchMoreFromSource = sourceHasMore && sourcePage <= MAX_SOURCE_PAGES;

  return {
    success: true,
    count: pageItems.length,
    page: Math.floor(options.offset / Math.max(1, options.limit)) + 1,
    limit: options.limit,
    hasMore: transformed.length > options.offset + options.limit || canFetchMoreFromSource,
    data: pageItems,
  };
}

async function refreshNewsSnapshot(
  cacheKey: string,
  options: {
    offset: number;
    limit: number;
    team: string | null;
    search: string | null;
  },
): Promise<NewsSnapshotPayload> {
  const pendingRefresh = newsRefreshPromises.get(cacheKey);

  if (pendingRefresh) {
    return pendingRefresh;
  }

  const refreshPromise = (async () => {
    const payload = await buildNewsSnapshot(options);
    await persistNewsSnapshot(cacheKey, payload);
    return payload;
  })().finally(() => {
    newsRefreshPromises.delete(cacheKey);
  });

  newsRefreshPromises.set(cacheKey, refreshPromise);
  return refreshPromise;
}

/* --------------------------------------------------------------
   ROUTE
--------------------------------------------------------------- */

/*
endpoint principal de noticias
flujo general:
- obtiene equipos
- consulta news api
- limpia y rankea resultados
- enriquece candidatos con scraping si hace falta
- transforma la respuesta al formato que usa el frontend
*/
router.get("/", async (req: Request, res: Response) => {
  const limit = parseLimitParam(req.query.limit);
  const page = parsePageParam(req.query.page);
  const explicitOffset = parseOffsetParam(req.query.offset);
  const options = {
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
          console.error("[api/noticias] Error refrescando cache en segundo plano:", refreshError);
        });
      }

      return res.json({
        ...cachedSnapshot.payload,
        cached: true,
        stale,
        cachedAt: cachedSnapshot.updatedAt,
      });
    }

    const freshSnapshot = await refreshNewsSnapshot(cacheKey, options);

    return res.json({
      ...freshSnapshot,
      cached: false,
      stale: false,
      cachedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (cachedSnapshot?.payload) {
      return res.json({
        ...cachedSnapshot.payload,
        cached: true,
        stale: true,
        fallback: true,
        cachedAt: cachedSnapshot.updatedAt,
      });
    }

    const message =
      error instanceof Error ? error.message : "Error interno al obtener noticias";

    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
