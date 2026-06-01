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
};

export type ModerationCheckResult = {
  flagged: boolean;
  status?: "clean" | "flagged" | "error";
  provider: "openai";
  model: string;
  categories: ModerationCategoryMap;
  categoryScores: ModerationScoreMap;
  rawResponse: OpenAIModerationResponse;
};

const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";

export class ModerationRateLimitError extends Error {
  constructor(message = "OpenAI Moderation esta saturado. Intenta publicar de nuevo en unos minutos.") {
    super(message);
    this.name = "ModerationRateLimitError";
  }
}

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY no esta configurada para moderar el foro");
  }

  return key;
}

export async function moderateForumContent(input: {
  text: string;
  imageDataUrl?: string | null;
}): Promise<ModerationCheckResult> {
  const key = getOpenAIKey();
  const text = input.text.trim();

  const moderationInput = input.imageDataUrl
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: input.imageDataUrl } },
      ]
    : text;

  const response = await fetch("https://api.openai.com/v1/moderations", {
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

  const json = (await response.json().catch(() => ({}))) as OpenAIModerationResponse & {
    error?: { message?: string };
  };

  if (!response.ok && response.status === 429) {
    return {
      flagged: false,
      status: "error",
      provider: "openai",
      model: MODERATION_MODEL,
      categories: { moderation_rate_limited: true },
      categoryScores: {},
      rawResponse: json,
    };
  }

  if (!response.ok) {
    throw new Error(json.error?.message || "No se pudo moderar el contenido");
  }

  const result = json.results?.[0];
  if (!result) {
    throw new Error("La moderacion no devolvio resultados");
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
