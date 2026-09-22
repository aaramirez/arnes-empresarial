---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ARQUITECTURA_codex.md"
---

# Codex CLI

Codex CLI es el *coding agent* de OpenAI que corre localmente en la terminal, escrito en Rust como un workspace Cargo de ~90 crates. Es una de varias superficies del producto Codex (CLI, IDE, escritorio, Codex Web) y es open source (Apache-2.0).

## Arquitectura clave

- `codex-core` es el cerebro: orquesta **Thread → Turn → Item**, construye el prompt/historial, llama al proveedor de modelo y aplica approvals + sandbox. `AGENTS.md` pide explícitamente no agregarle más código y crear crates nuevos en su lugar.
- Modelo de seguridad en **dos ejes ortogonales**: `sandbox_mode` (qué puede tocar el agente: `read-only`/`workspace-write`/`danger-full-access`) y `approval_policy` (cuándo pregunta: `untrusted`/`on-request`/granular/`never`).
- `execpolicy` decide `allow`/`prompt`/`forbidden` por comando con reglas de prefijo en Starlark, tomando siempre la más estricta.
- Participa en **MCP en ambos roles**: cliente (`rmcp-client`, con OAuth) y servidor (`codex mcp`, registrando las tools `codex` y `codex-reply`).
- El `app-server` expone un protocolo JSON-RPC bidireccional que consumen los SDKs de TypeScript y Python, lanzando el binario e intercambiando eventos JSONL.

En la [[Matriz-Comparativa]] Codex CLI puntúa 5,5/14, categoría "asistencia al desarrollador": gobernanza de seguridad fuerte (execpolicy/sandbox) pero local y mono-usuario, sin multi-tenencia ni auditoría forense.

## Relevancia para nuestro arnés

El modelo de dos ejes (sandbox × approval policy) es una referencia sólida para diseñar permisos y confirmaciones en nuestro Motor de Hooks (ver [[Componentes-e-Interfaces]]).
