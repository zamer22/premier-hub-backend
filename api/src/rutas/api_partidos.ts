import { Router, Request, Response } from "express";

const router = Router();

const BASE   = "https://v3.football.api-sports.io";
const LEAGUE = 39;
const SEASON = 2025;
const headers = () => ({ "x-apisports-key": process.env.APIFOOTBALL_KEY! });

router.get("/proximos", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${BASE}/fixtures?league=${LEAGUE}&season=${SEASON}&next=10`, { headers: headers() });
    const json: any = await r.json();
    res.json({ success: true, data: json.response || [] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/resultados", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${BASE}/fixtures?league=${LEAGUE}&season=${SEASON}&last=10`, { headers: headers() });
    const json: any = await r.json();
    res.json({ success: true, data: json.response || [] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/standings", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${BASE}/standings?league=${LEAGUE}&season=${SEASON}`, { headers: headers() });
    const json: any = await r.json();
    const standings = json.response?.[0]?.league?.standings?.[0] || [];
    res.json({ success: true, data: standings });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

router.get("/equipos", async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${BASE}/teams?league=${LEAGUE}&season=${SEASON}`, { headers: headers() });
    const json: any = await r.json();
    const teamNames = (json.response || []).map((t: any) => t.team?.name).filter(Boolean);
    res.json({ success: true, data: teamNames });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
