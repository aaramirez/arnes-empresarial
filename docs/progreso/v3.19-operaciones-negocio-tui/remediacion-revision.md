# Remediacion de la revision (W1-W3) — `operaciones-negocio-tui`

Fecha: 2026-09-23. Rama `hito/v3.19-operaciones-negocio-tui`. Origen: advertencias W1, W2 y W3 del Reviewer, remediadas a pedido del humano (Fase 8 de `tasks.md`). Sin cambios permanentes de codigo de produccion: todas las mutaciones se hicieron sobre un respaldo en el scratchpad y se restauraron **copiando el respaldo** (`cmp` identico, mismo `sha256`), nunca con `git checkout/restore/stash`.

Convencion: cada test nuevo describe comportamiento que ya existe, asi que **nace verde** (declarado); su valor se prueba por mutacion. Comandos: `npm test -- <archivo>` (con `dist/` borrado).

## W1 (tarea 8.1) — dientes de asercion de M1 bajo una mutacion sin `TypeError`

Problema: bajo M1 (`operacionesTui !== undefined`, sin `sesionVigente`) los tests fallaban por un `TypeError` en `sesionTurno.empleadoId` (el cast `as SesionEmpleado`), no por sus aserciones sobre `onOperaciones`/`onSubmit`.

**M1b** (dos lineas, `src/build-on-comando-empleado.ts`; `sha256` original `ccb31b0188e67075...417df`):

```diff
-      if (operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)) {
+      if (operacionesTui !== undefined) {
...
-      confirmacion: operaciones.confirmacionStore.paraEmpleado(sesionTurno.empleadoId),
+      confirmacion: operaciones.confirmacionStore.paraEmpleado(sesionTurno?.empleadoId ?? "ghost"),
```

Comando: `npm test -- build-on-comando-empleado operaciones-negocio-tui-flujo` -> **7 failed | 110 passed (117)**. Ningun fallo es `TypeError`; todos son `AssertionError`:

| Test | Mensaje |
|---|---|
| U1 | `expected "vi.fn()" to be called 1 times, but got 0 times` (`onSubmit`) |
| U2 (ruteo) | idem |
| U3 (ruteo) | idem |
| it 1 (integracion) | idem |
| it 3 (integracion) | idem |
| U2 (limpieza, L1) | `expected [ 'limpiarEmpleado:ana', …(2) ] to deeply equal [ 'limpiarEmpleado:ana', …(2) ]` (el orden incluye `onOperaciones` en vez de `onSubmit`) |
| U8 (H3) | `expected "vi.fn()" to be called 1 times, but got 2 times` |

Restaurado por copia: `cmp` identico, `sha256` `ccb31b01...417df`, `git diff --stat` vacio, `npm test -- build-on-comando-empleado operaciones-negocio-tui-flujo` -> 117/117 en verde.

**Resultado**: los cinco tests pedidos (U1, U2-ruteo, U3-ruteo, integracion `it` 1 e `it` 3) tienen dientes de asercion reales sobre `onSubmit`/`onOperaciones`, sin depender de un `TypeError` accidental. **No hizo falta ajustar ningun test.** Ningun archivo de codigo cambia en la tarea 8.1: solo este documento.

Nota de diseno para el humano (no se toco): el `TypeError` de M1 nace del cast `sesionTurno as SesionEmpleado`; eliminarlo (por ejemplo, estrechando el tipo con una guarda sin cast) haria que M1 fallara por tipos en compilacion. Es una decision de diseno del humano, fuera del alcance de esta remediacion.

## W2 (tarea 8.2) — frontera `mcpServers` y rechazo de rol dentro de la operacion

**W2a** — `src/build-on-submit.test.ts` (+35 lineas, 0 borradas; import de `OPERACIONES_MCP_SERVER_NAME` y un `it` nuevo, lineas 252-277). Antes no habia ninguna asercion sobre `operaciones` en ese archivo. El test inyecta un `knowledge` con UNA clave (`knowledge`) y afirma sobre el `mcpServers` que llega a `handleTurn`: sin la clave `operaciones` (`not.toHaveProperty(OPERACIONES_MCP_SERVER_NAME)`), `Object.keys` igual a `["knowledge"]`, y sin `knowledge` no hay `mcpServers`. Verde sin mutacion: `npm test -- build-on-submit` 6/6.

