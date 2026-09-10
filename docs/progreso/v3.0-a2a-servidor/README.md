# Hito 7 (v3.0.0) — Servidor A2A entrante: corrección al Plan de Implementación

**Fecha de esta corrección**: 2026-09-09.

**Tareas**: [`openspec/changes/hito-3.0-a2a-servidor/tasks.md`](../../../openspec/changes/hito-3.0-a2a-servidor/tasks.md) (tarea 20 — esta nota; tarea 21, verificación manual end-to-end del entregable con la evidencia completa, todavía no ejecutada).

Esta nota documenta, en el momento en que se descubrieron (fase de propuesta y tarea 1 de este hito), dos correcciones: (1) una afirmación del Plan de Implementación original que resultó ser incorrecta al verificarla contra la especificación real del protocolo A2A (`a2aproject/A2A`, tag `v1.0.0`), y (2) el hallazgo real de los dos códigos de error A2A-específicos verificados en la tarea 1. Ver [`proposal.md`](../../../openspec/changes/hito-3.0-a2a-servidor/proposal.md) (ADR 89) y [`design.md`](../../../openspec/changes/hito-3.0-a2a-servidor/design.md) §7.1 para el detalle completo de las decisiones de diseño.

> **Nota de alcance**: esta carpeta queda incompleta a propósito hasta que corra la tarea 21. La tarea 20 sólo aporta esta nota de corrección; la evidencia de cierre del hito (checklist de `AGENTS.md`, tráfico JSON-RPC capturado, volcado de `solicitudes_a2a_entrantes` en sus cinco estados, la corrida de concurrencia del Riesgo 2, verificación manual de los 17 pasos de `design.md` §11) se agrega junto a esta nota cuando se ejecute la tarea 21 — no se anticipa ni se inventa acá.
>
> **Actualización — tarea 21 ejecutada**: ver [`evidencia-verificacion-manual.md`](evidencia-verificacion-manual.md) — 16/17 pasos de `design.md` §11 pasaron contra el arnés real (`npm run dev`, no dobles de test); el paso 15 (cierre elegante por Ctrl+C) no pudo reproducirse tal cual en este entorno Windows, con la causa raíz documentada como hallazgo transversal (no específico de A2A).

## Corrección 1 — `agente_externo_url` no puede ser `NOT NULL`: el protocolo A2A no transporta la identidad del emisor

**Qué decía el Plan original** (`docs/Plan_Implementacion_Harness_Empresarial.md`, línea 381, sección del Hito 7):

```sql
agente_externo_url TEXT NOT NULL,   -- quién invocó, según su Agent Card
```

**Qué es lo real**, verificado contra `specification/a2a.proto` del tag `v1.0.0` de `a2aproject/A2A` en la fase de propuesta de este hito (`proposal.md`, ADR 89): `SendMessageRequest { tenant, message, configuration, metadata }` y `Message { message_id, context_id, task_id, role, parts, metadata, extensions, reference_task_ids }` — **ningún campo identifica al emisor** (`role` sólo distingue `ROLE_USER`/`ROLE_AGENT`). La identidad, según la especificación, sólo se resuelve a nivel de transporte, y ni siquiera nuestro propio Cliente A2A del Hito 6 manda algo parecido (`src/adapters/a2a/client.ts:382-393`: sólo `messageId`/`role`/`parts`). Un `NOT NULL` sobre una columna que el protocolo no puede poblar de forma conforme sólo se podía cumplir mintiendo — con un `"desconocido"` disfrazado de URL o con un header propietario (`X-A2A-Caller-Card-Url`) sin ningún consumidor real —, ambas opciones evaluadas y rechazadas en `proposal.md` ADR 89 pto 1.

**Cómo lo maneja el código de este hito**: la migración `src/adapters/memory/migrations/0011_solicitudes_a2a_entrantes.ts` (tarea 6) define la columna como **nullable**:

```sql
agente_externo_url  TEXT,
```

— y en este hito queda **siempre `NULL`**: ninguna firma de `src/adapters/memory/repository.ts` (`InsertSolicitudA2AEntranteInput`) permite poblarla. El comentario de la migración deja escrito el motivo (líneas 14-16 del archivo): *"NULLABLE, hoy SIEMPRE `NULL`: relajada respecto del Plan. El protocolo A2A v1.0.0 no transporta la identidad del emisor (ADR 89), así que no hay nada verdadero que poner ahí todavía."* El trabajo diferido con condición de disparo escrita (`proposal.md` ADR 89 pto 5) es un futuro **registro de agentes externos conocidos** (token por agente → URL de su Agent Card): recién ahí la columna se puebla con un dato en el que se puede confiar — no antes, porque una columna poblada con lo que el llamador afirma de sí mismo es peor que una columna vacía, porque parece evidencia.

Mismo tratamiento que el Hito 6 le dio a los hallazgos RD-24/RD-27 sobre otras dos afirmaciones incorrectas del Plan (ver [`docs/progreso/v2.2-a2a-cliente/README.md`](../v2.2-a2a-cliente/README.md)).

## Corrección 2 — los dos códigos de error A2A-específicos, verificados contra la especificación real (RD-37)

El Plan de Implementación no especificaba códigos de error JSON-RPC para "tarea no encontrada" ni "tarea no cancelable" — la tarea 1 de este hito (`src/adapters/a2a/server-config.ts`) necesitaba definirlos, y el criterio fijado en `design.md`/`tasks.md` (ADR 94 pto 9-10, RD-37) fue: si la especificación real define códigos propios para esos dos casos, usar esos literales; si no, usar dos valores del rango reservado `-32000..-32099` (errores de implementación por JSON-RPC 2.0).

**Qué es lo real**, verificado contra `docs/specification.md` del tag `v1.0.0` de `a2aproject/A2A` (Sección 5.4, "Error Code Mappings"):

- `TaskNotFoundError` → **`-32001`**
- `TaskNotCancelableError` → **`-32002`**

La especificación sí define códigos propios y literales para ambos casos, así que se usan tal cual en `src/adapters/a2a/server-config.ts` (líneas 54-66) — no son valores libres elegidos del rango reservado:

```ts
export const A2A_ERROR_TASK_NOT_FOUND = -32001;
export const A2A_ERROR_TASK_NOT_CANCELABLE = -32002;
```

`src/adapters/a2a/server-config.test.ts` fija ambos valores en un test dedicado: *"las dos constantes A2A-específicas son los valores literales de docs/specification.md v1.0.0 (TaskNotFoundError/TaskNotCancelableError, RD-37)"*.

**Nota de trazabilidad (ambigüedad declarada, no resuelta con una fuente inventada)**: `design.md`/`tasks.md` (tarea 1) pedían verificar estos dos valores contra **`specification/a2a.proto` Y `docs/specification.md`**, ambos del tag `v1.0.0` — mismo procedimiento que resolvió RD-24 en el Hito 6. El comentario del código fuente y el test de la tarea 1 sólo dejan citada explícitamente `docs/specification.md` §5.4 (la tabla "Error Code Mappings" y su ejemplo de payload); ni el código ni el mensaje del commit `4d34794` (`feat(adapters/a2a): agrega server-config con rutas, metodos y codigos de error JSON-RPC (Hito 7, tarea 1)`) dejan una cita explícita equivalente contra `a2a.proto`. Se anota tal cual quedó, sin inventar una segunda fuente que no está citada en el código: el valor documentado y trazable de este hito es el de `docs/specification.md`.
