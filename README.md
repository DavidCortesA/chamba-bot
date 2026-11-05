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

Escribir texto suelto también busca.

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

Las tablas y columnas nuevas se crean solas en cada ejecución (`ensureSchema`); no hay que migrar nada a mano. Tu configuración se guarda en la tabla `bot_state`.

## Ejecución

| Comando | Modo |
| --- | --- |
| `npm start` | Atiende comandos pendientes, busca vacantes y avisa (lo que usa el cron) |
| `npm run commands` | Solo atiende comandos pendientes |
| `npm run bot` | Escucha Telegram sin parar y responde al instante (uso local) |
| `npm test` | Pruebas unitarias |
| `npm run typecheck` | Verifica tipos |

### GitHub Actions

`.github/workflows/jobs.yml` corre `npm start` cada 30 minutos. Como no hay un servidor encendido, **los comandos se responden cuando corre el workflow** (hasta 30 min de espera). Para respuesta inmediata usa `npm run bot` en tu máquina o en un servidor.

> No corras `npm run bot` y el workflow a la vez con el mismo bot: Telegram solo permite un consumidor de `getUpdates` y los comandos se repartirían entre los dos.

## Estructura

```
src/
  index.ts        orquestador (modos run / commands / listen)
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
