type ModerationCategoryMap = Record<string, boolean>;
type ModerationScoreMap = Record<string, number>;

type OpenAIModerationResult = {
  flagged: boolean;
  categories?: ModerationCategoryMap;
  category_scores?: ModerationScoreMap;
};

type OpenAIModerationResponse = {
  id?: string;
  model?: string;
  results?: OpenAIModerationResult[];
  error?: { message?: string };
  skipped?: boolean;
  reason?: string;
};

export type ModerationCheckResult = {
  flagged: boolean;
  status?: "clean" | "flagged" | "error";
  provider: "openai" | "fallback";
  model: string;
  categories: ModerationCategoryMap;
  categoryScores: ModerationScoreMap;
  rawResponse: OpenAIModerationResponse;
};

const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";
const FALLBACK_MODEL = "moderation-unavailable";

export class ModerationRateLimitError extends Error {
  constructor(message = "OpenAI Moderation esta saturado. Intenta publicar de nuevo en unos minutos.") {
    super(message);
    this.name = "ModerationRateLimitError";
  }
}

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

function fallbackModeration(reason: string, categories: ModerationCategoryMap = {}): ModerationCheckResult {
  return {
    flagged: false,
    status: "error",
    provider: "fallback",
    model: FALLBACK_MODEL,
    categories: {
      moderation_unavailable: true,
      ...categories,
    },
    categoryScores: {},
    rawResponse: {
      skipped: true,
      reason,
    },
  };
}

export async function moderateForumContent(input: {
  text: string;
  imageDataUrl?: string | null;
}): Promise<ModerationCheckResult> {
  const key = getOpenAIKey();
  if (!key) {
    return fallbackModeration("OPENAI_API_KEY no esta configurada", {
      missing_openai_api_key: true,
    });
  }

  const text = input.text.trim();

  const moderationInput = input.imageDataUrl
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: input.imageDataUrl } },
      ]
    : text;

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        input: moderationInput,
      }),
    });
  } catch (error) {
    return fallbackModeration(error instanceof Error ? error.message : "No se pudo conectar con OpenAI", {
      openai_request_failed: true,
    });
  }

  const json = (await response.json().catch(() => ({}))) as OpenAIModerationResponse;

  if (!response.ok && response.status === 429) {
    return fallbackModeration(json.error?.message || "OpenAI Moderation esta saturado", {
      moderation_rate_limited: true,
    });
  }

  if (!response.ok) {
    return fallbackModeration(json.error?.message || "No se pudo moderar el contenido", {
      openai_response_error: true,
    });
  }

  const result = json.results?.[0];
  if (!result) {
    return fallbackModeration("La moderacion no devolvio resultados", {
      openai_empty_results: true,
    });
  }

  return {
    flagged: result.flagged === true,
    status: result.flagged === true ? "flagged" : "clean",
    provider: "openai",
    model: json.model || MODERATION_MODEL,
    categories: result.categories || {},
    categoryScores: result.category_scores || {},
    rawResponse: json,
  };
}
