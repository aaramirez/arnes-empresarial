---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ARQUITECTURA_HIVE.md"
---

# Hive

Hive (Aden Agent Framework) es un framework para agentes de IA orientados a resultados y auto-adaptativos, diseñado para atacar la "crisis de verdad fundamental" de los sistemas agénticos: no hay un oráculo único y confiable para evaluar el trabajo de un agente.

## Arquitectura clave

- Modelo de swarm **Queen / Judge / Worker**: la Queen orquesta colonias de workers; el Judge evalúa cada turno; los workers ejecutan el trabajo como grafo de nodos.
- **Verificación triangulada**: combina reglas deterministas (rápidas y definitivas), evaluación semántica por LLM (con gating de confianza) y juicio humano (HITL) — en ese orden, por costo creciente.
- **Reflexion loops**: un veredicto `RETRY` inyecta feedback del juez como mensaje `[Judge feedback]` en la conversación; el agente lo ve en el siguiente turno sin reentrenar el modelo.
- **Goal-driven architecture**: objetivos (`Goal`) con `success_criteria` ponderados y `constraints` duras/blandas de primera clase, en vez de tests binarios "gameables".
- **Tool result pointer pattern**: resultados de herramientas grandes se persisten a disco y se reemplazan en la conversación por un puntero compacto (`load_data()`), que sobrevive a la compactación de contexto.

En la [[Matriz-Comparativa]], Hive puntúa 9,0/14, categoría "empresarial": es el único con HITL, constraints duros y observabilidad de negocio como primitivas — recomendado cuando la gobernanza manda.

## Relevancia para nuestro arnés

La verificación triangulada y el reflexion loop son un patrón de evaluación más maduro que un simple tool-call loop; el patrón de "puntero" para resultados grandes es aplicable a cómo el [[Componentes-e-Interfaces|Adaptador de Conocimiento]] devuelve resultados de Graphify.
