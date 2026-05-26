import type { EventRow, H2HRow, LineupRow, LiveMatchRow, StatRow } from "./types";

function getFixtureMinuteLabel(fixture: any): string {
  const elapsed = fixture?.fixture?.status?.elapsed;
  const extra = fixture?.fixture?.status?.extra;

  if (elapsed && extra) {
    return `${elapsed}+${extra}'`;
  }

  if (elapsed) {
    return `${elapsed}'`;
  }

  return "0'";
}

export function getFixtureMinuteNumber(fixture: any): number | null {
  const elapsed = fixture?.fixture?.status?.elapsed;
  return typeof elapsed === "number" ? elapsed : null;
}

export function mapFixtureToLiveMatchRow(fixture: any): Partial<LiveMatchRow> & { id: number } {
  return {
    id: fixture.fixture?.id,
    league: fixture.league?.name ?? "Premier League",
    minute: getFixtureMinuteLabel(fixture),
    minute_number: getFixtureMinuteNumber(fixture),
    stadium: fixture.fixture?.venue?.name ?? "",
    status: fixture.fixture?.status?.long ?? "Live",
    home_team_id: fixture.teams?.home?.id ?? null,
    home_name: fixture.teams?.home?.name ?? "",
    home_logo: fixture.teams?.home?.logo ?? "",
    home_score: fixture.goals?.home ?? 0,
    away_team_id: fixture.teams?.away?.id ?? null,
    away_name: fixture.teams?.away?.name ?? "",
    away_logo: fixture.teams?.away?.logo ?? "",
    away_score: fixture.goals?.away ?? 0,
    source: "api",
    is_visible: true,
    updated_at: new Date().toISOString(),
  };
}

export function mapFootballLineups(lineups: any[], fixtureId: number): LineupRow[] {
  if (lineups.length < 2) return [];

  const apiHomeTeamId = lineups[0]?.team?.id;
  const rows: LineupRow[] = [];

  for (const teamLineup of lineups) {
    const side = teamLineup.team?.id === apiHomeTeamId ? "home" : "away";

    for (const [index, item] of (teamLineup.startXI ?? []).entries()) {
      rows.push({
        fixture_id: fixtureId,
        team: side,
        player_number: item.player?.number ?? null,
        player_name: item.player?.name ?? "",
        player_position: item.player?.pos ?? null,
        player_grid: item.player?.grid ?? null,
        is_sub: false,
        sort_order: index,
      });
    }

    for (const [index, item] of (teamLineup.substitutes ?? []).entries()) {
      rows.push({
        fixture_id: fixtureId,
        team: side,
        player_number: item.player?.number ?? null,
        player_name: item.player?.name ?? "",
        player_position: item.player?.pos ?? null,
        player_grid: null,
        is_sub: true,
        sort_order: index,
      });
    }
  }

  return rows;
}

export function mapFootballStats(stats: any[], fixtureId: number): StatRow[] {
  if (stats.length < 2) return [];

  const homeStats: Record<string, string> = {};
  const awayStats: Record<string, string> = {};

  for (const item of stats[0]?.statistics ?? []) {
    homeStats[item.type] = String(item.value ?? "0");
  }

  for (const item of stats[1]?.statistics ?? []) {
    awayStats[item.type] = String(item.value ?? "0");
  }

  return Array.from(new Set([...Object.keys(homeStats), ...Object.keys(awayStats)])).map((label) => ({
    fixture_id: fixtureId,
    label,
    home_value: homeStats[label] ?? "0",
    away_value: awayStats[label] ?? "0",
  }));
}

export function mapFootballEvent(event: any, fixtureId: number, eventOrder = 0): EventRow {
  const elapsed = event?.time?.elapsed ?? null;
  const extra = event?.time?.extra ?? null;

  return {
    fixture_id: fixtureId,
    event_order: eventOrder,
    minute: elapsed,
    extra,
    display_minute: elapsed ? `${elapsed}${extra ? `+${extra}` : ""}'` : "",
    team: null,
    team_id: event?.team?.id ?? null,
    team_name: event?.team?.name ?? "",
    team_logo: event?.team?.logo ?? "",
    player: event?.player?.name ?? null,
    assist: event?.assist?.name ?? null,
    type: event?.type ?? "",
    detail: event?.detail ?? "",
    comments: event?.comments ?? null,
    source: "api",
  };
}

export function mapFootballH2H(items: any[], fixtureId: number): H2HRow[] {
  return items.map((item: any) => ({
    fixture_id: fixtureId,
    related_fixture_id: item.fixture?.id ?? 0,
    match_date: item.fixture?.date ?? null,
    league: item.league?.name ?? "",
    home_team_id: item.teams?.home?.id ?? null,
    home_name: item.teams?.home?.name ?? "",
    home_logo: item.teams?.home?.logo ?? "",
    home_goals: item.goals?.home ?? 0,
    away_team_id: item.teams?.away?.id ?? null,
    away_name: item.teams?.away?.name ?? "",
    away_logo: item.teams?.away?.logo ?? "",
    away_goals: item.goals?.away ?? 0,
  }));
}

export function mapH2HForClient(row: H2HRow) {
  return {
    fixture_id: row.related_fixture_id,
    date: row.match_date,
    league: row.league,
    status: "Finalizado",
    home: {
      id: row.home_team_id,
      name: row.home_name,
      logo: row.home_logo,
      goals: row.home_goals ?? 0,
    },
    away: {
      id: row.away_team_id,
      name: row.away_name,
      logo: row.away_logo,
      goals: row.away_goals ?? 0,
    },
  };
}
