import { Router, Request, Response } from "express";

import supabase from "../db";
import { footballFetch, PREMIER_LEAGUE_ID } from "./api_partidos";

const router = Router();

const DEFAULT_SEASONS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const DEFAULT_TIME_ZONE = "America/Mexico_City";
const DEFAULT_FIXTURE_ATTEMPTS = 18;

type ApiTeam = {
  id?: number;
  name?: string;
  logo?: string;
};

type ApiFixture = {
  fixture?: {
    id?: number;
    date?: string;
    status?: {
      short?: string;
    };
  };
  league?: {
    id?: number;
    name?: string;
    season?: number;
  };
  teams?: {
    home?: ApiTeam;
    away?: ApiTeam;
  };
  goals?: {
    home?: number | null;
    away?: number | null;
  };
};

type ApiLineupPlayer = {
  id?: number;
  name?: string;
  number?: number | null;
  pos?: string | null;
  grid?: string | null;
};

type ApiLineup = {
  team?: ApiTeam;
  formation?: string;
  startXI?: Array<{
    player?: ApiLineupPlayer;
  }>;
};

type ApiPlayerProfile = {
  id?: number;
  name?: string;
  firstname?: string;
  lastname?: string;
  photo?: string;
};

type ApiPlayerProfileItem = {
  player?: ApiPlayerProfile;
};

type WinnerSide = "home" | "away";
type PlayerLine = "goalkeeper" | "defense" | "midfield" | "attack";

type FixtureTeam = {
  id: number;
  name: string;
  logo?: string;
};

type FinishedWinnerFixture = {
  fixtureId: number;
  fixtureDate: string;
  homeGoals: number;
  awayGoals: number;
  homeTeam: FixtureTeam;
  awayTeam: FixtureTeam;
  winnerSide: WinnerSide;
  winnerTeam: FixtureTeam;
};

type DbChallengeRow = {
  id: string;
  challenge_date: string;
  api_fixture_id: number;
  league_id: number;
  league_name: string;
  season: number;
  fixture_date: string;
  home_team_id: number;
  home_team_name: string;
  home_team_logo: string | null;
  away_team_id: number;
  away_team_name: string;
  away_team_logo: string | null;
  home_goals: number;
  away_goals: number;
  winner_team_id: number;
  winner_team_name: string;
  winner_side: WinnerSide;
  formation: string;
  raw_fixture?: unknown;
  raw_lineups?: unknown;
  created_at: string;
  updated_at: string;
};

type DbPlayerRow = {
  id: string;
  challenge_id: string;
  api_player_id: number;
  api_team_id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  answer: string;
  number: number | null;
  position: string;
  line: PlayerLine;
  x_percent: number | string;
  y_percent: number | string;
  photo_url: string | null;
  sort_order: number;
  raw_player?: unknown;
  raw_lineup_player?: unknown;
  created_at: string;
};

type DbAttemptRow = {
  score: number;
  dinero_ganado: number;
  submitted_players: SubmittedPlayer[];
  points_awarded?: boolean;
  awarded_at?: string | null;
  created_at: string;
};

type SubmitAttemptResult = {
  score: number;
  dinero_ganado: number;
  nuevo_saldo: number | string | null;
  submitted_players: SubmittedPlayer[];
  created_at: string;
  points_awarded: boolean;
  awarded_at: string | null;
  already_played: boolean;
};

type SubmittedAttemptRow = {
  letters?: unknown;
  results?: unknown;
};

type SubmittedPlayer = {
  id?: unknown;
  guessed?: unknown;
  failed?: unknown;
  usedHint?: unknown;
  attempts?: SubmittedAttemptRow[];
};

type GeneratedPlayer = {
  api_player_id: number;
  api_team_id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  answer: string;
  number: number | null;
  position: string;
  line: PlayerLine;
  x_percent: number;
  y_percent: number;
  photo_url: string | null;
  sort_order: number;
  raw_player: unknown;
  raw_lineup_player: unknown;
};

