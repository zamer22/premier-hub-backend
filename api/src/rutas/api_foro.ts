import { Router } from "express";
import type { Request, Response } from "express";

import supabase from "../db";
import { getSessionUserId } from "../live/session";
import {
  ModerationRateLimitError,
  moderateForumContent,
  type ModerationCheckResult,
} from "../services/moderationService";

const router = Router();

const FORUM_BUCKET = "forum-media";
const POST_SELECT = `
  id, subforum_id, id_usuario, title, body, image_path, image_width, image_height,
  status, created_at, updated_at, published_at,
  subforum:forum_subforums(id, slug, name),
  usuario:usuario!forum_posts_id_usuario_fkey(id_usuario, nickname, nombre_usuario, foto_perfil)
`;
const COMMENT_SELECT = `
  id, post_id, id_usuario, body, status, created_at, updated_at, published_at,
  usuario:usuario!forum_comments_id_usuario_fkey(id_usuario, nickname, nombre_usuario, foto_perfil)
`;

type ForumStatus = "published" | "pending_review" | "rejected" | "deleted";
type SortMode = "hot" | "recent" | "top" | "commented";
type VoteValue = -1 | 0 | 1;

type ImagePayload = {
  dataUrl: string;
  width?: number;
  height?: number;
};

type CreatePostBody = {
  subforum_id?: number;
  subforum_slug?: string;
  title?: string;
  body?: string;
  image?: ImagePayload | null;
};

type CreateCommentBody = {
  body?: string;
};

type VoteBody = {
  value?: number;
};

type ReportBody = {
  target_type?: "post" | "comment";
  target_id?: number;
  reason?: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Error interno del servidor";
}

function requireUser(req: Request, res: Response) {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Sesion no valida" });
    return null;
  }

  return userId;
}

function validateText(value: unknown, min: number, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < min || text.length > max) return null;
  return text;
}

function parseVote(value: unknown): VoteValue | null {
  const parsed = Number(value);
  if (parsed === -1 || parsed === 0 || parsed === 1) return parsed;
  return null;
}

function parseImage(value: ImagePayload | null | undefined) {
  if (!value?.dataUrl) return null;

  const match = value.dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("La imagen debe ser PNG, JPG o WebP");
  }

  const contentType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const extension = contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1];
  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("La imagen debe pesar menos de 5 MB");
  }

  return {
    buffer,
    contentType,
    extension,
    dataUrl: value.dataUrl,
    width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
    height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
  };
}

async function assertCanParticipate(userId: number) {
  const { data, error } = await supabase
    .from("user_restrictions")
    .select("id, reason, expires_at")
    .eq("id_usuario", userId)
    .eq("scope", "forum")
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);

  if (error) throw error;
  if (data?.length) {
    const err = new Error("Tu cuenta tiene restringida la participacion en el foro");
    err.name = "ForbiddenError";
    throw err;
  }
}

async function resolveSubforum(body: CreatePostBody) {
  let query = supabase.from("forum_subforums").select("id, slug, name, is_active").limit(1);

  if (body.subforum_id) {
    query = query.eq("id", Number(body.subforum_id));
  } else if (body.subforum_slug) {
    query = query.eq("slug", String(body.subforum_slug));
  } else {
    throw new Error("Selecciona un subforo");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) throw new Error("Subforo no disponible");
  return data;
}

async function createSignedImageUrl(path: string | null) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(FORUM_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data.signedUrl;
}

async function mapPost(row: any, userId: number | null) {
  const [{ count: commentsCount }, { data: votes }, signedUrlResult] = await Promise.all([
    supabase
      .from("forum_comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", row.id)
      .eq("status", "published"),
    supabase
      .from("forum_post_votes")
      .select("id_usuario, value")
      .eq("post_id", row.id),
    createSignedImageUrl(row.image_path),
  ]);

  const voteRows = votes || [];
  const score = voteRows.reduce((sum: number, vote: any) => sum + Number(vote.value || 0), 0);
  const myVote = userId
    ? Number(voteRows.find((vote: any) => Number(vote.id_usuario) === userId)?.value || 0)
    : 0;

  return {
    ...row,
    image_url: signedUrlResult,
    comments_count: commentsCount || 0,
    score,
    my_vote: myVote,
  };
}

async function mapComment(row: any, userId: number | null) {
  const { data: votes } = await supabase
    .from("forum_comment_votes")
    .select("id_usuario, value")
    .eq("comment_id", row.id);

  const voteRows = votes || [];
  const score = voteRows.reduce((sum: number, vote: any) => sum + Number(vote.value || 0), 0);
  const myVote = userId
    ? Number(voteRows.find((vote: any) => Number(vote.id_usuario) === userId)?.value || 0)
    : 0;

  return {
    ...row,
    score,
    my_vote: myVote,
  };
}

