# Hito 3 (v1.2) — Bot de revisión de PRs: evidencia de cierre

**Entregable funcional**: un PR real en un repo de prueba dispara el webhook, se verifica la firma, se crean `proyecto`/`actividad`/`caso`, el agente publica una revisión como comentario, el label del Issue refleja `actividades.estado`, y al resolverse las observaciones el label y el `assignee` se actualizan solos — sin intervención manual (`design.md` §12).

**Tareas**: [`openspec/changes/hito-1.2-bot-revision-prs/tasks.md`](../../../openspec/changes/hito-1.2-bot-revision-prs/tasks.md) (24/24 — tareas 1-23 con commit propio `(Hito 3, tarea N)`, tarea 24 verificación manual end-to-end, sin código de producción).

## Checklist de cierre (`AGENTS.md`)

- [x] Reviewer aprobó explícitamente (`sdd-verify` contra `tasks.md` + los 3 specs + `design.md`) — PASS, sin CRITICAL. Ver [`verify-report.md`](../../../openspec/changes/hito-1.2-bot-revision-prs/verify-report.md). El único WARNING relevante ("paso 5 no demostrado end-to-end") quedó resuelto con la evidencia de abajo, posterior al reporte.
- [x] Entregable funcional demostrado de punta a punta — guion de 10 pasos de `design.md` §12.3, **los 8 pasos aplicables con evidencia real**, incluido el paso 5 completo.
- [x] Esta carpeta (`docs/progreso/v1.2-bot-revision-prs/`).
- [ ] Tag `v1.2.0` — pendiente, se crea después del merge a `main`.

## Guion de demo (`design.md` §12.3) — resultado real

| # | Paso | Resultado |
|---|---|---|
| 1 | `npm run dev` sin `GITHUB_WEBHOOK_SECRET` | ✅ TUI arranca normal, sin puerto abierto, `webhook-deshabilitado` en el log |
| 2 | Con secreto + `gh webhook forward` | ✅ `webhook-escuchando { port: 8787 }` |
| 3 | Abrir un PR real | ✅ comentario del agente + label + filas nuevas en `proyectos`/`actividades`/`casos` |
| 4 | Prompt en la TUI mientras corre el turno del PR | ✅ dos `casoId` distintos, sin citas cruzadas |
| 5 | Comentar resolviendo observaciones | ✅ `actividad-reusada` + `estado`/`label` → `resuelto`, sin intervención manual — evidencia abajo |
| 6 | `curl` con firma inválida | ✅ `401`, `webhook-firma-invalida`, conteo de `actividades` sin cambio |
| 7 | Repetir paso 3 con `GITHUB_TOKEN` vacío | ✅ turno completa, estado persiste, `tablero-deshabilitado`, cero excepciones no capturadas |
| 8 | PRs en dos repos distintos casi a la vez | ✅ aislamiento por clave de la cola — evidencia abajo |
| 9 | Ctrl+C durante un turno de webhook | ⏭️ **no verificado manualmente** — ver abajo |
| 10 | `PRAGMA journal_mode` / `ls data/` | ✅ `wal`, `harness.db-wal`/`-shm` presentes, `git status` limpio |

### Bug real encontrado durante la verificación (paso 3/5): loop de auto-comentario

Al comentar el bot un PR (`publicarRevision`), GitHub reenvía ese mismo comentario como `issue_comment.created` — sin filtro, el proceso se reprocesaba a sí mismo (`actividad-reusada`), quemando un turno real de la API cada vez. Se confirmó **dos veces seguidas** en el PR #49 real (4 comentarios duplicados) antes de frenar el proceso manualmente.

**Fix aplicado** (Implementer→Reviewer, TDD): `resolveBotLogin` (`src/adapters/board/index.ts`) resuelve el login del bot vía `GET /user` una vez al arrancar; se propaga como `botLogin` hasta `mapIssueCommentEvent` (`src/adapters/webhooks/github-mapper.ts`), que descarta el evento si `comment.authorLogin === botLogin`. Reviewer aprobó (477/477 tests, typecheck limpio, cero violaciones de arquitectura). Commits: `511cd43`, `9d54801`, `a0e05b6`.

