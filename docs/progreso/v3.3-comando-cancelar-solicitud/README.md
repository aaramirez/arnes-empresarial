# v3.3.0 — `/cancelar-solicitud` (comando-cancelar-solicitud): evidencia de cierre (tarea 19)

**Entregable funcional**: el propio solicitante retira una solicitud interna pendiente con confirmación en dos pasos (`estado='cancelada'` confirmado por SQL directa); un tercero que intenta cancelar una solicitud ajena es rechazado sin ver su `detalle`; `/aprobar-solicitud`/`/rechazar-solicitud` siguen resolviendo solicitudes ajenas sin chequeo de dueño (R1, `solicitud-interna-hitl:72`, no derogado); y, post-ADR 144, `/cancelar-solicitud` sin id lista **únicamente** las solicitudes propias — incluido el caso de punta a punta que prueba que el bug del `LIMIT` está cerrado (25 solicitudes ajenas más antiguas no le comen el cupo a la propia) — mientras `/aprobar-solicitud`/`/rechazar-solicitud` sin id siguen listando **toda la organización**.

**Tareas**: [`openspec/changes/comando-cancelar-solicitud/tasks.md`](../../../openspec/changes/comando-cancelar-solicitud/tasks.md) — 19/19 (PR1: tareas 1-8, PR2: tareas 9-13, ya mergeados; PR3/ADR 144: tareas 15-18, ya commiteadas en esta rama; tarea 19: esta verificación manual, sin código de producción).

## Cómo se corrió la demo (sin `tmux` en este entorno)

Mismo patrón que [`docs/progreso/v1.4-tui-canal-empleado/README.md`](../v1.4-tui-canal-empleado/README.md) (sección "Cómo se corrió la demo (sin `tmux` en este entorno)"), replicado sin modificaciones de fondo:

1. Un script throwaway (`scratch-demo/driver-v3.3.tsx`, **borrado al terminar** — no es parte del entregable; ver `driver-output-raw.log` en esta misma carpeta para la salida cruda completa que produjo).
2. SQLite **temporal** bajo el scratchpad de la sesión (`.../scratchpad/demo-v3.3-cancelar-solicitud/data/harness.db`), **nunca** `data/harness.db` real del repo — confirmado con `git status --porcelain data/` antes y después de la corrida: vacío en ambos casos.
3. Reusa `openDatabase` (corre las migraciones reales), `bootstrapHarness()`, `buildOnComandoEmpleado`, `createSolicitudStore(db)`, `resolveVentasConfig`/`resolveAuthConfig`, `hashPassword`/`verificarPassword` — todos módulos reales de `src/`, nada reimplementado ni stubeado. Única costura deliberada: `onSubmit`/`onSoporte` son funciones que lanzan si se llaman (nunca se llaman en este guion — están fuera de alcance de esta verificación, que sólo ejercita comandos de solicitud) en vez de invocar el modelo real, para no generar costo de API ajeno al alcance de esta tarea.
4. Credenciales de los tres empleados (`ana`, `beto`, `eli`) provisionadas con el **CLI real** `npm run empleados:crear` (subproceso `tsx` contra `src/empleados.ts`, password por stdin, hash scrypt real).
5. Las solicitudes se siembran con `SolicitudStorePort.crearSolicitudConCaso`/`.aprobarSolicitud` reales (el mismo store que usa `createSolicitudStore(db)` en producción) — **no** con `crearSolicitudInterna` (que delega al subagente validador vía el modelo): sembrar decenas de solicitudes con un caso de uso que invoca el modelo real hubiera sido caro y lento sin aportar nada a lo que esta tarea verifica (el flujo de resolución, no el de validación).
6. Monta `<App onSubmit={onComandoEmpleado} />` (el componente TUI real) con `render()` de `ink-testing-library`, un `SubmitPromptHandler` por sesión (una sola sesión activa a la vez, como en producción — login/logout secuencial entre `ana`/`beto`/`eli`).
7. **Hallazgo de esta sesión, no del entregable**: `instance.stdin.write(texto + "\r")` en una sola llamada (como sugiere el README de v1.4 al pie de la letra) hace que Ink trate el string entero como un blob **pegado** con un `\r` embebido — la propia lógica de "Single-line input" de `App.tsx` lo sanitiza a un espacio en vez de disparar `key.return`. La corrección (ya usada por `App.test.tsx`, líneas con la constante `ENTER = "\r"`) es **dos** llamadas separadas: `instance.stdin.write(comando)` y luego `instance.stdin.write("\r")`. Con eso, cada comando se sometió correctamente.

## Guion de demo — resultado real (19 pasos + 2 verificaciones estáticas)

