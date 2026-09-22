---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ARCHITECTURE-opencode.md"
---

# OpenCode

OpenCode es un agente de codificación open source: un sistema cliente/servidor con núcleo embebible. Una única API HTTP (`HttpApi`) describe cada capacidad; la misma API se sirve en red o se ejecuta embebida en el proceso ("Embedded OpenCode"). CLI, TUI, escritorio y web son todos clientes del mismo contrato.

## Arquitectura clave

- Tres capas con dependencias dirigidas: `schema`/`protocol`/`llm` (hoja, browser-safe) → `core` (motor del agente) y `server` (host HTTP) → `client`/`sdk-next` y superficies de usuario.
- Runtime construido sobre **Effect-TS** (`ManagedRuntime`), con un `memoMap` compartido para reusar Layers entre el runtime de bootstrap y el de app.
- Núcleo de sesión V2: separa la **admisión durable de prompts** (fila `session_input`) de la **ejecución del modelo** (`SessionExecution`, global al proceso por Session-ID); un "Session Drain" ejecuta turnos hasta que no queda continuación.
- `CodeMode` ejecuta programas del modelo en un **intérprete de AST propio** (sin `eval`), confinado a herramientas explícitas — sin acceso a filesystem/red/proceso reales.
- El SDK se genera automáticamente desde el `HttpApi` público (contract-first): nunca se edita a mano.

En la [[Matriz-Comparativa]] OpenCode puntúa 9,0/14, categoría "empresarial": sesión durable que sobrevive a caídas, contrato HTTP versionable y paquetes de identidad/facturación ya presentes — recomendado como núcleo a envolver si se prioriza robustez de runtime.

## Relevancia para nuestro arnés

El patrón de admisión durable separada de la ejecución, y un contrato único consumido por todas las superficies, es un modelo a inspirar para el puerto *ModelProvider* de nuestro núcleo (ver [[Componentes-e-Interfaces]]).
