import express from "express";
import cors from "cors";
import { Pool } from "pg";

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FOOTBALL_KEY = process.env.FOOTBALL_KEY || "45379e002ce9894ab347104d24165229";
const FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FOOTBALL_HEADERS = { "x-apisports-key": FOOTBALL_KEY };
const PL_LEAGUE = 39;
const PL_SEASON = 2025;

app.use(cors());
app.use(express.json());

