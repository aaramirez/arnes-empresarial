# Plan de Implementación — Harness Empresarial

*Pasantía Corta — Secuencia progresiva de hitos con casos de uso empresariales*

# Introducción

Este documento complementa a ARC42_Harness_Empresarial.docx: mientras el arc42 describe qué es el arnés (arquitectura, bloques, interfaces), este plan describe cómo se construye — en qué orden, con qué entregable funcional en cada paso, y qué caso de uso empresarial demuestra cada uno.

Toma como esqueleto el ADR 1 (Sección 9 del arc42: Estrategia de entrega incremental v1 lineal → v2 swarm → v3 grafo) y lo desarrolla hito por hito, citando siempre los bloques e interfaces ya definidos en la Vista de Bloques del arc42 en vez de inventar vocabulario nuevo.

Cada hito incluye: los casos de uso que demuestra, los componentes del arc42 que involucra y cómo se relacionan, la estructura de datos concreta que introduce, la integración concreta con el sistema externo, qué conceptos transversales fija o extiende, y el entregable funcional verificable.

# Resumen de la secuencia

| Hito | Madurez del Núcleo | Caso(s) de uso empresarial | Adaptadores/integraciones nuevas | Entregable funcional |
| --- | --- | --- | --- | --- |
| 1 | v1 (un agente) | — (esqueleto base) | Adaptador TUI + Adaptador de Memoria Compartida | El agente conversa por TUI y recuerda el historial de la sesión |
| 2 | v1 | Consulta de política interna; consulta gerencial con historial; onboarding de empleado nuevo | Adaptador de Conocimiento (Graphify) | Responde con fuente citada |
| 3 | v1 | Bot de revisión de PRs; aprobación de solicitud interna; gestión de incidentes de IT | Adaptador de Webhooks (entrante) + Adaptador de Tablero de Proyecto + tablas SQLite nuevas | Un PR real dispara revisión automática; el tablero se actualiza solo |
| 4 | v1 | Confirmación de venta y comisiones; consulta de soporte por web; solicitud de devolución/reembolso | Adaptador Web/Notificaciones + Skill de reglas de negocio de ventas | Cliente confirma por web; a fin de mes se genera el reporte comparativo |
| 5 | v2 (subagentes) | Bot de PRs con roles separados; solicitud con aprobación humana (HITL) | Delegación a Subagentes (2.2) — Despachador con separación Gateway desde el inicio | Mismo caso del Hito 3, ahora con delegación interna |
| 6 | v2 (A2A cliente) | Incidente técnico coordinado; consolidado ejecutivo de KPIs; verificación de riesgo/crédito antes de una venta grande | Cliente A2A (3.1) | El agente delega parte del diagnóstico/consulta a un agente externo |
| 7 | v3 (A2A servidor) | El arnés es invocable por agentes externos (ej. desde Compras) | Servidor A2A (3.2) | Cierra el objetivo específico 7 por completo |

*Cada hito cierra con su tag semántico y su carpeta docs/progreso/vX.Y-nombre/, conforme al ADR 1 y a la Restricción Organizacional de la Sección 2 del arc42.*

# Casos de Uso Empresariales

Los 12 casos de uso que demuestra el plan, agrupados por hito:

## Hito 2 — Consulta de conocimiento

- Consulta de política interna

- Consulta gerencial con historial

- Onboarding de empleado nuevo

## Hito 3 — Bot de revisión de PRs

- Bot de revisión de PRs

- Aprobación de solicitud interna

- Gestión de incidentes de IT

## Hito 4 — Confirmación de venta y comisiones

- Confirmación de venta y cálculo de comisiones

- Consulta de soporte por web

- Solicitud de devolución/reembolso

## Hito 5 — Delegación a subagentes

- Bot de PRs con roles separados (Planner / Developer / Reviewer)

- Solicitud interna con aprobación humana (HITL)

## Hito 6 — Comunicación A2A saliente

- Incidente técnico coordinado