Mutaciones en `src/build-on-submit.ts` (`sha256` original `0c4401bc...bcb1`):

| Mutacion | Resultado | Falla |
|---|---|---|
| M-a: `mcpServers: { ...knowledge.mcpServers, operaciones: {} as never }` | 2 failed \| 4 passed | el test nuevo (`expected { …(2) } to not have property "operaciones"`) y tambien el existente "forwards mcpServers…" (igualdad de valor) |
| M-b: `mcpServers: Object.assign(knowledge.mcpServers, { operaciones: {} as never })` (misma referencia, mutada) | 1 failed \| 5 passed | **solo** el test nuevo; el existente pasa porque compara la misma referencia consigo misma |

M-b muestra que la asercion nueva aporta cobertura que el test vigente no tenia. Restaurado por copia: `cmp` identico, `sha256` `0c4401bc...bcb1`, 6/6 en verde.

**W2b** — integracion `it 5` (`operaciones-negocio-tui-flujo.integration.test.ts`, lineas 359-396). `armarFlujo` gana un parametro opcional `OpcionesFlujo` (`empleadoId`, `rol`, `confirmacionStoreTui`; los defaults reproducen el arnes anterior) y un helper `loginComo`. El empleado `beto` tiene rol `empleado` (`ROL_EMPLEADO`, el unico rol no administrador que existe: `ROLES_EMPLEADO = [empleado, administrador]`), entra por `/login` en el dispatcher de la TUI y confirma en dos turnos. Lo que hace el gate real (`ejecutar-operacion.ts` + `resolver-solicitud-interna.ts`):

- Turno 1: el rol NO se consulta; pide confirmar (`Vas a aprobar la solicitud sol-1 (taxi al cliente)…`), cero filas de auditoria.
- Turno 2: la confirmacion es valida (se consume) pero `puedeResolverAjeno` devuelve `false` -> `no_autorizado`; el texto es `No estás autorizado para aprobar esa solicitud: se requiere rol elevado.`, la tabla `solicitudes_internas` queda **identica** (volcado completo) y en `pendiente_aprobacion_humana`, y queda **exactamente una** fila de auditoria `{comando: aprobar-solicitud, resultado: no_autorizado, empleado_id: beto}`.

Mutacion (`src/core/auth/autorizacion-resolucion.ts`, `sha256` original `288bce04...8624`): `return rol === ROL_ADMINISTRADOR || true;` (afloja el gate). `npm test -- operaciones-negocio-tui-flujo` -> 1 failed | 4 passed: `it 5` con `expected 'Listo: la solicitud sol-1 quedó aprob…' to be 'No estás autorizado para aprobar esa …'`. Restaurado por copia (`cmp` identico, mismo `sha256`), 5/5 en verde.

## W3 (tarea 8.3) — cero cruce web-TUI y slash entre los dos turnos

**W3a** — integracion `it 6` (lineas 398-445). Dos `crearConfirmacionOperacionesStore()` independientes: `storeWeb` (suelto, el arnes no levanta el servidor web) y `storeTui` (el que recibe el dispatcher via `armarFlujo({ confirmacionStoreTui })`). Tras `/login ana`, se marca en `storeWeb` una ranura de `ana` para `aprobar sol-1` (con precondicion: `storeWeb.estaConfirmada(...)` es `true`, para que el test no sea vacuo). El texto "sí, confirmo" en la TUI se comporta como **primer turno**: pide confirmar, `solicitudes_internas` identica, pendiente, cero auditoria, y la ranura de la web queda intacta (no se consumio). Triangulacion: el turno 2 (confirmacion propia de la TUI) si ejecuta (`aprobada`, 1 fila de auditoria).

