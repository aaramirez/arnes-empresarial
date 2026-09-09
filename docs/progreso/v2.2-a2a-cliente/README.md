# Hito 6 (v2.2.0) — Comunicación A2A saliente: corrección al Plan de Implementación

**Fecha de esta corrección**: 2026-09-09.

**Tareas**: [`openspec/changes/hito-2.2-a2a-cliente/tasks.md`](../../../openspec/changes/hito-2.2-a2a-cliente/tasks.md) (tarea 22 — esta nota; tarea 23, verificación manual end-to-end del entregable con la evidencia completa, todavía no ejecutada).

Esta nota documenta, en el momento en que se descubrió (fase de diseño de este hito), la corrección a dos afirmaciones del Plan de Implementación original que resultaron ser incorrectas al verificarlas contra la especificación real del protocolo A2A (`a2a-protocol.org/v1.0.0/specification/`). Ver [`design.md`](../../../openspec/changes/hito-2.2-a2a-cliente/design.md), ADR 84 y RD-27, para el detalle completo de la decisión de diseño.

> **Nota de alcance**: esta carpeta queda incompleta a propósito hasta que corra la tarea 23. La tarea 22 sólo aporta la nota de corrección; la evidencia de cierre del hito (checklist de `AGENTS.md`, tráfico JSON-RPC capturado, volcado de `delegaciones_a2a`, medición del `201`, verificación manual de los 14+4 pasos de `design.md` §11) se agrega junto a esta nota cuando se ejecute la tarea 23 — no se anticipa ni se inventa acá.

## Corrección 1 — los nombres reales de los tres métodos JSON-RPC

**Qué decía el Plan original**: citaba los tres métodos con el prefijo `a2a/` (p. ej. `a2a/sendMessage`, `a2a/getTask`, `a2a/cancelTask`), siguiendo una convención de espacio de nombres común en otras implementaciones JSON-RPC pero que no corresponde a la especificación A2A real.

**Qué es lo real**, verificado contra `a2a-protocol.org/v1.0.0/specification/` en la fase de diseño (`design.md` §6.2, tabla "Las tres llamadas"): los tres métodos son **`SendMessage`**, **`GetTask`** y **`CancelTask`** — PascalCase, **sin** ningún prefijo de espacio de nombres.

**Cómo lo maneja el código de este hito**: `src/adapters/a2a/client.ts` construye el `method` de cada sobre JSON-RPC con el literal exacto (`method: "SendMessage"` en `enviarSendMessage`, `method: "GetTask"` y `method: "CancelTask"` en el loop de polling / `intentarCancelTask`), tipado con `SobreJsonRpc<"SendMessage", ...>` / `SobreJsonRpc<"GetTask", ...>` / `SobreJsonRpc<"CancelTask", ...>`. La tabla de tests de `design.md` (`a2a/client.ts (métodos)`) cubre explícitamente que `method` es exactamente uno de esos tres valores, ninguno con el prefijo `a2a/`.

## Corrección 2 — `TaskState` tiene nueve valores, no ocho

**Qué decía el Plan original**: enumeraba ocho valores del enum `TaskState` (`SUBMITTED`, `WORKING`, `COMPLETED`, `FAILED`, `CANCELED`, `REJECTED`, `INPUT_REQUIRED`, `AUTH_REQUIRED`), igual que `exploration.md` y `proposal.md` de este mismo change.

**Qué es lo real**, verificado contra la especificación v1.0.0 real en la fase de diseño (`design.md` ADR 84 / RD-27): el enum `TaskState` define **nueve** valores — falta `TASK_STATE_UNSPECIFIED`, el valor cero de un enum proto3, que aparece cuando el campo `status.state` del peer viene ausente o vacío (no representa un estado intermedio de la tarea).

**Cómo lo maneja el código de este hito**: `src/core/agents/a2a-contract.ts` mantiene `TASK_STATES_CONOCIDOS` con los OCHO valores originales — decisión deliberada, no un olvido. `TASK_STATE_UNSPECIFIED` queda fuera de ese registro a propósito, y por lo tanto cae por la regla ya existente de "estado desconocido": `esTaskStateConocido()` lo rechaza igual que cualquier string no reconocido, y el resultado se clasifica como `reason: "protocolo"` — nunca crashea, nunca es un caso especial, nunca hace polling sobre él esperando que se resuelva. La tabla de fallas de `design.md` §9 lo deja explícito: `status.state` desconocido (incluido `TASK_STATE_UNSPECIFIED`) ⇒ `reason = "protocolo"`, valor crudo truncado en el mensaje. El test exhaustivo de `a2a-contract.test.ts` cubre los ocho conocidos + `TASK_STATE_UNSPECIFIED` + un string inventado, con los dos últimos compartiendo el mismo veredicto (`protocolo`), para que el test documente el hallazgo en vez de esconderlo.
