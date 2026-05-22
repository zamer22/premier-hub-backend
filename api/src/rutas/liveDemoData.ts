export const LIVE_DEMO_FIXTURE_ID = 990000001;

export const liveDemoMatch = {
  id: LIVE_DEMO_FIXTURE_ID,
  league: "Premier League",
  minute: "0'",
  stadium: "Emirates Stadium",
  status: "Not Started",
  home_name: "Arsenal",
  home_logo: "https://media.api-sports.io/football/teams/42.png",
  home_score: 0,
  away_name: "Liverpool",
  away_logo: "https://media.api-sports.io/football/teams/40.png",
  away_score: 0,
  updated_at: new Date().toISOString(),
  is_demo: true,
};

export const liveDemoLineups = [
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 22, player_name: "David Raya", player_grid: "1:1", player_position: "GK", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 4, player_name: "Ben White", player_grid: "2:1", player_position: "RB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 2, player_name: "William Saliba", player_grid: "2:2", player_position: "CB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 6, player_name: "Gabriel Magalhaes", player_grid: "2:3", player_position: "CB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 12, player_name: "Jurrien Timber", player_grid: "2:4", player_position: "LB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 8, player_name: "Martin Odegaard", player_grid: "3:1", player_position: "CM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 41, player_name: "Declan Rice", player_grid: "3:2", player_position: "DM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 29, player_name: "Kai Havertz", player_grid: "3:3", player_position: "CM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 7, player_name: "Bukayo Saka", player_grid: "4:1", player_position: "RW", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 11, player_name: "Gabriel Martinelli", player_grid: "4:2", player_position: "LW", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 9, player_name: "Gabriel Jesus", player_grid: "4:3", player_position: "ST", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 1, player_name: "Aaron Ramsdale", player_position: "GK", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 19, player_name: "Leandro Trossard", player_position: "LW", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 5, player_name: "Thomas Partey", player_position: "DM", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 14, player_name: "Eddie Nketiah", player_position: "ST", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "home", player_number: 18, player_name: "Takehiro Tomiyasu", player_position: "DF", is_sub: true },

  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 1, player_name: "Alisson Becker", player_grid: "1:1", player_position: "GK", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 66, player_name: "Trent Alexander-Arnold", player_grid: "2:1", player_position: "RB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 5, player_name: "Ibrahima Konate", player_grid: "2:2", player_position: "CB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 4, player_name: "Virgil van Dijk", player_grid: "2:3", player_position: "CB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 26, player_name: "Andrew Robertson", player_grid: "2:4", player_position: "LB", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 10, player_name: "Alexis Mac Allister", player_grid: "3:1", player_position: "CM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 8, player_name: "Dominik Szoboszlai", player_grid: "3:2", player_position: "CM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 17, player_name: "Curtis Jones", player_grid: "3:3", player_position: "CM", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 11, player_name: "Mohamed Salah", player_grid: "4:1", player_position: "RW", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 7, player_name: "Luis Diaz", player_grid: "4:2", player_position: "LW", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 9, player_name: "Darwin Nunez", player_grid: "4:3", player_position: "ST", is_sub: false },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 62, player_name: "Caoimhin Kelleher", player_position: "GK", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 20, player_name: "Diogo Jota", player_position: "FW", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 18, player_name: "Cody Gakpo", player_position: "LW", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 3, player_name: "Wataru Endo", player_position: "DM", is_sub: true },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, team: "away", player_number: 21, player_name: "Kostas Tsimikas", player_position: "LB", is_sub: true },
] as const;

export const liveDemoStats = [
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Shots on Goal", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Total Shots", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Ball Possession", home_value: "50%", away_value: "50%" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Corner Kicks", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Fouls", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Yellow Cards", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Total passes", home_value: "0", away_value: "0" },
  { fixture_id: LIVE_DEMO_FIXTURE_ID, label: "Passes accurate", home_value: "0", away_value: "0" },
] as const;