- Consolidado ejecutivo de KPIs

- Verificación de riesgo/crédito antes de una venta grande

## Hito 7 — Comunicación A2A entrante

- Agente externo (ej. de Compras) consultando el arnés

# Hitos

## Hito 1: Esqueleto conversacional

**Madurez del Núcleo:** v1 (un agente)

**Caso(s) de uso empresarial:** — Ninguno todavía: este hito es fundación pura, sin caso de negocio.

**Componentes involucrados y su relación:** Adaptador TUI (I1) ↔ Núcleo — Resolución de Turno (1.1) → Ensamblador de Contexto (1.2) → Invocador del Modelo (1.3, vía I5) ↔ Adaptador de Memoria Compartida (I3). Registro de Agentes (2.1) con un solo agente definido.

***Hallazgo:*** *el Claude Agent SDK ya persiste el historial de cada conversación por su cuenta (sesiones automáticas en disco, recuperables con continue/resume) — nuestra capa SQLite no debe duplicar esa historia turno por turno. Lo que el objetivo general llama "memoria compartida" es que distintos agentes compartan el estado de un mismo caso de negocio, no la historia conversacional en sí. El Concepto Transversal 4 queda acotado a esta capa de correlación.*

**Estructura de datos:** El estado de negocio compartido entre agentes (lo que hace "compartida" a la memoria), correlacionado con las sesiones que el SDK ya persiste por su cuenta:

```
-- El estado de negocio compartido
CREATE TABLE casos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,        -- 'conversacion' | 'pr_review' | 'venta' | ...
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
 
-- Correlación entre un caso y las sesiones del SDK que participaron
CREATE TABLE sesiones_agente (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  agent_id TEXT NOT NULL,        -- agente del Registro de Agentes que corrió
  sdk_session_id TEXT NOT NULL,  -- session_id del SDK (para resume/continue)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sesiones_caso ON sesiones_agente(caso_id);
```

*Con esto, "distintos agentes leen/escriben el mismo estado de caso" (Caja Negra 4 del arc42) queda literal: varias filas de sesiones_agente, de agentes distintos, apuntando al mismo caso_id.*

**Integración concreta:** Llamada real al puerto ModelProvider (I5) mediante el Claude Agent SDK:

- **Paquete:** @anthropic-ai/claude-agent-sdk (Node.js 18+)

- **Función:** query({ prompt, options }) — generador asíncrono que itera mensajes tipados (SystemMessage, AssistantMessage, ResultMessage)

- **Autenticación:** variable de entorno ANTHROPIC_API_KEY — el SDK no la carga automáticamente desde .env, hay que setearla explícitamente antes de importar el SDK

- **Continuidad de turno:** options.continue u options.resume: <sdk_session_id> — el Invocador del Modelo (1.3) guarda el sdk_session_id en sesiones_agente; no re-envía el historial a mano

**Conceptos transversales:** Fija: modelo de datos del turno acotado a la capa de correlación caso/sesión (Concepto 4), configuración/credenciales vía variable de entorno (Concepto 2), orden de arranque de los registros (Concepto 5), política base de manejo de errores — Memoria + ModelProvider — (Concepto 1), logging/correlación base usando caso_id como identificador compartido (Concepto 3), convención de migración de esquema SQLite.

**Entregable funcional:** El agente conversa por la TUI y recuerda el historial de la sesión (Escenario de ejecución 1 del arc42).

