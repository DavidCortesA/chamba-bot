# 🦅 ChambaBot

Bot de Telegram que busca vacantes remotas de desarrollo, las puntúa según **tu stack** y te avisa solo de las que valen la pena. Se configura desde el propio chat.

Fuentes: RemoteOK · Remotive · WeWorkRemotely · Himalayas · Jobicy.

## Qué hace

- **Puntúa** cada vacante con tu stack, modalidad, sueldo y nivel. El título pesa más (+1 extra por tecnología que aparece en él).
- **Descarta** vacantes que no son para ti: "US only", "EU only", y las que tienen un campo de ubicación restringido a otra región (se puede apagar con `/ubicacion off`).
- **Normaliza sueldos** a USD (mensual y anual) para poder filtrar y comparar entre fuentes. Los tipos de cambio son aproximados.
- **Mensaje completo** por vacante: sueldo, ubicación, seniority, tipo de contrato, años de experiencia, stack que piden (✅ las que son tuyas), match con desglose, resumen y requisitos.
- **Botones** en cada vacante: ⭐ Guardar · ✅ Apliqué · 🙈 Descartar.

```
🔥 Senior React Full stack Developer
🏢 Lemon.io · 📡 RemoteOK · 🕒 hace 27 d

💰 $6,670–$16,670 USD/mes (≈ $80k–$200k/año)
🎓 4+ años
🛠 Piden: ✅ React · ✅ Node.js · Python · ✅ TypeScript
🎯 Match 11 ▰▰▰▰▱ +4 react (título), +2 typescript, +2 remote…

📝 Resumen…
📋 Requisitos:
• 4+ years of software development experience.
[Ver vacante →]
[⭐ Guardar] [✅ Apliqué] [🙈 Descartar]
```

## Comandos

Escribir texto suelto también busca; un saludo ("hola", "buenas") te responde por tu nombre.

| Comando | Qué hace |
| --- | --- |
| `/top [n]` | Mejores vacantes de los últimos 7 días |
| `/buscar react 3000-6000` | Busca por texto y/o rango de sueldo (USD/mes) |
| `/guardadas` · `/aplicadas` | Tus listas. Abre una con `/ver_ID` |
| `/sueldo 3000-6000` | Solo avisar dentro del rango (USD/mes). `4000+`, `40k-80k anual`, `off` |
| `/sinsueldo si\|no` | ¿Avisar vacantes que no publican sueldo? (solo con `/sueldo` activo) |
| `/minscore 8` · `/lote 10` | Puntaje mínimo · máximo de avisos por ejecución |
| `/ubicacion on\|off` | Descartar vacantes restringidas a otras regiones |
| `/stack` | Ver tu stack y pesos |
| `/stack add rust 3` | Agregar (peso opcional, por defecto 2). Alias con `\|`: `nestjs\|nest.js` |
| `/stack remove vue` · `/stack peso react 4` | Quitar · cambiar peso (-5 a 5) |
| `/stack set react 3, next.js 3, typescript 2` | Reemplazar todo el stack |
| `/stack reset` | Volver al stack original |
| `/evitar add php` · `remove` · `reset` | Tecnologías que penalizan (-3) |
| `/stats` | Totales, sueldo mediano, tecnologías más pedidas y huecos de tu stack |
| `/config` · `/pausa` · `/reanudar` | Configuración y control de avisos |
| `/ayuda` | Ayuda y teclado de atajos |

Los montos de `/sueldo` y `/buscar` son **USD por mes** salvo que agregues `anual`. El filtro incluye vacantes cuyo rango se *traslapa* con el tuyo.

Al cambiar stack, evitar o ubicación, el bot **re-puntúa** las vacantes de los últimos 30 días y te dice cuántas quedan pendientes.

## Instalación

