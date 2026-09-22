---
tags: [arnes, investigacion, moc]
---

# MOC — Estudio comparativo de arneses

Mapa de navegación para la investigación de ocho arneses/frameworks de agentes de IA, evaluados contra un marco de catorce criterios empresariales (activación, persistencia de sesión, multi-tenencia, auditoría, gobernanza, etc.). Ver la síntesis completa en [[Matriz-Comparativa]].

## Harnesses reales (evaluados contra los 14 criterios)

- [[DeerFlow]] — súper-agente LangGraph full-stack; el mejor puntuado (9,5/14), "empresarial de fábrica".
- [[Opencode]] — sistema cliente/servidor Effect-TS con sesión durable V2; el mejor núcleo para envolver (9,0/14).
- [[Hive]] — swarm Queen/Judge/Worker orientado a resultados, con HITL y verificación triangulada (9,0/14).
- [[Codex]] — CLI de OpenAI en Rust, gobernanza de seguridad fuerte pero local y mono-usuario (5,5/14).
- [[Claude-Code]] — CLI de Anthropic, arquetipo del asistente interactivo de terminal (4,0/14).

## Fuera de categoría (no son harness)

- [[MEMU]] — sidecar de memoria persistente sin LLM propio; resuelve mejor que nadie la memoria a largo plazo.
- [[OpenHands]] — solo el frontend (Agent Canvas); el runtime real es el Agent Server, ausente del análisis.

## Relevancia para nuestro arnés

Este estudio es el resultado del objetivo específico 1 de la propuesta de pasantía y alimenta las decisiones de diseño documentadas en [[Vision-General]].
