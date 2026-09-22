---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ARQUITECTURA-MEMU.md"
---

# memU

memU es un sistema de memoria persistente y liviano para agentes de IA: una "wiki" de memoria compartida entre sesiones, agentes y dispositivos, que además destila *skills* reutilizables del historial. Se instala como *sidecar* de agentes de escritorio (Codex, Claude Code, Cursor, …) y no tiene LLM propio — solo embeddings para indexar y buscar.

## Arquitectura clave

- Dos costuras (seams): **record** (capturar y destilar historial en memoria/skills) e **inject** (traer memoria relevante antes de responder).
- Superficie agéntica de solo tres operaciones (`list_all_recall_files`, `progressive_retrieve`, `commit_results`), satisfecha por dos implementaciones intercambiables: `MemoryService` (local) y `CloudMemoryClient` (HTTP).
- Almacenamiento pluggable detrás del protocolo `Database`: `inmemory`, `sqlite` o `postgres` (con pgvector), elegible por config sin cambiar el código que lo consume.
- `TranscriptSource` es la única abstracción que varía por host — declara cómo descubrir y clasificar sesiones de cada agente anfitrión.
- Regla anti-auto-minado: el propio run de bridging corre como sesión del host, así que su identidad se filtra explícitamente para no retroalimentarse a sí mismo.

Según la [[Matriz-Comparativa]], memU **no es un harness** — es un complemento de memoria a largo plazo (criterio C9) que ningún harness resuelve tan bien, pensado para combinarse con un núcleo como DeerFlow u OpenCode.

## Relevancia para nuestro arnés

El patrón *record/inject* desacoplado del motor de razonamiento, y el almacenamiento pluggable detrás de un protocolo mínimo, son ideas directamente aplicables al [[Componentes-e-Interfaces|Adaptador de Memoria Compartida]] de nuestro diseño, aunque nuestro MVP usa SQLite embebido sin capa cloud.
