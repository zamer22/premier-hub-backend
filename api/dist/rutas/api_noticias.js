"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const premierLeagueTeams_1 = require("../utils/premierLeagueTeams");
const router = (0, express_1.Router)();
const NEWS_BASE = "https://newsapi.org/v2";
const OTHER_COMPETITIONS = [
    "champions league",
    "europa league",
    "conference league",
    "la liga",
    "bundesliga",
    "serie a",
    "ligue 1",
    "mls",
    "saudi pro league",
    "world cup",
    "copa del rey",
    "fa cup",
    "carabao cup",
];
const PREMIER_SIGNALS = [
    "premier league",
    "english premier league",
    "epl",
    "premierleague",
];
function cleanNewsText(value) {
    if (typeof value !== "string")
        return null;
    const cleaned = value
        .replace(/\s*\[\+\d+\s+chars\]\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.length > 0 ? cleaned : null;
}
function buildNewsQuery(keywords) {
    const terms = keywords
        .filter((keyword) => keyword.trim().length > 0)
        .map((keyword) => `"${keyword.trim()}"`);
    return encodeURIComponent(terms.join(" OR "));
}
function isPremierLeagueArticle(article, teamNames) {
    const text = [
        article?.title,
        article?.description,
        article?.content,
        article?.source?.name,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const hasPremierSignal = PREMIER_SIGNALS.some((signal) => text.includes(signal));
    const mentionsCurrentTeam = teamNames.some((teamName) => text.includes(teamName.toLowerCase()));
    if (!hasPremierSignal && !mentionsCurrentTeam) {
        return false;
    }
    return !OTHER_COMPETITIONS.some((competition) => text.includes(competition));
}
function getNewsHeaders() {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) {
        throw new Error("NEWS_API_KEY no esta disponible en process.env. Revisa la carga de dotenv antes de montar el router.");
    }
    return {
        "X-Api-Key": apiKey,
    };
}
router.get("/", async (_req, res) => {
    try {
        const teams = await (0, premierLeagueTeams_1.fetchPremierLeagueTeams)();
        const teamNames = teams.map((team) => team.name);
        const keywords = (0, premierLeagueTeams_1.buildPremierLeagueNewsKeywords)(teams);
        const query = buildNewsQuery(keywords);
        const url = `${NEWS_BASE}/everything?q=${query}` +
            "&searchIn=title,description,content" +
            "&language=en" +
            "&sortBy=publishedAt" +
            "&pageSize=25";
        const r = await fetch(url, {
            headers: getNewsHeaders(),
        });
        const json = await r.json();
        if (json.status !== "ok") {
            return res.status(500).json({
                success: false,
                error: json.message,
            });
        }
        const transformed = (json.articles || [])
            .filter((article) => isPremierLeagueArticle(article, teamNames))
            .map((article, index) => ({
            id: index + 1,
            title: cleanNewsText(article.title),
            summary: cleanNewsText(article.description),
            content: cleanNewsText(article.content),
            source: cleanNewsText(article.source?.name),
            image: cleanNewsText(article.urlToImage),
            url: cleanNewsText(article.url),
            publishedAt: article.publishedAt,
            category: "Premier League",
            readTime: 3,
        }))
            .filter((article) => article.title && article.summary);
        res.json({
            success: true,
            keywords,
            teams: teamNames,
            data: transformed,
        });
    }
    catch (e) {
        res.status(500).json({
            success: false,
            error: e.message,
        });
    }
});
exports.default = router;