type GeneratedChallenge = {
  challenge_date: string;
  api_fixture_id: number;
  league_id: number;
  league_name: string;
  season: number;
  fixture_date: string;
  home_team_id: number;
  home_team_name: string;
  home_team_logo: string | null;
  away_team_id: number;
  away_team_name: string;
  away_team_logo: string | null;
  home_goals: number;
  away_goals: number;
  winner_team_id: number;
  winner_team_name: string;
  winner_side: WinnerSide;
  formation: string;
  raw_fixture: unknown;
  raw_lineups: unknown;
  players: GeneratedPlayer[];
};

type StandardApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string;
  detail?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object") {
    const maybeError = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const messageParts = [
      maybeError.message,
      maybeError.details,
      maybeError.hint,
      maybeError.code ? `code: ${maybeError.code}` : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    if (messageParts.length) return messageParts.join(" | ");
  }

  return "Error interno del servidor";
}

function getTodayDate() {
  const timeZone =
    process.env.MISSING_XI_TIME_ZONE || process.env.WORDLE_TIME_ZONE || DEFAULT_TIME_ZONE;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getSessionUserId(req: Request) {
  const rawId = (req as any).signedCookies?.ph_session;
  const userId = Number(rawId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getSeasonPool() {
  const rawSeasons = process.env.MISSING_XI_SEASONS;
  if (!rawSeasons) return DEFAULT_SEASONS;

  const seasons = rawSeasons
    .split(",")
    .map((season) => Number(season.trim()))
    .filter((season) => Number.isInteger(season) && season > 1990);

  return seasons.length ? seasons : DEFAULT_SEASONS;
}

function getSeedFromString(value: string) {
  let seed = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    seed ^= value.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return seed >>> 0;
}

function createSeededRandom(seedValue: string) {
  let state = getSeedFromString(seedValue) || 1;

  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seedValue: string) {
  const shuffled = [...items];
  const random = createSeededRandom(seedValue);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function getSeasonLabel(season: number) {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}

function normalizeAnswer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
}

function normalizeAttemptLetters(value: unknown) {
  if (!Array.isArray(value)) return "";

  return normalizeAnswer(
    value
      .map((letter) => (typeof letter === "string" ? letter : ""))
      .join("")
  );
}

function normalizeSubmittedPlayers(value: unknown): SubmittedPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((player): player is SubmittedPlayer => {
    return Boolean(player && typeof player === "object");
  });
}

function getSingleSurnameAnswer(value: string) {
  const particles = new Set([
    "AL",
    "BIN",
    "DA",
    "DAS",
    "DE",
    "DEL",
    "DEN",
    "DER",
    "DI",
    "DOS",
    "DU",
    "EL",
    "IBN",
    "LA",
    "LE",
    "VAN",
    "VON",
  ]);
  const tokens = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z]+/)
    .map((token) => normalizeAnswer(token))
    .filter((token) => token && !particles.has(token));

  return tokens[tokens.length - 1] || normalizeAnswer(value);
}

function compactName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNameParts(profile: ApiPlayerProfile | null, lineupPlayer: ApiLineupPlayer) {
  const displayName = compactName(profile?.name) || compactName(lineupPlayer.name) || "Jugador";
  const profileFirstName = compactName(profile?.firstname);
  const profileLastName = compactName(profile?.lastname);

  if (profileFirstName || profileLastName) {
    return {
      firstName: profileFirstName,
      lastName: profileLastName,
      displayName,
    };
  }

  const nameParts = displayName.split(/\s+/).filter(Boolean);

  return {
    firstName: nameParts[0] || null,
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : displayName,
    displayName,
  };
}

function parseGrid(grid: string | null | undefined) {
  if (!grid) return null;

  const [rawRow, rawColumn] = grid.split(":");
  const row = Number(rawRow);
  const column = Number(rawColumn);

  if (!Number.isFinite(row) || !Number.isFinite(column)) return null;
  if (row <= 0 || column <= 0) return null;

  return { row, column };
}

function getLineFromApiPosition(position: string | null | undefined): PlayerLine {
  const normalized = (position || "").toUpperCase();

  if (normalized.includes("G")) return "goalkeeper";
  if (normalized.includes("D")) return "defense";
  if (normalized.includes("M")) return "midfield";
  if (normalized.includes("F") || normalized.includes("A")) return "attack";

  return "midfield";
}

