import supabase from "../db";
import type {
  EventRow,
  H2HRow,
  LineupRow,
  LiveActivationClaimRow,
  LiveActivationRow,
  LiveChatMessageRow,
  LiveConfig,
  LiveMatchRow,
  StatRow,
  StatSnapshotRow,
} from "./types";

function throwIfError(error: { message?: string } | null, action: string) {
  if (error) {
    throw new Error(`${action}: ${error.message}`);
  }
}

export async function upsertLiveMatch(row: Partial<LiveMatchRow> & { id: number }) {
  const { data, error } = await supabase
    .from("live_matches")
    .upsert(row)
    .select("*")
    .single();

  throwIfError(error, "Error guardando live_matches");
  return data as LiveMatchRow;
}

export async function getVisibleLiveMatches() {
  const { data, error } = await supabase
    .from("live_matches")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  throwIfError(error, "Error leyendo live_matches");
  return (data || []) as LiveMatchRow[];
}

export async function getRecentCachedLiveMatches(hours = 2) {
  const minUpdatedAt = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("live_matches")
    .select("*")
    .eq("is_visible", true)
    .gte("updated_at", minUpdatedAt)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  throwIfError(error, "Error leyendo cache live");
  return (data || []) as LiveMatchRow[];
}

async function replaceFixtureRows<T extends { fixture_id: number }>(
  table: string,
  fixtureId: number,
  rows: T[],
) {
  const { error: deleteError } = await supabase.from(table).delete().eq("fixture_id", fixtureId);
  throwIfError(deleteError, `Error limpiando ${table}`);

  if (rows.length === 0) return;

  const { error: insertError } = await supabase.from(table).insert(rows);
  throwIfError(insertError, `Error guardando ${table}`);
}

export async function replaceLineups(fixtureId: number, rows: LineupRow[]) {
  await replaceFixtureRows("live_lineups", fixtureId, rows);
}

