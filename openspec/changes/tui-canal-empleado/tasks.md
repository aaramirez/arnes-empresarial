> **Nota de proceso (hook de graphify)**: ejecutor sin shell disponible (solo `Read`/`Grep`/`Glob`/`Write`/`Edit`), igual que las fases previas de este change. Este documento no reinterpreta el diseño: cada tarea desglosa una pieza ya fijada por `design.md` §11 (orden de implementación) y sus ADR 34-41. Se recomienda `graphify update .` tras persistir este archivo.

# Tasks: Canal TUI para empleados — soporte, devolución y cierre de R3 (v1.4.0)

**Origen** (no se duplica): [`proposal.md`](proposal.md) ADR 21-33 · [`design.md`](design.md) §2-11, ADR 34-41 · specs: `autenticacion-empleado-tui`, `comando-empleado-tui`, `reembolso-evaluacion`, `reembolso-resolucion-escalacion`, `registro-acciones-empleado`, `reporte-comisiones-mensual`, `soporte-web-turno`.

**Metodología**: TDD estricto (`strict_tdd: true`) en toda tarea con lógica (1-13, 16-17). Excepciones: 14 (wiring puro en `main.ts`, cubierto por regresión de `build-on-*.test.ts`), 15 (module docs, sin lógica nueva).

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2500-3000 (17 tareas: 2 carpetas de núcleo, 1 adaptador crypto, 2 migraciones + 9 funciones de repository, 1 dispatcher, 1 CLI) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 = Fases 1-5 (tareas 1-12, auth+provisioning) → PR2 = Fases 6-7 (tareas 13-17, comandos+cierre R3) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Nota: `design.md` §11 ya recomienda este corte — los comandos privilegiados no pueden shippear sin auth. `feature-branch-chain` calza con el patrón de una sola rama por hito de `AGENTS.md` (precedente: tasks.md de Hito 4).

### Suggested Work Units

| Unit | Goal | Tasks | Base |
|---|---|---|---|
| 1 | Autenticación + provisioning: migraciones, crypto, parser, contratos, casos de uso puros, repository, CLI | 1-12 | `hito/v1.4-tui-canal-empleado` |
| 2 | Comandos + cierre R3: store ampliado, dispatcher, wiring, reporte | 13-17 | Unit 1 |

## Phase 1: Cimientos sin dependencias (paralelizables)

- [x] 1.1 `migrations/0005_registro_acciones_empleado.ts` + append `index.ts`. Tabla+índice. Cubre `registro-acciones-empleado` req. 1, 4.
- [x] 1.2 `migrations/0006_credenciales_empleado.ts` + append `index.ts`. Cubre `autenticacion-empleado-tui` req. 1-2.
- [x] 1.3 `src/adapters/crypto/password.ts` — `hashPassword`/`verificarPassword` (scrypt real, nunca lanza). TDD con derivaciones reales. Cubre `autenticacion` req. 1, 3.
- [x] 1.4 `src/core/commands/comando-empleado.ts` — `parsearComando`, `COMANDOS`, `formatearAyuda`. Puro. Cubre `comando-empleado-tui` req. 1-3.

## Phase 2: Contratos de puerto y vocabulario (dependen de tipos)

- [x] 2.1 `src/core/commands/registro-acciones-contract.ts` — `AccionEmpleado`, `RegistroAccionesEmpleadoPort`. Cubre `registro-acciones-empleado` req. 1, 2, 5.
- [x] 2.2 `src/core/auth/credenciales-contract.ts` + `sesion.ts` + `auth-config.ts` — puros. Cubre `autenticacion` req. 5-7.
- [x] 2.3 `src/core/ventas/ventas-contract.ts` — 6º estado, `CASO_ESTADO_RESUELTO`, `EscalacionListada`, 5 métodos de puerto. Bloquea 2.4, Fase 3, 4.1.

## Phase 3: Casos de uso puros (dependen de Fase 2)

- [x] 3.1 `src/core/auth/login.ts` — `resolverLogin`, puro/síncrono. Cubre `autenticacion` req. 3-4, 8.
- [x] 3.2 `src/core/ventas/procesar-devolucion.ts` — solo ensancha el retorno; tests existentes se amplían. Cubre `reembolso-evaluacion` req. ADDED.
- [x] 3.3 `src/core/ventas/resolver-escalacion-reembolso.ts` — puro/síncrono, 3 acciones + confirmación en 2 pasos. Cubre `reembolso-resolucion-escalacion` req. 1-7.

## Phase 4: Adaptador de memoria (depende de migraciones)

- [x] 4.1 `repository.ts` — `listEscalacionesReembolso`, `insertAccionEmpleado` (+ lector de test), 3 CAS transaccionales, 3 funciones de credenciales. TDD con SQLite en memoria. Cubre `reembolso-resolucion-escalacion` req. 3-7, `registro-acciones` req. 4, 6.

## Phase 5: Provisioning demostrable (depende de 1.3 y 4.1)

- [x] 5.1 `src/empleados.ts` + script `empleados:crear` en `package.json` — `parseArgsEmpleado` puro testeado, password por stdin, alta/rotación. Cubre `autenticacion` req. 1-2.

> **Estado (Work Unit 1, PR1 — feature-branch-chain)**: tareas 1-12 completas
> en la rama `hito/v1.4-tui-canal-empleado` (tracker). `npm run typecheck`
> tiene 2 errores PENDIENTES y esperados en `src/build-on-venta.ts` /
> `src/build-on-venta.test.ts`: `VentaStorePort` ya expone los 5 métodos
> nuevos (tarea 2.3) pero `createVentaStore` todavía no los implementa —
> eso es la tarea 13 (Fase 6, Work Unit 2), que ADR 41 ya anticipa como
> inevitable. `npm test` pasa completo porque nada en Unit 1 invoca esos
> métodos en runtime (el dispatcher que lo haría es la tarea 14).

## Phase 6: Store y dispatcher

- [ ] 6.1 `src/build-on-venta.ts` — amplía `createVentaStore` con los 5 closures nuevos; `buildOnVenta` no cambia (ADR 41).
- [ ] 6.2 `src/build-on-comando-empleado.ts` — dispatcher, 2 ranuras de closure, ruteo de 8 comandos. TDD con dobles. Cubre `comando-empleado-tui`, `autenticacion`, `reembolso-resolucion-escalacion`, `registro-acciones-empleado` (todos los req.). Depende de todo lo anterior salvo 5.1.

## Phase 7: Wiring y cierre

- [ ] 7.1 `src/main.ts` — 5 cambios de wiring (§8 diseño): `authConfig`, `onSoporte` compartido, `buildOnComandoEmpleado`, mount de `startTui`.
- [ ] 7.2 `tui-port.ts` (comentario), `turn-logger.ts` (doc de 13 eventos), `core/config/env.ts` (doc `SESION_TTL_MINUTOS`).
- [ ] 7.3 `reporte.ts` + `reporte.test.ts` — actualiza `NOTA_ESCALACION_FUERA_DE_BANDA` y caso borde de `reembolso_rechazado`. Cubre `reporte-comisiones-mensual` req. 1-2.