function getLineFromCoordinates(yPercent: number): PlayerLine {
  if (yPercent >= 78) return "goalkeeper";
  if (yPercent >= 60) return "defense";
  if (yPercent >= 36) return "midfield";
  return "attack";
}

function getPositionFromLine(line: PlayerLine, xPercent: number, yPercent: number) {
  if (line === "goalkeeper") return "GK";

  if (line === "defense") {
    if (xPercent <= 30) return "LB";
    if (xPercent >= 70) return "RB";
    return "CB";
  }

  if (line === "midfield") {
    if (yPercent >= 52 && xPercent > 38 && xPercent < 62) return "CDM";
    if (yPercent <= 42 && xPercent > 38 && xPercent < 62) return "CAM";
    return "CM";
  }

  if (xPercent <= 35) return "LW";
  if (xPercent >= 65) return "RW";
  return "ST";
}

function getGridCoordinates(player: ApiLineupPlayer, starters: ApiLineupPlayer[]) {
  const currentGrid = parseGrid(player.grid);
  if (!currentGrid) return null;

  const parsedGrids = starters
    .map((starter) => parseGrid(starter.grid))
    .filter((grid): grid is { row: number; column: number } => Boolean(grid));

  if (!parsedGrids.length) return null;

  const maxRow = Math.max(...parsedGrids.map((grid) => grid.row));
  const maxColumnByRow = parsedGrids.reduce<Record<number, number>>((result, grid) => {
    result[grid.row] = Math.max(result[grid.row] || 0, grid.column);
    return result;
  }, {});

  const columnsInRow = maxColumnByRow[currentGrid.row] || currentGrid.column;
  const xPercent = (currentGrid.column / (columnsInRow + 1)) * 100;
  const yPercent = maxRow > 1 ? 88 - ((currentGrid.row - 1) / (maxRow - 1)) * 70 : 50;

  return {
    xPercent: Number(xPercent.toFixed(2)),
    yPercent: Number(yPercent.toFixed(2)),
  };
}

function getFallbackCoordinates(
  player: ApiLineupPlayer,
  playerIndex: number,
  starters: ApiLineupPlayer[],
) {
  const line = getLineFromApiPosition(player.pos);
  const sameLine = starters
    .map((starter, index) => ({ starter, index, line: getLineFromApiPosition(starter.pos) }))
    .filter((item) => item.line === line);
  const lineIndex = sameLine.findIndex((item) => item.index === playerIndex);
  const safeLineIndex = lineIndex >= 0 ? lineIndex : 0;
  const xPercent = ((safeLineIndex + 1) / (sameLine.length + 1)) * 100;
  const yByLine: Record<PlayerLine, number> = {
    attack: 20,
    midfield: 48,
    defense: 70,
    goalkeeper: 88,
  };

  return {
    xPercent: Number(xPercent.toFixed(2)),
    yPercent: yByLine[line],
  };
}

function getFinishedWinnerFixture(fixture: ApiFixture): FinishedWinnerFixture | null {
  const homeGoals = fixture.goals?.home;
  const awayGoals = fixture.goals?.away;
  const homeTeam = fixture.teams?.home;
  const awayTeam = fixture.teams?.away;
  const status = fixture.fixture?.status?.short;

  const isFinished =
    status === "FT" ||
    status === "AET" ||
    status === "PEN" ||
    (typeof homeGoals === "number" && typeof awayGoals === "number");

  if (!isFinished) return null;
  if (typeof homeGoals !== "number" || typeof awayGoals !== "number") return null;
  if (homeGoals === awayGoals) return null;
  if (!fixture.fixture?.id || !fixture.fixture.date) return null;
  if (!homeTeam?.id || !homeTeam.name || !awayTeam?.id || !awayTeam.name) return null;

  const winnerSide: WinnerSide = homeGoals > awayGoals ? "home" : "away";
  const safeHomeTeam = {
    id: homeTeam.id,
    name: homeTeam.name,
    logo: homeTeam.logo,
  };
  const safeAwayTeam = {
    id: awayTeam.id,
    name: awayTeam.name,
    logo: awayTeam.logo,
  };
  const winnerTeam = winnerSide === "home" ? safeHomeTeam : safeAwayTeam;

  return {
    fixtureId: fixture.fixture.id,
    fixtureDate: fixture.fixture.date,
    homeGoals,
    awayGoals,
    homeTeam: safeHomeTeam,
    awayTeam: safeAwayTeam,
    winnerSide,
    winnerTeam,
  };
}

