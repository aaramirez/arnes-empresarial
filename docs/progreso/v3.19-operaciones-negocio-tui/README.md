# Hito v3.19 — `operaciones-negocio-tui`: el texto libre autenticado de la TUI llega a `operacion_negocio`

> **ESTADO: tarea 6.3 ejecutada por el humano en la TUI real (2026-09-23).** Evidencia objetiva del paso 3 tomada de la base de datos; los pasos 1, 2 y 4 y las decisiones D6/R9 quedan como atestación del humano, sin captura adjunta (ver "Alcance de la evidencia"). No es hito completo hasta el Reviewer, el tag y el cierre.

Rama: `hito/v3.19-operaciones-negocio-tui`. Fecha del esqueleto: 2026-09-23. Fecha de la verificación manual: 2026-09-23.

## Que cambia

Antes, en la TUI el texto libre iba siempre a `onSubmit` (camino conversacional sin la tool `operacion_negocio`), aunque hubiera sesion. Ahora, con `operacionesTui` inyectada por `main.ts` **y** sesion vigente, el texto libre va al **mismo** handler de operaciones que ya usa la web (`buildOnOperacionesEmpleado`), con la identidad tomada solo de la sesion (nunca del texto), una confirmacion en dos turnos y **stores propios de la TUI** (cero cruce con los de la web). Sin sesion, con sesion vencida o tras `/logout`, el texto sigue yendo a `onSubmit` sin cambios. La limpieza del estado de operaciones ocurre en cuatro sitios (expiracion, `/logout`, entrada de `/login` aunque falle, login exitoso).

- ADR 297-299, RD-170/171 (ratificadas).
- Diff de activacion: una clave `operacionesTui` y dos stores en `src/main.ts` (bloque 5c). Rollback: borrar esa clave.

## Verificacion manual (tarea 6.3) — EJECUTADA por el humano

Prerrequisito cumplido: TUI real (`npm run dev`) sobre `data/harness.db`, con `jimmy` (rol `administrador`) y una solicitud interna pendiente del solicitante `beto` (la autoaprobacion esta prohibida).

| # | Paso | Resultado esperado | Evidencia |
|---|---|---|---|
| 1 | **Sin login**, escribir `listá las solicitudes para aprobar` | El mensaje enganoso vigente **no cambia** (R4, fuera de alcance): el texto va a `onSubmit`, sin tool. | Ejecutado por el humano el 2026-09-23: funciona. Sin captura adjunta. |
| 2 | `/login <id> <password>`, luego el mismo pedido `listá las solicitudes para aprobar` | Responde con el listado de solicitudes pendientes. El agente puede preguntar antes "¿aprobar o rechazar?". El listado **no** consume confirmacion: la confirmacion aparece al nombrar una solicitud concreta (paso 3). | Ejecutado por el humano el 2026-09-23: funciona. Sin captura adjunta. |
| 3 | Pedir aprobar una solicitud concreta, ver el eco con el detalle y confirmar en un mensaje aparte (p. ej. `sí, confirmo`) | Ejecuta: la solicitud queda resuelta (`Listo: la solicitud <id> quedó aprobada.`) y aparece la fila de auditoria. | **Base de datos (lectura)**, ver bloque siguiente. |
| 4 | `/logout` y repetir el pedido | Vuelve al camino **sin tool** (igual que el paso 1); nada se ejecuta. | Ejecutado por el humano el 2026-09-23: funciona. Sin captura adjunta. |
| 5 (opcional) | Con `jimmy` logueado, aprobar por texto libre un reembolso escalado por otro empleado | La devolucion escalada por `beto` queda aprobada por `jimmy` (rol `administrador`, distinto del vendedor) y la venta pasa a `reembolsada`. | **Base de datos (lectura)**, ver bloque "Evidencia objetiva del paso 5". |

### Evidencia objetiva del paso 3 (`data/harness.db`, consulta de solo lectura)

Solicitud resuelta:

| Campo | Valor |
|---|---|
| `id` | `40679afd-2e46-4688-9e6a-012be94d84f9` |
| `solicitante_id` | `beto` |
| `tipo` | `vacaciones` |
| `estado` | `aprobada` |
| `resuelta_por` | `jimmy` |
| `resuelta_at` | `2026-09-23T23:12:50.249Z` |

Fila de auditoria (`registro_acciones_empleado`):

| Campo | Valor |
|---|---|
| `id` | `b7daf0c1-75ae-4ba8-95bf-c606fc86e484` |
| `empleado_id` | `jimmy` |
| `comando` | `/aprobar-solicitud` |
| `resultado` | `aprobada` |
| `caso_id` | `4a566d56-5f48-4af8-8dd3-782543129fb4` (el caso de la solicitud) |
| `ocurrido_at` | `2026-09-23T23:12:50.249Z` (mismo instante que `resuelta_at`) |

Lo que esto prueba: el solicitante (`beto`) es distinto de quien resuelve (`jimmy`); la resolucion y la fila de auditoria quedaron registradas con el mismo timestamp y el mismo `caso_id`; el `comando` de auditoria reusa el literal `/aprobar-solicitud`, como fija el contrato (`registro-acciones-contract.ts`).

Consulta usada (Node + `better-sqlite3`, solo lectura):

```bash
node -e "const db=require('better-sqlite3')('data/harness.db',{readonly:true});console.log(db.prepare(\"SELECT id, solicitante_id, estado, resuelta_por, resuelta_at FROM solicitudes_internas WHERE id='40679afd-2e46-4688-9e6a-012be94d84f9'\").all());console.log(db.prepare(\"SELECT id, empleado_id, comando, resultado, ocurrido_at FROM registro_acciones_empleado WHERE id='b7daf0c1-75ae-4ba8-95bf-c606fc86e484'\").all())"
```

