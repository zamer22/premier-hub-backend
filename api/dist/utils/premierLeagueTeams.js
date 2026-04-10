"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPremierLeagueTeams = fetchPremierLeagueTeams;
exports.buildPremierLeagueNewsKeywords = buildPremierLeagueNewsKeywords;
const FOOTBALL_BASE = "https://v3.football.api-sports.io";
const PL_LEAGUE = 39;
const PL_SEASON = 2025;
function getFootballHeaders() {
    const apiKey = process.env.APIFOOTBALL_KEY;
    if (!apiKey) {
        throw new Error("APIFOOTBALL_KEY no esta disponible en process.env.");
    }
    return {
        "x-apisports-key": apiKey,
    };
}
async function fetchPremierLeagueTeams() {
    const response = await fetch(`${FOOTBALL_BASE}/standings?league=${PL_LEAGUE}&season=${PL_SEASON}`, {
        headers: getFootballHeaders(),
    });
    const json = await response.json();
    if (!response.ok || json.errors) {
        throw new Error(json?.errors?.message ||
            json?.message ||
            "No fue posible obtener los equipos de la Premier League.");
    }
    const standings = json.response?.[0]?.league?.standings?.[0];
    if (!Array.isArray(standings)) {
        throw new Error("La respuesta de standings no incluyo equipos validos.");
    }
    return standings.map((entry) => ({
        id: Number(entry.team?.id),
        name: entry.team?.name ?? "Equipo desconocido",
        code: entry.team?.code ?? null,
        country: entry.team?.country ?? null,
        logo: entry.team?.logo ?? null,
        founded: entry.team?.founded ?? null,
        rank: Number(entry.rank ?? 0),
    }));
}
function buildPremierLeagueNewsKeywords(teams) {
    const baseKeywords = ["Premier League", "English Premier League", "EPL"];
    const teamKeywords = teams.map((team) => team.name);
    return Array.from(new Set([...baseKeywords, ...teamKeywords]));
}
