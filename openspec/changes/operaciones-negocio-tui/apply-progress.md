# Apply progress: `operaciones-negocio-tui`

**Mode**: Strict TDD · **Store**: openspec · **Delivery**: `ask-on-risk`, PR #1 = Fases 1-3 · **Chain strategy**: pendiente · **Rama**: `hito/v3.19-operaciones-negocio-tui`
**Merge-friendly**: cada batch agrega su bloque; no borrar bloques previos.

## Checklist

- [x] 1.1 ROJO de tipo: U5 (x2), U6, U10 (batch 1)
- [x] 1.2 ROJO invariantes: U1, U2-ruteo, U3-ruteo, U4 (x5), U9 (batch 1)
- [x] 1.3 ROJO limpieza: U2-limpieza (x2), U3-limpieza, U7 (x2), U8, L4, L3+L4, 2 guardas (batch 1)
- [x] 2.1 VERDE ruteo y tipos (batch 2)
- [x] 2.2 VERDE limpieza L1-L4 (batch 2)
- [ ] 3.1 (verificación de cierre de la PR #1, sin marcar en tasks.md; su contenido se re-verificó en 7.4)
- [x] 4.1 ROJO cableado: `main.test.ts` (batch 3)
- [x] 4.2 VERDE cableado: `main.ts` (batch 3)
- [x] 5.1 integración `it` 1-2 (nace verde, declarado) (batch 3)
- [x] 5.2 integración `it` 3-4 (nace verde, declarado) (batch 3)
- [x] 6.1 mutación M1 (batch 3)
- [x] 6.2 mutación M2 (batch 3)
- [ ] 6.3 verificación manual en la TUI real (a cargo del humano; esqueleto listo)
- [x] 7.1 · [x] 7.2 · [x] 7.3 · [ ] 7.4 (reportado, requiere el estado final commiteado)

## Batch 1 — Fase 1 (tests rojos, sólo `src/build-on-comando-empleado.test.ts`, +478 líneas, 0 borradas)

**G0**: baseline verde con `dist/` borrado: `npm run typecheck` OK, `npm test` 161 archivos passed | 2 skipped, 3223 passed | 5 skipped, `npm run build` OK. Anclajes de `build-on-comando-empleado.ts` y `main.ts` sin deriva (`:702-703`, `:728-756`, `:758-767`, `:1395-1404`, `:1411-1415`, `main.ts:528/576`, `main.test.ts:682`).

**Rojo (evidencia)**: `npm run typecheck` falla con un único error, `TS2322 ... 'operacionesTui' does not exist in type 'Partial<BuildOnComandoEmpleadoDeps>'` (helper `armarDispatcherOperaciones`). `npm test -- build-on-comando-empleado`: 12 failed | 101 passed (113). Suite completa: 12 failed | 3234 passed | 5 skipped; el resto de la suite vigente queda verde y el test de delegación existente (línea 421 original) intacto.

**Nacen verdes (declarado)**: U1, U2-ruteo, U3-ruteo, U4 (x5), U9 (describen el comportamiento vigente; sus dientes se prueban por M1 en 6.1) y las dos guardas negativas de 1.3 (`/logout` sin sesión, slash entre turnos).

**Verificación adicional (fuera del repo)**: los tests se corrieron contra una implementación descartable de 2.1+2.2 en una copia en el scratchpad (ya borrada): 113/113 verde y `tsc` limpio; M1 (quitar `sesionVigente`) rompe U1, U2-ruteo, U3-ruteo (+U2-limpieza, U8); M2 (quitar L2) rompe U3-limpieza; una limpieza en slash rompe la guarda de RD-170.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `src/build-on-comando-empleado.test.ts` | Unit | 90/90 previos | Written, 4 rojos + typecheck rojo | Pendiente (2.1) | 2 casos U5 | N/A |
| 1.2 | idem | Unit | idem | Written, nacen verdes (declarado) | Verde en runtime | it.each x5 | N/A |
| 1.3 | idem | Unit | idem | Written, 8 rojos + 2 guardas verdes | Pendiente (2.2) | U2 x2, U7 x2, L4 + L3/L4 | N/A |

## Batch 2 — Fase 2 (VERDE, sólo `src/build-on-comando-empleado.ts`, +99 / -5 líneas; `size:exception` resuelto por el humano para la PR #1)

**Safety net**: `npm test -- build-on-comando-empleado` antes de tocar: 12 failed | 101 passed (113), el rojo de la Fase 1 reproducido.

**2.1 (ruteo y tipos, +73/-5)**: imports `type ConfirmacionOperacionPort` (`operaciones-contract.js`), `type ConversacionEmpleadoPort` (`conversacion-contract.js`) y `CONVERSATIONAL_AGENT_ID` sumado al import ya existente de `definitions.js`; `OperacionesTuiDeps` exportada (design §5); `operacionesTui?` en `BuildOnComandoEmpleadoDeps`; ranura `claveConversacion`; doc-comment del módulo "dos" -> "tres"; `manejarTextoLibreAutenticado`; rama del paso 3-4 (`const sesionTurno = sesion` + guarda `operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)`); `onSubmit(texto, onAgentResolved)` intacto. Hunks (parche 2.1): `:16` doc, `:164` import, `:263` interface, `:317` dep, `:651` destructure, `:734` ranura+función, `:1473` guarda.
**Evidencia 2.1**: `npm test -- build-on-comando-empleado` = 7 failed | 106 passed (todos de limpieza 1.3; U1, U2-ruteo, U3-ruteo, U4, U5, U6, U9, U10 verdes); `npm run typecheck` verde (cierra ventana `1.1->2.1`); sin imports nuevos de `build-on-operaciones-empleado` ni `adapters/web/` (las dos únicas coincidencias de `adapters/web` son `adapters/webhooks`, preexistentes); `git diff main -- src/build-on-comando-empleado.test.ts` = 478 adiciones, 0 borradas; `rg "operacionesTui" src/main.ts` vacío.

**2.2 (limpieza, +26)**: `cerrarEstadoOperaciones(empleadoId | undefined)` (no-op sin `operacionesTui`; `limpiarEmpleado` si hay id; `eliminar(clave)` sólo si hay clave; `claveConversacion = undefined`) y cuatro llamadas: L1 paso 1 rama expirada, L2 `manejarLogout`, L3 entrada de `manejarLogin` (`sesion?.empleadoId`, antes de `resolverLogin`), L4 tras el éxito (id nuevo). Sin registro de acciones ni aviso.
**Evidencia 2.2**: `npm test -- build-on-comando-empleado` = 113/113; `npm test` = 161 files passed | 2 skipped, 3246 passed | 5 skipped (3223 + 23); `npm run typecheck` verde; `npm run build` verde (con `dist/` borrado antes y después; `dist/` está en `.gitignore`); `rg -c "cerrarEstadoOperaciones\(" src/build-on-comando-empleado.ts` = 5 (definición + 4 llamadas); `git diff main -- src/build-on-operaciones-empleado.ts src/build-on-submit.ts src/core src/adapters src/main.ts` vacío.

**Desvío cosmético**: `manejarTextoLibreAutenticado` recibe la dep como primer parámetro (`operaciones`) en vez de leer `operacionesTui` del closure, para conservar el estrechamiento de tipo sin `!`; comportamiento idéntico al pseudocódigo. Se reescribió el doc-comment de `OperacionesTuiDeps` para no citar el nombre del archivo prohibido (mantiene limpio el `rg` de aceptación).

### TDD Cycle Evidence (Fase 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `src/build-on-comando-empleado.test.ts` | Unit | 12 rojos / 101 verdes (rojo de Fase 1) | Escrito en 1.1-1.2 | 106/113, typecheck verde | Cubierto por 1.1-1.2 (U5 x2, U4 x5) | N/A (mínimo; sin cambios de diseño) |
| 2.2 | idem | Unit | 7 rojos / 106 verdes | Escrito en 1.3 | 113/113; suite 3246 passed | Cubierto por 1.3 (U2 x2, U7 x2, L3+L4, guardas) | N/A |

## Batch 3 — Fases 4-7 (cableado, integración, mutación, evidencia; PR #2; `size:exception` ya resuelto para la PR #1, `chain_strategy` sin definir, misma rama)

**Safety net**: `npm test -- main` antes de tocar: 85/85. Baseline completo del batch (con la tarea 2.2 aún sin commitear en el árbol): 161 archivos, 3246 passed | 5 skipped.

**4.1 ROJO (`src/main.test.ts`, +50 / -0, dentro del `describe` de "MISMA instancia")**: dos `it` nuevos. (a) `comandoMock.mock.calls[0][0].operacionesTui.onOperaciones` es `toBe` `operacionesMock.mock.results[0].value`. (b) `confirmacionStore` y `conversacionStore` de `operacionesTui` están definidos y `not.toBe` los que recibe `startWebServer` (`confirmacionOperacionesStore`, `conversacionStore`), más un `not.toBe` entre los dos de la TUI. (c) el test (iv) no se toca: se verifica.
**Evidencia rojo**: `npm run typecheck` verde; `npm test -- main` = 2 failed | 85 passed (87). Ambos con `AssertionError: expected undefined to be defined`: "inyecta operacionesTui con la MISMA instancia de onOperaciones..." y "los stores de operacionesTui son de la TUI y NO son los que recibe startWebServer...". Sin hunks sobre aserciones existentes.

**4.2 VERDE (`src/main.ts`, +13 / -0, un solo hunk `@@ -573,7 +573,20 @@`)**: comentario ADR 297-299/RD-170/171 (sin el literal prohibido), `confirmacionOperacionesStoreTui = crearConfirmacionOperacionesStore()`, `conversacionStoreTui = crearConversacionEmpleadoStore()` y la clave `operacionesTui: { onOperaciones: onOperacionesEmpleado, confirmacionStore, conversacionStore }` dentro del bloque 5c, antes de `buildOnComandoEmpleado({`. Sin reordenar nada (H4).
**Evidencia verde**: `npm test -- main` = 87/87 (el (iv) de `:682` verde sin editar); `npm run typecheck` verde; suite completa y build en Fase 7.
**Desvío cosmético**: la clave `operacionesTui` va como PRIMERA clave del literal de `buildOnComandoEmpleado` (no junto a `registro`) para que el diff sea un solo hunk contiguo, como exige la aceptación de 4.2, y porque el (iv) exige que la última línea del literal siga siendo el spread `...(clienteA2A ...) // exactOptionalPropertyTypes` seguido de `});`.

**5.1-5.2 integración (`src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts`, NUEVO, 325 líneas, 4 `it`)**: `openDatabase(":memory:")` real, credencial `ana` (scrypt real) con rol `administrador`, solicitud `sol-1` (gasto) pendiente de `juan`, `buildOnOperacionesEmpleado` real, `vi.mock` de `handle-turn.js` que invoca la tool registrada real (`_registeredTools[OPERACIONES_TOOL_NAME].handler`) con la operación fijada por el test (`{operacion:"resolver_solicitud", accion:"aprobar", solicitudId:"sol-1"}`, campos verificados contra `validar-operacion.ts`), `buildOnComandoEmpleado` real con `crearConfirmacionOperacionesStore()`/`crearConversacionEmpleadoStore()` reales, `onSubmit` falso, `logDeps` en memoria (nada escribe `harness.log`). `it` 1 sin login -> `onSubmit`, sin tool; `it` 2 login, texto 1 pide confirmar sin cambiar la BD (volcado de `solicitudes_internas` idéntico, cero filas de auditoría), texto 2 ejecuta (`aprobada` + 1 fila de auditoría de `ana`); `it` 3 tras `/logout` -> `onSubmit`, tool no invocada de nuevo; `it` 4 confirmación previa al `/logout` no sobrevive al re-login (vuelve a pedir confirmar, BD intacta) y una confirmación nueva sí ejecuta (triangulación). Sin `.only`/`skip`.
**Nacen verdes (declarado)**: `npm test -- operaciones-negocio-tui-flujo` = 4/4 a la primera; sus dientes se probaron por mutación (6.1: `it` 1 e `it` 3 fallan bajo M1). Aviso: `it` 4 NO cambia bajo M2 porque el re-login pasa por L3 (defensa en profundidad); el diente de L2 aislado lo tiene U3-limpieza.

**6.1 M1 / 6.2 M2**: respaldo de `build-on-comando-empleado.ts` en el scratchpad (sha256 `ccb31b01...7df`); sin `git checkout/restore/stash`. Baseline `npm test`: 162 archivos | 3252 passed | 5 skipped. **M1** (guarda sin `sesionVigente`): 7 failed | 3245 passed: U1, U2-ruteo, U3-ruteo, U2-limpieza, U8, integración `it` 1 e `it` 3 (los nombrados U1, U3-ruteo, `it` 3 fallan). Todos con `TypeError: Cannot read properties of undefined (reading 'empleadoId')` (el cast `as SesionEmpleado` deja pasar `undefined`). **M2** (quitar L2): 1 failed | 3251 passed: solo U3 (limpieza, L2), `expected [] to deeply equal ['limpiarEmpleado:ana', 'eliminar:id-2']`. Tras cada mutación: copia del respaldo, `cmp` idéntico, mismo sha256, `git diff --stat` igual, suite en verde 3252. Evidencia: `docs/progreso/v3.19-operaciones-negocio-tui/mutacion-guarda-sesion.md` y `mutacion-limpieza-logout.md`.

**6.3 (NO hecha)**: esqueleto `docs/progreso/v3.19-operaciones-negocio-tui/README.md` con resumen, los cuatro pasos manuales, D6, R9 y placeholders "PENDIENTE: evidencia (captura/log)".

**Fase 7**: `rm -rf dist` antes; `npm run typecheck` verde; `npm test` = 162 archivos passed | 2 skipped (164), 3252 passed | 5 skipped (3257) (3246 + 2 de `main.test.ts` + 4 de integración); `npm run build` verde; `dist/` borrado después. **7.4** (reporte, sin marcar): `git diff main --numstat` = `tasks.md` 15/15 (checkboxes), `build-on-comando-empleado.ts` 99/5 (2.1+2.2), su `.test.ts` 478/0, `main.ts` 13/0, `main.test.ts` 50/0: 655 inserciones / 20 borrados en total (los borrados son de `tasks.md` y del `.ts`; ningún test tiene borrados); `git diff main -- src/build-on-operaciones-empleado.ts src/build-on-submit.ts src/core src/adapters` vacío; `git diff main -- package.json` vacío. Pendiente hasta que el humano commitee: los archivos nuevos (test de integración, docs) no aparecen en `git diff main` por ser untracked.

### TDD Cycle Evidence (Fases 4-7)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `src/main.test.ts` | Wiring (spy sobre `main.ts` real) | 85/85 | Escrito, 2 rojos (`expected undefined to be defined`), typecheck verde | 87/87 (tarea 4.2) | 2 `it`: identidad del handler y aislamiento de stores | N/A |
| 4.2 | idem | Wiring | 85/85 previos, 87 con 4.1 | Escrito en 4.1 | 87/87; typecheck y build verdes | Cubierto por 4.1 | N/A (mínimo) |
| 5.1 | `src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts` | Integration | N/A (archivo nuevo) | Excepción declarada: nace verde | 2/2 (`it` 1-2) | it 1 vs it 2 (rama sin tool vs con tool, dos turnos) | N/A |
| 5.2 | idem | Integration | N/A (idem) | Excepción declarada: nace verde | 4/4 en el archivo | it 3 (logout) + it 4 (re-login con y sin confirmación fresca) | N/A |
| 6.1 | mutación M1 | Mutación | suite verde 3252 | Rojo: 7 fallos (incluye los 3 nombrados) | verde tras restaurar, `cmp` idéntico | N/A | N/A |
| 6.2 | mutación M2 | Mutación | suite verde 3252 | Rojo: 1 fallo (U3-limpieza) | verde tras restaurar, `cmp` idéntico | N/A | N/A |
