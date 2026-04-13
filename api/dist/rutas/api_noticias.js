"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const readability_1 = require("@mozilla/readability");
const jsdom_1 = require("jsdom");
const router = (0, express_1.Router)();
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
const MAX_NEWS_RESULTS = 8;
const SCRAPE_VIRTUAL_CONSOLE = new jsdom_1.VirtualConsole();
const MIN_SCORE = 3;
const TEAM_ALIASES = {
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
let equiposCache = [];
let lastFetchEquipos = 0;
const articleCache = new Map();
/* --------------------------------------------------------------
   FUNCIONES DE AYUDA
--------------------------------------------------------------- */
/*
funcion para normalizar texto y poder comparar cadenas sin que afecten
mayusculas, acentos, signos o espacios repetidos
retorna: texto limpio y comparable
*/
function normalizeComparable(value) {
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
function shortenText(value, maxLength) {
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
function normalizeReadableText(value) {
    if (!value) {
        return null;
    }
    const cleaned = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 0 ? cleaned : null;
}
/*
funcion para obtener las variantes o aliases de un equipo
ejemplo: "manchester city" tambien puede matchear con "man city"
retorna: lista unica de patrones normalizados
*/
function getTeamPatterns(team) {
    const normalizedTeam = normalizeComparable(team);
    const aliases = TEAM_ALIASES[normalizedTeam] || [];
    return Array.from(new Set([team, normalizedTeam, ...aliases]
        .map((value) => normalizeComparable(value))
        .filter(Boolean)));
}
/*
funcion para revisar si un texto menciona a cierto equipo
retorna: true si encuentra el equipo o alguno de sus aliases
*/
function matchesTeam(text, team) {
    return getTeamPatterns(team).some((pattern) => {
        const safePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|\\s)${safePattern}(\\s|$)`, "i").test(text);
    });
}
/*
funcion para extraer que equipos aparecen mencionados dentro de una noticia
retorna: lista de equipos detectados
*/
function extractTeams(article, equipos) {
    const text = normalizeComparable([article.title, article.description, article.content, article.sourceName]
        .filter(Boolean)
        .join(" "));
    return equipos.filter((team) => matchesTeam(text, team));
}
/*
funcion para construir un headline corto y limpio para la noticia
prioriza titulo, luego descripcion, luego contenido
*/
function buildHeadline(article) {
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
function buildSummary(article) {
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
function buildContent(article) {
    const { description, content } = article;
    if (content && description) {
        const normalizedContent = normalizeComparable(content);
        const normalizedDescription = normalizeComparable(description);
        if (normalizedContent.includes(normalizedDescription) ||
            normalizedDescription.includes(normalizedContent)) {
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
function hasEnoughBody(article) {
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
async function scrapeArticle(url) {
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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36 PremierHubBot/1.0",
                "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            },
        });
        if (!response.ok) {
            return { title: null, excerpt: null, content: null };
        }
        const html = await response.text();
        const dom = new jsdom_1.JSDOM(html, {
            url,
            virtualConsole: SCRAPE_VIRTUAL_CONSOLE,
        });
        const parsed = new readability_1.Readability(dom.window.document).parse();
        const scrapedArticle = {
            title: normalizeReadableText(parsed?.title),
            excerpt: normalizeReadableText(parsed?.excerpt),
            content: normalizeReadableText(parsed?.textContent),
        };
        articleCache.set(url, {
            expiresAt: Date.now() + ARTICLE_CACHE_MS,
            article: scrapedArticle,
        });
        return scrapedArticle;
    }
    catch {
        return { title: null, excerpt: null, content: null };
    }
    finally {
        clearTimeout(timeout);
    }
}
/*
funcion para enriquecer una noticia con scraping si el api la trae muy corta
retorna: noticia original o noticia enriquecida
*/
async function enrichArticle(article) {
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
    const description = normalizeReadableText(article.description || scraped.excerpt || shortenText(scraped.content, 220));
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
async function enrichCandidates(candidates) {
    const subset = candidates.slice(0, SCRAPE_CANDIDATES);
    const enrichedSubset = await Promise.all(subset.map(async (candidate) => ({
        ...candidate,
        article: await enrichArticle(candidate.article),
    })));
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
async function getEquipos() {
    const now = Date.now();
    if (equiposCache.length > 0 && now - lastFetchEquipos < CACHE_EQUIPOS_MS) {
        return equiposCache;
    }
    const json = (await fetch("http://localhost:4000/api/partidos/equipos").then((r) => r.json()));
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
function limpiaNoticias(noticia) {
    const limpiar = (valor) => {
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
function getRelevancia(article, equipos) {
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
function compareRankedArticles(a, b) {
    const bodyDelta = (b.article.content?.length || b.article.description?.length || 0) -
        (a.article.content?.length || a.article.description?.length || 0);
    if (bodyDelta !== 0) {
        return bodyDelta;
    }
    return b.score - a.score;
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
router.get("/", async (_req, res) => {
    try {
        const equipos = await getEquipos();
        // query base para traer noticias sin sobrecargar demasiado el request
        const query = encodeURIComponent(`"Premier League" OR football`);
        const url = `${NEWS_BASE}/everything?q=${query}` +
            "&language=es" +
            "&sortBy=publishedAt" +
            "&pageSize=30";
        const json = (await fetch(url, {
            headers: {
                "X-Api-Key": process.env.NEWS_API_KEY,
            },
        }).then((r) => r.json()));
        if (json.status !== "ok") {
            return res.status(500).json({
                success: false,
                error: json.message || "No se pudieron obtener noticias",
            });
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
            .sort(compareRankedArticles);
        const filtradas = (await enrichCandidates(rankedArticles))
            .filter((item) => hasEnoughBody(item.article))
            .sort(compareRankedArticles)
            .slice(0, MAX_NEWS_RESULTS)
            .map((item) => item.article);
        const transformed = filtradas
            .map((article, index) => {
            const teams = extractTeams(article, equipos);
            const summary = buildSummary(article);
            const content = buildContent(article);
            return {
                id: index + 1,
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
            .filter((article) => Boolean(article.headline) &&
            Boolean(article.summary) &&
            Boolean(article.publishedAt));
        return res.json({
            success: true,
            count: transformed.length,
            data: transformed,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Error interno al obtener noticias";
        return res.status(500).json({
            success: false,
            error: message,
        });
    }
});
exports.default = router;
