# Verify Report - PR5 (Hito 7 / v3.0.0)

**Alcance**: tareas 11-14 de tasks.md - "server.ts parte 2: construirTask, despacho real de SendMessage/GetTask/CancelTask, startServer (tope de turnos en vuelo + drenaje + puerto efectivo) y server-index.ts (fachada startA2AServer)". Tareas 1-10 (PR1-PR4) ya verificadas/mergeadas en commits previos; tareas 15-21 (PR6) fuera de alcance, no evaluadas.

**Rama verificada**: hito/v3.0-a2a-servidor (working tree limpio al momento de la verificacion). Commits evaluados: b8874dc (tarea 11), 12f91a9 (tarea 12), 95fa32d (tarea 13), 16b1cfa (tarea 14).

**Metodologia**: lectura directa de tasks.md (texto exacto de las 4 tareas), design.md (ADR 93, 94, 97, 99, 100, 101, seccion 6.3, 6.4, 12), specs/servidor-a2a-jsonrpc/spec.md, src/adapters/a2a/server.ts, src/adapters/a2a/server.test.ts, src/adapters/a2a/server-index.ts, src/adapters/a2a/server-index.test.ts - mas ejecucion real de npm test -- server, npm test -- server-index y npm run typecheck en esta sesion.

## Evidencia de ejecucion (recalculada en esta sesion)

- npm test -- server: 5 archivos, 156 tests, todos verdes (incluye server.test.ts, server-config.test.ts, server-index.test.ts y los servidores web/webhooks que matchean por substring).
- npm test -- server-index: 1 archivo, 3 tests, todos verdes.
- npm run typecheck (tsc --noEmit): sin errores.

## Puntos de atencion especificos (verificados con evidencia, no de oidas)

