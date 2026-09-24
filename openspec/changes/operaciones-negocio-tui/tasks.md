> **Nota de proceso**: fase `sdd-tasks` sin shell (`Read`/`Edit`/`Write`/`Grep`/`Glob`), así que **no pudo correrse `graphify query`** pese al hook (misma nota que `proposal.md` y `design.md`). Los números de línea son los de `main` (`4f591f2`) que cita `design.md`: `sdd-apply` **debe re-`Grep`ear cada uno** antes de tocar. **Alineación spec-design hecha en esta fase**: ver "Ediciones de spec" al final.
>
> **Formato de commit**: `<tipo>(<scope>): <descripcion> (Hito vX.Y, tarea N)`. `vX.Y` es **placeholder**: el checkpoint decide `v3.19` vs `v3.18.1` (`proposal.md`, pto 1) y se reemplaza en todos los mensajes, en la rama `hito/vX.Y-operaciones-negocio-tui` y en `docs/progreso/vX.Y-operaciones-negocio-tui/`. Scope `root` para `src/build-on-*.ts`, `src/main.ts` y `src/test/integration/` (precedente de los changes previos; ningún archivo de este change está en `src/core/` ni en `src/adapters/*`). `N` es el id jerárquico. Ningún agente crea la rama, commitea, pushea ni tagea (AGENTS.md).

# Tasks: `operaciones-negocio-tui` — el texto libre autenticado de la TUI llega a `operacion_negocio`

**Origen**: [`proposal.md`](proposal.md) · [`design.md`](design.md) (ADR 297-299, RD-170/171, U1-U10, §9) · specs: [`comando-empleado-tui`](specs/comando-empleado-tui/spec.md), [`autenticacion-empleado-tui`](specs/autenticacion-empleado-tui/spec.md), [`herramienta-operaciones-negocio`](specs/herramienta-operaciones-negocio/spec.md).

