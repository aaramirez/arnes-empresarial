---
tags: [arnes, investigacion, arquitectura-sdk, mensajes-sdk]
fuente: "docs/Investigacion Pre-proyecto/Referencia-Claude-Agent-SDK-Mensajes-y-Flujos.md"
---

# Tipos de mensaje del SDK (`SDKMessage`)

Síntesis del catálogo verificado contra las definiciones de tipos de `@anthropic-ai/claude-agent-sdk` **0.3.248** (la propuesta fija 0.3.221; `package.json` del proyecto declara `^0.3.248`). `query()` devuelve un `Query`: un generador asíncrono de `SDKMessage` con métodos de control. La unión `SDKMessage` tiene **39 variantes**: 28 con `type: "system"` (distinguidas por `subtype`) y 11 con otro `type`. El propio tipo advierte que el conjunto crece, y que hay que ignorar lo desconocido.

## Tipos más importantes

| `type` / `subtype` | Contenido clave | Cuándo llega |
|---|---|---|
| `system` / `init` | `session_id`, `model`, `tools`, `mcp_servers`, `skills`, `permissionMode` | Al inicio de cada turno |
| `assistant` | `message` (un bloque por mensaje), `parent_tool_use_id` | Durante el turno; `parent_tool_use_id` no nulo indica actividad de un sub-agente |
| `user` | `message` con `tool_result` | Resultados de herramientas |
| `stream_event` | Eventos de streaming de la API | Solo con `includePartialMessages` |
| `result` / `success` | `result` (texto final), `is_error`, `usage`, `total_cost_usd`, `num_turns` | Uno por turno; con `is_error: true` el texto es un error de API |
| `result` / `error_*` | `errors`, `terminal_reason` (sin campo `result`) | `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` |
| `system` / `compact_boundary`, `api_retry`, `task_*`, `permission_denied` | Compactación, reintentos, tareas de sub-agentes, herramientas denegadas | Según ocurra |

## Los tres que el arnés consume

El bucle de `invoke-model.ts` solo actúa sobre estos mensajes:

1. `system/init`: guarda `session_id`, que luego se persiste en `sesiones_agente` para reanudar con `resume`.
2. `result/success` con `is_error` falso: guarda `result` como texto de la respuesta.
3. `assistant` con `parent_tool_use_id` no nulo: registra la actividad de un sub-agente.

Todo lo demás se ignora. Si falta el `session_id` o el texto, o llega un `result` de error o con `is_error: true`, se lanza `ModelResponseIncompleteError` y el turno se marca fallido en la etapa `model`.

## Relevancia para nuestro arnés

- El arnés no usa los 31 hooks nativos del SDK (`HookEvent`): tiene un motor propio con `PRE_TURN` y `POST_TURN`.
- No maneja `stream_event`, y no captura `usage` ni `total_cost_usd`: el costo por turno no es observable hoy.
- La delegación del arnés no pasa por una tool call del modelo: la orquesta el despachador propio. El agente conversacional no tiene la herramienta `Agent`, por lo que `parent_tool_use_id` casi nunca se puebla.
- Los flujos completos (turno nuevo, reanudado, conocimiento MCP, sub-agentes, errores) están en el documento fuente y complementan [[Mensajes-y-Flujos]] (interfaces I1-I5) y [[Componentes-e-Interfaces]] (Vista de Bloques).
- El SDK se distribuye como paquete de Node y controla un proceso de Claude Code: coherente con la elección documentada en [[Node-vs-Go]].
