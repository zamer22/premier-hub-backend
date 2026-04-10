import { Router } from "express";

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

type EquiposResponse = {
  data?: string[];
};

type NoticiaLimpia = {
  title: string | null;
  description: string | null;
  content: string | null;
  sourceName: string | null;
  image: string | null;
  url: string | null;
  publishedAt: string | null;
};



/* --------------------------------------------------------------
FUNCIONES DE AYUDA
--------------------------------------------------------------- */



let equiposCache: string[] = [];
let lastFetchEquipos = 0;
const CACHE_EQUIPOS_MS = 1000 * 60 * 60 * 24;

/*
funcion para obtener la lista de equipos de la premier league desde el APIfootball
retorna: lista de nombres de equipos en minúscula
funcionamiento:
- Implementa un mecanismo de cache simple para evitar llamadas frecuentes al API
- Si el cache es reciente (menos de 24 horas), retorna los datos almacenados
- Si no, hace una solicitud al endpoint local que expone los equipos, procesa la respuesta y actualiza el cache
*/
async function getEquipos(): Promise<string[]> {
  const now = Date.now();

  if (equiposCache.length > 0 && now - lastFetchEquipos < CACHE_EQUIPOS_MS) {
    return equiposCache;
  }

  const json = await fetch("http://localhost:4000/api/partidos/equipos")
    .then((r) => r.json()) as EquiposResponse;

  equiposCache = (json.data || [])
    .map((team) => team.toLowerCase())
    .filter(Boolean);

  lastFetchEquipos = now;

  return equiposCache;
}


/*
funcion para limpiar noticias
parametro: noticia - objeto de noticia a limpiar
retorna: objeto con campos limpios o null si no es valido
funcionamiento:
- Define una función interna limpiar() que procesa cada campo individualmente:
  - Verifica que el valor sea una cadena de texto, si no lo es retorna null
  - Elimina patrones que a veces regresa el api como "[+123 chars]" al final del texto
  - Reemplaza múltiples espacios por uno solo y recorta espacios al inicio y final
  - Solo retorna algo si es una cadena no vacía;
*/
function limpiaNoticias(noticia: any): NoticiaLimpia {
  const limpiar = (valor: unknown): string | null => {
    if (typeof valor !== "string") return null;

    const limpio = valor
      .replace(/\s*\[\+\d+\s+chars\]\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    return limpio.length > 0 ? limpio : null;
  };

  return {
    title: limpiar(noticia?.title),
    description: limpiar(noticia?.description),
    content: limpiar(noticia?.content),
    sourceName: limpiar(noticia?.source?.name),
    image: limpiar(noticia?.urlToImage),
    url: limpiar(noticia?.url),
    publishedAt: limpiar(noticia?.publishedAt),
  };
}


/* funcion para calcular la relevancia de una noticia
parametro: article - objeto de noticia limpio, equipos - lista de equipos
retorna: puntaje de relevancia
funcionamiento:
- Concatena el texto relevante de la noticia (título, descripción, contenido, fuente)
- Asigna puntajes según señales:
  - Señales directas Premier: +5 puntos
  - Mención de equipos: +4 puntos por mención, +2 puntos extra si es en el título
  - Keywords relevantes: +1 punto por cada keyword encontrada
  - Penalizaciones suaves (ej. menciones de NBA/NFL): -5 puntos
- Retorna el puntaje total, que luego se usará para filtrar y ordenar las noticias
*/
function getRelevancia(article: NoticiaLimpia, equipos: string[]): number {
  const title = article.title?.toLowerCase() || "";
  const description = article.description?.toLowerCase() || "";
  const content = article.content?.toLowerCase() || "";
  const source = article.sourceName?.toLowerCase() || "";

  const text = [title, description, content, source].join(" ");

  let score = 0;

  if (PREMIER_LEAGUE.some((k) => text.includes(k))) {
    score += 5;
  }

  equipos.forEach((team) => {
    if (text.includes(team)) score += 4;
    if (title.includes(team)) score += 2;
  });

  KEYWORDS.forEach((k) => {
    if (text.includes(k.toLowerCase())) score += 1;
  });

  if (text.includes("nba") || text.includes("nfl")) {
    score -= 5;
  }

  return score;
}


/* -------------------------------
   ROUTE
--------------------------------*/
router.get("/", async (_req, res) => {
  try {
    const equipos = await getEquipos();

    // query base (NO la sobrecargues)
    const query = encodeURIComponent(`"Premier League" OR football`);

    const url =
      `${NEWS_BASE}/everything?q=${query}` +
      "&language=es" +
      "&sortBy=publishedAt" +
      "&pageSize=30";

    const json: any = await fetch(url, {
      headers: {
        "X-Api-Key": process.env.NEWS_API_KEY!,
      },
    }).then((r) => r.json());

    if (json.status !== "ok") {
      return res.status(500).json({
        success: false,
        error: json.message,
      });
    }

    const MIN_SCORE = 3;

    const filtradas = (json.articles || [])
      .map((raw: any, index: number) => {
        const article = limpiaNoticias(raw);
        const score = getRelevancia(article, equipos);

        return {
          article,
          score,
          index,
        };
      })
      .filter((item: any) => item.score >= MIN_SCORE)
      .sort((a: any, b: any) => b.score - a.score)
      .map((item: any) => item.article);

    const transformed = filtradas
      .map((article: NoticiaLimpia, index: number) => ({
        id: index + 1,
        title: article.title,
        summary: article.description,
        content: article.content,
        source: article.sourceName,
        image: article.image,
        url: article.url,
        publishedAt: article.publishedAt,
        category: "Premier League",
        readTime: 3,
      }))
      .filter((a: any) => a.title && a.summary);

    res.json({
      success: true,
      count: transformed.length,
      data: transformed,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

export default router;