async function getPlayerProfile(playerId: number, season: number) {
  try {
    const data = await footballFetch<ApiPlayerProfileItem[]>("/players", {
      id: playerId,
      season,
    });

    return data.response?.[0]?.player || null;
  } catch (error) {
    console.warn(`[missing-xi] No se pudo obtener foto del jugador ${playerId}`, error);
    return null;
  }
}

async function buildGeneratedPlayers(
  starters: ApiLineupPlayer[],
  teamId: number,
  season: number,
): Promise<GeneratedPlayer[]> {
  const profiles = await Promise.all(
    starters.map((player) => (player.id ? getPlayerProfile(player.id, season) : null)),
  );

  const mappedPlayers = starters.map<GeneratedPlayer | null>((player, index) => {
    if (!player.id) return null;

    const profile = profiles[index];
    const names = getNameParts(profile, player);
    const answer = getSingleSurnameAnswer(names.lastName || names.displayName);
    const coordinates =
      getGridCoordinates(player, starters) || getFallbackCoordinates(player, index, starters);
    const line =
      player.pos && getLineFromApiPosition(player.pos) !== "midfield"
        ? getLineFromApiPosition(player.pos)
        : getLineFromCoordinates(coordinates.yPercent);
    const position = getPositionFromLine(line, coordinates.xPercent, coordinates.yPercent);

    if (!answer) return null;

    return {
      api_player_id: player.id,
      api_team_id: teamId,
      first_name: names.firstName,
      last_name: names.lastName,
      display_name: names.displayName,
      answer,
      number: typeof player.number === "number" ? player.number : null,
      position,
      line,
      x_percent: coordinates.xPercent,
      y_percent: coordinates.yPercent,
      photo_url: profile?.photo || null,
      sort_order: index + 1,
      raw_player: profile as unknown,
      raw_lineup_player: player as unknown,
    };
  });

  return mappedPlayers.filter((player): player is GeneratedPlayer => player !== null);
}

async function getChallengeFromDb(challengeDate: string) {
  const { data: challenge, error: challengeError } = await supabase
    .from("missing_xi_challenges")
    .select("*")
    .eq("challenge_date", challengeDate)
    .maybeSingle();

  if (challengeError) throw challengeError;
  if (!challenge) return null;

  const { data: players, error: playersError } = await supabase
    .from("missing_xi_players")
    .select("*")
    .eq("challenge_id", challenge.id)
    .order("sort_order", { ascending: true });

  if (playersError) throw playersError;
  if (!players?.length) {
    throw new Error("El reto Missing XI existe, pero no tiene jugadores guardados");
  }

  return mapDbChallenge(challenge as DbChallengeRow, players as DbPlayerRow[]);
}

async function hasStoredFixture(apiFixtureId: number) {
  const { data, error } = await supabase
    .from("missing_xi_challenges")
    .select("id")
    .eq("api_fixture_id", apiFixtureId)
    .maybeSingle();

  if (error) throw error;

  return Boolean(data);
}

