export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  reward_points?: number;
  is_correct?: boolean;
  saldo?: number | null;
  running?: boolean;
  fixtureId?: number | null;
  message?: string;
};

export type LiveTeamSide = "home" | "away";
export type LiveActivationType = "poll" | "drop";

export type LiveMatchRow = {
  id: number;
  league: string;
  minute: string;
  minute_number: number | null;
  stadium: string | null;
  status: string;
  home_team_id: number | null;
  home_name: string;
  home_logo: string | null;
  home_score: number;
  away_team_id: number | null;
  away_name: string;
  away_logo: string | null;
  away_score: number;
  source: "api" | "manual";
  is_demo: boolean;
  is_visible: boolean;
  sort_order: number;
  updated_at: string;
};

export type LineupRow = {
  fixture_id: number;
  team: LiveTeamSide;
  player_number: number | null;
  player_name: string;
  player_position?: string | null;
  player_grid: string | null;
  is_sub: boolean;
  sort_order?: number;
};

export type StatRow = {
  fixture_id: number;
  label: string;
  home_value: string;
  away_value: string;
};

export type StatSnapshotRow = StatRow & {
  minute: number;
};

export type EventRow = {
  fixture_id: number;
  event_order?: number;
  minute: number | null;
  extra: number | null;
  display_minute: string | null;
  team: LiveTeamSide | null;
  team_id: number | null;
  team_name: string | null;
  team_logo: string | null;
  player: string | null;
  assist: string | null;
  type: string;
  detail: string;
  comments: string | null;
  source?: "api" | "manual";
};

export type H2HRow = {
  fixture_id: number;
  related_fixture_id: number;
  match_date: string | null;
  league: string;
  home_team_id: number | null;
  home_name: string;
  home_logo: string | null;
  home_goals: number | null;
  away_team_id: number | null;
  away_name: string;
  away_logo: string | null;
  away_goals: number | null;
};

export type LiveActivationRow = {
  id: number;
  fixture_id: number;
  type: LiveActivationType;
  title: string;
  description: string | null;
  payload: any;
  reward_points: number;
  starts_at_minute: number;
  expires_at_minute: number;
  status: string;
  created_at?: string;
};

export type LiveActivationClaimRow = {
  id: number;
  activation_id: number;
  id_usuario: number;
  selected_option: string | null;
  is_correct: boolean;
  reward_points: number;
  claimed_at: string;
};

export type LiveChatMessageRow = {
  id: number;
  fixture_id: number;
  id_usuario: number;
  username: string;
  message: string;
  created_at: string;
};

export type LiveConfig = {
  statLabels: Array<{
    api_label: string;
    display_label: string;
    sort_order: number;
  }>;
  chatEmotes: Array<{
    token: string;
    label: string;
    src: string;
    kind: "emote" | "sticker";
    sort_order: number;
  }>;
  settings: Record<string, unknown>;
};