**Tag / carpeta de progreso:** *v1.0.0 — docs/progreso/v1.0-esqueleto-conversacional/*

## Checkpoint: validación de usabilidad

Con el tutor u otro usuario real, antes de seguir construyendo encima — adelanta la Deuda 3 del arc42 (medida de usabilidad sin validar) mientras es barato hacerlo.

## Hito 2: Consulta de conocimiento

**Madurez del Núcleo:** v1

**Caso(s) de uso empresarial:** Un empleado consulta una política interna. Un gerente pregunta "¿cómo van las ventas?", combinando conocimiento y memoria de sesiones anteriores. Un empleado recién ingresado consulta el manual de onboarding y las políticas de RRHH — mismo adaptador, otro dominio de pregunta.

**Componentes involucrados y su relación:** Ensamblador de Contexto (1.2) ↔ Adaptador de Conocimiento, vía I2 → servidor MCP propio → CLI de Graphify → vault de Obsidian.

***Hallazgo:*** *Graphify no tiene servidor MCP propio — es una herramienta de línea de comandos (graphify query devuelve texto plano, no JSON). El Adaptador de Conocimiento resuelve esto exponiendo un servidor MCP propio que envuelve la CLI. La arquitectura del arc42 (Núcleo habla MCP con el adaptador) no cambia; lo que se corrige es que Graphify en sí no habla MCP nativamente.*

**Estructura de datos:** Ninguna tabla SQLite nueva en este hito — el estado del conocimiento vive en graphify-out/ (graph.json y graphify-out/memory/), fuera de nuestra base. No hay que duplicarlo.

**Integración concreta:** Servidor MCP propio (paquete @modelcontextprotocol/sdk) registrado en el Claude Agent SDK vía options.mcpServers, con una tool query_knowledge_base:

- **Consulta:** la tool ejecuta como subproceso: graphify query "<pregunta>" --graph <ruta-al-graph.json> --budget <N> — devuelve texto plano con líneas NODE <nombre> [src=... loc=... community=...]

- **Fuente citable:** el campo src (y loc) de cada nodo es la fuente que se cita en la respuesta — no hace falta parsear a JSON, se devuelve el texto tal cual como contenido de la tool

- **Cierre del loop:** después de responder, se invoca graphify save-result --question "..." --answer "..." --nodes <labels citados> — alimenta el grafo con qué nodos resultaron útiles, tal como lo prevé la propia CLI

**Conceptos transversales:** Extiende: la política de manejo de errores y el logging del Hito 1 para cubrir también al Adaptador de Conocimiento (y el subproceso de Graphify).

**Entregable funcional:** El agente responde citando la fuente del vault (Escenario de ejecución 2 del arc42).

**Tag / carpeta de progreso:** *v1.1.0 — docs/progreso/v1.1-consulta-conocimiento/*

## Hito 3: Bot de revisión de PRs

**Madurez del Núcleo:** v1

**Caso(s) de uso empresarial:** Bot de revisión de PRs. Aprobación de una solicitud interna disparada por webhook y trackeada en el mismo tablero. Gestión de incidentes de IT: una alerta de un sistema de monitoreo externo crea un ticket en el tablero y lo asigna automáticamente.

**Componentes involucrados y su relación:** Nuevo Adaptador de Webhooks (entrante, mismo molde estructural que el Servidor A2A 3.2) ↔ Núcleo — mismo Selector de Turno, ahora con el turno disparado externamente en vez de por el Empleado — ↔ nuevo Adaptador de Tablero de Proyecto (saliente).

*Decisión de diseño: el trigger (webhook) y el tablero viven los dos en GitHub — Issues con labels/assignees como tablero — para no meter un tercer sistema externo solo para esto.*

**Estructura de datos:** Tablas SQLite nuevas — actividades se liga directamente a casos del Hito 1, no se reinventa la correlación:

```
CREATE TABLE proyectos (
  id TEXT PRIMARY KEY,              -- "owner/repo" de GitHub
  nombre TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
 
CREATE TABLE responsables (
  id TEXT PRIMARY KEY,              -- login de GitHub
  nombre TEXT,
  created_at TEXT NOT NULL
);
 
CREATE TABLE actividades (
  id TEXT PRIMARY KEY,
  proyecto_id TEXT NOT NULL REFERENCES proyectos(id),
  tipo TEXT NOT NULL,                -- 'pr_review' | 'solicitud_interna' | 'incidente'
  referencia_externa TEXT NOT NULL,  -- número del Issue/PR en GitHub
  responsable_id TEXT REFERENCES responsables(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),  -- liga con el Hito 1
  estado TEXT NOT NULL,              -- 'pendiente_revision' | 'observado' | 'resuelto' | 'aprobado' — SQLite es la fuente canónica
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_actividades_proyecto ON actividades(proyecto_id);
```

**Integración concreta:** Adaptador de Webhooks (entrante):

- **Endpoint:** HTTP propio, POST /webhooks/github

- **Verificación:** firma X-Hub-Signature-256 (HMAC-SHA256 con secreto compartido) antes de aceptar el evento

- **Eventos:** pull_request (acciones opened, synchronize, reopened) e issue_comment (acción created, solo si el issue es un PR)

- **Traducción a turno:** dispara el Selector de Turno con un prompt sintético (ej. "Revisar PR #123 de owner/repo")

- **Segunda fuente (incidentes de IT):** el mismo endpoint enruta por origen del webhook (ej. header propio del sistema de monitoreo) en vez de asumir siempre GitHub; el tipo de actividades creada cambia ('pr_review' vs. 'incidente'), pero el adaptador y su forma de traducir a turno no

**Adaptador de Tablero de Proyecto (saliente):**

- **API:** REST de GitHub (Issues) — mismo sistema que el trigger en los casos de PR y solicitud interna; en incidentes de IT el trigger es externo (el monitoreo), pero el tablero sigue siendo GitHub, para no sumar un tercer sistema solo por eso

- **Estado:** actividades.estado (SQLite) es la fuente canónica, con cuatro valores; los labels de GitHub (necesita-revision → observaciones-pendientes → resuelto → aprobado) son un espejo unidireccional para que el humano lo vea en el tablero — el Núcleo nunca lee el estado desde el label

- **Asignación:** PATCH /repos/{owner}/{repo}/issues/{number}, campo assignees

**Conceptos transversales:** Fija la estrategia de concurrencia de escritura en SQLite: modo WAL (Write-Ahead Logging, permite lectores concurrentes con un escritor) + cola de escritura en memoria por proyecto_id dentro del mismo proceso Node.js, para que dos webhooks casi simultáneos no pisen la misma fila de actividades.

**Entregable funcional:** Un PR real dispara una revisión automática; cuando las observaciones quedan resueltas, el tablero se actualiza solo y se asigna la siguiente actividad.

**Tag / carpeta de progreso:** *v1.2.0 — docs/progreso/v1.2-bot-revision-prs/*

## Hito 4: Confirmación de venta y comisiones

**Madurez del Núcleo:** v1

**Caso(s) de uso empresarial:** Confirmación de venta y cálculo de comisiones. Cliente envía una consulta de soporte por la misma página web. Solicitud de devolución/reembolso: se aprueba sola si el monto está bajo un umbral, o se escala a un humano si lo supera.

**Componentes involucrados y su relación:** Nuevo Adaptador Web/Notificaciones (entrante + saliente) ↔ Núcleo ↔ nueva Skill de reglas de negocio de ventas — cálculo de comisiones, reporte, y evaluación de devolución/reembolso (Registro de Skills).

**Estructura de datos:** El caso de soporte no necesita tabla nueva — reutiliza casos (tipo 'soporte'), igual que la consulta gerencial del Hito 2. La devolución/reembolso tampoco necesita tabla nueva — reutiliza ventas, sobre la misma fila que confirmó la compra:

```
CREATE TABLE vendedores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  created_at TEXT NOT NULL
);
 
CREATE TABLE ventas (
  id TEXT PRIMARY KEY,
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  cliente_id TEXT NOT NULL,
  plan_anterior TEXT,
  plan_nuevo TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL,              -- 'pendiente_confirmacion' | 'confirmada' | 'rechazada' | 'reembolsada'
  caso_id TEXT NOT NULL REFERENCES casos(id),  -- liga con el Hito 1
  token_confirmacion TEXT NOT NULL UNIQUE,     -- para el link de la página web
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE INDEX idx_ventas_vendedor ON ventas(vendedor_id);
 
CREATE TABLE comisiones (
  id TEXT PRIMARY KEY,
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id),
  monto REAL NOT NULL,
  periodo TEXT NOT NULL,             -- 'YYYY-MM'
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comisiones_periodo ON comisiones(periodo);
```

**Integración concreta:** Adaptador Web/Notificaciones:

- **Notificación al cliente:** envío por email con un link único https://.../confirmar/{token_confirmacion}

- **Página de confirmación:** GET /confirmar/:token muestra el formulario; POST /confirmar/:token procesa la respuesta del cliente

- **Al confirmar:** actualiza ventas.estado y calcula la fila correspondiente en comisiones (monto × porcentaje fijo para el MVP — una tabla de reglas queda como posible deuda técnica futura)

- **Consulta de soporte:** mismo adaptador, otro endpoint (POST /soporte), crea un caso tipo 'soporte' en vez de una venta

- **Devolución/reembolso:** otro endpoint (POST /devolucion) sobre el mismo adaptador; reutiliza la misma Skill de reglas de negocio del cálculo de comisiones, ahora evaluando un umbral de monto — por debajo aprueba sola y actualiza ventas.estado, por encima crea un caso para que un humano lo apruebe (mismo patrón HITL del Hito 5)

*Reporte mensual: un comando del Registro de Comandos que corre a fin de mes, agrupa ventas + comisiones por vendedor_id y periodo, y genera el reporte comparativo por vendedor.*

**Conceptos transversales:** Reutiliza la estrategia de concurrencia ya fijada en el Hito 3 (WAL + cola por recurso) — acá la cola es por vendedor_id en vez de proyecto_id.

**Entregable funcional:** El cliente confirma la compra por la página web; el agente actualiza estadísticas y calcula comisiones; a fin de mes genera el reporte comparativo por vendedor.

**Tag / carpeta de progreso:** *v1.3.0 — docs/progreso/v1.3-ventas-comisiones/*

## Hito 5: Delegación a subagentes

**Madurez del Núcleo:** v2 (subagentes)

**Caso(s) de uso empresarial:** El bot de PRs, ahora con roles separados (Planner / Developer / Reviewer). Una solicitud interna (ej. vacaciones o gasto) con un subagente validador y un humano que aprueba (HITL).

**Componentes involucrados y su relación:** Despachador de Delegación (1.4), construido desde este hito con la separación estructural tipo Gateway (Delegación interna vs. A2A) aunque A2A recién se active en el Hito 6 ↔ Delegación a Subagentes (2.2) ↔ Definición y Carga de Agentes (2.1).

***Hallazgo:*** *confirmado contra la documentación oficial del SDK: el aislamiento de contexto es el comportamiento por default. El subagente arranca con contexto fresco y solo recibe el prompt de la tarea delegada (vía la tool Agent) más su propio system prompt — no el historial del padre, ni sus tool results, ni su system prompt. Nuestra arquitectura asumía esto correctamente; la tabla delegaciones sirve para trazabilidad de negocio, no para forzar un aislamiento que ya viene por default.*

**Estructura de datos:** Registra la delegación en sí — qué se le pidió al subagente (texto acotado, no el historial del padre) y qué devolvió. Ambas sesiones comparten el mismo caso_id de sesiones_agente (Hito 1):

```
CREATE TABLE delegaciones (
  id TEXT PRIMARY KEY,
  sesion_padre_id TEXT NOT NULL REFERENCES sesiones_agente(id),
  sesion_subagente_id TEXT NOT NULL REFERENCES sesiones_agente(id),
  tarea_delegada TEXT NOT NULL,      -- la tarea específica, no el historial completo
  resultado TEXT,
  created_at TEXT NOT NULL
);
```

**Integración concreta:** Subagentes definidos en options.agents (Record<string, AgentDefinition>), cada uno con description y prompt obligatorios, y opcionalmente tools, model, entre otros:

```
agents: {
  'code-reviewer': {
    description: 'Revisa PRs y genera observaciones',
    prompt: 'Sos un revisor de código...',
    tools: ['Read', 'Grep', 'Glob'],
  },
}
```

El Despachador de Delegación arma explícitamente tarea_delegada (el prompt de la tool Agent) antes de invocar al subagente. El resultado vuelve como resultado normal de la tool Agent; el campo parent_tool_use_id en los mensajes permite rastrear qué proviene de un subagente. Se registra la delegación antes de invocar, y se completa resultado cuando el subagente responde.

**Conceptos transversales:** Ninguno nuevo — se valida que la separación Gateway no rompe las convenciones ya fijadas.

**Entregable funcional:** El mismo caso del Hito 3 corre ahora con delegación interna entre roles, sin reescribir el Despachador cuando llegue el Hito 6 (Escenario de ejecución 3 del arc42).

**Tag / carpeta de progreso:** *v2.0.0 — docs/progreso/v2.0-delegacion-subagentes/*

## Hito 6: Comunicación A2A saliente

**Madurez del Núcleo:** v2 (A2A cliente)

**Caso(s) de uso empresarial:** Un incidente técnico se coordina con otro agente externo. Un agente ejecutivo consulta a otros agentes vía A2A para armar un consolidado de KPIs. Verificación de riesgo/crédito: antes de confirmar una venta grande (Hito 4), el arnés delega la consulta a un agente externo de Finanzas/Riesgo.

**Componentes involucrados y su relación:** Cliente A2A (3.1) ↔ Despachador de Delegación, vía I4 → agente externo (JSON-RPC).

**Estructura de datos:** Mismo patrón de correlación que en el Hito 1 y el Hito 5 (caso_id + tarea acotada), ahora para delegación externa:

```
CREATE TABLE delegaciones_a2a (
  id TEXT PRIMARY KEY,
  caso_id TEXT NOT NULL REFERENCES casos(id),
  agente_externo_url TEXT NOT NULL,     -- endpoint del agente externo (Agent Card)
  tarea_delegada TEXT NOT NULL,          -- texto acotado, igual que en delegaciones (Hito 5)
  a2a_task_id TEXT,                      -- id de tarea que devuelve el protocolo A2A
  estado TEXT NOT NULL,                  -- TaskState del protocolo A2A v1.0.0: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'rejected' | 'auth-required'
  resultado TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Integración concreta:** Descubrimiento: el Cliente A2A obtiene el Agent Card del agente externo — un documento JSON publicado en una URL bien conocida del agente externo, con sus capacidades y el endpoint a invocar. Protocolo: JSON-RPC 2.0 sobre HTTPS — la tarea delegada se envía como mensaje con contenido de texto, y el agente externo responde con el estado de la tarea (TaskState del protocolo: submitted → working → completed/failed, entre otros).

- **Métodos JSON-RPC (verificado contra la especificación v1.0.0, vigente):** a2a/sendMessage para delegar la tarea, a2a/getTask para consultar su estado, a2a/cancelTask si hace falta cancelarla. Nota de versión: v0.3.0 (todavía común en ejemplos y tutoriales) usaba message/send y tasks/get; v1.0.0 renombró todo el esquema con el prefijo a2a/, con cambios incompatibles respecto a v0.3.0 — confirma el riesgo de cambios de versión que este pendiente señalaba.

- **Agentes externos de prueba:** dos samples del repo oficial github.com/a2aproject/a2a-samples, cada uno corrido como su propio proceso local — el Cliente A2A es agnóstico al dominio, así que un solo agente ya alcanzaría para probar el mecanismo, pero usar dos con temática distinta hace la demo más realista para cada caso. Nota: ambos samples están en Python, no TypeScript — no es una inconsistencia con la Restricción Técnica del arc42 (esa restricción rige nuestro arnés, no a terceros), sino el punto mismo de A2A: interoperar entre agentes de stacks distintos, corriendo como procesos externos separados del código del arnés.

- **Para verificación de riesgo/crédito:** el sample langgraph (agente de conversión de moneda) — ejercita un ciclo de tarea real con herramientas (no un simple eco), es el ejemplo más citado en tutoriales de A2A, y su dominio financiero resuena con este caso.

- **Para incidente técnico / consolidado de KPIs:** el sample analytics (CrewAI) — convierte prompts en gráficos (ej. "generá un gráfico de ventas: Ene $1000, Feb $2000...") vía Matplotlib; encaja con un consolidado ejecutivo de KPIs, y también sirve para visualizar una tendencia de métricas durante el diagnóstico de un incidente.

**Conceptos transversales:** Ninguno nuevo.

**Entregable funcional:** El agente delega parte del diagnóstico o la consulta a un agente externo y recibe su resultado (Escenario de ejecución 4 del arc42).

**Tag / carpeta de progreso:** *v2.1.0 — docs/progreso/v2.1-a2a-cliente/*

## Hito 7: Comunicación A2A entrante

**Madurez del Núcleo:** v3 (A2A servidor)

**Caso(s) de uso empresarial:** El arnés mismo es invocable por agentes externos — por ejemplo, un agente de Compras de otra área que consulta el estado de un proyecto (el mismo dato que generó el Hito 3).

**Componentes involucrados y su relación:** Servidor A2A (3.2) ↔ Núcleo — entrada externa, no desde el Empleado. Mismo molde estructural que el Adaptador de Webhooks (Hito 3): un disparador externo se traduce en un turno del Selector de Turno.

**Estructura de datos:** Mapeo de una solicitud A2A entrante a un caso/turno del Núcleo, simétrico a delegaciones_a2a del Hito 6:

```
CREATE TABLE solicitudes_a2a_entrantes (
  id TEXT PRIMARY KEY,
  agente_externo_url TEXT NOT NULL,   -- quién invocó, según su Agent Card
  a2a_task_id TEXT NOT NULL,           -- id de tarea que asigna nuestro servidor
  caso_id TEXT NOT NULL REFERENCES casos(id),
  estado TEXT NOT NULL,                -- TaskState del protocolo A2A v1.0.0: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'rejected' | 'auth-required'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Integración concreta:** El Servidor A2A publica su propio Agent Card en una URL bien conocida, describiendo las capacidades del arnés. Expone un endpoint JSON-RPC (mismo protocolo que se consume como cliente en el Hito 6, ahora del otro lado). Al recibir una solicitud, la traduce a un turno del Núcleo — igual que el Adaptador de Webhooks del Hito 3.

- **Métodos JSON-RPC que implementa:** los mismos que consume el Cliente A2A del Hito 6 (v1.0.0 vigente), ahora como servidor: recibe a2a/sendMessage para aceptar la tarea, responde a a2a/getTask cuando el agente externo consulta el estado, y a a2a/cancelTask si la cancela.

- **Cómo se prueba:** no hace falta un tercer agente — se reutiliza nuestro propio Cliente A2A del Hito 6 (o el test_client.py de alguno de los samples), apuntado contra nuestro servidor en vez de contra un agente externo, para simular a "Compras" invocando el arnés.

**Conceptos transversales:** Valida la estrategia de concurrencia ya fijada en el Hito 3 bajo un nuevo patrón de tráfico (Riesgo 2 del arc42) — no se resuelve de cero, se confirma que aguanta con otra fuente externa concurrente.

**Entregable funcional:** Cierra el objetivo específico 7 del Alcance por completo: el arnés modela distintas arquitecturas de agentes aplicadas a problemas reales, y puede participar como agente invocable desde otros sistemas.

**Tag / carpeta de progreso:** *v3.0.0 — docs/progreso/v3.0-a2a-servidor/*
