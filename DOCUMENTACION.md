# API — Premier Hub

## Índice

1. [Conexión a Supabase](#1-conexión-a-supabase)
2. [Base de Datos](#2-base-de-datos)
3. [Variables de Entorno](#3-variables-de-entorno)
4. [Seguridad](#4-seguridad)
5. [Autenticación y Sesiones](#5-autenticación-y-sesiones)
6. [Endpoints del API](#6-endpoints-del-api)
7. [NGINX y Kong](#7-nginx-y-kong)
8. [CI/CD](#8-cicd)
9. [Instalación Local](#9-instalación-local)

---

## 1. Conexión a Supabase

**Archivo:** `api/src/db.ts` — schema fijo: `premier`

| Parámetro | Valor |
|---|---|
| `SUPABASE_URL` | `https://supabase.zamer-o.com` (prod) |
| `SUPABASE_SERVICE_KEY` | JWT HS256 — service role key |
| `db.schema` | `premier` |
| `autoRefreshToken` / `persistSession` | `false` (no necesario en backend) |

El backend usa exclusivamente la **Service Role Key**: bypassa RLS, tiene privilegio máximo y nunca se expone al frontend. Se inyecta al pod vía K8s Secret en tiempo de ejecución.

---

## 2. Base de Datos — Schema `premier`

### Tablas

| Tabla | Columnas clave | Relaciones |
|---|---|---|
| `usuario` | `id_usuario`, `auth_id` (UUID OAuth), `correo`, `nombre_usuario`, `nickname`, `dinero`, `foto_perfil`, `banner_perfil`, `es_admin` | — |
| `logro` | `id_logro`, `nombre`, `categoria` | — |
| `usuario_logro` | `id_usuario`, `id_logro`, `estado` | → usuario, logro |
| `partido_en_vivo` | `id_partido` (varchar PK), `equipo_local/visitante`, `estado`, `fecha` | — |
| `mensaje_chat` | `id_usuario`, `id_partido`, `contenido`, `timestamp` | → usuario, partido_en_vivo |
| `vr_partida` | `id_usuario`, `atajadas`, `puntos`, `fecha` | → usuario |
| `vr_ranking` | `id_usuario` (UNIQUE), `posicion`, `puntos_totales` | → usuario |
| `simulador_partida` | `id_usuario`, `cambios_hechos`, `puntos`, `fecha` | → usuario |
| `simulador_ranking` | `id_usuario` (UNIQUE), `posicion`, `puntos_totales` | → usuario |
| `simulador_desafio` | `id_desafio`, `nombre`, `dificultad` | — |
| `usuario_desafio` | `id_usuario`, `id_desafio`, `estado` | → usuario, simulador_desafio |
| `simulacion` | `id_simulacion`, `id_usuario`, `partido_data` (JSONB), `cambios` (JSONB), `status` | → usuario |
| `producto` | `id_producto`, `nombre`, `costo`, `categoria` (`perfil`\|`real`\|`drop`), `stock`, `imagen`, `css` | — |
| `producto_variante` | `id_producto`, `nombre`, `talla`, `stock` | → producto |
| `inventario_producto` | `id`, `id_usuario`, `id_producto`, `en_marketplace` | → usuario, producto |
| `coleccionable` | `id_coleccionable`, `tipo`, `rareza` | — |
| `inventario_coleccionable` | `id_usuario`, `id_coleccionable`, `cantidad` | → usuario, coleccionable |
| `drop` | `id_usuario`, `id_coleccionable`, `id_partido` | → usuario, coleccionable, partido_en_vivo |
| `publicacion` | `id_usuario`, `id_coleccionable`, `precio`, `activa` | → usuario, coleccionable |
| `temporada` | `id_temporada`, `nombre`, `activa`, `inicio`, `fin` | — |
| `marketplace_listado` | `id_listado`, `id_vendedor`, `id_inventario`, `precio`, `estado` | → usuario, inventario_producto |
| `pedido` | `id_pedido`, `id_usuario`, `id_producto`, `id_variante`, `costo`, `direccion_snapshot`, `lat_destino`, `lng_destino`, `estado`, `lat_actual`, `lng_actual`, `tracking_numero`, `fecha_estimada`, `notas_admin` | → usuario, producto, producto_variante |
| `direccion_envio` | `id_usuario`, `nombre`, `direccion`, `ciudad`, `cp`, `telefono` | → usuario |
| `comentario_producto` | `id_producto`, `id_usuario`, `texto` | → producto, usuario |
| `usuario_equipamiento` | `id_usuario` (PK), `marco_inventario_id`, `titulo_inventario_id`, `banner_inventario_id`, `trofeo_inventario_id` | → usuario, inventario_producto |
| `ranking_general` | `id_usuario` (PK), `puntos`, `posicion` | → usuario |
| `live_matches` | `id` (PK), `league`, `minute`, `status`, `home_*`, `away_*`, `updated_at` | — |
| `live_lineups` | `fixture_id`, `team`, `player_number`, `player_name`, `is_sub` | → live_matches |
| `live_stats` | `fixture_id`, `label`, `home_value`, `away_value` | → live_matches |
| `live_h2h` | `fixture_id`, `related_fixture_id`, `match_date`, `home_*`, `away_*` | → live_matches |
| `past_matches` | igual que `live_matches` + `archived_at` | — |
| `past_lineups` | igual que `live_lineups` | → past_matches |
| `past_stats` | igual que `live_stats` | → past_matches |
| `past_h2h` | igual que `live_h2h` | → past_matches |
| `noticias_cache` | `cache_key` (PK), `payload` (JSONB), `expires_at` | — |
| `topics` | `id`, `title`, `metric_label` | — |
| `players` | `id`, `name`, `photo_url` | — |
| `challenges` | `id`, `topic_id`, `scheduled_date`, `is_active` | → topics |
| `challenge_players` | `challenge_id`, `player_id`, `correct_rank`, `display_order` | → challenges, players |
| `user_attempts` | `id_usuario`, `challenge_id`, `submitted_order` (JSONB), `score`, `dinero_ganado` | → usuario, challenges |
| `player_topic_stats` | `player_id`, `topic_id`, `metric_value` | → players, topics |
| `team_timeline_events` | `team_id`, `year`, `title`, `description`, `image_url`, `order` | — |

### Políticas RLS

La mayoría de tablas **no tienen RLS habilitado** — el backend usa Service Role Key que bypassa RLS. El control de acceso se implementa vía funciones SQL `SECURITY DEFINER` y validaciones en el backend.

**Con RLS activo:**
- `team_timeline_events`: lectura pública, escritura solo `service_role`
- `user_attempts`: lectura e inserción solo del propio usuario (por `auth_id`)

### Funciones SQL (SECURITY DEFINER)

| Función | Descripción |
|---|---|
| `fn_login(identificador, contrasena)` | Verifica credenciales con bcrypt |
| `fn_registro(nombre_usuario, correo, contrasena, nickname)` | Crea cuenta con hash bcrypt |
| `fn_comprar_producto(id_usuario, id_producto)` | Compra con validaciones atómicas |
| `fn_comprar_marketplace(id_comprador, id_listado)` | Transacción P2P atómica |
| `fn_ranking()` | Ranking general agregado |
| `fn_productos_v2(categoria)` | Productos disponibles por categoría |
| `fn_mis_items(id_usuario)` | Inventario del usuario |
| `fn_marketplace_listados(excluir_usuario)` | Listados activos excluyendo al usuario |
| `fn_mis_listados(id_usuario)` | Listados propios del usuario |
| `fn_simulador_ranking()` | Ranking del simulador |
| `activate_today_challenge()` | Activa el challenge del día (Wordle) |

---

## 3. Variables de Entorno

```env
PORT=4000
NODE_ENV=development

CORS_ORIGIN=https://app.zamer-o.com
DEV_CORS_ORIGIN=http://localhost:5173

COOKIE_SECRET=clave_larga_aleatoria

SUPABASE_URL=https://supabase.zamer-o.com
SUPABASE_SERVICE_KEY=eyJhbGci...

APIFOOTBALL_KEY=tu_api_key
APIFOOTBALL_BASE_URL=https://v3.football.api-sports.io
APIFOOTBALL_LEAGUE_ID=39
APIFOOTBALL_SEASON=2025

NEWS_API_KEY=tu_api_key
NEWS_BASE_URL=https://newsapi.org/v2
NEWS_CACHE_TTL_MINUTES=30

LIVE_FIXTURE_ID=     # ID del partido activo, vacío si no hay
WORDLE_TIME_ZONE=America/Mexico_City
```

En producción, las sensibles (`SUPABASE_SERVICE_KEY`, `APIFOOTBALL_KEY`, `NEWS_API_KEY`, `COOKIE_SECRET`) van en el K8s Secret `api-secrets`. Las demás van directamente en el deployment YAML.

---

## 4. Seguridad

### TLS — Cloudflare Tunnel

```
Usuario (HTTPS) → Cloudflare Edge (TLS terminado aquí)
                    → Tunnel cifrado → cloudflared (Milano)
                        → HTTP interno → K3s NodePort → Pod
```

El servidor no expone puertos a internet ni recibe TLS directamente. Los certificados los gestiona Cloudflare.

### Cookies de sesión

| Propiedad | Valor |
|---|---|
| `name` | `ph_session` |
| `value` | `id_usuario` firmado HMAC-SHA256 |
| `httpOnly` | `true` — no accesible desde JS |
| `secure` | `true` en prod |
| `sameSite` | `lax` — protección CSRF básica |
| `maxAge` | 7 días |

### CORS

```
origin: CORS_ORIGIN || DEV_CORS_ORIGIN || "http://localhost:5173"
credentials: true
limit body: 8mb (para subida de fotos en base64)
```

---

## 5. Autenticación y Sesiones

**Login con correo/contraseña:**
```
1. POST /api/auth/login { correo, contrasena }
2. Backend → fn_login() en PostgreSQL (verifica bcrypt)
3. Backend firma cookie ph_session con COOKIE_SECRET
4. Cada request: navegador envía cookie automáticamente
5. Backend verifica firma HMAC → extrae id_usuario → consulta premier.usuario
6. POST /api/auth/logout → clearCookie("ph_session")
```

**Login con Google OAuth:**
```
1. Frontend completa OAuth en Supabase → obtiene access_token
2. POST /api/auth/google-sync { access_token } → backend valida contra Supabase Auth
3a. Usuario existente → setea cookie + retorna datos
3b. Usuario nuevo    → frontend redirige a registro con POST /api/auth/google-register
```

**Admin:** Las rutas `/api/admin/*` verifican que el usuario tenga `es_admin = true` en `premier.usuario`. Se pasa `id_usuario` como query param o en el body.

---

## 6. Endpoints del API

**Base URLs:**
- Prod: `https://api.zamer-o.com`
- Preprod: `https://api-preprod.zamer-o.com`
- Local: `http://localhost:4000`

---

### Health

| Método | Ruta | Response 200 |
|---|---|---|
| GET | `/api/health` | `{ "status": "ok" }` |

---

### Autenticación — `/api/auth`

#### GET `/api/auth/me`
**Entrada:** Cookie `ph_session`

**Response 200:**
```json
{ "success": true, "user": { "id_usuario": 1, "nombre_usuario": "...", "nickname": "...", "correo": "...", "dinero": "1500.00", "foto_perfil": null, "banner_perfil": null, "es_admin": false } }
```

---

#### POST `/api/auth/login`
**Entrada:** `{ "correo": "...", "contrasena": "..." }`
**Efecto:** Setea cookie `ph_session` (7 días)

**Response 200:**
```json
{ "success": true, "user": { "id_usuario": 1, "nombre_usuario": "...", "correo": "...", "dinero": "1500.00" } }
```

---

#### POST `/api/auth/logout`
**Response 200:** `{ "success": true }`

---

#### POST `/api/auth/registro`
**Entrada:** `{ "correo": "...", "nombre_usuario": "...", "nickname": "...", "contrasena": "..." }`

**Response 200:**
```json
{ "success": true, "user": { "id_usuario": 11, "nombre_usuario": "...", "dinero": "0.00" } }
```

---

#### POST `/api/auth/google-sync`
**Entrada:** `{ "access_token": "ya29..." }`

**Response 200 — usuario existente:** `{ "success": true, "isNew": false, "user": { ... } }`

**Response 200 — usuario nuevo:** `{ "success": true, "isNew": true, "correo": "...", "nombre": "..." }`

---

#### POST `/api/auth/google-register`
**Entrada:** `{ "correo": "...", "nombre": "...", "nickname": "..." }`
**Efecto:** Crea usuario con saldo inicial 1000, setea cookie

**Response 200:** `{ "success": true, "user": { "id_usuario": 11, "nickname": "...", "dinero": "1000.00" } }`

---

#### PATCH `/api/auth/profile`
**Entrada:** `{ "nombre_usuario": "...", "nickname": "..." }` (al menos uno requerido)
Nickname: 3-20 chars, solo letras, números o guión bajo.

**Response 200:** `{ "success": true, "user": { ...usuario actualizado } }`

---

#### GET `/api/auth/profile/customization`
Obtiene el equipamiento activo del usuario (marco, título, banner, trofeo).

**Response 200:**
```json
{ "success": true, "data": { "id_usuario": 1, "marco_inventario_id": 42, "titulo_inventario_id": null, "banner_inventario_id": 7, "trofeo_inventario_id": null } }
```

---

#### PATCH `/api/auth/profile/customization`
**Entrada:** uno o más de `{ "marco_inventario_id": 42, "titulo_inventario_id": null, "banner_inventario_id": 7, "trofeo_inventario_id": null }`
Valida que cada item pertenezca al usuario y sea del tipo correcto.

**Response 200:** `{ "success": true, "data": { ...equipamiento actualizado } }`

---

#### POST `/api/auth/profile/photo`
**Entrada:** `{ "imageData": "data:image/png;base64,...", "fileName": "foto.png" }`
Sube la imagen a Supabase Storage y actualiza `foto_perfil` del usuario. Máx 5 MB.

**Response 200:** `{ "success": true, "url": "https://supabase.../foto.png", "user": { ...usuario actualizado } }`

---

#### DELETE `/api/auth/account`
**Entrada:** `{ "confirmacion": "ELIMINAR {nickname}" }`
Elimina marketplace_listado, simulaciones e inventario del usuario antes de borrar la cuenta.

**Response 200:** `{ "success": true }`

---

### Ranking — `/api/ranking`

#### GET `/api/ranking`

**Response 200:**
```json
{ "success": true, "data": [{ "posicion": 1, "id_usuario": 6, "nickname": "SofiaGolazo", "puntos_totales": 2430, "foto_perfil": null }] }
```

---

### Simulador — `/api/simulador`

#### GET `/api/simulador/ranking`

**Response 200:**
```json
{ "success": true, "count": 10, "data": [{ "posicion": 1, "nickname": "...", "cambios_totales": 4, "realismo_promedio": "93.70", "puntos_totales": 2430 }] }
```

---

#### POST `/api/simulador/simular`
**Entrada:**
```json
{ "id_usuario": 1, "partido_data": { "equipo_local": "Man United", "equipo_visitante": "Arsenal", "minuto": 60 }, "cambios": [{ "saliente": "Rashford", "entrante": "Martial", "minuto": 65 }] }
```

**Response 200:** `{ "success": true, "data": { "id_simulacion": 42, "status": "pendiente" } }`

---

#### GET `/api/simulador/simulacion/:id`
**Params:** `id` = id_simulacion

**Response 200:** `{ "success": true, "data": { "id_simulacion": 42, "partido_data": {}, "cambios": [], "status": "pendiente" } }`

---

### Partidos — `/api/partidos`

Consultan API-Football en tiempo real.

#### GET `/api/partidos/proximos`
Próximos 10 partidos de la Premier League.

**Response 200:**
```json
{ "success": true, "data": [{ "fixture": { "id": 1035045, "date": "...", "venue": { "name": "Old Trafford" }, "status": { "short": "NS" } }, "teams": { "home": { "id": 33, "name": "Man United", "logo": "..." }, "away": { "id": 42, "name": "Arsenal", "logo": "..." } }, "goals": { "home": null, "away": null } }] }
```

---

#### GET `/api/partidos/resultados`
Últimos 10 resultados. Mismo formato que `/proximos` con `goals` con valores y `status.short: "FT"`.

---

#### GET `/api/partidos/standings`

**Response 200:**
```json
{ "success": true, "data": [{ "rank": 1, "team": { "id": 50, "name": "Manchester City", "logo": "..." }, "points": 85, "goalsDiff": 58, "all": { "played": 35, "win": 27, "draw": 4, "lose": 4 } }] }
```

---

#### GET `/api/partidos/equipos`
**Query params:** `detalle=true` para retornar objetos completos (por defecto retorna solo nombres)

**Response 200 (sin detalle):** `{ "success": true, "data": ["Arsenal", "Manchester City", "..."] }`

**Response 200 (con `?detalle=true`):**
```json
{ "success": true, "data": [{ "id": 33, "name": "Man United", "logo": "...", "code": "MUN", "founded": 1878, "venue": "Old Trafford" }] }
```

---

### Partidos en Vivo — `/api/partidos/live`

Datos sincronizados desde API-Football, persistidos en tablas `live_*`.

#### GET `/api/partidos/live`

**Response 200:**
```json
{ "success": true, "data": [{ "id": 1035045, "league": "Premier League", "minute": "67'", "status": "Second Half", "home_name": "Man United", "home_score": 1, "away_name": "Arsenal", "away_score": 2, "updated_at": "..." }] }
```

---

#### GET `/api/partidos/live/:id/lineups`
**Params:** `id` = fixture_id

**Response 200:** `{ "success": true, "data": [{ "fixture_id": 1035045, "team": "home", "player_number": 1, "player_name": "De Gea", "is_sub": false }] }`

---

#### GET `/api/partidos/live/:id/stats`
**Params:** `id` = fixture_id

**Response 200:** `{ "success": true, "data": [{ "label": "Ball Possession", "home_value": "45%", "away_value": "55%" }] }`

---

#### GET `/api/partidos/live/:id/h2h`
**Params:** `id` = fixture_id

**Response 200:**
```json
{ "success": true, "data": [{ "fixture_id": 987654, "date": "...", "league": "Premier League", "status": "Finalizado", "home": { "id": 33, "name": "Man United", "logo": "...", "goals": 1 }, "away": { "id": 42, "name": "Arsenal", "logo": "...", "goals": 0 } }] }
```

---

#### POST `/api/partidos/live/sync/:fixtureId`
Sincronización manual de un partido (upsert en todas las tablas `live_*`).

**Response 200:** `{ "success": true, "fixtureId": 1035045, "message": "Partido sincronizado correctamente" }`

---

#### POST `/api/partidos/live/start/:fixtureId`
Inicia auto-sync cada 60 segundos. Solo 1 fixture activo a la vez.

**Response 200:** `{ "success": true, "fixtureId": 1035045, "message": "Auto-sync iniciado cada 60 segundos" }`

---

#### POST `/api/partidos/live/stop`

**Response 200:** `{ "success": true, "message": "Auto-sync detenido" }`

---

#### GET `/api/partidos/live/autosync/status`

**Response 200:** `{ "success": true, "running": true, "fixtureId": 1035045 }`

---

### Historial de Partidos — `/api/partidos/historial`

Datos de partidos pasados persistidos en tablas `past_*`.

#### GET `/api/partidos/historial/pasados`
Últimos 10 partidos archivados, ordenados por `archived_at` desc.

**Response 200:** `{ "success": true, "data": [{ "id": 987654, "league": "...", "match_date": "...", "home_name": "...", "home_score": 2, "away_name": "...", "away_score": 1 }] }`

---

#### GET `/api/partidos/historial/:fixtureId/stats`
**Params:** `fixtureId`

**Response 200:** `{ "success": true, "data": [{ "label": "Ball Possession", "home_value": "52%", "away_value": "48%" }] }`

---

#### GET `/api/partidos/historial/:fixtureId/lineups`
**Params:** `fixtureId`

**Response 200:** `{ "success": true, "data": [{ "team": "home", "player_number": 1, "player_name": "De Gea", "is_sub": false }] }`

---

#### GET `/api/partidos/historial/:fixtureId/eventos`
**Params:** `fixtureId` — eventos del partido (goles, tarjetas, sustituciones) desde API-Football.

**Response 200:**
```json
{ "success": true, "data": [{ "minute": 23, "extra": null, "team": { "id": 33, "name": "Man United", "logo": "..." }, "player": "Rashford", "assist": null, "type": "Goal", "detail": "Normal Goal", "comments": null }] }
```

---

### Noticias — `/api/noticias`

Cache en `premier.noticias_cache`. Fuente: NewsAPI + Readability.

#### GET `/api/noticias`

**Query params:**

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `page` | number | 1 | Página |
| `limit` | number | 8 (máx 12) | Artículos por página |
| `offset` | number | — | Posición exacta (alternativa a `page`) |
| `team` | string | — | Filtrar por equipo |
| `search` | string | — | Búsqueda en título/descripción |

**Response 200:**
```json
{ "success": true, "count": 8, "page": 1, "hasMore": true, "cached": true, "stale": false,
  "data": [{ "id": 123, "title": "...", "headline": "...", "summary": "...", "source": "Sky Sports", "image": "...", "url": "...", "publishedAt": "...", "teams": ["Arsenal"], "readTime": 3 }] }
```

---

### Tienda — `/api/tienda`

#### GET `/api/tienda/productos-v2`
**Query params:** `categoria` = `perfil` | `real` | `drop` (default: `perfil`)

**Response 200:**
```json
{ "success": true, "data": [{ "id_producto": 1, "nombre": "Marco PL", "costo": "500", "categoria": "perfil", "imagen": "...", "temporada_nombre": "2024-2025" }] }
```
Los de `categoria: "real"` incluyen además `variantes: [{ id, nombre, talla, stock }]`.

---

#### GET `/api/tienda/mis-items/:id_usuario`

**Response 200:**
```json
{ "success": true, "data": [{ "id_inventario": 42, "id_producto": 1, "nombre": "Marco PL", "tipo": "marco", "categoria": "perfil", "en_marketplace": false }] }
```

---

#### GET `/api/tienda/temporada-activa`

**Response 200:** `{ "success": true, "data": { "id_temporada": 1, "nombre": "2024-2025", "activa": true, "inicio": "2024-08-01", "fin": "2025-05-31" } }`

---

#### GET `/api/tienda/saldo/:id_usuario`

**Response 200:** `{ "success": true, "dinero": "1500.00" }`

---

#### POST `/api/tienda/comprar`
**Entrada:** `{ "id_usuario": 1, "id_producto": 7 }`

**Response 200:** `{ "success": true, "saldo": "1000.00" }`

---

#### POST `/api/tienda/bonus`
**Entrada:** `{ "id_usuario": 1 }` — agrega 500 puntos.

**Response 200:** `{ "success": true, "dinero": 2000, "bonus": 500 }`

---

### Marketplace — `/api/marketplace`

Solo items `categoria = "perfil"`.

#### GET `/api/marketplace/listados`
**Query params:** `mios=<id_usuario>` | `excluir=<id_usuario>`

**Response 200:**
```json
{ "success": true, "data": [{ "id_listado": 123, "precio": "750.00", "estado": "activo", "nombre": "Marco PL", "vendedor_nickname": "SofiaGolazo" }] }
```

---

#### POST `/api/marketplace/publicar`
**Entrada:** `{ "id_usuario": 6, "id_inventario": 42, "precio": 750 }`

**Response 200:** `{ "success": true, "data": { "id_listado": 456, "precio": "750.00", "estado": "activo" } }`

---

#### POST `/api/marketplace/comprar`
**Entrada:** `{ "id_comprador": 1, "id_listado": 123 }`
Transacción atómica: descuenta al comprador, suma al vendedor, transfiere el item.

**Response 200:** `{ "success": true, "saldo": "750.00" }`

---

#### DELETE `/api/marketplace/cancelar/:id_listado`
**Entrada:** `{ "id_usuario": 6 }`

**Response 200:** `{ "success": true }`

---

### Wordle — `/api/wordle`

Reto diario de ordenar jugadores por estadística. Usa `challenges` con `scheduled_date` y `is_active`.

#### GET `/api/wordle/daily`
Obtiene el reto del día. Si no existe, lo genera con `activate_today_challenge()`. Si el usuario ya jugó, incluye el resultado.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "challenge_id": "uuid",
    "scheduled_date": "2026-05-02",
    "theme": "Goleadores",
    "metric_label": "Goles",
    "players": [{ "id": "uuid", "name": "Erling Haaland", "initials": "EH", "image": "...", "stat": 27 }],
    "played": false,
    "attempt": null
  }
}
```

Si ya jugó, `played: true` y `attempt` incluye `score`, `dinero_ganado`, `results` y `correct_order`.

---

#### GET `/api/wordle/played/:challengeId`
Requiere sesión. Verifica si el usuario ya jugó ese challenge.

**Response 200:** `{ "success": true, "played": true, "attempt": { "score": 7, "dinero_ganado": 300, "results": [...], "correct_order": [...] } }`

---

#### POST `/api/wordle/submit`
Requiere sesión. Solo se puede jugar una vez por challenge.

**Entrada:** `{ "challenge_id": "uuid", "submitted_order": ["id1", "id2", ...] }`

**Escala de premios:**
- 10/10 correctos → $500
- >8 → $300
- >6 → $150
- cualquier otro → $50

**Response 200:**
```json
{ "success": true, "data": { "score": 7, "dinero_ganado": 300, "nuevo_saldo": 1800, "results": [{ "player_id": "...", "submitted_rank": 1, "correct_rank": 2, "correct": false }], "correct_order": ["id3", "id1", ...] } }
```

---

### Historia — `/api/historia`

#### GET `/api/historia/equipos`
Equipos de la Premier League con datos completos (cache en memoria 1 hora).

**Response 200:**
```json
{ "success": true, "data": [{ "id": 33, "name": "Manchester United", "logo": "...", "code": "MUN", "founded": 1878, "venue": "Old Trafford" }] }
```

---

#### GET `/api/historia/timeline/:teamId`
Timeline histórico de un equipo, ordenado por año.

**Params:** `teamId` = ID del equipo (API-Football)

**Response 200:**
```json
{ "success": true, "data": [{ "id": 1, "team_id": 33, "year": 1878, "title": "Fundación del club", "description": "...", "image_url": "...", "order": 1 }] }
```

---

### Admin — `/api/admin`

Todas las rutas requieren `es_admin = true`. Se pasa `id_usuario` como query param.

#### GET `/api/admin/pedidos`
**Query params:** `id_usuario` (requerido), `estado` (procesando|enviado|en_camino|entregado|cancelado), `desde`, `hasta` (fechas ISO), `q` (id numérico o tracking_numero)

**Response 200:**
```json
{ "success": true, "data": [{ "id_pedido": 1, "estado": "procesando", "costo": "1200.00", "tracking_numero": null, "fecha_pedido": "...", "producto": { "nombre": "Jersey MU", "imagen": "..." }, "variante": { "talla": "M" }, "usuario": { "nickname": "carlos_gol", "correo": "..." }, "direccion_snapshot": {...}, "lat_destino": 19.4, "lng_destino": -99.1, "lat_actual": null, "lng_actual": null }] }
```

---

#### GET `/api/admin/pedido/:id_pedido`
**Query params:** `id_usuario`

**Response 200:** `{ "success": true, "data": { ...pedido completo } }`

---

#### PUT `/api/admin/pedido/:id_pedido`
**Query params:** `id_usuario`
**Entrada:** `{ "estado": "enviado", "tracking_numero": "MX123", "fecha_estimada": "2026-05-10", "lat_actual": 19.4, "lng_actual": -99.1, "notas_admin": "..." }` (todos opcionales)

Estados válidos: `procesando` | `enviado` | `en_camino` | `entregado` | `cancelado`
Pedidos `entregado` o `cancelado` no se pueden modificar.
Si cambia a `cancelado`, devuelve el `costo` en puntos al usuario.

**Response 200:** `{ "success": true, "data": { ...pedido actualizado } }`

**Response 200 con reembolso:** `{ "success": true, "data": {...}, "refunded": 1200 }`

**Response 200 con advertencia:** `{ "success": true, "data": {...}, "warning": "Pedido cancelado, pero la devolución de puntos falló" }`

---

## 7. NGINX y Kong

### NGINX (Frontend)

El frontend React/Vite se sirve con Nginx dentro del pod. **Archivo:** `pagina/nginx.conf`

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

- `try_files ... /index.html` — routing de SPA
- `no-cache` en `/` — `index.html` nunca se cachea
- `expires 1y` en `/assets/` — assets de Vite tienen hash, se cachean indefinidamente

### API Gateway Kong (Supabase)

**Consumidores:**

| Consumer | Rol | Auth |
|---|---|---|
| `anon` | Acceso público | API Key (`SUPABASE_ANON_KEY`) |
| `service_role` | Acceso total | API Key (`SUPABASE_SERVICE_KEY`) |
| `DASHBOARD` | Interfaz web | Basic Auth |

**Servicios:**

| Path | Servicio |
|---|---|
| `/auth/v1/*` | GoTrue — OAuth, JWT |
| `/rest/v1/*` | PostgREST |
| `/storage/v1/*` | Storage |
| `/realtime/v1/*` | Realtime WebSockets |

**Puertos:** `8000/8443` (prod) · `8100/8543` (preprod)

---

## 8. CI/CD

### Flujo de trabajo

```
Branch desde develop → PR → develop → merge → deploy automático preprod
Verificar en api-preprod.zamer-o.com
PR preprod → main → merge → deploy automático prod
```

### GitHub Actions

**Prod** — `.github/workflows/deploy.yml`, dispara en push a `main`, runner `milano-backend`:
```yaml
- uses: actions/checkout@v4
- run: |
    docker build -t premier-api:${{ github.sha }} -t premier-api:latest ./api
    docker save premier-api:${{ github.sha }} | sudo k3s ctr images import -
    kubectl set image deployment/api api=premier-api:${{ github.sha }} -n prod
    kubectl rollout status deployment/api -n prod --timeout=120s
```

**Preprod** — idéntico pero rama `preprod`, namespace `preprod`, tag `:preprod`.

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

---

## 9. Instalación Local

**Requisitos:** Node.js 20+, npm, acceso a Supabase, API keys de API-Football y NewsAPI.

```bash
git clone git@github.com:zamer22/premier-hub-backend.git
cd premier-hub-backend/api
npm install
cp .env.example .env   # Editar con valores reales
npm run dev            # Desarrollo con hot reload
npm run build && npm start  # Producción
```

**Verificación:**
```bash
curl http://localhost:4000/api/health
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"usuario@example.com","contrasena":"pass123"}'
curl "http://localhost:4000/api/wordle/daily"
curl "http://localhost:4000/api/historia/equipos"
```

---

*Última actualización: Mayo 2026 — Premier Hub API*
