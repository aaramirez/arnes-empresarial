# Exploration: Hito 5 — Delegación a subagentes

> Nota de proceso: esta exploración corrió con el rol `sdd-explore`, sin herramienta Bash disponible (no se pudo invocar `graphify query`/`explain`/`path` como pide `CLAUDE.md`). Se trabajó directo con Read/Grep/Glob sobre `docs/` y `src/`, mismo criterio documentado como precedente en `openspec/changes/hito-1.3-ventas-comisiones/specs/reembolso-evaluacion/spec.md:1`. Tampoco había `mem_save` disponible en esta sesión — el artifact store de este repo es `openspec` (archivos versionados), no `engram`.

## Corrección de la premisa inicial

El pedido original de este ciclo asumía que "Hito 5" era el cierre de la escalación de reembolsos (R3/ADR 11). Verificado contra la fuente, eso es incorrecto:

1. **La rama `hito/v1.4-tui-canal-empleado` ya está mergeada a `main`** — `git log`: `b733f98 Merge pull request #4 from aaramirez/hito/v1.4-tui-canal-empleado`, rama actual `main`, working tree limpio al inicio de la sesión.
2. **No quedaban hallazgos de review pendientes de esa primera ronda** — `docs/progreso/v1.4-tui-canal-empleado/README.md:250-271` documenta 10 hallazgos de `/code-review` (nivel `high`), los 10 cerrados en tres commits (`948e605`, `45235b9`, `bdc1350`), con TDD y reverificación manual de 22/22 pasos en verde, 978/978 tests. (Una SEGUNDA ronda de `/code-review` corrida en esta misma sesión encontró 10 hallazgos adicionales, de los cuales 6 ya se cerraron con el ciclo Implementer→Reviewer antes de esta exploración; están sin commitear sobre `main` — pendiente decidir rama para esa unidad de trabajo, fuera del alcance de este documento.)
3. **El cierre de R3 (ADR 11) que hizo `tui-canal-empleado` NO es el Hito 5 real del Plan**:
   - `openspec/changes/hito-1.3-ventas-comisiones/proposal.md:127` (ADR 11) y línea 192 (riesgo R3) dejan la resolución de la escalación de reembolso "fuera de alcance... con dueño asignado (Hito 5)" — texto escrito pensando en el Hito 5 de ese momento.
   - `tui-canal-empleado` se shippeó como **`v1.4.0`** (tag suelto confirmado en `.git/refs/tags/v1.4.0`), es decir, un hito intercalado **1.4**, no el Hito 5 de la secuencia numerada.
   - `src/core/ventas/reporte.ts:158-171` ya actualizó `NOTA_ESCALACION_FUERA_DE_BANDA` (ADR 26) para decir que SÍ hay vía de producto (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`) — ya no menciona al Hito 5.
   - **Conclusión**: R3/ADR 11 está cerrado, y lo cerró v1.4, no el Hito 5. El Hito 5 real no tiene nada que ver con reembolsos.

El Plan de Implementación (`docs/Plan_Implementacion_Harness_Empresarial.md:285-326`) define el Hito 5 como **"Delegación a subagentes"** — bot de PRs con roles separados (Planner/Developer/Reviewer) y solicitudes internas con aprobación humana (HITL). Este documento explora ese hito.

## Current State

**Definición del Plan (Hito 5, líneas 285-326):**

- Madurez del Núcleo: **v2 (subagentes)**.
- Casos de uso: (a) bot de PRs con roles separados Planner/Developer/Reviewer; (b) solicitud interna (vacaciones o gasto) con subagente validador + humano que aprueba (HITL).
- Componentes: **Despachador de Delegación (1.4)** — construido *desde este hito* con separación estructural tipo Gateway (delegación interna vs. A2A) aunque A2A recién se activa en el Hito 6 — ↔ **Delegación a Subagentes (2.2)** ↔ **Definición y Carga de Agentes (2.1)**.
- Hallazgo ya documentado en el Plan: el aislamiento de contexto del subagente es comportamiento *default* del SDK (contexto fresco, solo prompt de tarea + su propio system prompt) — la tabla `delegaciones` es para trazabilidad de negocio, no para forzar un aislamiento que ya viene gratis.
- Estructura de datos nueva: tabla `delegaciones` (`sesion_padre_id`, `sesion_subagente_id`, `tarea_delegada`, `resultado`), referenciando `sesiones_agente` del Hito 1.
- Integración: `options.agents` (`Record<string, AgentDefinition>`) del SDK — cada subagente con `description`/`prompt` obligatorios.
- Entregable funcional: el mismo caso del Hito 3 (bot de PRs) corre con delegación interna entre roles, sin reescribir el Despachador cuando llegue A2A en el Hito 6.
- Tag / carpeta: `v2.0.0` — `docs/progreso/v2.0-delegacion-subagentes/`.

**Bloques arc42 involucrados** (`docs/ARC42_Harness_Empresarial.md`):

| Bloque | Ubicación prevista | Estado real en `src/` |
|---|---|---|
| 1.4 Despachador de Delegación | `src/core/turn-selector/dispatch-delegation.ts` | **No existe el archivo** (confirmado por Glob) |
| 2.1 Definición y Carga de Agentes | `src/core/agents/definitions.ts` | Existe, pero registra **un solo agente** (`CONVERSATIONAL_AGENT`) en un `Map` — cero Planner/Developer/Reviewer |
| 2.2 Delegación a Subagentes | `src/core/agents/subagents.ts` | **No existe el archivo** |
| I4 (Núcleo ↔ Adaptador A2A) | `src/adapters/a2a/` | **Directorio inexistente** — correcto, es de Hito 6/7, no bloquea Hito 5 pero condiciona el diseño del Gateway |

`invoke-model.ts` (Hito 1) ya deja dicho en su propio doc-comment (líneas 6-9) que **no procesa `tool_use` de delegación** porque "eso pertenece al Despachador de Delegación (Hito posterior, Caja Blanca 1.4)" — es la misma pieza que el Hito 5 tiene que construir.

## Affected Areas

- **`src/core/agents/definitions.ts`** — hoy es un registro de un solo agente. Necesita sumar Planner/Developer/Reviewer (o el naming que decida el Spec Author) sin romper `getAgentDefinition`/`listAgentDefinitions` (la API ya es genérica, así que agregar entradas al `Map` no debería requerir cambiar la forma pública).
- **`src/core/turn-selector/invoke-model.ts`** — hoy no procesa `tool_use` de delegación (documentado explícitamente como fuera de su alcance). Es el punto donde el Despachador de Delegación se engancha.
- **`src/core/activity/run-activity-turn.ts` + `activity-contract.ts`** (Hito 3) — hoy invoca un **único** `runTurn` que produce un único veredicto (`aprobado`/`observado`/`resuelto`, `VEREDICTO_PREFIX` en `activity-contract.ts:55`). El caso de uso "bot de PRs con roles separados" implica que ese ciclo deje de ser un turno de un solo agente y pase a involucrar al menos un Planner y un Developer antes de llegar al veredicto — esto es un cambio de flujo real, no aditivo.
- **`src/core/ventas/ventas-contract.ts:49-63`** — hallazgo puntual y textual: el comentario sobre `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` dice literalmente *"Vive acá y no en `handle-turn.ts`... porque hoy tiene UN dueño semántico: ventas. **Cuando Hito 5 generalice el HITL, se muda** — con más de un dueño, deja de ser vocabulario de ventas."* Esto SÍ es deuda real y explícita para el Hito 5 (a diferencia de R3/ADR 11, que ya cerró v1.4). Mismo comentario aplica a `CASO_ESTADO_RESUELTO` (línea 63).
- **`src/core/ventas/resolver-escalacion-reembolso.ts`** — el único mecanismo HITL que existe hoy (aprobar/rechazar/reabrir sobre una escalación) está 100% acoplado a `VentaEstado`/`VentaStorePort`/`EscalacionListada`. No es reusable tal cual para "solicitud interna" sin generalizar — es el molde a seguir, no el código a heredar directamente.
- **`src/core/activity/activity-contract.ts:21,27-29`** — el tipo `ACTIVIDAD_TIPO_SOLICITUD_INTERNA` **ya existe** en el vocabulario canónico desde el Hito 3, pero el comentario de esa misma sección dice "este hito solo ejercita el primero (ADR 5)" (o sea, `pr_review`). No hay adaptador de entrada, ni subagente validador, ni HITL conectado a ese tipo — el nombre existe, el flujo no.
- **`src/adapters/webhooks/`** — hoy solo traduce eventos de GitHub a `pr_review`/`incidente` (ver `github-mapper.ts`); no hay un origen de eventos para "solicitud interna" (vacaciones/gasto) — habría que definir de dónde entra ese caso de uso (¿otro webhook? ¿comando de TUI, como hizo v1.4 con reembolsos?).
- **Migraciones SQLite** — no existe `delegaciones` (`src/adapters/memory/migrations/` llega hasta `0006_credenciales_empleado.ts`). Hace falta una migración `0007` nueva.

## Approaches

Decisiones de diseño abiertas — corresponden al Spec Author en la fase de propuesta:

| Decisión | Opción A | Opción B | Trade-off |
|---|---|---|---|
| Dónde vive el HITL genérico | Generalizar `resolver-escalacion-reembolso.ts` a un módulo `src/core/hitl/` (o similar) del que ventas y solicitud-interna importen | Duplicar el patrón (aprobar/rechazar/reabrir) en un módulo nuevo de solicitud-interna, sin tocar ventas todavía | La opción A es lo que el propio comentario de `ventas-contract.ts:52-54` anticipa ("cuando Hito 5 generalice"); la B es más rápida pero deja la deuda textual sin saldar |
| Cómo entra "solicitud interna" al sistema | Nuevo endpoint/adaptador dedicado | Reusar Adaptador de Webhooks (Hito 3) con un tercer origen, como ya hace con incidentes de IT | El Plan no lo especifica para Hito 5 (a diferencia del Hito 3, que sí fue explícito con GitHub); es una laguna real del Plan que el Spec Author va a tener que resolver con una decisión propia, citando el criterio ya usado en Hito 3 |
| Roles del bot de PRs | Tres agentes nombrados (Planner/Developer/Reviewer) como subagentes reales del SDK (`options.agents`), orquestados por el Despachador | Mantener un solo agente pero con distintos system prompts según fase, sin usar subagentes de verdad | Solo la primera opción ejercita realmente "Delegación a Subagentes (2.2)" y el aislamiento de contexto que el Plan pide demostrar; la segunda no cerraría el objetivo del hito |
| Alcance del Gateway (1.4) en este hito | Construir el Despachador con la bifurcación interna/A2A ya en la firma (switch/interfaz) aunque el brazo A2A lance "no implementado" | Construir solo el camino in-process y posponer la forma del Gateway al Hito 6 | El Plan es explícito (línea 291): "construido desde este hito con la separación estructural tipo Gateway... aunque A2A recién se active en el Hito 6" — la primera opción es la que el Plan pide, la segunda contradice el texto |

## Casos de uso del Hito 5 (checklist exhaustivo, según el Plan)

| # | Caso de uso / requisito (texto literal del Plan) | Soporte actual en código |
|---|---|---|
| 1 | Bot de PRs con roles separados (Planner/Developer/Reviewer) | **Nada** — `run-activity-turn.ts` sigue siendo de un solo `runTurn`; no hay definiciones de Planner/Developer/Reviewer en `definitions.ts` |
| 2 | Solicitud interna (vacaciones o gasto) con subagente validador + humano que aprueba (HITL) | **Parcial mínimo** — el tipo `ACTIVIDAD_TIPO_SOLICITUD_INTERNA` existe en el vocabulario (Hito 3) pero sin ejercitar; no hay subagente validador ni HITL conectado a ese tipo |
| 3 | Despachador de Delegación (1.4), con separación Gateway interno/A2A desde el inicio | **Nada** — archivo `dispatch-delegation.ts` no existe |
| 4 | Delegación a Subagentes (2.2) — Task/subagente nativo del SDK con contexto propio acotado | **Nada** — archivo `subagents.ts` no existe; ningún `options.agents` con más de una entrada en el código |
| 5 | Definición y Carga de Agentes (2.1) extendida a múltiples agentes | **Parcial** — el módulo y su API (`getAgentDefinition`/`listAgentDefinitions`) ya son genéricos y no necesitan romperse, pero el registro real tiene un solo agente |
| 6 | Tabla `delegaciones` (trazabilidad de la delegación) | **Nada** — no hay migración para esa tabla |
| 7 | Entregable funcional: "el mismo caso del Hito 3 corre con delegación interna, sin reescribir el Despachador cuando llegue A2A" | **No verificable aún** — depende de 1, 3 y 4 |
| — | (Ya cerrado, no es tarea de Hito 5 pese a que un ADR anterior lo asignaba ahí) R3/ADR 11 — vía de producto para cerrar escalaciones de reembolso | **Cerrado por v1.4** — `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` (ADR 21/26/29) |

## Risks

- **Deuda textual real y puntual para el Spec Author**: `src/core/ventas/ventas-contract.ts:49-63` — `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y `CASO_ESTADO_RESUELTO` están declarados explícitamente como "vocabulario de ventas hasta que Hito 5 generalice el HITL". Si la propuesta de Hito 5 no toca este archivo, el comentario queda desactualizado (mismo patrón de riesgo que `NOTA_ESCALACION_FUERA_DE_BANDA` en v1.4) — el Spec Author debería decidir explícitamente si se muda o se deja, no ignorarlo.
- **Laguna del propio Plan**: a diferencia del Hito 3 (que especifica GitHub como origen concreto del webhook), el Hito 5 no dice de dónde entra la "solicitud interna" (¿webhook?, ¿comando TUI?, ¿formulario web como Hito 4?). Es una decisión de diseño que el checkpoint humano va a tener que aprobar explícitamente, no algo que el Plan ya resolvió.
- **Gap de proceso previo (no bloqueante para Hito 5, pero visible)**: no se encontró tag `v1.3.0` (packed-refs solo tiene `v1.0.0`, `v1.1.0`, `v1.2.0`; `v1.4.0` es un tag suelto) ni `docs/progreso/v1.3-ventas-comisiones/`, pese a que `hito-1.3-ventas-comisiones` tiene su propio proposal/design/tasks completos en `openspec/`. El checklist de cierre de `AGENTS.md` (línea 103 en adelante) pide tag + carpeta de evidencia por hito. No es parte del alcance de Hito 5, pero conviene saber que ese hueco existe.
- **Convención de nombres inconsistente**: `hito-1.1-...`, `hito-1.2-...`, `hito-1.3-...` en `openspec/changes/` siguen el patrón `hito-{tag}-{nombre}`, pero el cambio de v1.4 se llamó `tui-canal-empleado` sin el prefijo `hito-1.4-`. Este documento usa `hito-2.0-delegacion-subagentes` (consistente con el tag real `v2.0.0` del Plan) — confirmado con el humano.
- **Riesgo de diseño real, no solo de proceso**: extender `run-activity-turn.ts` de "un `runTurn`" a "Planner → Developer → Reviewer" cambia el contrato de `RunActivityTurnDeps.runTurn` (hoy `(casoId, prompt) => Promise<ActivityTurnOutcome>`, un solo resultado). Esto no es un agregado aditivo — es un cambio de forma en un módulo que hoy tiene tests dedicados (`run-activity-turn.test.ts`) y que otros módulos ya consumen desde el composition root (`build-on-activity.ts`).

## Ready for Proposal

Sí, con estas condiciones para el Spec Author:

1. Confirmar con el humano el fork de "Approaches" antes de escribir el proposal — en particular, si el Gateway 1.4 se construye con el brazo A2A "presente pero no implementado" (tal como pide el texto del Plan) o se pospone.
2. Decidir explícitamente el origen del evento "solicitud interna" (el Plan no lo especifica, a diferencia de Hito 3).
3. Decidir si `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`/`CASO_ESTADO_RESUELTO` se generalizan en este hito (tal como el propio código anticipa) o se documenta por qué se difiere de nuevo.
4. El ADR de este hito debería dejar constancia de que R3/ADR 11 (reembolsos) **ya está cerrado por v1.4** y no es parte del alcance de Hito 5 — para que no se re-litigue por error.

Archivos relevantes citados (rutas relativas al repo):
- `docs/Plan_Implementacion_Harness_Empresarial.md` (líneas 285-326, Hito 5)
- `docs/ARC42_Harness_Empresarial.md` (líneas 226-370, bloques 1.4/2.1/2.2/3.1/3.2)
- `src/core/agents/definitions.ts`
- `src/core/turn-selector/invoke-model.ts` (líneas 1-25)
- `src/core/activity/run-activity-turn.ts`
- `src/core/activity/activity-contract.ts`
- `src/core/ventas/ventas-contract.ts` (líneas 44-63)
- `src/core/ventas/reporte.ts` (líneas 158-171)
- `src/core/ventas/resolver-escalacion-reembolso.ts`
- `docs/progreso/v1.4-tui-canal-empleado/README.md`
- `openspec/changes/hito-1.3-ventas-comisiones/proposal.md` (líneas 30, 127, 192 — ADR 11, R3)
