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
