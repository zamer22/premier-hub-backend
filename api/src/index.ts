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

const pool = new Pool({
  host: process.env.DB_HOST || "192.168.1.24",
  port: Number(process.env.DB_PORT) || 54322,
  database: "postgres",
  user: "postgres",
  password: process.env.DB_PASSWORD || "",
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => { res.json({ status: "ok" }); });

// --- AUTH: LOGIN ---
app.post("/api/auth/login", async (req, res) => {
  const { correo, contrasena } = req.body;
  try {
    const result = await pool.query(
      `SELECT id_usuario, nickname, nombre_usuario, correo, dinero 
       FROM premier.usuario 
       WHERE (correo = $1 OR nombre_usuario = $1) AND contrasena = $2`,
      [correo, contrasena]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Credenciales incorrectas" });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- AUTH: REGISTRO ---
app.post("/api/auth/registro", async (req, res) => {
  const { correo, nombre_usuario, nickname, contrasena } = req.body;
  try {
    // Validar si el usuario o correo ya existen
    const existe = await pool.query(
      `SELECT id_usuario FROM premier.usuario WHERE correo = $1 OR nickname = $2`,
      [correo, nickname]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ success: false, error: "El correo o el nickname ya están en uso" });
    }

    // Insertar nuevo usuario con 1000 de dinero inicial
    const result = await pool.query(
      `INSERT INTO premier.usuario (nombre_usuario, correo, contrasena, nickname, dinero)
       VALUES ($1, $2, $3, $4, 1000) 
       RETURNING id_usuario, nickname, nombre_usuario, correo, dinero`,
      [nombre_usuario, correo, contrasena, nickname]
    );

    res.json({ success: true, user: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- RANKING ---
app.get("/api/ranking", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT rg.*, u.nickname FROM premier.ranking_general rg
      JOIN premier.usuario u ON u.id_usuario = rg.id_usuario
      ORDER BY rg.posicion ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// --- SIMULADOR ---
app.get("/api/simulador/ranking", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT sr.*, u.nickname FROM premier.simulador_ranking sr
      JOIN premier.usuario u ON u.id_usuario = sr.id_usuario
      ORDER BY sr.posicion ASC
    `);
    res.json({ success: true, data: result.rows, count: result.rowCount });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/simulador/simular", async (req, res) => {
  try {
    const { id_usuario, partido_data, cambios } = req.body;
    const result = await pool.query(
      `INSERT INTO premier.simulacion (id_usuario, partido_data, cambios, status) VALUES ($1, $2, $3, 'pendiente') RETURNING *`,
      [id_usuario, JSON.stringify(partido_data), JSON.stringify(cambios)]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/api/simulador/simulacion/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM premier.simulacion WHERE id_simulacion = $1`, [req.params.id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// --- PARTIDOS (API EXTERNA) ---
app.get("/api/partidos/proximos", async (_req, res) => {
  try {
    const r = await fetch(`${FOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&next=10`, { headers: FOOTBALL_HEADERS });
    const json: any = await r.json();
    res.json({ success: true, data: json.response || [] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/api/partidos/resultados", async (_req, res) => {
  try {
    const r = await fetch(`${FOOTBALL_BASE}/fixtures?league=${PL_LEAGUE}&season=${PL_SEASON}&last=10`, { headers: FOOTBALL_HEADERS });
    const json: any = await r.json();
    res.json({ success: true, data: json.response || [] });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/api/partidos/standings", async (_req, res) => {
  try {
    const r = await fetch(`${FOOTBALL_BASE}/standings?league=${PL_LEAGUE}&season=${PL_SEASON}`, { headers: FOOTBALL_HEADERS });
    const json: any = await r.json();
    const standings = json.response?.[0]?.league?.standings?.[0] || [];
    res.json({ success: true, data: standings });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// --- TIENDA ---
app.get("/api/tienda/productos", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM premier.producto ORDER BY es_nuevo DESC, costo ASC`);
    res.json({ success: true, data: result.rows });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/tienda/comprar", async (req, res) => {
  const { id_usuario, id_producto } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // 1. Obtener producto y verificar stock
    const prod = await client.query(`SELECT * FROM premier.producto WHERE id_producto = $1`, [id_producto]);
    if (!prod.rows[0]) throw new Error("Producto no encontrado");
    
    const producto = prod.rows[0];
    if (producto.stock <= 0) throw new Error("Sin stock disponible");

    // 2. Verificar saldo del usuario
    const usr = await client.query(`SELECT * FROM premier.usuario WHERE id_usuario = $1`, [id_usuario]);
    if (!usr.rows[0]) throw new Error("Usuario no encontrado");
    
    if (Number(usr.rows[0].dinero) < Number(producto.costo)) throw new Error("Puntos insuficientes");

    // 3. Ejecutar transacción
    await client.query(`UPDATE premier.usuario SET dinero = dinero - $1 WHERE id_usuario = $2`, [producto.costo, id_usuario]);
    await client.query(`UPDATE premier.producto SET stock = stock - 1 WHERE id_producto = $1`, [id_producto]);
    await client.query(`INSERT INTO premier.inventario_producto (id_usuario, id_producto) VALUES ($1, $2)`, [id_usuario, id_producto]);
    
    await client.query("COMMIT");
    
    const updated = await client.query(`SELECT dinero FROM premier.usuario WHERE id_usuario = $1`, [id_usuario]);
    res.json({ success: true, saldo: updated.rows[0].dinero });
  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ success: false, error: e.message });
  } finally { 
    client.release(); 
  }
});

app.listen(PORT, "0.0.0.0", () => { 
  console.log(`🚀 PremierHub API corriendo en puerto ${PORT}`); 
});