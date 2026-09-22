---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/ARQUITECTURA_deerflow.md"
---

# DeerFlow

DeerFlow es un sistema de súper-agente basado en LangGraph, full-stack: un agente "líder" que razona en horizontes largos, ejecuta código en sandbox, recuerda entre sesiones, delega en subagentes y se extiende con herramientas (built-in, MCP y de comunidad), todo aislado por hilo de conversación.

## Arquitectura clave

- Distinción estricta **Harness vs. App**, verificada en CI: `deerflow.*` (framework publicable) nunca importa `app.*` (Gateway FastAPI + canales de mensajería); la App sí puede importar el Harness.
- Topología de cuatro servicios cooperantes: Nginx (único punto de entrada), Frontend Next.js, Gateway API (FastAPI + runtime LangGraph) y un Provisioner opcional para sandbox en modo K8s.
- El comportamiento del agente vive en una **cadena de ~35 middlewares** ensamblados en orden estricto (autorización, sandbox, skills, memoria, detección de loops, clarificación humana al final), no en una función monolítica.
- Sandbox con interfaz abstracta y varios providers intercambiables (local, Docker, microVMs), con un sistema de **rutas virtuales** que el agente ve siempre igual sin importar el provider real.
- Subagentes enrutados **por beneficio**: se delega solo cuando el paralelismo o el aislamiento superan claramente el costo.

En la [[Matriz-Comparativa]] DeerFlow es el mejor puntuado (9,5/14), la elección "empresarial de fábrica" por defecto: frontera Harness/App verificada, multi-canal y K8s.

## Relevancia para nuestro arnés

La frontera Harness/App verificada en CI y la cadena de middlewares ordenada son ideas trasladables a nuestro Núcleo de Orquestación y Motor de Hooks (ver [[Componentes-e-Interfaces]]), aunque a escala mucho menor.