async function recordModerationEvent(input: {
  targetType: "post" | "comment";
  targetId: number;
  userId: number;
  moderation: ModerationCheckResult;
  action: "published" | "pending_review";
}) {
  const { error } = await supabase.from("moderation_events").insert({
    target_type: input.targetType,
    target_id: input.targetId,
    id_usuario: input.userId,
    scope: "forum",
    provider: input.moderation.provider,
    model: input.moderation.model,
    status: input.moderation.status || (input.moderation.flagged ? "flagged" : "clean"),
    action: input.action,
    categories: input.moderation.categories,
    category_scores: input.moderation.categoryScores,
    raw_response: input.moderation.rawResponse,
  });

  if (error) throw error;
}

function orderPosts(posts: any[], sort: SortMode) {
  const withTime = posts.map((post) => ({
    post,
    timestamp: new Date(post.published_at || post.created_at).getTime(),
  }));

  if (sort === "recent") {
    return withTime.sort((a, b) => b.timestamp - a.timestamp).map((item) => item.post);
  }

  if (sort === "top") {
    return withTime.sort((a, b) => b.post.score - a.post.score || b.timestamp - a.timestamp).map((item) => item.post);
  }

  if (sort === "commented") {
    return withTime
      .sort((a, b) => b.post.comments_count - a.post.comments_count || b.timestamp - a.timestamp)
      .map((item) => item.post);
  }

  return withTime
    .sort((a, b) => {
      const ageA = Math.max(1, (Date.now() - a.timestamp) / 36e5);
      const ageB = Math.max(1, (Date.now() - b.timestamp) / 36e5);
      const hotA = a.post.score * 2 + a.post.comments_count * 0.8 - ageA * 0.08;
      const hotB = b.post.score * 2 + b.post.comments_count * 0.8 - ageB * 0.08;
      return hotB - hotA;
    })
    .map((item) => item.post);
}

router.get("/subforos", async (_req, res) => {
  const { data, error } = await supabase
    .from("forum_subforums")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, data: data || [] });
});

