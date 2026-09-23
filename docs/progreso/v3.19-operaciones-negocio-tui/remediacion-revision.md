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