1. GetTask es genuinamente sincrono (ADR 100): confirmado por lectura - el bloque "if (method === METODO_GET_TASK)" (server.ts:556-571) no tiene ningun await; onConsultarTarea esta tipada (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined (sin Promise), asi que un await adentro seria un error de compilacion, no de criterio. Hay un test mecanico dedicado (server.test.ts:805-830) que verifica que un unico microtask tick alcanza para llegar a res.end() - no polling con vi.waitFor. Paso en ejecucion real.
2. Las cuatro ramas de CancelTask (ADR 94) estan completas: "cancelada"/"ya-cancelada" responden result via construirTask (probadas con it.each, server.test.ts:841-856); "no-cancelable" responde A2A_ERROR_TASK_NOT_CANCELABLE con onCancelarTarea llamado una sola vez (server.test.ts:858-878); "no-encontrada" responde A2A_ERROR_TASK_NOT_FOUND (server.test.ts:880-894). El switch (server.ts:576-589) cubre los 4 discriminantes del tipo CancelacionA2AResultado sin default, exhaustivo por tipo.
3. construirTask es total y pura: las 7 combinaciones estado x artifacts/status.message estan testeadas explicitamente (server.test.ts:1266-1329): COMPLETED con resultado, COMPLETED sin resultado (no lanza, sin artifacts), FAILED/CANCELED/REJECTED (con status.message fijo, sin artifacts), SUBMITTED/WORKING (ninguno de los dos). Confirmado por lectura de server.ts:686-713: no hay Date.now(), no hay randomUUID, status.timestamp = vista.updatedAt exacto, artifactId/messageId derivados de a2aTaskId, y ninguna rama tiene throw.
4. Tope de turnos en vuelo (ADR 99 pto 3): hayCupo viaja como valor calculado inline (enVuelo.size < deps.config.maxEnVuelo, server.ts:763) dentro del objeto que se pasa a deps.onSolicitudA2A - no como callback separado. Testeado con maxEnVuelo: 2 y tres SendMessage concurrentes: el tercero recibe hayCupo: false y REJECTED (server.test.ts:1058-1096), y recupera cupo al resolver un turno (server.test.ts:1098-1138).
5. Drenaje (ADR 99 pto 5, ADR 97): close() usa Promise.allSettled sobre enVuelo en carrera contra A2A_CLOSE_TIMEOUT_MS via Promise.race, y nunca rechaza - confirmado por lectura (server.ts:801-819) y por los tres tests con reloj falso: espera un turno pendiente (server.test.ts:1150-1183), resuelve igual al agotar el techo y loguea a2a-servidor-cierre-con-turnos-en-vuelo (server.test.ts:1185-1218), y no rechaza aunque el turno en vuelo rechace (server.test.ts:1220-1248).
6. startA2AServer devuelve undefined (no un no-op) sin token: confirmado por lectura (server-index.ts:63-66) - el chequeo isA2AServerEnabled(config) retorna undefined explicito, con createServer sin invocar. Testeado en server-index.test.ts:99-113.

## src/core/ no tocado por estas 4 tareas

git diff --stat b8874dc^..16b1cfa -- src/core/ da vacio - confirmado: las tareas 11-14 son 100% adaptador (server.ts, server.test.ts, server-index.ts, server-index.test.ts), sin ningun archivo de src/core/ tocado.

## Contra AGENTS.md / ADRs fuera de alcance (segun instruccion del orquestador)

- ADR 90 pto 7 (evidencia real de concurrencia): correctamente NO verificado en este PR - es tarea 17, PR6.
- ADR 98 (firma de dependencias del nucleo): correctamente NO aplica - es tarea 15, y de hecho src/core/ ni se toco (ver arriba).
- ADR 102 (independencia servidor/cliente): server.ts no importa client.ts ni repository.ts - confirmado por lectura de los imports (server.ts:42-68), solo node:http, node:crypto, a2a-contract.js (nucleo, permitido), agent-card.js y server-config.js (mismo adaptador).

## Hallazgo nuevo - WARNING de presupuesto de review (no reportado por el Implementer)

design.md seccion 12 forecast para PR5: ~470 lineas de diff (215 prod + 255 test). Diff real medido en esta sesion (git diff --numstat b8874dc^..16b1cfa -- src/adapters/a2a/):

| Archivo | + | - |
|---|---|---|
| server-index.test.ts | 174 | 0 |
| server-index.ts | 85 | 0 |
| server.test.ts | 825 | 19 |
| server.ts | 493 | 23 |
| Total | 1577 | 42 |

Total real aprox 1619 lineas de diff, ~3.4x el forecast de design.md seccion 12. No es un defecto de codigo - la cobertura de test es exhaustiva y justificada (7 combinaciones de construirTask, 4 ramas de CancelTask, 3 escenarios de tope, 3 de drenaje, 3 de puerto efectivo) - pero excede largamente el presupuesto de 400 lineas que el propio proceso SDD de este repo declara como guardia de carga cognitiva del reviewer. Si este PR5 se sube como un solo PR de GitHub, el reviewer va a enfrentar ~4x el tamano que design.md prometio. No bloqueante para el codigo, pero si para la promesa de "PRs revisables" que el propio design.md hace en la seccion 12 - vale la pena recalibrar el forecast de PR6 (que ya lleva ~430 lineas estimadas, con mas superficie: build-on-a2a-entrante.ts, main.ts, el test de integracion).

## Hallazgo de proceso - estructura de rama del chain (no bloqueante, informativo)

design.md seccion 12 declara chain_strategy = feature-branch-chain, misma que hito-2.0, hito-2.1 y hito-2.2 - con la expectativa textual de que "PR1 apunta al tracker hito/v3.0-a2a-servidor y cada hijo al inmediato anterior" (o sea, ramas Git separadas por PR). En la practica (git branch -a, git ls-remote, gh pr list), ninguno de los hitos anteriores (hito-2.0, hito-2.1, hito-2.2) uso sub-ramas por PR: cada uno vive como una unica rama de tracker (hito/vX.Y-...) con commits secuenciales por tarea, mergeada como un solo PR de GitHub a main al cerrar el hito completo (gh pr list muestra PRs numero 5, 6, 7 - uno por hito, no uno por sub-PR). hito/v3.0-a2a-servidor sigue exactamente ese mismo patron real: los commits de PR1-PR5 (tareas 1-14) estan todos en la misma rama, sin sub-ramas Git. No hay una rama "PR4" separada contra la cual mergear "PR5" - el target real, dado el precedente de este repo, es: los commits de PR5 se apilan sobre los de PR1-PR4 en la misma rama de tracker, y el unico PR de GitHub que eventualmente se abre es hito/v3.0-a2a-servidor hacia main, al cerrar el hito completo (despues de PR6/tarea 21). Esto es una discrepancia entre lo que design.md seccion 12 promete textualmente y el precedente real del repo - vale la pena que quede escrito antes de asumir que hace falta abrir 6 PRs de GitHub separados.

## Veredicto

APROBADO, sin reservas de codigo, para continuar la rama hito/v3.0-a2a-servidor con PR6 (tareas 15-21).

Las cuatro tareas (11-14) estan completas, testeadas con evidencia de ejecucion real (no solo lectura), cumplen construirTask PURA y TOTAL (ADR 93), las cuatro ramas de CancelTask (ADR 94), la sincronia real de GetTask/CancelTask (ADR 100), el tope de turnos en vuelo con hayCupo como argumento (ADR 99 pto 3), el drenaje que nunca rechaza (ADR 99 pto 5) y el puerto efectivo (ADR 101), y startA2AServer con la semantica undefined correcta. npm test -- server, npm test -- server-index y npm run typecheck pasan en verde. src/core/ no fue tocado. No hay CRITICAL.

Los dos hallazgos (presupuesto de review 3.4x el forecast, y la discrepancia entre el chain plan de design.md y el precedente real de ramas del repo) son WARNING de proceso, no de codigo - no bloquean seguir con PR6, pero conviene que el orquestador/usuario los tenga presentes antes de decidir si esto se sube como PR de GitHub separado o se sigue acumulando en la misma rama de tracker hasta el cierre del hito.

## CRITICAL

Ninguno.

## WARNING

1. Diff real de PR5 (~1619 lineas) es ~3.4x el forecast de design.md seccion 12 (~470 lineas) - recalibrar la estimacion de PR6 y decidir si amerita partirse mas, dado que el presupuesto de 400 lineas del proceso SDD ya se declaro "High risk" para el change completo.
2. design.md seccion 12 promete sub-ramas Git por PR (feature-branch-chain con ramas hijas), pero el precedente real de hito-2.0/2.1/2.2 (y esta misma rama) es una unica rama de tracker con un solo PR de GitHub al cierre del hito. Si el usuario quiere sub-ramas reales, hay que crearlas retroactivamente (por ejemplo, una rama pr5 sobre el commit de la tarea 14, con base en una rama pr4 sobre el commit de la tarea 10); si no, el plan de design.md seccion 12 deberia actualizarse para reflejar la practica real.

## SUGGESTION

Ninguna - el codigo de las 4 tareas es limpio, sigue los moldes literales que design.md prescribe (onSoporteConDrenaje, address() con fallback, TEXTO_STATUS_MESSAGE_FRACASO como constantes de modulo) y no encontre bugs de logica, condiciones de carrera mal manejadas, ni violaciones de las reglas de tarea al revisar el diff acumulado de los 4 commits.