**Hallazgo y ajuste**: la primera version marcaba la ranura de la web ANTES del login. Bajo la mutacion `const storeTui = storeWeb;` el test **paso** (7/7): `/login` llama `limpiarEmpleado` (L3/L4) sobre el store de la TUI, que en esa mutacion es el compartido, y borraba la ranura marcada antes (defensa en profundidad). Se ajusto el test para marcar la ranura **despues** del login (con un comentario que lo explica), que es tambien el caso realista (sesion web concurrente).

Mutacion (en el propio test, `const storeTui = crearConfirmacionOperacionesStore();` -> `const storeTui = storeWeb;`): `npm test -- operaciones-negocio-tui-flujo` -> 1 failed | 6 passed: `it 6` con `expected 'Listo: la solicitud sol-1 quedó aprob…' to contain 'Vas a aprobar la solicitud sol-1 (tax…'`. Restaurado por copia (`cmp` identico), 7/7 en verde.

**W3b** — integracion `it 7` (lineas 447-478), RD-170/D4: `/login ana` -> turno 1 (eco de confirmacion, BD identica, cero auditoria) -> `/ayuda` (`agentLabel: "sistema"`, la tool no corre, `onSubmit` no corre, BD identica) -> turno 2 "sí, confirmo" -> `aprobada` con una fila de auditoria de `ana`.

Mutacion (`src/build-on-comando-empleado.ts`, restaurado desde el respaldo `sha256 ccb31b01...417df`): antes del paso 5 se agrego `if (sesion !== undefined) operacionesTui?.confirmacionStore.limpiarEmpleado(sesion.empleadoId);` (un slash limpia la confirmacion). `npm test -- build-on-comando-empleado operaciones-negocio-tui-flujo` -> **5 failed | 115 passed (120)**: `it 7` (`expected 'Vas a aprobar la solicitud sol-1 (tax…' to be 'Listo: la solicitud sol-1 quedó aprob…'`), la guarda unitaria de RD-170 (`expected "vi.fn()" to not be called at all, but actually been called 1 times`) y, como cobertura adicional ya existente, U3-limpieza, U8 y L3+L4 (el orden de llamadas cambia). Restaurado por copia, `cmp` identico, `sha256` `ccb31b01...417df`, `git diff --stat` sin `src/build-on-comando-empleado.ts`, 120/120 en verde.

## Verificacion final

`rm -rf dist`; `npm run typecheck` verde; `npm test` = **162 archivos passed | 2 skipped (164); 3256 passed | 5 skipped (3261)** (linea base 3252 + 1 de `build-on-submit` + 3 de integracion `it 5-7`; el numero de archivos no cambia); `npm run build` verde; `dist/` borrado. `git diff --stat` solo lista `src/build-on-submit.test.ts` (+35/-0) y `src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts` (+166/-11; los 11 borrados son lineas de imports y del encabezado de `armarFlujo` reescritas sin cambiar comportamiento); `src/main.ts`, `build-on-submit.ts`, `build-on-operaciones-empleado.ts`, `build-on-comando-empleado.ts`, `src/core`, `src/adapters` y `package.json` sin cambios.

## Batch 5 - hallazgos menores del code-review (Fase 9, tareas 9.1-9.3)

Origen: tres hallazgos menores del code-review del Reviewer, atendidos a pedido del humano (2026-09-23). Sin cambios de codigo de produccion: `src/main.ts` se mutó sobre un respaldo y se restauro por copia.

### 9.1 - los turnos de la TUI no estan en el drenaje de cierre: CONFIRMADO, NO APLICADO (requiere decision de diseno)

**Rastro del codigo (confirma el hallazgo).**