Evidencia en producción de que el fix funciona — 30 ocurrencias reales de `webhook-evento-ignorado` en `data/harness.log` tras el deploy, cero loops nuevos desde entonces.

### Paso 5 — resuelto con identidad de bot dedicada

La primera corrida de este paso usaba el mismo PAT personal (`JimmyFung123`) para abrir el PR y para el propio bot — el filtro anti-loop compara `comment.authorLogin` contra `botLogin`, y con un PAT compartido ambos son literalmente el mismo login, así que no podía distinguir "eco del bot" de "comentario humano real" (confirmado además que `comment.user.type` tampoco ayuda: un PAT personal siempre reporta `"User"`, nunca `"Bot"`). No era un bug de código, era una limitación de credencial compartida en el entorno de demo.

**Solución aplicada**: cuenta de GitHub dedicada para el bot (`JimmyF2024`), agregada como colaboradora con permiso Write al repo de prueba, con su propio token — **classic PAT**, no fine-grained, porque los fine-grained tokens todavía no soportan repos donde la cuenta es colaboradora y no dueña ([GitHub Community #58868](https://github.com/orgs/community/discussions/58868)). Con `GITHUB_TOKEN` apuntando a ese token, `authorLogin` (`JimmyFung123`) y `botLogin` (`JimmyF2024`) quedan genuinamente distintos.

Ciclo completo real, PR #2 de `JimmyFung123/practicaDeDesarrollo`, todo bajo el mismo `casoId` `0741ceb4-864d-4a8c-804e-4d775d6452cb`:

```json
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"2","actividadId":"bf899497-1709-4080-be44-b5e494a371b2","deliveryId":"5b0ce6e0-a7fe-11f1-92f2-4e720b6e698a","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"actividad-creada","timestamp":"2026-09-04T01:17:11.130Z"}
{"chars":1621,"casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"tablero-comentario-publicado","timestamp":"2026-09-04T01:17:39.505Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"tablero-actualizado","timestamp":"2026-09-04T01:17:41.331Z"}
{"event":"webhook-recibido","action":"created","bytes":13842,"casoId":"6d3508c0-a7fe-11f1-9c38-a9ec49b61b1f","timestamp":"2026-09-04T01:17:41.532Z"}
{"eventName":"issue_comment","casoId":"6d3508c0-a7fe-11f1-9c38-a9ec49b61b1f","event":"webhook-evento-ignorado","timestamp":"2026-09-04T01:17:41.533Z"}
```

**Ronda 1** — el bot publica su comentario (`tablero-comentario-publicado`), GitHub le reenvía su propio comentario como webhook 200ms después, y el filtro lo descarta correctamente (`webhook-evento-ignorado`) porque `authorLogin === botLogin === "JimmyF2024"`. `estado: "observado"`.

```json
{"deliveryId":"d17e8ea0-a7fe-11f1-8182-1cb93083aa8f","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"actividad-reusada","timestamp":"2026-09-04T01:20:29.756Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"tablero-actualizado","timestamp":"2026-09-04T01:20:39.161Z"}
```

**Ronda 2** — comentario humano real (`JimmyFung123`, distinto de `botLogin`) diciendo "ya corregí lo que mencionaste", sin cambiar nada del PR. El filtro lo deja pasar (`actividad-reusada`, mismo `caso`, no crea uno nuevo). El agente lee la metadata real del PR (`leerMetadatos`), ve que título/descripción/archivos siguen idénticos a la ronda anterior, y **correctamente no se deja convencer por la sola afirmación**: `VEREDICTO: observado`, mismo `label`. Comportamiento honesto por diseño, no un fallo.

```json
{"deliveryId":"545a2910-a7ff-11f1-9330-d17c4d97e4bb","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"actividad-reusada","timestamp":"2026-09-04T01:24:09.206Z"}
{"estado":"resuelto","label":"resuelto","assignee":"JimmyFung123","casoId":"0741ceb4-864d-4a8c-804e-4d775d6452cb","event":"tablero-actualizado","timestamp":"2026-09-04T01:24:24.879Z"}
```

**Ronda 3** — título y descripción del PR editados de verdad, más un comentario avisando. El agente ve la metadata cambiada, da veredicto de aprobación, y `tablero-actualizado` transiciona `estado`/`label` a `"resuelto"` con `assignee: "JimmyFung123"` — **sin ninguna intervención manual sobre el label o el assignee**. Paso 5 confirmado de punta a punta.

### Paso 9 — no verificado manualmente

Es la única verificación manual del drenaje ordenado de turnos en vuelo al cerrar (ADR 10, `Promise.race` con timeout de 5s) — no existe un test automatizado de SIGINT-a-mitad-de-turno por diseño. Se decidió omitir la verificación manual por timing (Ctrl+C no cayó de forma confiable dentro de la ventana de un turno en vuelo en los intentos realizados). Cobertura actual: solo lectura de código (`src/main.ts`, el `finally` con `webhook.close()` antes de `db.close()`).

## Evidencia técnica — paso 8 (aislamiento por `proyectoId`)

Dos PRs abiertos ~13s aparte en dos repos reales distintos, correlacionados por `deliveryId` → `casoId`:

```json
{"event":"webhook-recibido","action":"opened","bytes":25233,"casoId":"d25d0e60-a767-11f1-9d39-7dfdbb55241c","timestamp":"2026-09-03T07:19:38.586Z"}
{"proyectoId":"JimmyFung123/Proyecto-SBD-Grupo-5-26559","referenciaExterna":"4","actividadId":"4bce0260-3989-4da8-85ea-c7c77ebae32f","deliveryId":"d25d0e60-a767-11f1-9d39-7dfdbb55241c","casoId":"1db87d14-0ab8-4efd-aeb4-999a0781b142","event":"actividad-creada","timestamp":"2026-09-03T07:19:38.588Z"}
{"event":"webhook-recibido","action":"opened","bytes":24340,"casoId":"d9fde040-a767-11f1-9a0c-56cd45623c3d","timestamp":"2026-09-03T07:19:51.441Z"}
{"proyectoId":"JimmyFung123/ProyectoUMBRALGrupo8","referenciaExterna":"52","actividadId":"fffa9ed3-67c9-4f60-9d24-719bb12f9866","deliveryId":"d9fde040-a767-11f1-9a0c-56cd45623c3d","casoId":"b926c700-aa20-4e15-bf5a-d03ee29faee2","event":"actividad-creada","timestamp":"2026-09-03T07:19:51.442Z"}
{"agentId":"agente-conversacional","sdkSessionId":"402bf1a3-f510-43fc-bd93-aa82b25ab798","casoId":"1db87d14-0ab8-4efd-aeb4-999a0781b142","event":"turno-completado","timestamp":"2026-09-03T07:19:51.545Z"}
{"casoId":"1db87d14-0ab8-4efd-aeb4-999a0781b142","event":"conocimiento-sin-consulta","timestamp":"2026-09-03T07:19:51.545Z"}
{"chars":1498,"casoId":"1db87d14-0ab8-4efd-aeb4-999a0781b142","event":"tablero-comentario-publicado","timestamp":"2026-09-03T07:19:52.386Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"1db87d14-0ab8-4efd-aeb4-999a0781b142","event":"tablero-actualizado","timestamp":"2026-09-03T07:19:54.051Z"}
{"agentId":"agente-conversacional","sdkSessionId":"b1a57d45-b0ce-4843-a897-0a61e1d657ac","casoId":"b926c700-aa20-4e15-bf5a-d03ee29faee2","event":"turno-completado","timestamp":"2026-09-03T07:20:04.760Z"}
{"casoId":"b926c700-aa20-4e15-bf5a-d03ee29faee2","event":"conocimiento-sin-consulta","timestamp":"2026-09-03T07:20:04.760Z"}
{"chars":1389,"casoId":"b926c700-aa20-4e15-bf5a-d03ee29faee2","event":"tablero-comentario-publicado","timestamp":"2026-09-03T07:20:05.711Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"b926c700-aa20-4e15-bf5a-d03ee29faee2","event":"tablero-actualizado","timestamp":"2026-09-03T07:20:07.307Z"}
```

`webhook-recibido` del segundo repo llega **antes** de que el primero termine (`turno-completado` a las `:51.545`, segundo `webhook-recibido` a las `:51.441` — un momento antes) y ambos `casoId` corren su ciclo completo sin bloquearse entre sí: la `KeyedQueue` serializa por `proyectoId`, no globalmente (ADR 8).

## `SELECT` de las tres tablas nuevas

```
$ sqlite3 -header -column data/harness.db "SELECT id, nombre, repo_url FROM proyectos;"
id                                        nombre                       repo_url
-----------------------------------------  ---------------------------  ------------------------------------------------------------
JimmyFung123/ProyectoUMBRALGrupo8         ProyectoUMBRALGrupo8         https://github.com/JimmyFung123/ProyectoUMBRALGrupo8
JimmyFung123/Proyecto-SBD-Grupo-5-26559   Proyecto-SBD-Grupo-5-26559   https://github.com/JimmyFung123/Proyecto-SBD-Grupo-5-26559

$ sqlite3 -header -column data/harness.db "SELECT id, proyecto_id, tipo, referencia_externa, estado, responsable_id FROM actividades WHERE id IN ('4bce0260-3989-4da8-85ea-c7c77ebae32f','fffa9ed3-67c9-4f60-9d24-719bb12f9866');"
id                                     proyecto_id                                tipo       referencia_externa   estado      responsable_id
-------------------------------------  -----------------------------------------  ---------  -------------------  ----------  --------------
4bce0260-3989-4da8-85ea-c7c77ebae32f   JimmyFung123/Proyecto-SBD-Grupo-5-26559    pr_review  4                    observado   JimmyFung123
fffa9ed3-67c9-4f60-9d24-719bb12f9866   JimmyFung123/ProyectoUMBRALGrupo8          pr_review  52                   observado   JimmyFung123

$ sqlite3 -header -column data/harness.db "SELECT id, tipo, estado FROM casos WHERE id IN ('1db87d14-0ab8-4efd-aeb4-999a0781b142','b926c700-aa20-4e15-bf5a-d03ee29faee2');"
id                                     tipo       estado
-------------------------------------  ---------  ------
1db87d14-0ab8-4efd-aeb4-999a0781b142   pr_review  activo
b926c700-aa20-4e15-bf5a-d03ee29faee2   pr_review  activo
```

Totales al momento del cierre: 2 `proyectos`, 12 `actividades`, 86 `casos` (incluye los `casos` de la TUI, que comparten la misma tabla que los de webhook).

## `npm test` / `npm run typecheck`

```
$ npm test
 Test Files  40 passed (40)
      Tests  477 passed (477)

$ npm run typecheck
> tsc --noEmit
(sin salida — cero errores)
```

Corridos **después** de arreglar un bug de test-isolation encontrado durante esta misma verificación manual: 6 tests de `src/build-on-activity.test.ts` que ejecutan un turno real vía `handler(...)` no pasaban `logDeps` explícito a `makeBaseDeps`, cayendo al escritor de archivo real por default y contaminando este mismo `data/harness.log` con líneas de fixtures cada vez que corría `npm test`. Fix: `fakeLogDeps()` explícito en los 6 — mismo patrón que ya usaban los otros tests del archivo.
