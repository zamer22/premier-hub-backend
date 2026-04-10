import express from "express";
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import noticiasRouter from "./rutas/api_noticias";
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Variables de entorno
const APIFOOTBALL_KEY = process.env.APIFOOTBALL_KEY!;

// Configuración de la API de apifootball
const FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FOOTBALL_HEADERS = {
  "x-apisports-key": APIFOOTBALL_KEY,
};
const PL_LEAGUE = 39;
const PL_SEASON = 2025;


// conexión a la base de datos
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: "postgres",
  user: "postgres",
  password: process.env.DB_PASSWORD,
});


// middleware
app.use(cors());
app.use(express.json());
app.use("/api/noticias", noticiasRouter);


// consulta del servidor
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});


// Consulta general del ranking de usuarios
app.get("/api/ranking", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT rg.*, u.nickname FROM premier.ranking_general rg
      JOIN premier.usuario u ON u.id_usuario = rg.id_usuario
      ORDER BY rg.posicion ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


/* ---------------------------------------------------------
Seccion del simulador
--------------------------------------------------------- */
app.get("/api/simulador/ranking", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT sr.*, u.nickname FROM premier.simulador_ranking sr
      JOIN premier.usuario u ON u.id_usuario = sr.id_usuario
      ORDER BY sr.posicion ASC
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.post("/api/simulador/simular", async (req, res) => {
  try {
    const { id_usuario, partido_data, cambios } = req.body;

    const result = await pool.query(
      `INSERT INTO premier.simulacion (id_usuario, partido_data, cambios, status)
       VALUES ($1, $2, $3, 'pendiente') RETURNING *`,
      [id_usuario, JSON.stringify(partido_data), JSON.stringify(cambios)]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/api/simulador/simulacion/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM premier.simulacion WHERE id_simulacion = $1`,
      [req.params.id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


/* ---------------------------------------------------------
Seccion de los partidos (apifootball)
--------------------------------------------------------- */
app.get("/api/partidos/proximos", async (_req, res) => {
  try {
    const r = await fetch(
      `${FOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&next=10`,
      { headers: FOOTBALL_HEADERS }
    );

    const json: any = await r.json();

    res.json({ success: true, data: json.response || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/api/partidos/resultados", async (_req, res) => {
  try {
    const r = await fetch(
      `${FOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&last=10`,
      { headers: FOOTBALL_HEADERS }
    );

    const json: any = await r.json();

    res.json({ success: true, data: json.response || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/api/partidos/standings", async (_req, res) => {
  try {
    const r = await fetch(
      `${FOOTBALL_BASE}/standings?league=${PL_LEAGUE}&season=${PL_SEASON}`,
      { headers: FOOTBALL_HEADERS }
    );

    const json: any = await r.json();
    const standings = json.response?.[0]?.league?.standings?.[0] || [];

    res.json({ success: true, data: standings });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/api/partidos/equipos", async (_req, res) => {
  try {
    const r = await fetch(
      `${FOOTBALL_BASE}/teams?league=${PL_LEAGUE}&season=${PL_SEASON}`,
      { headers: FOOTBALL_HEADERS }
    );

    const json: any = await r.json();

    const teamNames = (json.response || [])
      .map((t: any) => t.team?.name)
      .filter(Boolean);

    res.json({
      success: true,
      data: teamNames,
    });
  } catch (e: any) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});


/* ---------------------------------------------------------
Seccion de la tienda
--------------------------------------------------------- */
app.get("/api/tienda/productos", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM premier.producto 
      ORDER BY es_nuevo DESC, costo ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.post("/api/tienda/comprar", async (req, res) => {
  const { id_usuario, id_producto } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const prod = await client.query(
      `SELECT * FROM premier.producto WHERE id_producto = $1`,
      [id_producto]
    );

    if (!prod.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Producto no encontrado" });
    }

    const producto = prod.rows[0];

    if (producto.stock <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "Sin stock" });
    }

    const usr = await client.query(
      `SELECT * FROM premier.usuario WHERE id_usuario = $1`,
      [id_usuario]
    );

    if (!usr.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Usuario no encontrado" });
    }

    if (Number(usr.rows[0].dinero) < Number(producto.costo)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "Puntos insuficientes" });
    }

    await client.query(
      `UPDATE premier.usuario SET dinero = dinero - $1 WHERE id_usuario = $2`,
      [producto.costo, id_usuario]
    );

    await client.query(
      `UPDATE premier.producto SET stock = stock - 1 WHERE id_producto = $1`,
      [id_producto]
    );

    await client.query(
      `INSERT INTO premier.inventario_producto (id_usuario, id_producto)
       VALUES ($1, $2)`,
      [id_usuario, id_producto]
    );

    await client.query("COMMIT");

    const updated = await client.query(
      `SELECT dinero FROM premier.usuario WHERE id_usuario = $1`,
      [id_usuario]
    );

    res.json({ success: true, saldo: updated.rows[0].dinero });

  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});


// Correr la app
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API corriendo en puerto ${PORT}`);
});