| # | Paso | Resultado |
|---|---|---|
| 1 | `/login ana clave-ana-1` | ✅ `Sesión abierta como ana. Vence ...` |
| 2 | `/cancelar-solicitud sol-a1` (propia, paso 1) | ✅ eco: `solicitud sol-a1 · tipo vacaciones · detalle semana en octubre · caso caso-a1 — repetí el comando para confirmar.` |
| 3 | `/cancelar-solicitud sol-a1` (paso 2, confirma) | ✅ `Listo: la solicitud sol-a1 quedó cancelada.` — SQL directa: `estado='cancelada'`, `resuelta_por='ana'` |
| 4 | `/cancelar-solicitud sol-a3` (ya `aprobada` de antes) | ✅ `No hay ninguna solicitud sol-a3 tuya pendiente de cancelación...` — snapshot de las 3 tablas antes/después: **cero filas nuevas** |
| 5 | `/cancelar-solicitud sol-no-existe` (id inexistente) | ✅ **mensaje byte-por-byte idéntico** al del paso 4 |
| 6 | `/logout` | ✅ `Sesión cerrada.` |
| 7 | `/login beto clave-beto-1` | ✅ `Sesión abierta como beto. Vence ...` |
| 8 | `/cancelar-solicitud sol-a2` (ajena, de ana) | ✅ `La solicitud sol-a2 no es tuya: sólo quien la creó puede cancelarla.` — **sin** `detalle` (`viatico octubre`) ni `solicitanteId` (`ana`) en la respuesta |
| 9 | `/aprobar-solicitud sol-a4` (ajena, de `carla`) × 2 pasos | ✅ eco + `Listo: la solicitud sol-a4 quedó aprobada.` — SQL: `resuelta_por='beto'` (R1 no derogado) |
| 10 | `/rechazar-solicitud sol-a5` (ajena, de `carla`) × 2 pasos | ✅ eco + `Listo: la solicitud sol-a5 quedó rechazada.` — SQL: `resuelta_por='beto'` |
| 11 | `/logout` | ✅ `Sesión cerrada.` |
| 12 | `/login eli clave-eli-1` | ✅ `Sesión abierta como eli. Vence ...` |
| 13 | **`/cancelar-solicitud` sin id** (25 ajenas más antiguas + 1 propia) | ✅ **sólo** `sol-b-propia-eli` en la respuesta — cero ids/`solicitanteId`/`detalle` de las 25 ajenas (verificación manual del bug del `LIMIT`, ver abajo) |
| 14 | `/logout` | ✅ `Sesión cerrada.` |
| 15 | `/login beto clave-beto-1` | ✅ `Sesión abierta como beto. Vence ...` |
| 16 | **`/aprobar-solicitud` sin id** (misma base) | ✅ listado **global**: `sol-a2` (de `ana`) + 19 de las 25 ajenas (tope `LIMIT 20`), con `solicitante`/`detalle` completos — R1 y `:72` siguen sin derogarse |
| 17 | `/logout` | ✅ `Sesión cerrada.` |
| 18 | `rg 'MotivoNoAplicableHitl' src/core/hitl/hitl-contract.ts` | ✅ sin diff — 2 apariciones, mismas que antes de este change |
| 19 | `git diff --stat main -- src/core/hitl/ src/core/propuestas/ src/core/ventas/` | ✅ vacío |

**Verificaciones estáticas adicionales** (sin código de producción, parte de la misma tarea 19):
- **Rollback de la tarea 8** (`de92b8a`): `git show de92b8a^:src/core/solicitudes/resolver-solicitud-interna.ts` (inspección sin tocar el working tree, sin worktree desechable — no hizo falta crear uno: `git show <commit>^:ruta` ya inspecciona el estado previo sin ninguna mutación) confirma que en el padre del commit (`c1a62f8`, tarea 7), `AccionSolicitud` era una unión de **2** miembros (`aprobar`/`rechazar`, sin `cancelar`) y el `switch` de `aplicarCas` tenía exactamente **2** `case`.
- `npm run typecheck` (`npx tsc --noEmit`): sin salida, 0 errores.
- `npx vitest run`: **1938 passed | 1 failed | 3 skipped** (1942 total) — el único fallo es `run-tests.integration.test.ts` por un worktree git bloqueado (`fatal: a branch named 'harness/caso-caso-run-tests-verde' already exists`), preexistente y sin relación con este change (confirmado en esta sesión, no sólo heredado del reporte anterior).

Ver [`evidencia-verificacion-manual.md`](evidencia-verificacion-manual.md) para el detalle completo (SQL crudo, snapshots, salida de `rg`/`git diff`/`git show`, y los frames completos de la TUI para los dos casos nuevos del ADR 144).

## Limpieza

`scratch-demo/driver-v3.3.tsx` y la SQLite temporal (bajo el scratchpad de la sesión) se borraron al terminar. `git status --porcelain` del repo, después de la limpieza, no muestra ningún archivo nuevo salvo esta misma carpeta de evidencia (y los artefactos de `openspec/` ya presentes al empezar esta tarea, sin relación).