function mapDbChallenge(challenge: DbChallengeRow, players: DbPlayerRow[]) {
  return {
    id: challenge.id,
    challengeDate: challenge.challenge_date,
    apiFixtureId: challenge.api_fixture_id,
    league: {
      id: challenge.league_id,
      name: challenge.league_name,
      season: challenge.season,
      seasonLabel: getSeasonLabel(challenge.season),
    },
    fixture: {
      date: challenge.fixture_date,
      homeTeam: {
        id: challenge.home_team_id,
        name: challenge.home_team_name,
        logo: challenge.home_team_logo,
      },
      awayTeam: {
        id: challenge.away_team_id,
        name: challenge.away_team_name,
        logo: challenge.away_team_logo,
      },
      homeGoals: challenge.home_goals,
      awayGoals: challenge.away_goals,
      winner: {
        id: challenge.winner_team_id,
        name: challenge.winner_team_name,
        side: challenge.winner_side,
      },
      formation: challenge.formation,
    },
    players: players.map((player) => ({
      id: player.id,
      apiPlayerId: player.api_player_id,
      apiTeamId: player.api_team_id,
      firstName: player.first_name,
      lastName: player.last_name,
      displayName: player.display_name,
      answer: getSingleSurnameAnswer(player.last_name || player.display_name || player.answer),
      number: player.number,
      position: player.position,
      line: player.line,
      xPercent: Number(player.x_percent),
      yPercent: Number(player.y_percent),
      photoUrl: player.photo_url,
      guessed: false,
      failed: false,
      usedHint: false,
      attempts: [],
    })),
  };
}

function mapDbAttempt(attempt: DbAttemptRow | null) {
  if (!attempt) return null;

  return {
    score: Number(attempt.score || 0),
    dinero_ganado: Number(attempt.dinero_ganado || 0),
    submitted_players: attempt.submitted_players || [],
    points_awarded: attempt.points_awarded === true,
    awarded_at: attempt.awarded_at || null,
    created_at: attempt.created_at,
  };
}

function applyAttemptToChallenge(challenge: ReturnType<typeof mapDbChallenge>, attempt: DbAttemptRow | null) {
  const mappedAttempt = mapDbAttempt(attempt);
  if (!mappedAttempt) return challenge;

  const submittedMap = new Map(
    mappedAttempt.submitted_players
      .filter((player) => typeof player.id === "string")
      .map((player) => [player.id as string, player])
  );

  return {
    ...challenge,
    played: true,
    attempt: mappedAttempt,
    players: challenge.players.map((player) => {
      const submitted = submittedMap.get(player.id);
      if (!submitted) return player;

      return {
        ...player,
        guessed: submitted.guessed === true,
        failed: submitted.failed === true,
        usedHint: submitted.usedHint === true,
        attempts: Array.isArray(submitted.attempts) ? submitted.attempts : [],
      };
    }),
  };
}

async function getUserAttempt(challengeId: string, userId: number) {
  const { data, error } = await supabase
    .from("missing_xi_attempts")
    .select("score, dinero_ganado, submitted_players, points_awarded, awarded_at, created_at")
    .eq("challenge_id", challengeId)
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      console.warn("[missing-xi] Tabla missing_xi_attempts no existe todavia");
      return null;
    }

    throw error;
  }

  return (data || null) as DbAttemptRow | null;
}

function calculateMissingXIScore(dbPlayers: DbPlayerRow[], submittedPlayers: SubmittedPlayer[]) {
  const dbPlayerMap = new Map(dbPlayers.map((player) => [player.id, player]));
  const submittedIds = new Set<string>();

  let score = 0;
  let dineroGanado = 0;

  const normalizedSubmitted = submittedPlayers.map((submitted) => {
    const id = typeof submitted.id === "string" ? submitted.id : "";
    const dbPlayer = dbPlayerMap.get(id);
    const attempts = Array.isArray(submitted.attempts) ? submitted.attempts : [];
    const hasCorrectAttempt = dbPlayer
      ? attempts.some((attempt) => normalizeAttemptLetters(attempt.letters) === dbPlayer.answer)
      : false;
    const guessed = Boolean(dbPlayer && hasCorrectAttempt);
    const failed = !guessed;
    const usedHint = submitted.usedHint === true;

    if (id) submittedIds.add(id);
    if (guessed) {
      score += 1;
      dineroGanado += usedHint ? 50 : 100;
    }

    return {
      id,
      guessed,
      failed,
      usedHint,
      attempts,
    };
  });

  const expectedIds = new Set(dbPlayers.map((player) => player.id));
  const hasInvalidPlayers =
    normalizedSubmitted.length !== expectedIds.size ||
    submittedIds.size !== expectedIds.size ||
    normalizedSubmitted.some((player) => !expectedIds.has(player.id));

  return {
    hasInvalidPlayers,
    score,
    dineroGanado,
    submittedPlayers: normalizedSubmitted,
  };
}