- La web rastrea sus turnos DENTRO de `startServer` (`src/adapters/web/server.ts:919-949`): un `Set<Promise<unknown>>` privado (`enVuelo`) y un envoltorio `onOperacionesEmpleadoConDrenaje` sobre `deps.onOperacionesEmpleado`. `close()` (`:977-1003`) hace `server.close()` y luego `Promise.allSettled([...enVuelo])` en carrera contra `WEB_CLOSE_TIMEOUT_MS` (5 000 ms).
- `main.ts` entrega el handler CRUDO a la web (`:552`, `onOperacionesEmpleado`) y ese mismo handler crudo a la TUI (`:585-586`, `operacionesTui.onOperaciones`). El envoltorio con drenaje vive dentro de la web: el `Set` no es alcanzable desde `main.ts`, asi que los turnos de la TUI nunca entran en el.
- Cierre de la TUI (`main.ts:801-875`): `await tui.waitUntilExit()` resuelve con Ctrl+C (Ink desmonta, `exitOnCtrlC` por defecto) y el `finally` corre `web.close()`, `webhook.close()`, `a2aServidor.close()`, `opsServidor.close()` y `db.close()`. Nada espera a un turno de la TUI: `App.tsx:625` lanza `onSubmit(...).then(...)` y no lo registra en ningun lado. Si `web`, `webhook` y A2A no estan habilitados, `db.close()` corre a los pocos ms de Ctrl+C.

**Ventana real.** No es una carrera de un instante: un turno con la tool `operaciones` pasa la mayor parte del tiempo esperando al modelo (segundos). Ctrl+C durante esa espera cierra la base; el proceso NO muere (la promesa pendiente sostiene el event loop) y, cuando el modelo llama a la tool, la primera escritura sincrona de better-sqlite3 lanza porque la conexion esta cerrada (el suite ya lo documenta en `main.test.ts:1767-1769`). Resultado tipico: la operacion confirmada no se aplica y nadie lo ve (la TUI ya se desmonto). Ventana de escritura parcial, mas estrecha: operaciones con un `await` entre dos escrituras, p. ej. `ejecutarRegistrarVenta` (`src/core/operaciones/ejecutar-operacion.ts:754-772`: `await registrarVenta(...)`, que notifica, y despues `registrar(...)` de la fila de auditoria); un Ctrl+C durante ese `await` deja la venta sin su fila de auditoria. No hay corrupcion (cada escritura es atomica). El camino conversacional `onSubmit` y `/soporte` de la TUI tienen exactamente la misma exposicion desde antes de este change: `operacionesTui` solo agrego un tercer tipo de turno.

**Por que no se aplico la correccion.** Existe un arreglo tecnico chico (un `Set` local en `main.ts`, un envoltorio y un `await` acotado antes de `db.close()`), pero exige decisiones que no son de esta tarea:

1. **Contradice una spec ya cerrada**: en `modo-headless-cierre-limpio`, el requirement H10 fija que en modo TUI el orden del `finally` es `web.close, webhook.close, a2a.close, db.close`, una vez cada uno, y el escenario "En modo TUI no se arma ningun presupuesto". Un paso nuevo de drenaje de la TUI enmienda H10 y esa politica.
2. **Presupuesto y UX sin decidir**: cuanto espera Ctrl+C. Reusar `WEB_CLOSE_TIMEOUT_MS` (5 s) no alcanza para un turno de modelo de 10-50 s; uno mayor bloquea la salida con la TUI ya desmontada y sin aviso. Ademas H-4/R33 ya declara que Ctrl+C con web tarda ~5 s por un `setTimeout` sin limpiar; un temporizador propio repetiria ese defecto salvo que se limpie.
3. **Alcance**: envolver solo `operacionesTui.onOperaciones` deja sin cubrir `onSubmit` y `/soporte` desde la TUI (la misma clase de ventana); lo coherente es envolver el handler que recibe `startTui` (`onComandoEmpleado`), y eso es una decision de diseno del ciclo de vida de la TUI (extiende el ADR 10), no un ajuste de este change.
4. **Identidad del handler (4.1(a))**: envolver `onOperaciones` rompe el `toBe` de identidad del test 4.1(a) y la decision de diseno "MISMA instancia"; envolver `onComandoEmpleado` no la toca.

**Recomendacion**: un change propio ("drenaje de turnos de la TUI al cerrar", con enmienda explicita de H10) que decida presupuesto, alcance y aviso al usuario. Mientras tanto queda declarado como limite conocido, preexistente y no introducido por `operaciones-negocio-tui`. Sin cambios en `main.ts` ni `main.test.ts` por 9.1.