router.get("/posts", async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    const sort = ["hot", "recent", "top", "commented"].includes(String(req.query.sort))
      ? (String(req.query.sort) as SortMode)
      : "hot";

    let query = supabase
      .from("forum_posts")
      .select(POST_SELECT)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(80);

    if (req.query.subforo) {
      const subforo = String(req.query.subforo);

      if (Number.isNaN(Number(subforo))) {
        const { data: selectedSubforum, error: subforumError } = await supabase
          .from("forum_subforums")
          .select("id")
          .eq("slug", subforo)
          .maybeSingle();

        if (subforumError) throw subforumError;
        if (!selectedSubforum) return res.json({ success: true, data: [] });
        query = query.eq("subforum_id", selectedSubforum.id);
      } else {
        query = query.eq("subforum_id", Number(subforo));
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    const posts = await Promise.all((data || []).map((post) => mapPost(post, userId)));
    return res.json({ success: true, data: orderPosts(posts, sort) });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.get("/posts/:id", async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    const postId = Number(req.params.id);
    if (!postId) return res.status(400).json({ success: false, error: "Post invalido" });

    const { data: post, error } = await supabase
      .from("forum_posts")
      .select(POST_SELECT)
      .eq("id", postId)
      .eq("status", "published")
      .maybeSingle();

    if (error) throw error;
    if (!post) return res.status(404).json({ success: false, error: "Post no encontrado" });

    const { data: comments, error: commentsError } = await supabase
      .from("forum_comments")
      .select(COMMENT_SELECT)
      .eq("post_id", postId)
      .eq("status", "published")
      .order("created_at", { ascending: true });

    if (commentsError) throw commentsError;

    const [mappedPost, mappedComments] = await Promise.all([
      mapPost(post, userId),
      Promise.all((comments || []).map((comment) => mapComment(comment, userId))),
    ]);

    return res.json({ success: true, data: { post: mappedPost, comments: mappedComments } });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/posts", async (req: Request<{}, {}, CreatePostBody>, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    await assertCanParticipate(userId);

    const title = validateText(req.body.title, 4, 160);
    const body = validateText(req.body.body, 1, 10000);
    if (!title || !body) {
      return res.status(400).json({ success: false, error: "Titulo o contenido invalido" });
    }

    const subforum = await resolveSubforum(req.body);
    const image = parseImage(req.body.image);
    const moderation = await moderateForumContent({
      text: `${title}\n\n${body}`,
      imageDataUrl: image?.dataUrl || null,
    });
    const status: ForumStatus = moderation.flagged ? "pending_review" : "published";
    let imagePath: string | null = null;

    if (image) {
      imagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${image.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(FORUM_BUCKET)
        .upload(imagePath, image.buffer, {
          contentType: image.contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;
    }

    const { data, error } = await supabase
      .from("forum_posts")
      .insert({
        subforum_id: subforum.id,
        id_usuario: userId,
        title,
        body,
        image_path: imagePath,
        image_width: image?.width,
        image_height: image?.height,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select(POST_SELECT)
      .single();

    if (error) throw error;
    await recordModerationEvent({
      targetType: "post",
      targetId: data.id,
      userId,
      moderation,
      action: status,
    });

    const mapped = status === "published" ? await mapPost(data, userId) : data;
    return res.status(201).json({ success: true, data: mapped, pendingReview: status === "pending_review" });
  } catch (error) {
    const status =
      error instanceof ModerationRateLimitError
        ? 429
        : error instanceof Error && error.name === "ForbiddenError"
          ? 403
          : 400;
    return res.status(status).json({ success: false, error: getErrorMessage(error) });
  }
});

router.delete("/posts/:id", async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { data, error } = await supabase
      .from("forum_posts")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", Number(req.params.id))
      .eq("id_usuario", userId)
      .neq("status", "deleted")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Post no encontrado" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/posts/:id/comments", async (req: Request<{ id: string }, {}, CreateCommentBody>, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    await assertCanParticipate(userId);

    const body = validateText(req.body.body, 1, 4000);
    if (!body) return res.status(400).json({ success: false, error: "Comentario invalido" });

    const postId = Number(req.params.id);
    const { data: post, error: postError } = await supabase
      .from("forum_posts")
      .select("id")
      .eq("id", postId)
      .eq("status", "published")
      .maybeSingle();

    if (postError) throw postError;
    if (!post) return res.status(404).json({ success: false, error: "Post no encontrado" });

    const moderation = await moderateForumContent({ text: body });
    const status: ForumStatus = moderation.flagged ? "pending_review" : "published";

    const { data, error } = await supabase
      .from("forum_comments")
      .insert({
        post_id: postId,
        id_usuario: userId,
        body,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select(COMMENT_SELECT)
      .single();

    if (error) throw error;
    await recordModerationEvent({
      targetType: "comment",
      targetId: data.id,
      userId,
      moderation,
      action: status,
    });

    const mapped = status === "published" ? await mapComment(data, userId) : data;
    return res.status(201).json({ success: true, data: mapped, pendingReview: status === "pending_review" });
  } catch (error) {
    const status =
      error instanceof ModerationRateLimitError
        ? 429
        : error instanceof Error && error.name === "ForbiddenError"
          ? 403
          : 400;
    return res.status(status).json({ success: false, error: getErrorMessage(error) });
  }
});

router.delete("/comments/:id", async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { data, error } = await supabase
      .from("forum_comments")
      .update({ status: "deleted", updated_at: new Date().toISOString() })
      .eq("id", Number(req.params.id))
      .eq("id_usuario", userId)
      .neq("status", "deleted")
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: "Comentario no encontrado" });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/posts/:id/vote", async (req: Request<{ id: string }, {}, VoteBody>, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const value = parseVote(req.body.value);
    const postId = Number(req.params.id);
    if (value === null || !postId) return res.status(400).json({ success: false, error: "Voto invalido" });

    if (value === 0) {
      const { error } = await supabase
        .from("forum_post_votes")
        .delete()
        .eq("post_id", postId)
        .eq("id_usuario", userId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("forum_post_votes")
        .upsert({ post_id: postId, id_usuario: userId, value }, { onConflict: "post_id,id_usuario" });
      if (error) throw error;
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/comments/:id/vote", async (req: Request<{ id: string }, {}, VoteBody>, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const value = parseVote(req.body.value);
    const commentId = Number(req.params.id);
    if (value === null || !commentId) return res.status(400).json({ success: false, error: "Voto invalido" });

    if (value === 0) {
      const { error } = await supabase
        .from("forum_comment_votes")
        .delete()
        .eq("comment_id", commentId)
        .eq("id_usuario", userId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("forum_comment_votes")
        .upsert({ comment_id: commentId, id_usuario: userId, value }, { onConflict: "comment_id,id_usuario" });
      if (error) throw error;
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

router.post("/reports", async (req: Request<{}, {}, ReportBody>, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;

    const targetType = req.body.target_type;
    const targetId = Number(req.body.target_id);
    const reason = validateText(req.body.reason || "Contenido inapropiado", 3, 800);

    if (!targetType || !["post", "comment"].includes(targetType) || !targetId || !reason) {
      return res.status(400).json({ success: false, error: "Reporte invalido" });
    }

    const { data, error } = await supabase
      .from("forum_reports")
      .insert({
        target_type: targetType,
        target_id: targetId,
        id_usuario: userId,
        reason,
      })
      .select("*")
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: getErrorMessage(error) });
  }
});

export { router as foroRouter };
export default router;