async function generateMissingXIChallenge(challengeDate: string): Promise<GeneratedChallenge> {
  const seasons = shuffleWithSeed(getSeasonPool(), `${challengeDate}:seasons`);
  const maxFixtureAttempts =
    Number(process.env.MISSING_XI_FIXTURE_ATTEMPTS) || DEFAULT_FIXTURE_ATTEMPTS;
  let fixtureAttempts = 0;

  for (const season of seasons) {
    const fixturesData = await footballFetch<ApiFixture[]>("/fixtures", {
      league: PREMIER_LEAGUE_ID,
      season,
    });
    const fixtures = shuffleWithSeed(fixturesData.response || [], `${challengeDate}:${season}`);

    for (const fixture of fixtures) {
      if (fixtureAttempts >= maxFixtureAttempts) {
        throw new Error("No se encontro un partido con alineacion disponible para Missing XI");
      }

      const fixtureInfo = getFinishedWinnerFixture(fixture);
      if (!fixtureInfo) continue;
      if (await hasStoredFixture(fixtureInfo.fixtureId)) continue;

      fixtureAttempts += 1;

      const lineupsData = await footballFetch<ApiLineup[]>("/fixtures/lineups", {
        fixture: fixtureInfo.fixtureId,
      });
      const lineups = lineupsData.response || [];
      const winnerLineup = lineups.find((lineup) => lineup.team?.id === fixtureInfo.winnerTeam.id);
      const starters = (winnerLineup?.startXI || [])
        .map((item) => item.player)
        .filter((player): player is ApiLineupPlayer => Boolean(player))
        .slice(0, 11);

      if (!winnerLineup?.formation || starters.length < 11) continue;

      const players = await buildGeneratedPlayers(starters, fixtureInfo.winnerTeam.id, season);
      if (players.length < 11) continue;

      return {
        challenge_date: challengeDate,
        api_fixture_id: fixtureInfo.fixtureId,
        league_id: fixture.league?.id || PREMIER_LEAGUE_ID,
        league_name: fixture.league?.name || "Premier League",
        season,
        fixture_date: fixtureInfo.fixtureDate,
        home_team_id: fixtureInfo.homeTeam.id,
        home_team_name: fixtureInfo.homeTeam.name,
        home_team_logo: fixtureInfo.homeTeam.logo || null,
        away_team_id: fixtureInfo.awayTeam.id,
        away_team_name: fixtureInfo.awayTeam.name,
        away_team_logo: fixtureInfo.awayTeam.logo || null,
        home_goals: fixtureInfo.homeGoals,
        away_goals: fixtureInfo.awayGoals,
        winner_team_id: fixtureInfo.winnerTeam.id,
        winner_team_name: fixtureInfo.winnerTeam.name,
        winner_side: fixtureInfo.winnerSide,
        formation: winnerLineup.formation,
        raw_fixture: fixture,
        raw_lineups: lineups,
        players,
      };
    }
  }

  throw new Error("No se pudo generar el reto Missing XI con las temporadas configuradas");
}

async function saveGeneratedChallenge(generatedChallenge: GeneratedChallenge) {
  const { players, ...challengePayload } = generatedChallenge;

  const { data: challenge, error: challengeError } = await supabase
    .from("missing_xi_challenges")
    .insert(challengePayload)
    .select("*")
    .single();

  if (challengeError) {
    if (challengeError.code === "23505") {
      const cachedChallenge = await getChallengeFromDb(generatedChallenge.challenge_date);
      if (cachedChallenge) return cachedChallenge;
    }

    throw challengeError;
  }

  const playerPayload = players.map((player) => ({
    ...player,
    challenge_id: challenge.id,
  }));

  const { error: playersError } = await supabase.from("missing_xi_players").insert(playerPayload);

  if (playersError) {
    await supabase.from("missing_xi_challenges").delete().eq("id", challenge.id);
    throw playersError;
  }

  return getChallengeFromDb(generatedChallenge.challenge_date);
}