Requisitos: Node 22+, una base de datos [Neon](https://neon.tech) y un bot de Telegram (con [@BotFather](https://t.me/BotFather)).

```bash
npm install
```

Variables de entorno:

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión de Neon |
| `TELEGRAM_TOKEN` | Token del bot |
| `TELEGRAM_CHAT_ID` | Tu chat id. El bot **ignora a cualquier otro chat** |
| `MIN_SCORE` | Puntaje mínimo por defecto (5). `/minscore` lo sobrescribe |
| `MAX_PER_RUN` | Máximo de avisos por ejecución (10). `/lote` lo sobrescribe |
| `WINDOW_SECONDS` | Duración de la ventana de escucha en modo `window` (270) |
| `SCRAPE_EVERY_MIN` | Minutos entre búsquedas de vacantes en modo `window` (25) |

Las tablas y columnas nuevas se crean solas en cada ejecución (`ensureSchema`); no hay que migrar nada a mano. Tu configuración se guarda en la tabla `bot_state`.

## Ejecución

| Comando | Modo |
| --- | --- |
| `npm run scrape` | **Lo que usa GitHub Actions.** Solo busca vacantes y avisa (los comandos los atiende el Worker) |
| `npm run window` | Alternativa sin Cloudflare: escucha ~4.5 min y busca vacantes si pasaron ≥ 25 min |
| `npm run deploy` | Despliega el Worker (`wrangler deploy`) |
| `npm start` | Una sola pasada: atiende comandos pendientes, busca vacantes y avisa |
| `npm run commands` | Solo atiende comandos pendientes |
| `npm run bot` | Escucha Telegram sin parar y responde al instante (uso local) |
| `npm test` | Pruebas unitarias |
| `npm run typecheck` | Verifica tipos |

### Arquitectura (gratis)

```
Telegram ──webhook──▶ Cloudflare Worker (src/worker.ts) ──▶ Neon   → responde al instante
GitHub Actions (cada 30 min, npm run scrape) ──────────────▶ Neon + Telegram → busca y avisa
```

### 1. Cloudflare Worker (comandos y botones)

1. En Cloudflare: **Workers & Pages → Create → Import a repository** y elige este repo. Nombre del Worker: `chamba-bot` (debe coincidir con `wrangler.jsonc`).
2. En el formulario deja el **Build command vacío** y el **Deploy command** como `npx wrangler deploy`.
3. Tras el primer deploy, en **Settings → Variables and Secrets** agrega como **Secret**:

   | Secret | Valor |
   | --- | --- |
   | `DATABASE_URL` | Cadena de conexión de Neon |
   | `TELEGRAM_TOKEN` | Token del bot |
   | `TELEGRAM_CHAT_ID` | Tu chat id (el bot ignora a cualquier otro) |
   | `WEBHOOK_SECRET` | Una cadena larga inventada por ti (solo `A-Z a-z 0-9 _ -`), p. ej. `openssl rand -hex 24` |
   | `MIN_SCORE`, `MAX_PER_RUN` | Opcionales |

4. Registra el webhook **una sola vez** abriendo en el navegador:

   ```
   https://chamba-bot.<tu-subdominio>.workers.dev/setup?key=<WEBHOOK_SECRET>
   ```

   Responde `{"ok": true, "action": "webhook registrado"}` y deja listo el menú de comandos. Después escríbele `hola` al bot.

- `.../setup?key=<WEBHOOK_SECRET>&delete=1` quita el webhook (para usar `npm run bot` en local).
- `GET /` responde "ChambaBot activo" para comprobar que el Worker está arriba.
- Cada actualización se valida con el header secreto de Telegram; sin él, 401.
- Si cambias a otro bot, crea otro Worker (otro nombre) con sus propios secretos y su propio `/setup`. **Usa una base de datos de Neon distinta por bot** (o un branch de Neon): si comparten base, se pisan la configuración, las vacantes y el estado.

### 2. GitHub Actions (búsqueda de vacantes)

`.github/workflows/jobs.yml` corre `npm run scrape` cada 30 minutos con los secretos `DATABASE_URL`, `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID` del repositorio (**Settings → Secrets and variables → Actions**). No lee mensajes: con el webhook activo Telegram no permite `getUpdates`.

> No corras `npm run bot` con el webhook activo (quita el webhook con `/setup?...&delete=1`): `npm run bot` lo borra al arrancar.

### Sin Cloudflare

Usa `npm run window` en el workflow (cron `*/5`): escucha Telegram ~4.5 min por ventana y busca vacantes si ya tocó. Es gratis en repositorios públicos pero corre casi continuo.

## Estructura

```
src/
  worker.ts       Cloudflare Worker (webhook de Telegram + /setup)
  index.ts        orquestador (modos run / scrape / commands / listen / window)
  commands.ts     comandos y botones de Telegram
  telegram.ts     API de Telegram, menú de comandos y teclado
  db.ts           esquema, consultas, re-puntuación y estadísticas
  settings.ts     configuración (stack, filtros, pausa)
  score.ts        reglas de puntuación y bloqueos
  stack.ts        stack por defecto y detección de tecnologías
  salary.ts       parseo, normalización y formato de sueldos
  format.ts       construcción del mensaje de cada vacante
  sources/        una fuente por archivo
test/             pruebas unitarias
```

## Agregar una fuente

Crea `src/sources/mi-fuente.ts` que exporte un `Source` (`name` y `fetch()` que devuelve `Job[]`), llena los campos opcionales que tenga (`salary`, `location`, `seniority`, `tags`, `postedAt`…) y agrégala al arreglo `sources` en `src/index.ts`.
