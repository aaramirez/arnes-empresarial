---
tags: [arnes, investigacion, arquitectura-sdk]
fuente: "docs/ARC42_Harness_Empresarial.md"
---

# Mensajes y flujos del arnés

Resume el catálogo de interfaces (I1-I5) y los escenarios de ejecución del ARC42 del proyecto: cómo viaja un mensaje desde que el empleado lo escribe hasta que vuelve como respuesta citada.

## Catálogo de interfaces

- **I1 — Núcleo ↔ Adaptador TUI**: prompt del empleado / respuesta renderizada con estado del agente. Texto en lenguaje natural, canal interno del mismo proceso Node.js.
- **I2 — Núcleo ↔ Adaptador de Conocimiento**: consulta al vault / resultado con fuente y fragmento citado. Texto plano estructurado, vía un servidor MCP propio que envuelve la CLI de Graphify.
- **I3 — Núcleo ↔ Adaptador de Memoria Compartida**: lectura/escritura del estado de negocio (casos), correlacionado con las sesiones que gestiona el SDK. Consultas SQL sobre SQLite local.
- **I4 — Núcleo ↔ Adaptador A2A**: delegación/coordinación con agentes externos. JSON-RPC sobre el protocolo A2A.
- **I5 — Núcleo ↔ puerto ModelProvider**: solicitud de razonamiento (prompt + herramientas) / respuesta del modelo. Llamadas del Claude Agent SDK a la Anthropic Messages API por HTTPS.

## Escenarios de ejecución

- **Turno conversacional básico**: TUI → I1 → Resolución de Turno → Ensamblador de Contexto lee I3 → Invocador del Modelo llama I5 → hooks de post-turno → escritura en I3 → respuesta por I1. Es el único punto que cruza a un sistema externo real (Anthropic API); todo lo demás ocurre in-process.
- **Consulta a la base de conocimiento**: el Ensamblador de Contexto envía la consulta por I2 al Adaptador de Conocimiento, que invoca `graphify query`; Graphify devuelve nodos con archivo y ubicación de origen (src/loc) — la fuente citable que sostiene la Meta de Observabilidad.
- **Delegación a un subagente**: el modelo devuelve una tool call de delegación; el Despachador de Delegación instancia el subagente con contexto propio y acotado (no hereda el historial del padre), y su resultado vuelve como resultado de tool call al turno del agente padre. Este escenario habilita la variante swarm (v2); no se ejercita en el MVP lineal v1.

## Relevancia para nuestro arnés

Este catálogo I1-I5 es el contrato explícito que mantiene desacoplados los adaptadores del núcleo (ver [[Componentes-e-Interfaces]]); ningún adaptador se comunica con otro directamente, solo a través de estas interfaces — la condición que sostiene la Meta de Extensibilidad del ARC42.

Ver también: [[Tipos-de-Mensaje-SDK]]