router.get("/daily", async (req: Request, res: Response<StandardApiResponse>) => {
  try {
    const challengeDate = getTodayDate();
    const cachedChallenge = await getChallengeFromDb(challengeDate);

    if (cachedChallenge) {
      const userId = getSessionUserId(req);
      const attempt = userId ? await getUserAttempt(cachedChallenge.id, userId) : null;
      return res.json({ success: true, data: applyAttemptToChallenge(cachedChallenge, attempt) });
    }

    const generatedChallenge = await generateMissingXIChallenge(challengeDate);
    const savedChallenge = await saveGeneratedChallenge(generatedChallenge);

    return res.json({ success: true, data: savedChallenge });
  } catch (error: unknown) {
    console.error("[missing-xi/daily]", error);
    return res.status(500).json({
      success: false,
      error: "No pudimos preparar el reto diario de Missing XI. Intenta de nuevo en unos minutos.",
      detail: process.env.NODE_ENV !== "production" ? getErrorMessage(error) : undefined,
    });
  }
});

router.post("/submit", async (req: Request, res: Response<StandardApiResponse>) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: "No autenticado" });
    }

    const { challenge_id, players } = req.body as {
      challenge_id?: string;
      players?: unknown;
    };

    if (!challenge_id) {
      return res.status(400).json({ success: false, error: "Datos invalidos" });
    }

    const existingAttempt = await getUserAttempt(challenge_id, userId);
    if (existingAttempt) {
      return res.status(409).json({
        success: false,
        error: "Ya completaste este Missing XI",
        data: mapDbAttempt(existingAttempt),
      });
    }

    const { data: challenge, error: challengeError } = await supabase
      .from("missing_xi_challenges")
      .select("id")
      .eq("id", challenge_id)
      .single();

    if (challengeError) throw challengeError;
    if (!challenge) {
      return res.status(404).json({ success: false, error: "Reto no encontrado" });
    }

    const { data: dbPlayers, error: playersError } = await supabase
      .from("missing_xi_players")
      .select("*")
      .eq("challenge_id", challenge_id);

    if (playersError) throw playersError;
    if (!dbPlayers?.length) {
      return res.status(404).json({ success: false, error: "El reto no tiene jugadores" });
    }

    const submittedPlayers = normalizeSubmittedPlayers(players);
    const result = calculateMissingXIScore(dbPlayers as DbPlayerRow[], submittedPlayers);

    if (result.hasInvalidPlayers) {
      return res.status(400).json({
        success: false,
        error: "Los jugadores enviados no coinciden con el reto",
      });
    }

    const { data: submitRows, error: submitError } = await supabase.rpc(
      "submit_missing_xi_attempt",
      {
        p_challenge_id: challenge_id,
        p_id_usuario: userId,
        p_submitted_players: result.submittedPlayers,
        p_score: result.score,
        p_dinero_ganado: result.dineroGanado,
      }
    );

    if (submitError) throw submitError;

    const submitResult = (
      Array.isArray(submitRows) ? submitRows[0] : submitRows
    ) as SubmitAttemptResult | null;

    if (!submitResult) {
      throw new Error("No se pudo guardar el intento de Missing XI");
    }

    if (submitResult.already_played) {
      return res.status(409).json({
        success: false,
        error: "Ya completaste este Missing XI",
        data: {
          score: Number(submitResult.score || 0),
          dinero_ganado: Number(submitResult.dinero_ganado || 0),
          submitted_players: submitResult.submitted_players || [],
          points_awarded: submitResult.points_awarded === true,
          awarded_at: submitResult.awarded_at || null,
          created_at: submitResult.created_at,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        score: Number(submitResult.score || 0),
        dinero_ganado: Number(submitResult.dinero_ganado || 0),
        nuevo_saldo: Number(submitResult.nuevo_saldo || 0),
        submitted_players: submitResult.submitted_players || [],
        points_awarded: submitResult.points_awarded === true,
        awarded_at: submitResult.awarded_at || null,
      },
    });
  } catch (error: unknown) {
    console.error("[missing-xi/submit]", error);
    return res.status(500).json({
      success: false,
      error: "Error interno al guardar el intento",
      detail: process.env.NODE_ENV !== "production" ? getErrorMessage(error) : undefined,
    });
  }
});

export default router;