export async function getLineups(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_lineups")
    .select("fixture_id, team, player_number, player_name, player_position, player_grid, is_sub, sort_order")
    .eq("fixture_id", fixtureId)
    .order("team", { ascending: true })
    .order("is_sub", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("player_number", { ascending: true });

  throwIfError(error, "Error leyendo live_lineups");
  return (data || []) as LineupRow[];
}

export async function replaceStats(fixtureId: number, rows: StatRow[]) {
  await replaceFixtureRows("live_stats", fixtureId, rows);
}

export async function getStats(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_stats")
    .select("fixture_id, label, home_value, away_value")
    .eq("fixture_id", fixtureId);

  throwIfError(error, "Error leyendo live_stats");
  return (data || []) as StatRow[];
}

export async function getStatSnapshots(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_stat_snapshots")
    .select("fixture_id, minute, label, home_value, away_value")
    .eq("fixture_id", fixtureId)
    .order("minute", { ascending: true });

  throwIfError(error, "Error leyendo live_stat_snapshots");
  return (data || []) as StatSnapshotRow[];
}

export async function replaceEvents(fixtureId: number, rows: EventRow[]) {
  await replaceFixtureRows("live_events", fixtureId, rows);
}

export async function getEvents(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_events")
    .select("id, fixture_id, event_order, minute, extra, display_minute, team, team_id, team_name, team_logo, player, assist, type, detail, comments, source")
    .eq("fixture_id", fixtureId)
    .order("minute", { ascending: true })
    .order("event_order", { ascending: true });

  throwIfError(error, "Error leyendo live_events");
  return data || [];
}

export async function replaceH2H(fixtureId: number, rows: H2HRow[]) {
  await replaceFixtureRows("live_h2h", fixtureId, rows);
}

export async function getH2H(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_h2h")
    .select("*")
    .eq("fixture_id", fixtureId)
    .order("match_date", { ascending: false });

  throwIfError(error, "Error leyendo live_h2h");
  return (data || []) as H2HRow[];
}

export async function getActivations(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_activations")
    .select("*")
    .eq("fixture_id", fixtureId)
    .order("starts_at_minute", { ascending: true });

  throwIfError(error, "Error leyendo live_activations");
  return (data || []) as LiveActivationRow[];
}

export async function getActivationById(fixtureId: number, activationId: number) {
  const { data, error } = await supabase
    .from("live_activations")
    .select("*")
    .eq("fixture_id", fixtureId)
    .eq("id", activationId)
    .maybeSingle();

  throwIfError(error, "Error leyendo live_activations");
  return data as LiveActivationRow | null;
}

export async function getClaimedActivationIds(userId: number | null, activationIds: number[]) {
  if (!userId || activationIds.length === 0) return new Set<number>();

  const { data, error } = await supabase
    .from("live_activation_claims")
    .select("activation_id")
    .eq("id_usuario", userId)
    .in("activation_id", activationIds);

  throwIfError(error, "Error leyendo live_activation_claims");
  return new Set((data || []).map((item: any) => Number(item.activation_id)));
}

export async function getClaimsByActivation(userId: number, activationIds: number[]) {
  if (activationIds.length === 0) return new Map<number, LiveActivationClaimRow>();

  const { data, error } = await supabase
    .from("live_activation_claims")
    .select("id, activation_id, id_usuario, selected_option, is_correct, reward_points, claimed_at")
    .eq("id_usuario", userId)
    .in("activation_id", activationIds);

  throwIfError(error, "Error leyendo live_activation_claims");
  return new Map(((data || []) as LiveActivationClaimRow[]).map((claim) => [Number(claim.activation_id), claim]));
}

export async function createActivationClaim(input: {
  activation_id: number;
  fixture_id: number;
  id_usuario: number;
  selected_option: string | null;
  is_correct: boolean;
  reward_points: number;
}) {
  const { data, error } = await supabase
    .from("live_activation_claims")
    .insert(input)
    .select("id, activation_id, id_usuario, selected_option, is_correct, reward_points, claimed_at")
    .single();

  if (error?.code === "23505") {
    const duplicate = new Error("Activacion ya reclamada");
    duplicate.name = "DuplicateClaimError";
    throw duplicate;
  }

  throwIfError(error, "Error guardando live_activation_claims");
  return data as LiveActivationClaimRow;
}

export async function addUserMoney(userId: number, points: number) {
  if (points <= 0) return null;

  const { data: usuario, error: userError } = await supabase
    .from("usuario")
    .select("dinero")
    .eq("id_usuario", userId)
    .single();

  throwIfError(userError, "Error leyendo usuario");
  if (!usuario) {
    throw new Error("Usuario no encontrado");
  }

  const saldo = Number(usuario.dinero || 0) + points;
  const { error: updateError } = await supabase
    .from("usuario")
    .update({ dinero: saldo })
    .eq("id_usuario", userId);

  throwIfError(updateError, "Error actualizando usuario");
  return saldo;
}

export async function getChatMessages(fixtureId: number) {
  const { data, error } = await supabase
    .from("live_chat_messages")
    .select("id, fixture_id, id_usuario, username, message, created_at")
    .eq("fixture_id", fixtureId)
    .order("created_at", { ascending: false })
    .limit(80);

  throwIfError(error, "Error leyendo live_chat_messages");
  return ((data || []) as LiveChatMessageRow[]).reverse();
}

export async function createChatMessage(fixtureId: number, userId: number, message: string) {
  const { data: user, error: userError } = await supabase
    .from("usuario")
    .select("id_usuario, nickname, nombre_usuario")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (userError || !user) {
    const error = new Error("Usuario no encontrado");
    error.name = "UnauthorizedError";
    throw error;
  }

  const username = user.nickname || user.nombre_usuario || "Usuario";
  const { data, error } = await supabase
    .from("live_chat_messages")
    .insert({
      fixture_id: fixtureId,
      id_usuario: userId,
      username,
      message,
    })
    .select("id, fixture_id, id_usuario, username, message, created_at")
    .single();

  throwIfError(error, "Error guardando live_chat_messages");
  return data as LiveChatMessageRow;
}

export async function getLiveConfig(): Promise<LiveConfig> {
  const [statLabelsResult, emotesResult, settingsResult] = await Promise.all([
    supabase
      .from("live_stat_labels")
      .select("api_label, display_label, sort_order")
      .eq("is_enabled", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("live_chat_emotes")
      .select("token, label, src, kind, sort_order")
      .eq("is_enabled", true)
      .order("sort_order", { ascending: true }),
    supabase.from("live_runtime_settings").select("key, value"),
  ]);

  throwIfError(statLabelsResult.error, "Error leyendo live_stat_labels");
  throwIfError(emotesResult.error, "Error leyendo live_chat_emotes");
  throwIfError(settingsResult.error, "Error leyendo live_runtime_settings");

  const settings = Object.fromEntries(
    (settingsResult.data || []).map((row: any) => [row.key, row.value]),
  );

  return {
    statLabels: statLabelsResult.data || [],
    chatEmotes: emotesResult.data || [],
    settings,
  };
}
