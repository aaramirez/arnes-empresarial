---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ANALISIS-ARQUITECTURA-ClaudeCode.md"
---

# Claude Code

Claude Code es el CLI de programación con IA de Anthropic: un binario único cuya interfaz completa se renderiza en la terminal con React sobre Ink, y cuyo motor es un bucle de streaming con tool-calling contra la Anthropic Messages API.

## Arquitectura clave

- Pipeline central: entrada del usuario → parser CLI (`main.tsx`) → `QueryEngine` (streaming + bucle de herramientas) → API de Anthropic → UI de terminal (React/Ink).
- `Tool` es un hub de abstracción (69 conexiones, mayormente imports entrantes): cada herramienta empaqueta schema Zod, modelo de permisos y UI propia; se registran en `tools.ts`.
- `Message` es el vocabulario compartido entre entrypoint, QueryEngine, herramientas y extracción de memorias — el tipo central del sistema.
- Subsistemas gated por feature flags en tiempo de build (`feature()` de `bun:bundle`): Bridge IDE, MCP, coordinador multi-agente, voz — se eliminan físicamente de las builds que no los usan.
- Dos front-ends (CLI vía `REPL.tsx` y Bridge IDE vía `bridgeMain()`) comparten el mismo núcleo: state, config, auth, permisos y QueryEngine.
- Infraestructura transversal dominante: logging/telemetría (`logForDebugging()`, 1.186 edges) es el god node de mayor grado — la preocupación más conectada de todo el código.

En el marco comparativo de la [[Matriz-Comparativa]], Claude Code queda en la categoría "asistencia al desarrollador" (4,0/14): permisos y sandbox fuertes, pero sin multi-tenencia, identidad delegada ni auditoría — el sesgo "un humano, un terminal, un ciclo".

## Relevancia para nuestro arnés

Nuestro arnés corre justamente sobre el Claude Agent SDK que Claude Code expone (`src/entrypoints/sdk/`); entender su modelo de `Tool`, hooks y permisos ayuda a diseñar el núcleo de orquestación descrito en [[Componentes-e-Interfaces]].