### Evidencia objetiva del paso 5 (aprobacion de reembolso, `data/harness.db`, solo lectura)

Este paso responde con evidencia real a la pregunta de si la TUI puede aprobar reembolsos: los comandos slash `/aprobar-reembolso`, `/rechazar-reembolso` y `/reabrir-reembolso` se dieron de baja en `aprobacion-conversacional-hitl` (ADR 210) y hoy se resuelven por conversacion con la operacion `resolver_reembolso`, que la TUI no tenia hasta este hito.

Venta `eba6eea5-191f-4e8e-b8bb-2b7e3c20aa7a` (vendedor `beto`, monto 500): estado final **`reembolsada`**.

Cadena de auditoria de esa venta (`registro_acciones_empleado`), en orden:

| `ocurrido_at` | `empleado_id` | `comando` | `resultado` |
|---|---|---|---|
| 2026-09-23T20:21:34.853Z | `beto` | `operacion:registrar_venta` | `creada` |
| 2026-09-23T23:19:15.467Z | `beto` | `operacion:solicitar_devolucion` | `escalada` |
| 2026-09-23T23:21:28.396Z | `jimmy` | `/aprobar-reembolso` | `aprobada` |

Lo que esto prueba: quien inicia la devolucion (`beto`, vendedor) y quien la aprueba (`jimmy`, administrador) son personas distintas, como exige el flujo "dos personas"; la aprobacion quedo auditada con el literal `/aprobar-reembolso` que reusa el contrato; y la devolucion iniciada por el empleado (`solicitar_devolucion`) no se cierra sola: queda `escalada` hasta que un administrador distinto la resuelve. El evento `operaciones-caso-creado` del turno aparece en `data/harness.log` segundos antes de la fila de auditoria (23:21:25Z).

### Alcance de la evidencia

- La base de datos **no distingue el canal** (TUI o chat web): ambos escriben con el mismo handler y el mismo literal de comando. Que los pasos 3 y 5 se hicieron por la TUI es atestacion del humano (confirmada en la sesion de trabajo del 2026-09-23).
- Los pasos 1, 2 y 4 no tienen captura ni registro objetivo: son atestacion del humano.
- Correccion respecto del esqueleto original: el paso 2 decia que el agente "pide confirmar" al listar; en realidad el listado no usa confirmacion, solo la operacion sobre una solicitud concreta (paso 3).

## Decisiones aceptadas que hay que dejar visibles (RD-171)

- **D6 — los turnos TUI autenticados ya no escriben `graphify-out/memory`.** El turno de operaciones no cablea el feedback de conocimiento (ADR 235), como ya ocurre en el canal web. Efecto observable: tras usar texto libre autenticado en la TUI, **no** aparecen notas nuevas en `graphify-out/memory` por esos turnos; los turnos sin sesion (camino `onSubmit`) siguen escribiendolas como siempre. Sin evidencia medida antes/despues en esta verificacion: queda como comportamiento declarado por diseño y cubierto por los tests de `build-on-operaciones-empleado`.
- **R9 — asimetria de `consultar_kpi` dentro de la TUI.** En texto libre autenticado, `consultar_kpi` exige rol `administrador` (pasa por el dispatcher de operaciones); el comando `/consultar-kpi` **no exige rol**. Se declara y no se corrige aqui: lo resuelve N7-R13/OQ1 de `permisos-granulares`. Sin evidencia manual (opcional).
- **Limite conocido — drenaje de apagado (hallazgo 9.1 del code-review).** Los turnos de operaciones de la TUI no participan del drenaje de cierre que la web si tiene: un Ctrl+C a mitad de un turno cierra la base bajo una operacion en vuelo. No corrompe datos, y `onSubmit` y `/soporte` tienen la misma exposicion. Requiere un change aparte con enmienda de H10 de `modo-headless-cierre-limpio`; ver [`remediacion-revision.md`](remediacion-revision.md).

## Evidencia automatizada ya disponible

- Unitarios del dispatcher: `src/build-on-comando-empleado.test.ts` (U1-U10, L1-L4).
- Cableado: `src/main.test.ts` (misma instancia de `onOperaciones`; stores de la TUI distintos de los de `startWebServer`).
- Integracion con stores y base reales: `src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts` (login, confirmacion en dos turnos, logout, rol insuficiente, cero cruce web-TUI, slash entre turnos).
- Mutacion: [`mutacion-guarda-sesion.md`](mutacion-guarda-sesion.md) (M1) y [`mutacion-limpieza-logout.md`](mutacion-limpieza-logout.md) (M2).
- Remediacion de la revision (W1-W3 y hallazgos menores): [`remediacion-revision.md`](remediacion-revision.md).
- Suite completa al cierre de la remediacion: 162 archivos, 3256 tests pasados; `typecheck` y `build` en verde.

## Enlaces

- Propuesta: [`openspec/changes/operaciones-negocio-tui/proposal.md`](../../../openspec/changes/operaciones-negocio-tui/proposal.md)
- Diseno: [`openspec/changes/operaciones-negocio-tui/design.md`](../../../openspec/changes/operaciones-negocio-tui/design.md)
- Tareas: [`openspec/changes/operaciones-negocio-tui/tasks.md`](../../../openspec/changes/operaciones-negocio-tui/tasks.md)
- Specs: [`comando-empleado-tui`](../../../openspec/changes/operaciones-negocio-tui/specs/comando-empleado-tui/spec.md), [`autenticacion-empleado-tui`](../../../openspec/changes/operaciones-negocio-tui/specs/autenticacion-empleado-tui/spec.md), [`herramienta-operaciones-negocio`](../../../openspec/changes/operaciones-negocio-tui/specs/herramienta-operaciones-negocio/spec.md)
