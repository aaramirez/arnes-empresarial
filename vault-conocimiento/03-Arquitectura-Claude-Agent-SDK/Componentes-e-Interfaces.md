---
tags: [arnes, investigacion, arquitectura-sdk]
fuente: "docs/ARC42_Harness_Empresarial.md"
---

# Componentes e interfaces del arnés

Resume la Vista de Bloques del ARC42: el arnés se organiza como un **núcleo de orquestación** rodeado de **cuatro adaptadores intercambiables** (arquitectura hexagonal, puertos y adaptadores). Ningún adaptador conoce a los demás — solo al núcleo.

## Los cinco bloques (Nivel 1)

- **Núcleo de Orquestación** (`src/core/`): declara y registra agentes, subagentes, comandos, hooks y skills sobre las primitivas nativas del Claude Agent SDK; resuelve qué agente atiende el turno activo; expone el puerto `ModelProvider`.
- **Adaptador TUI** (`src/adapters/tui/`): entrada/salida por terminal, construida con Ink.
- **Adaptador de Conocimiento** (`src/adapters/knowledge/`): traduce consultas del núcleo en invocaciones a `graphify query`, vía un servidor MCP propio que envuelve esa CLI.
- **Adaptador de Memoria Compartida** (`src/adapters/memory/`): persiste el estado de negocio compartido entre agentes (casos) en SQLite embebido, correlacionado con las sesiones del SDK.
- **Adaptador A2A** (`src/adapters/a2a/`): expone el arnés como agente A2A servidor y permite actuar como cliente hacia agentes externos; sin ejercitar en el v1 (MVP lineal).

## Bloques internos del núcleo (Nivel 2-3)

- **Selector de Turno**: recibe el prompt (I1), recupera contexto (I2/I3), consulta el Registro de Agentes, dispara hooks, invoca el modelo (I5) y despacha delegaciones (I4).
- **Registro de Agentes y Subagentes**, **Registro de Comandos**, **Motor de Hooks** y **Registro de Skills**: registran, respectivamente, la configuración de cada agente, los comandos expuestos al empleado, las funciones de ciclo de vida del turno y las skills cargadas desde `.claude/skills/`.
- Dentro del Selector de Turno: Resolución de Turno → Ensamblador de Contexto → Invocador del Modelo → Despachador de Delegación (subagente in-process o Adaptador A2A externo).

## Relevancia para nuestro arnés

Esta es la estructura que efectivamente se está implementando en el repo; entender los paralelismos con [[Claude-Code]] (el propio `Tool` como hub central) y [[DeerFlow]] (frontera Harness/App verificada en CI) ayuda a no reinventar decisiones ya validadas en otros proyectos.