export const liveDemoEvents = [
  { id: 1, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 8, team: "home", type: "Chance", detail: "Shot on target", player: "Bukayo Saka", assist: "Martin Odegaard" },
  { id: 2, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 17, team: "away", type: "Goal", detail: "Normal Goal", player: "Mohamed Salah", assist: "Darwin Nunez" },
  { id: 3, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 28, team: "home", type: "Card", detail: "Yellow Card", player: "Declan Rice" },
  { id: 4, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 41, team: "home", type: "Goal", detail: "Normal Goal", player: "Gabriel Jesus", assist: "Bukayo Saka" },
  { id: 5, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 45, team: null, type: "Half", detail: "Half Time", player: null, assist: null },
  { id: 6, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 58, team: "home", type: "subst", detail: "Substitution", player: "Leandro Trossard", assist: "Gabriel Martinelli" },
  { id: 7, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 63, team: "away", type: "Card", detail: "Yellow Card", player: "Ibrahima Konate" },
  { id: 8, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 67, team: "home", type: "Goal", detail: "Normal Goal", player: "Bukayo Saka", assist: "Leandro Trossard" },
  { id: 9, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 74, team: "away", type: "subst", detail: "Substitution", player: "Diogo Jota", assist: "Darwin Nunez" },
  { id: 10, fixture_id: LIVE_DEMO_FIXTURE_ID, minute: 83, team: "away", type: "Goal", detail: "Normal Goal", player: "Diogo Jota", assist: "Trent Alexander-Arnold" },
] as const;

export const liveDemoActivations = [
  {
    id: 9901001,
    fixture_id: LIVE_DEMO_FIXTURE_ID,
    type: "poll",
    title: "Quien llega arriba al medio tiempo?",
    description: "Elige antes del minuto 20 y gana si aciertas.",
    payload: {
      options: [
        { id: "home", label: "Arsenal" },
        { id: "away", label: "Liverpool" },
        { id: "draw", label: "Empate" },
      ],
      correct_option: "draw",
    },
    reward_points: 300,
    starts_at_minute: 10,
    expires_at_minute: 20,
    status: "active",
  },
  {
    id: 9901002,
    fixture_id: LIVE_DEMO_FIXTURE_ID,
    type: "drop",
    title: "Gol en vivo: estabas aqui",
    description: "Claim del gol de Gabriel Jesus.",
    payload: { event_minute: 41, event_type: "goal" },
    reward_points: 500,
    starts_at_minute: 41,
    expires_at_minute: 47,
    status: "active",
  },
  {
    id: 9901003,
    fixture_id: LIVE_DEMO_FIXTURE_ID,
    type: "poll",
    title: "Habra otro gol antes del 75'?",
    description: "Predice el siguiente tramo del partido.",
    payload: {
      options: [
        { id: "yes", label: "Si" },
        { id: "no", label: "No" },
      ],
      correct_option: "yes",
    },
    reward_points: 300,
    starts_at_minute: 52,
    expires_at_minute: 61,
    status: "active",
  },
  {
    id: 9901004,
    fixture_id: LIVE_DEMO_FIXTURE_ID,
    type: "drop",
    title: "Drop relampago por gol",
    description: "Saka acaba de mover el marcador.",
    payload: { event_minute: 67, event_type: "goal" },
    reward_points: 500,
    starts_at_minute: 67,
    expires_at_minute: 73,
    status: "active",
  },
  {
    id: 9901005,
    fixture_id: LIVE_DEMO_FIXTURE_ID,
    type: "poll",
    title: "Quien controla el cierre?",
    description: "Vota por el equipo con mejor momento.",
    payload: {
      options: [
        { id: "home", label: "Arsenal" },
        { id: "away", label: "Liverpool" },
      ],
    },
    reward_points: 100,
    starts_at_minute: 78,
    expires_at_minute: 86,
    status: "active",
  },
] as const;

export function getLiveDemoActivationById(activationId: number) {
  return liveDemoActivations.find((item) => item.id === activationId) ?? null;
}

export const liveDemoH2H = [
  {
    fixture_id: 1208021,
    date: "2025-05-11T15:30:00+00:00",
    league: "Premier League",
    status: "Finalizado",
    home: {
      id: 40,
      name: "Liverpool",
      logo: "https://media.api-sports.io/football/teams/40.png",
      goals: 2,
    },
    away: {
      id: 42,
      name: "Arsenal",
      logo: "https://media.api-sports.io/football/teams/42.png",
      goals: 2,
    },
  },
  {
    fixture_id: 1207943,
    date: "2024-10-27T16:30:00+00:00",
    league: "Premier League",
    status: "Finalizado",
    home: {
      id: 42,
      name: "Arsenal",
      logo: "https://media.api-sports.io/football/teams/42.png",
      goals: 2,
    },
    away: {
      id: 40,
      name: "Liverpool",
      logo: "https://media.api-sports.io/football/teams/40.png",
      goals: 2,
    },
  },
  {
    fixture_id: 1035277,
    date: "2024-02-04T16:30:00+00:00",
    league: "Premier League",
    status: "Finalizado",
    home: {
      id: 42,
      name: "Arsenal",
      logo: "https://media.api-sports.io/football/teams/42.png",
      goals: 3,
    },
    away: {
      id: 40,
      name: "Liverpool",
      logo: "https://media.api-sports.io/football/teams/40.png",
      goals: 1,
    },
  },
] as const;
