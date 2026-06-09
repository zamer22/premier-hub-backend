# Premier Hub — Backend API

API REST construida con **Node.js 20 + Express + TypeScript**. Se conecta a Supabase (base de datos y storage), a la API de fútbol (API-Football) y a un servicio de ML interno desplegado en el mismo clúster de Kubernetes.

---

## Tabla de contenidos

1. [Requisitos previos](#requisitos-previos)
2. [Instalación local](#instalación-local)
3. [Variables de entorno](#variables-de-entorno)
4. [Ejecución local](#ejecución-local)
5. [Build y Docker](#build-y-docker)
6. [Despliegue en Kubernetes (K3s)](#despliegue-en-kubernetes-k3s)
7. [Túnel de red](#túnel-de-red)
8. [Rutas disponibles](#rutas-disponibles)

---

## Requisitos previos

| Herramienta | Versión mínima |
|-------------|----------------|
| Node.js | 20 |
| npm | 10 |
| Docker | 24 |
| kubectl | 1.28 |
| k3s (solo en el servidor) | v1.28 |

---

## Instalación local

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd premier-hub-backend

# 2. Entrar al directorio de la aplicación
cd api

# 3. Instalar dependencias
npm install
```

---

## Variables de entorno

Dentro de `api/` crear el archivo `.env`:

```bash
touch api/.env
```

Sustituir cada variable con los valores que se encuentran en el documento **`06_Configuracion_de_seguridad.pdf`**, sección **Backend**.

---

## Ejecución local

Todos los comandos se ejecutan desde el directorio `api/`.

```bash
# Modo desarrollo con recarga automática (tsx watch)
npm run dev

# Compilar TypeScript a JavaScript (genera dist/)
npm run build

# Ejecutar el build compilado
npm start
```

La API queda disponible en `http://localhost:4000`.

Para verificar que el servidor está activo:

```bash
curl http://localhost:4000/api/health
# Respuesta esperada: {"status":"ok"}
```

---

## Build y Docker

La imagen Docker se construye desde el directorio raíz del repositorio usando el `Dockerfile` que se encuentra en `api/`.

```bash
# Construir la imagen para producción
docker build -t premier-api:latest ./api

# Construir la imagen para preprod
docker build -t premier-api:preprod ./api

# Ejecutar el contenedor localmente
docker run -p 4000:4000 --env-file api/.env premier-api:latest
```

El `Dockerfile` usa `node:20-alpine`, instala dependencias, compila TypeScript y expone el puerto `4000`

---

## Despliegue en Kubernetes (K3s)

### Descripción general

El servidor corre **K3s** (distribución ligera de Kubernetes). El CI/CD está implementado con **GitHub Actions** usando un runner self-hosted instalado directamente en ese servidor. Cuando se hace push a las ramas correctas, el workflow construye la imagen Docker, la importa en el runtime de K3s y actualiza el Deployment.

No se usa un registry externo: la imagen se transfiere directamente con `docker save | k3s ctr images import`. Por eso los manifiestos usan `imagePullPolicy: Never`.

### Namespaces

| Namespace | Rama que lo dispara | Dominio |
|-----------|--------------------|---------| 
| `preprod` | `preprod` | `https://app-preprod.zamer-o.com` |
| `prod` | `main` | `https://app.zamer-o.com` |

### Flujo de despliegue automático

**Preprod** — archivo `.github/workflows/deploy-preprod.yml`:

```
push a branch preprod
  → docker build -t premier-api:<sha> -t premier-api:preprod ./api
  → docker save | sudo k3s ctr images import -
  → kubectl set image deployment/api api=premier-api:<sha> -n preprod
  → kubectl rollout status deployment/api -n preprod --timeout=120s
```

**Prod** — archivo `.github/workflows/deploy.yml`:

```
push a branch main
  → docker build -t premier-api:<sha> -t premier-api:latest ./api
  → docker save | sudo k3s ctr images import -
  → kubectl set image deployment/api api=premier-api:<sha> -n prod
  → kubectl rollout status deployment/api -n prod --timeout=120s
```

### Secrets de Kubernetes

Antes del primer despliegue, los secretos deben existir en cada namespace. Se crean una sola vez en el servidor con los valores del documento **`06_Configuracion_de_seguridad.pdf`**, sección **Backend**:

```bash
# Namespace preprod
kubectl create secret generic api-secrets \
  --namespace=preprod \
  --from-literal=SUPABASE_URL='...' \
  --from-literal=SUPABASE_SERVICE_KEY='...' \
  --from-literal=APIFOOTBALL_KEY='...' \
  --from-literal=NEWS_API_KEY='...' \
  --from-literal=COOKIE_SECRET='...'

# Namespace prod
kubectl create secret generic api-secrets \
  --namespace=prod \
  --from-literal=SUPABASE_URL='...' \
  --from-literal=SUPABASE_SERVICE_KEY='...' \
  --from-literal=APIFOOTBALL_KEY='...' \
  --from-literal=NEWS_API_KEY='...' \
  --from-literal=COOKIE_SECRET='...'
```

### Variables de entorno en los manifiestos

Las variables no sensibles (puerto, entorno, CORS, URLs de APIs externas) se definen directamente en el manifiesto YAML de cada namespace. Las sensibles se inyectan desde el Secret `api-secrets` usando `secretKeyRef`.

**Diferencia entre preprod y prod en `ML_SERVICE_URL`:**

- En **preprod** se usa el nombre DNS interno del clúster: `http://ml.preprod.svc.cluster.local:8080`
- En **prod** se usa la ClusterIP fija del Service: `http://10.43.53.230:8080`

Esta diferencia existe porque ambos Deployments tienen `dnsPolicy: None` (ver sección [Túnel de red](#túnel-de-red)). En prod, sin resolución DNS interna del clúster, el nombre `ml.prod.svc.cluster.local` no resuelve, por lo que se configuró la IP interna directamente.

### Comandos útiles de operación

```bash
# Ver el estado de los pods
kubectl get pods -n prod
kubectl get pods -n preprod

# Ver logs del pod en ejecución
kubectl logs -n prod deployment/api
kubectl logs -n preprod deployment/api

# Forzar un rollout sin cambiar imagen (útil para recargar secrets)
kubectl rollout restart deployment/api -n prod

# Ver el historial de rollouts
kubectl rollout history deployment/api -n prod
```

---

## Túnel de red

### Por qué existe el túnel

El servidor no expone puertos directamente a internet. En su lugar se usa un **Cloudflare Tunnel** (`cloudflared`) instalado en el servidor. Este túnel crea una conexión saliente cifrada hacia Cloudflare, que luego enruta el tráfico HTTPS externo de los dominios `zamer-o.com` hacia los servicios internos del clúster sin necesidad de abrir puertos en el firewall ni tener IP pública fija.

### Cómo funciona

```
Usuario → https://app.zamer-o.com
        → Cloudflare (DNS + edge)
        → Cloudflare Tunnel (cloudflared en el servidor)
        → Ingress / Service de K3s
        → Pod de la API (puerto 4000)
```

Lo mismo aplica para `app-preprod.zamer-o.com` y `supabase.zamer-o.com`.

### Relación con `dnsPolicy: None`

Los pods de la API tienen configurado `dnsPolicy: None` con servidores DNS externos (`8.8.8.8` y `1.1.1.1`). Esto se hizo para que los pods puedan resolver dominios públicos (como `supabase.zamer-o.com`) a través de Cloudflare, ya que el DNS interno del clúster no conoce esos nombres.

La consecuencia es que los pods **no pueden resolver nombres internos del clúster** (`.svc.cluster.local`). Por eso el servicio ML en prod se referencia por su ClusterIP numérica en lugar de su nombre DNS interno.

---

## Rutas disponibles

| Prefijo | Módulo |
|---------|--------|
| `/api/health` | Health check |
| `/api/auth` | Autenticación y perfil de usuario |
| `/api/ranking` | Ranking de usuarios |
| `/api/simulador` | Simulador de partidos |
| `/api/noticias` | Noticias (scraping + News API) |
| `/api/tienda` | Tienda de items |
| `/api/marketplace` | Marketplace entre usuarios |
| `/api/wordle` | Juego Wordle temático |
| `/api/historia` | Historia de la Premier League |
| `/api/partidos/historial` | Historial de partidos pasados |
| `/api/foro` | Foro de la comunidad |
| `/api/admin` | Administración (rutas protegidas) |
| `/api/missing-xi` | Juego Missing XI |
| `/api/ml` | Proxy hacia el servicio de ML |
| `/api/leaderboard` | Tabla de líderes |
| `/api/lab` | Funciones experimentales |
| `/api` (general) | Partidos en vivo y fixtures |