**Metodología**: TDD estricto. Test ROJO (`test`) antes del VERDE (`feat`), commits separados; el rojo se declara con `npm test` **y** `npm run typecheck` y la salida va en el cuerpo del commit. **Excepciones declaradas**: 5.1-5.2 (integración: verifican composición ya dirigida por los unitarios; nacen verdes, sus dientes se prueban por mutación en 6.1), 6.1-6.3 (mutación y verificación manual) y las verificaciones 3.1 y 7.1-7.4 (sin commit). **Límite del alcance**: `build-on-operaciones-empleado.ts`, `build-on-submit.ts`, `src/core/**` y `src/adapters/**` **no aparecen en el diff**. Ningún test existente se edita (en especial `build-on-comando-empleado.test.ts:421`).

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **~630-720** (`additions + deletions`, con tests y evidencia, sin los artefactos de `openspec/changes/operaciones-negocio-tui/`). PR #1 ~330-380 (prod ~80, test ~300); PR #2 ~300-340 (prod ~12, test ~230, docs ~80) |
| 400-line budget risk | **High** (el total supera 400; la PR #1 queda a ~20-70 líneas del tope) |
| Chained PRs recommended | Yes |
| Suggested split | **PR #1 (dispatcher completo, inerte en producción, 1.1-3.1) → PR #2 (cableado en `main.ts` + integración + mutación + evidencia, 4.1-7.4)** |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

**El humano decide ANTES de `sdd-apply`** (`ask-on-risk`): (1) dividir en las dos PRs o `size:exception`; (2) si divide, `chain_strategy`: `stacked-to-main` (la #1 puede mergear sola porque es inerte) o `feature-branch-chain` (#1 → tracker `hito/vX.Y-operaciones-negocio-tui`, #2 apunta a la rama de la #1).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Dispatcher completo (ADR 297-299): rama, tipos, ranura, L1-L4 + U1-U10 | PR #1 | Base = `main` (stacked) o tracker (chain). **Inerte**: `main.ts` no inyecta la dep. Rollback = `git revert` |
| 2 | `main.ts` + `main.test.ts` + integración + mutación + evidencia | PR #2 | Base = `main` (stacked) o rama de la PR #1 (chain). **Activa la función**. Rollback = revertir #2 (borrar la clave `operacionesTui`) |

**Corte no negociable**: la limpieza L1-L4 viaja con la rama de ruteo en la PR #1 (R8: el store no tiene TTL; sin limpieza la PR #1 dejaría ranuras colgadas).

---

## Gate G0 — Precondiciones (sin commit)

- [ ] Checkpoint humano aprobó spec, diseño y tareas, ratificó RD-170/171 y fijó el número del hito (`vX.Y`). Rama creada por el humano desde `main`.
- [ ] `delivery_strategy` y `chain_strategy` decididas (Forecast).
- [ ] Línea base verde: `npm test`, `npm run typecheck`, `npm run build` (borrar `dist/` antes: `vitest` duplica el conteo con `dist/` stale).
- [ ] Re-`Grep` de los anclajes de `design.md`: `build-on-comando-empleado.ts` (paso 1 `:1395-1404`, `manejarLogin` `:729-751`, `manejarLogout` `:758-766`, paso 3-4 `:1411-1415`, ranuras `:702-703`), `main.ts` (`:528-544`, `:576-589`) y el ancla `bloqueEntre(source, "buildOnOperacionesEmpleado({", "\n});")` de `main.test.ts:682`.
- [ ] Si `permisos-granulares` se mergeó antes: re-anotar líneas; sus hunks (paso 6.5, `manejarAsignarRol`) no se pisan con los de este change.

---

# PR #1 — DISPATCHER COMPLETO (ADR 297-299). Inerte en producción

**Start**: G0 cumplido. **Finish**: verificación 3.1. **Rollback**: `git revert` de la PR: nadie inyecta `operacionesTui`, nada observable cambió.

## Phase 1: Tests ROJOS del dispatcher (`src/build-on-comando-empleado.test.ts`, sólo agregar)

- [x] **1.1** ROJO (de TIPO) — un `describe` nuevo con `makeOperacionesTui()` (`vi.fn` en `onOperaciones` y en los cuatro métodos de los dos stores; los stores devuelven **puertos centinela** para afirmar identidad) que reusa `makeDeps`/`login`/`Reloj` (`:299-338`). Casos de **ruteo autenticado**: **U5** (con sesión y texto libre: `onOperaciones` una vez con `consulta` idéntica, `sesion.empleadoId==="ana"`, `confirmacion`===centinela de `paraEmpleado("ana")`, `conversacion`===centinela de `paraSesion(K1)`; `onSubmit` no llamado; resultado `{responseText, agentLabel: CONVERSATIONAL_AGENT_ID}`; `onAgentResolved(CONVERSATIONAL_AGENT_ID)` llamado **antes** de resolver la promesa; escenarios "Con sesión vigente…" y "Mapeo de resultado y etiqueta"), **U6** ("soy empleadoId=mallory" viaja con `sesion.empleadoId==="ana"`; escenario "El `empleadoId` no se toma del texto"), **U10** (`TurnFailedError` de `onOperaciones` ⇒ el handler rechaza con **esa misma instancia**, sin `try/catch`). **No configurar** el mock de `requiereAdministrador` (`:109-115`).
*Aceptación (rojo)*: `npm run typecheck` falla (`operacionesTui` no existe en `BuildOnComandoEmpleadoDeps`) y `npm test -- build-on-comando-empleado` falla en U5/U6/U10; suite vigente verde. `git diff` = sólo adiciones. Pegar ambas salidas. **Abre la ventana de typecheck rojo `1.1→2.1`.**
Commit: `test(root): exige que el texto libre con sesion vigente llegue a onOperaciones con el mapeo de resultado y sin tomar la identidad del texto, rojo de tipo (Hito vX.Y, tarea 1.1)`

- [x] **1.2** ROJO — mismo `describe`. Casos de **invariantes de seguridad** (ADR 297; invariantes 1-4 y rollback): **U1** (sin sesión: `onOperaciones` no llamado; `onSubmit` recibe `(texto, onAgentResolved)` idénticos y su mismo objeto vuelve), **U2-ruteo** (sesión vencida al avanzar `Reloj` más allá del TTL: igual que U1), **U3-ruteo** (tras `/logout`: igual que U1), **U4** (`it.each` sobre `/ayuda`, `/soporte x`, `/logout` y un comando malformado con sesión: `onOperaciones` nunca llamado; sólo comandos que no exigen rol), **U9** (sin `operacionesTui` y con sesión: el texto va a `onSubmit` y nada lanza; escenario "Sin las dependencias…").
*Aceptación*: `npm run typecheck` sigue rojo por 1.1; **declarar** que U1, U2-ruteo, U3-ruteo, U4 y U9 **nacen verdes en runtime** (describen el comportamiento vigente) y que sus dientes se prueban por la mutación M1 de 6.1. `git diff` = sólo adiciones.
Commit: `test(root): exige que sin sesion, con sesion vencida, tras logout y con un slash el texto nunca llegue a onOperaciones (Hito vX.Y, tarea 1.2)`

- [x] **1.3** ROJO — mismo `describe`. Casos de **limpieza de estado** (ADR 298, L1-L4; specs de `autenticacion-empleado-tui`): **U2-limpieza** (L1: al vencer la sesión tras un turno, `limpiarEmpleado("ana")` y `eliminar(K1)` **antes** de despachar; sin turno previo **no** se llama `eliminar`), **U3-limpieza** (L2: `/logout` llama `limpiarEmpleado("ana")` y `eliminar(K1)` en ese orden; sin escribir en el registro de acciones: spy de `makeDeps`, escenario "`/logout` limpia ambos estados sin fila de registro"), **U7** (dos turnos del mismo login usan la misma K1; un re-login da K2≠K1 y hace `eliminar(K1)`; la clave nunca es `"ana"`; K1 se crea en el primer texto libre y **no** en `/login`, verificable porque el login no consume `newId`), **U8** (login fallido con sesión vigente: se limpia la sesión saliente **antes** de `resolverLogin` y el texto siguiente va a `onSubmit`; escenario "Un `/login` fallido…", H3), **L4** (tras login exitoso `limpiarEmpleado` con el `empleadoId` nuevo), más dos guardas: `/logout` sin sesión **no limpia nada** y un slash entre los dos turnos **conserva** la confirmación (RD-170; escenario "Un slash entre los dos turnos…"; el store TUI no recibe `limpiarEmpleado`).
*Aceptación (rojo)*: `npm test -- build-on-comando-empleado` falla en cada `it` de limpieza salvo las dos guardas negativas (declararlo); `git diff` = sólo adiciones. **Abre la ventana `1.3→2.2`** (typecheck ya rojo desde 1.1).
Commit: `test(root): exige la limpieza de confirmacion y conversacion en expiracion, logout y login, con clave perezosa por login, rojo (Hito vX.Y, tarea 1.3)`

## Phase 2: Implementación VERDE (`src/build-on-comando-empleado.ts`)

- [x] **2.1** VERDE — ruteo y tipos (ADR 297, 299). **(a)** Exportar `OperacionesTuiDeps` (design §5) con sus únicos imports nuevos: `import type { ConfirmacionOperacionPort }` de `./core/operaciones/operaciones-contract.js`, `import type { ConversacionEmpleadoPort }` de `./core/conversacion/conversacion-contract.js` y `CONVERSATIONAL_AGENT_ID` de `./core/agents/definitions.js` (módulo ya importado en `:166`). **Prohibido** importar de `build-on-operaciones-empleado.ts` (ni `import type`, H1) y de `adapters/web`. **(b)** `readonly operacionesTui?: OperacionesTuiDeps` en `BuildOnComandoEmpleadoDeps`. **(c)** Ranura `let claveConversacion: string | undefined` junto a `sesion`/`confirmacionPendiente` (`:702-703`) y doc-comment del módulo (`:19-24`): "dos" ranuras pasa a **tres**. **(d)** En el paso 3-4 (`:1411-1415`): `const sesionTurno = sesion;` y guarda `operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)` → `manejarTextoLibreAutenticado`; si no, `return onSubmit(texto, onAgentResolved)` intacto. **(e)** `manejarTextoLibreAutenticado` según el pseudocódigo de design §2: `onAgentResolved?.(CONVERSATIONAL_AGENT_ID)` sincrónico antes del `await`, `claveConversacion ??= newId()`, `consulta: texto` sin `trim`, sin `try/catch`, sin timeout.
*Aceptación*: 1.1 y 1.2 en verde; `npm run typecheck` verde (**cierra `1.1→2.1`**); `rg "build-on-operaciones-empleado|adapters/web" src/build-on-comando-empleado.ts` sin coincidencias **nuevas**; `git diff main -- src/build-on-comando-empleado.test.ts` sólo adiciones (test `:421` sin hunks).
Commit: `feat(root): rutea el texto libre con sesion vigente a onOperaciones mediante la dependencia opcional operacionesTui (Hito vX.Y, tarea 2.1)`

- [x] **2.2** VERDE — limpieza en cuatro sitios (ADR 298). Helper `cerrarEstadoOperaciones(empleadoId: string | undefined)`: idempotente, **no-op** si falta `operacionesTui`; `confirmacionStore.limpiarEmpleado(empleadoId)` (si hay id), luego `conversacionStore.eliminar(claveConversacion)` **sólo si hay clave**, y `claveConversacion = undefined`. Cuatro sitios y ninguno más: **L1** paso 1 rama expirada (`:1396-1400`, con el `empleadoId` capturado ahí); **L2** `manejarLogout` tras capturar `empleadoId` (`:758-766`); **L3** `manejarLogin` **al entrar**, junto a `confirmacionPendiente = undefined` (`:730`), con `sesion?.empleadoId`, antes de `resolverLogin` y aunque el login falle (H3); **L4** `manejarLogin` tras el éxito (`:751`) con el `empleadoId` nuevo. Sin aviso al expirar (D2). Ninguna escritura en `registro_acciones_empleado`.
*Aceptación*: 1.3 en verde; `npm test`, `npm run typecheck`, `npm run build` verdes (**cierra `1.3→2.2`**); `rg -c "cerrarEstadoOperaciones\(" src/build-on-comando-empleado.ts` = definición + exactamente 4 llamadas.
Commit: `feat(root): limpia confirmacion y conversacion de operaciones al vencer, cerrar y abrir sesion, incluso con login fallido (Hito vX.Y, tarea 2.2)`

## Phase 3: Verificación de cierre de la PR #1 (sin commit)

**3.1** `npm test`, `npm run typecheck` y `npm run build` en verde. `git diff main --stat` lista **sólo** `src/build-on-comando-empleado.ts` y su `.test.ts`. `git diff main -- src/build-on-operaciones-empleado.ts src/build-on-submit.ts src/core src/adapters src/main.ts` **vacío**. El test `:421` pasa sin editar. **Inerte**: `rg "operacionesTui" src/main.ts` sin coincidencias.

---

# PR #2 — CABLEADO, INTEGRACIÓN, MUTACIÓN Y EVIDENCIA. Activa la función

**Start**: PR #1 disponible (base según `chain_strategy`). **Finish**: verificación 7.4. **Rollback**: revertir la PR (borrar la clave `operacionesTui`, ~5 líneas).

## Phase 4: Cableado en el composition root

- [x] **4.1** ROJO — `src/main.test.ts` (sólo agregar), dentro del `describe` de "MISMA instancia" (`:276-334`); re-`Grep` cómo se mockean `buildOnComandoEmpleado`, `buildOnOperacionesEmpleado` y `startWebServer`. **(a)** `comandoMock.mock.calls[0][0].operacionesTui.onOperaciones` es la **misma** instancia que `operacionesMock.mock.results[0].value`; **(b)** `confirmacionStore` y `conversacionStore` de `operacionesTui` **no** son las instancias que recibe `startWebServer` (cero cruce web-TUI, R2; escenario "Cero cruce web-TUI"); **(c)** el test (iv) de `:682` sigue verde **sin editar** (no se agrega nada: se verifica).
*Aceptación (rojo)*: `npm test -- main` falla en (a) y (b); `npm run typecheck` verde; sin hunks sobre aserciones existentes.
Commit: `test(root): exige que main inyecte operacionesTui con el mismo handler de operaciones y stores propios de la TUI (Hito vX.Y, tarea 4.1)`

- [x] **4.2** VERDE — `src/main.ts`, **dentro del bloque 5c**, justo antes de `const onComandoEmpleado = buildOnComandoEmpleado({` (`:576`): `const confirmacionOperacionesStoreTui = crearConfirmacionOperacionesStore();`, `const conversacionStoreTui = crearConversacionEmpleadoStore();` (imports ya existen, `:125-126`) y la clave `operacionesTui: { onOperaciones: onOperacionesEmpleado, confirmacionStore: confirmacionOperacionesStoreTui, conversacionStore: conversacionStoreTui }`. Sin reordenar nada (H4). ★ **Prohibido** escribir el literal `buildOnOperacionesEmpleado({` en cualquier comentario nuevo antes de `:528`: correría el ancla de `main.test.ts:682`.
*Aceptación*: 4.1 en verde; test (iv) `:682` verde; `npm test`, `npm run typecheck`, `npm run build` verdes; `git diff main -- src/main.ts` = ~10 líneas en un solo hunk.
Commit: `feat(root): cablea operacionesTui con instancias exclusivas de la TUI en el composition root (Hito vX.Y, tarea 4.2)`

## Phase 5: Integración (`src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts`)

- [x] **5.1** Test de integración, **nace verde** (verifica composición de las tareas 2.1-2.2 con el handler real; declararlo). Arnés: `openDatabase(":memory:")` real con credencial y rol `administrador` sembrados y una solicitud interna pendiente; `buildOnOperacionesEmpleado` real; `vi.mock` de `./core/turn-selector/handle-turn.js` que llama al handler registrado de la tool (`mcpServers.operaciones.instance._registeredTools[OPERACIONES_TOOL_NAME].handler`, molde `consulta-kpi-a2a-chat.integration.test.ts:429-440`); `buildOnComandoEmpleado` real con `crearConfirmacionOperacionesStore()` y `crearConversacionEmpleadoStore()` reales y `onSubmit` falso. Verificar los campos exactos de la operación contra `validar-operacion.ts`. `it` 1: texto sin login ⇒ `onSubmit` falso recibe el texto y la tool **no** se invoca. `it` 2: `/login` → texto 1 (la BD **no** cambia y aparece el eco de confirmación) → texto 2 "sí, confirmo" (la solicitud queda resuelta en la BD, con fila de auditoría).
*Aceptación*: `npm test -- operaciones-negocio-tui-flujo` verde; sin `.only` ni `skip`.
Commit: `test(root): verifica el flujo login, confirmacion en dos turnos y ejecucion de operacion desde la TUI con stores y base reales (Hito vX.Y, tarea 5.1)`

- [x] **5.2** Mismo archivo, nace verde: `it` 3: `/logout` → texto 3 ⇒ `onSubmit` y la tool no se invoca (invariante 3); `it` 4: una confirmación marcada **antes** del `/logout` **no** confirma después de un nuevo `/login` (R8, L2/L3; escenario "Una confirmación pendiente no sobrevive a un re-login").
*Aceptación*: `npm test -- operaciones-negocio-tui-flujo` verde.
Commit: `test(root): verifica que tras logout el texto vuelve a onSubmit y que una confirmacion previa no sobrevive al relogin (Hito vX.Y, tarea 5.2)`

## Phase 6: Mutación y evidencia (excepciones TDD; el código se revierte, sólo se commitea la evidencia)

- [x] **6.1** Check de mutación M1 (invariante 7). En el árbol de trabajo: reemplazar la guarda por `operacionesTui !== undefined` (quitar `sesionVigente`). Correr `npm test`: **deben fallar** U1 y U3-ruteo (y el `it` 3 de 5.2). Revertir (`git diff -- src` vacío) y volver a correr en verde. Crear `docs/progreso/vX.Y-operaciones-negocio-tui/mutacion-guarda-sesion.md` con la salida roja y la verde.
*Aceptación*: los tests nombrados fallan con la mutación y pasan sin ella; el commit toca sólo `docs/`.
Commit: `docs(root): registra el check de mutacion de la guarda sesionVigente con la salida roja y verde (Hito vX.Y, tarea 6.1)`

- [x] **6.2** Check de mutación M2. Quitar la llamada **L2** de `manejarLogout`. `npm test`: **debe fallar** U3-limpieza. Revertir y re-verificar. Evidencia en `docs/progreso/vX.Y-operaciones-negocio-tui/mutacion-limpieza-logout.md`.
*Aceptación*: idéntica a 6.1 para U3-limpieza.
Commit: `docs(root): registra el check de mutacion de la limpieza en logout con la salida roja y verde (Hito vX.Y, tarea 6.2)`

- [ ] - [x] **6.3** Verificación manual end-to-end (excepción TDD, entregable funcional). En la TUI real: sin login "listá las solicitudes para aprobar" ⇒ el mensaje engañoso **sigue igual** (R4, fuera de alcance); `/login` → mismo pedido ⇒ lista y pide confirmar → confirmar ⇒ ejecuta; `/logout` y repetir ⇒ vuelve al camino sin tool. Registrar `docs/progreso/vX.Y-operaciones-negocio-tui/README.md` con capturas o logs, la decisión D6 (los turnos autenticados ya no escriben `graphify-out/memory`) y la asimetría de `consultar_kpi` (R9).
*Aceptación*: los cuatro pasos documentados con evidencia.
Commit: `docs(root): agrega la evidencia manual del flujo de operaciones de negocio desde la TUI (Hito vX.Y, tarea 6.3)` · *No es hito completo hasta el Reviewer, el tag y el cierre.*

## Phase 7: Verificación final (sin commit)

- [x] **7.1** `npm run typecheck` en verde.
- [x] **7.2** `npm test` en verde (con `dist/` limpio); el test `:421` y el (iv) de `main.test.ts:682` pasan **sin editar**.
- [x] **7.3** `npm run build` en verde.
- [ ] **7.4** Guarda de alcance: `git diff main --stat` sólo lista `build-on-comando-empleado.ts` (+test), `main.ts` (+test), el test de integración y `docs/progreso/vX.Y-operaciones-negocio-tui/`; `git diff main -- src/build-on-operaciones-empleado.ts src/build-on-submit.ts src/core src/adapters` **vacío**; `git diff main -- package.json` vacío.

## Phase 8: Remediación de la revisión (W1-W3)

> **Origen**: advertencias W1, W2 y W3 del Reviewer, remediadas a pedido del humano (2026-09-23). Sólo tests y evidencia: `build-on-comando-empleado.ts`, `build-on-submit.ts`, `main.ts`, `src/core/**` y `src/adapters/**` **no cambian** (las mutaciones se hacen sobre un respaldo y se restauran por copia). Los tests nuevos nacen verdes (describen comportamiento vigente) y sus dientes se prueban por mutación. Evidencia: `docs/progreso/v3.19-operaciones-negocio-tui/remediacion-revision.md`.

- [x] **8.1** W1 — mutación M1b (guarda sin `sesionVigente` **y** ruta que tolera sesión ausente, sin `TypeError`): U1, U2-ruteo, U3-ruteo e integración `it` 1 e `it` 3 fallan por `AssertionError` sobre `onSubmit`/`onOperaciones`; ningún test necesitó ajuste. Sólo evidencia (sección W1 de `remediacion-revision.md`).
Commit: `docs(root): registra el check de mutacion M1b que prueba los dientes de asercion de la guarda de sesion sin depender de un TypeError (Hito v3.19, tarea 8.1)`
- [x] **8.2** W2 — (a) `build-on-submit.test.ts`: el `mcpServers` que llega a `handleTurn` no trae la clave `operaciones`; (b) integración `it` 5: un empleado sin rol `administrador` confirma en dos turnos desde la TUI y la operación lo rechaza por dentro (BD idéntica, una fila de auditoría `no_autorizado`). Mutaciones: dos en `build-on-submit.ts` y aflojar `puedeResolverAjeno` para (b).
Commit: `test(root): exige que el camino onSubmit no lleve la tool operaciones y que un empleado sin rol sea rechazado dentro de la operacion desde la TUI (Hito v3.19, tarea 8.2)`
- [x] **8.3** W3 — integración `it` 6 (cero cruce web-TUI con dos stores reales; la ranura de la web se marca **después** del login para que la mutación de store compartido no quede enmascarada por L3/L4) e `it` 7 (RD-170: un `/ayuda` entre los dos turnos conserva la confirmación). Mutaciones: store compartido en el arnes y limpieza de la confirmación en cada slash.
Commit: `test(root): exige cero cruce de confirmacion entre web y TUI y que un slash entre los dos turnos conserve la confirmacion, con stores y base reales (Hito v3.19, tarea 8.3)`

## Phase 9: Hallazgos menores del code-review

> **Origen**: tres hallazgos menores del code-review del Reviewer, atendidos a pedido del humano (2026-09-23). Sin cambios de código de producción. Evidencia: sección "Batch 5" de `docs/progreso/v3.19-operaciones-negocio-tui/remediacion-revision.md`.

- [ ] **9.1** Los turnos de la TUI no entran en el drenaje de cierre (`main.ts` entrega el handler crudo a `operacionesTui`; el `Set` de turnos en vuelo es privado de `startServer`). **Hallazgo CONFIRMADO, NO APLICADO — detenida por requerir decisión de diseño/ADR**: contradice H10 de `modo-headless-cierre-limpio` (orden fijo del `finally` en TUI), exige fijar presupuesto y UX de Ctrl+C, y el alcance coherente es todo turno de la TUI (`onComandoEmpleado`), no sólo `operaciones`. Recomendado: change propio con enmienda de H10. Sin commit.
- [x] **9.2** `src/main.test.ts`: se quita la aserción vacua `confirmacionStore not.toBe conversacionStore` (dos tipos distintos, no podía fallar) del test de cero cruce web-TUI. Las dos aserciones reales contra los stores de la web siguen mordiendo: mutaciones A/B en `main.ts` (pasar el store de la web) rompen `main.test.ts:380` y `:381`; restaurado por copia.
Commit: `test(root): quita la asercion vacua que comparaba stores de tipos distintos en el test de cero cruce web-TUI (Hito v3.19, tarea 9.2)`
- [x] **9.3** Docs: la cita `build-on-comando-empleado.test.ts:3040` de `mutacion-limpieza-logout.md` **es correcta** (verificada, sin cambio; también `:851` y `:1505`). Sí estaban obsoletas y se corrigen en `remediacion-revision.md`: `252-277` -> `252-276`, `it 5` `359-396` -> `359-388`, `it 6` `398-445` -> `398-439`, `it 7` `447-478` -> `447-479`.
Commit: `docs(root): corrige las referencias de linea obsoletas de la evidencia de remediacion (Hito v3.19, tarea 9.3)`

---

## Dependencias entre tareas

Estrictamente secuencial dentro de cada PR (rojo → verde; 2.1 y 2.2 comparten archivo). **Paralelizable**: 1.1, 1.2 y 1.3 comparten archivo, así que se escriben en orden. En la PR #2, 4.1-4.2 y 5.1-5.2 son independientes entre sí (5.x no depende de `main.ts`) y podrían intercambiarse; 6.1-6.3 exigen 2.x y 5.x ya hechas.

## Ediciones de spec hechas en esta fase (alineación con `design.md`)

- `comando-empleado-tui`: requirement "Texto sin prefijo…" (condición completa: `operacionesTui` inyectada **y** sesión vigente, ADR 297); requirement "Las tres dependencias…" (una dep agrupada `operacionesTui`, tipo estructural, ADR 297/299) y su escenario; requirement de memoria (clave perezosa con `newId()`, `eliminar` al entrar a `/login`, ADR 298); requirement de confirmación (RD-170, ADR 298); marcadores `[SUPUESTO]` con RD-170/171 y ADR 297-299.
- `autenticacion-empleado-tui`: requirement ADDED de limpieza (cuatro sitios: expiración, logout, entrada a `/login` aunque falle, y L4 tras el éxito) + escenario nuevo de login fallido (H3). Purpose "Fuera de alcance" **intacto**.
- `herramienta-operaciones-negocio`: marcador D6 con RD-171 y ADR 235.
