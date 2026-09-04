# Análisis de Arquitectura — Claude Code CLI

> Análisis completo de la arquitectura del proyecto, sus componentes, la función de cada uno
> y las relaciones entre ellos.
>
> Generado el 2026-08-08 combinando dos fuentes de evidencia:
> - **El grafo de conocimiento** en `graphify-out/` — 17.484 nodos, 60.519 relaciones (edges),
>   406 comunidades. Construido con extracción AST de 2.111 archivos de código fuente más
>   extracción semántica de la documentación.
> - **Investigación con fuentes primarias** sobre el stack tecnológico — ver
>   [`tech-stack-research.md`](tech-stack-research.md) para las referencias completas y citadas.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [El pipeline central](#3-el-pipeline-central)
4. [Mapa de componentes — qué hace cada parte](#4-mapa-de-componentes--qué-hace-cada-parte)
5. [Cómo se relacionan los componentes (evidencia del grafo)](#5-cómo-se-relacionan-los-componentes-evidencia-del-grafo)
6. [Subsistemas en profundidad](#6-subsistemas-en-profundidad)
7. [Infraestructura transversal (God Nodes)](#7-infraestructura-transversal-god-nodes)
8. [Hallazgos estructurales del grafo](#8-hallazgos-estructurales-del-grafo)
9. [Cómo navegar este código](#9-cómo-navegar-este-código)

---

## 1. Resumen ejecutivo

Claude Code es un **asistente de programación con IA nativo de terminal**, distribuido como un CLI
de un solo binario. Es una aplicación completamente reactiva cuya interfaz entera está construida con
**React renderizado en la terminal** (mediante Ink), y cuyo "cerebro" es un bucle de streaming con
llamadas a herramientas (tool-calling) contra la Anthropic Messages API.

A grandes rasgos, la arquitectura es un **pipeline** envuelto en una **UI reactiva** y extendido por
un conjunto de **subsistemas conectables (pluggables)**:

```
Entrada del usuario → Parser CLI → Query Engine → API de Anthropic → Bucle de herramientas → UI de terminal
                      (main.tsx)   (QueryEngine.ts)  (streaming)        (src/tools/)           (React + Ink)
```

El grafo confirma la forma y la escala del diseño:

| Métrica | Valor | Qué nos dice |
|---------|-------|--------------|
| Nodos | 17.484 | Símbolos (funciones, clases, tipos, archivos, conceptos) |
| Relaciones | 60.519 | Imports, llamadas, referencias, vínculos semánticos |
| Comunidades | 406 | Clústeres cohesivos ≈ módulos/features |
| Clústeres más grandes | Componentes UI, herramientas de Agente, servicios API | La app es **pesada en UI y en agentes** |
| God node principal | `logForDebugging()` (1.186 edges) | El logging/telemetría es la preocupación más transversal |

Las comunidades dominantes son la UI (`src/components`, ~140 componentes repartidos en varios
clústeres), el stack de la **herramienta de Agente** (`src/tools/AgentTool`) y los
**servicios/API** (`src/services`). Esto coincide con un producto cuyo trabajo es renderizar una UI
de terminal rica mientras orquesta agentes de IA e integraciones externas.

---

## 2. Stack tecnológico

El detalle completo con citas a fuentes primarias está en
[`tech-stack-research.md`](tech-stack-research.md). Resumen de cada tecnología y el rol que el grafo
muestra que cumple en este código:

| Tecnología | Rol en este proyecto | Dónde aparece (grafo) |
|------------|----------------------|------------------------|
| **Bun** | Runtime + bundler; ejecuta `.ts/.tsx` directo, genera un binario único con `--compile`; provee `bun:bundle` para feature flags en tiempo de build | `src/shims/bun-bundle.ts`, `src/types/bun-bundle.d.ts`, `feature()` |
| **esbuild** | Motor de bundling a archivo único (target Node); también sostiene a Vitest | Config de build, bundles web `terminal.js`/`terminal.css` |
| **Ink** | Renderer de React para la terminal — toda la capa de vista | `src/ink.ts`, `src/ink/components/App.tsx`, `src/components/` |
| **React** | Modelo de componentes/estado/efectos que Ink maneja | `src/components/`, `src/hooks/`, `src/context/` |
| **MCP** | El CLI es a la vez **cliente** MCP (consume herramientas externas) y **servidor** MCP (`entrypoints/mcp.ts`) | `src/services/mcp/`, `Transport` en `services/mcp/types.ts` |
| **LSP** | El CLI actúa como **cliente** LSP para info de código con conciencia del lenguaje | `src/services/lsp/` (comunidad 12) |
| **OAuth 2.0 / PKCE** | Flujo de login de cliente público para autenticarse contra la API | `src/services/oauth/`, `getClaudeAIOAuthTokens` |
| **JWT** | Tokens de auth entre el CLI y el bridge del IDE; chequeo de expiración | `src/bridge/jwtUtils.ts`, `decodeJwtExpiry()` |
| **Vitest** | Framework de tests (nativo de Vite/esbuild) | Archivos de test en todo `src/` |
| **Anthropic Messages API** | El motor de IA — streaming + tool use + prompt caching | `src/services/api/claude.ts`, `QueryEngine.ts` |

**Feature flags en tiempo de build (eliminación de código muerto).** Una decisión arquitectónica
distintiva: subsistemas enteros están detrás de `feature('FLAG')` de `bun:bundle` y se **eliminan en
tiempo de build** de las builds que no los necesitan. `feature()` vive en `src/shims/bun-bundle.ts` y
aparece como god node del grafo (251 edges) porque casi todo subsistema opcional está detrás de un
flag: `BRIDGE_MODE`, `VOICE_MODE`, `COORDINATOR_MODE`, `PROACTIVE`, `DAEMON`, entre otros.

---

## 3. El pipeline central

La travesía BFS del grafo desde el entrypoint `main()` / `run()` alcanza ~410 nodos en 2 saltos: la
columna vertebral del pipeline. Las etapas:

### 3.1 Entrypoint — `src/main.tsx` → `run()`

`main.tsx` (comunidad 44) es el punto de entrada del CLI. Parsea argumentos (Commander.js), dispara
side-effects de prefetch en paralelo (settings MDM, Keychain, preconexión a la API), inicializa el
renderer React/Ink y cede el control al REPL. `run()` está definido en `src/main.tsx:884`.

### 3.2 Inicialización — `src/entrypoints/` + `src/bootstrap/`

`init.ts` (`src/entrypoints/init.ts`) configura config, telemetría, OAuth y política MDM.
`src/bootstrap/state.ts` (comunidad 27, 123 nodos) contiene el estado global mutable en runtime y es
uno de los módulos más "importados-desde" — el sustrato de estado compartido de toda la app.

Existen entrypoints alternativos para distintos modos de ejecución:
- `src/entrypoints/mcp.ts` — correr Claude Code **como servidor MCP**.
- `src/entrypoints/sdk/` (comunidad 32, 120 nodos) — el **Agent SDK**: esquemas Zod y una API
  programática para embeber Claude Code (`coreSchemas.ts`, tipos `*Schema`).

### 3.3 Query Engine — `src/QueryEngine.ts`

El corazón de la app (clase `QueryEngine` en `src/QueryEngine.ts:184`). Su superficie pública, según
el `explain` del grafo: `.constructor()`, `.submitMessage()`, `.getMessages()`, `.setModel()`,
`.interrupt()`, `.getSessionId()`, `.getReadFileState()`, y una referencia a `FileStateCache`. Se
encarga de:
- hacer streaming de respuestas desde la API de Anthropic,
- correr el **bucle de tool-call** (ejecutar la herramienta pedida, devolver el resultado),
- gestionar thinking/effort, reintentos, conteo de tokens y contexto/compactación.

### 3.4 Sistema de herramientas — `src/Tool.ts` + `src/tools/`

`Tool` (`src/Tool.ts:362`, comunidad 7) es un **hub**: el grafo muestra 69 conexiones, casi todas
`imports` — REPL, messages, el cliente de Anthropic, permisos, `tools.ts`, el runner de agentes,
plugins y el yolo classifier dependen todos de la abstracción `Tool`. Cada herramienta empaqueta un
schema de entrada (Zod), un modelo de permisos, la lógica de ejecución y sus propios componentes de UI.
Las herramientas se registran en `src/tools.ts` (comunidad 10) y el Query Engine las descubre durante
los bucles de tool-call.

### 3.5 Sistema de comandos — `src/commands.ts` + `src/commands/`

Comandos slash de cara al usuario (`/commit`, `/review`, `/mcp`, …), en tres variantes: `PromptCommand`
(envía un prompt formateado al LLM), `LocalCommand` (in-process, devuelve texto) y `LocalJSXCommand`
(in-process, devuelve JSX de React). Registrados en `src/commands.ts` (comunidad 51).

### 3.6 UI de terminal — React + Ink

`REPL.tsx` (`src/screens/REPL.tsx`, comunidad 5) es la pantalla por defecto y la superficie viva
donde el pipeline entero renderiza. `src/ink.ts` y `src/ink/components/App.tsx` hacen el puente entre
React y la terminal. La UI es la parte más grande del código por cantidad de nodos (ver §4).

---

## 4. Mapa de componentes — qué hace cada parte

Derivado de las 406 comunidades, agrupado por preocupación. Cada fila nombra el directorio dominante,
la función de la comunidad y su tamaño (clústeres representativos).

### 4.1 Capa de UI (el área más grande)

| Área | Ubicación | Función |
|------|-----------|---------|
| Componentes base | `src/components/` (comunidades 0, 1, 16, 25, 29, …) | ~140 componentes React/Ink: menús, diálogos, visualización de mensajes, inputs, spinners |
| Design system | `src/components/design-system/` | Primitivas reutilizables (`BaseTextInput`, `TextInput`) |
| UI de permisos | `src/components/permissions/` (comunidad 17) | `AskUserQuestionPermissionRequest`, diálogos de aprobación |
| Pantallas | `src/screens/` | Modos de pantalla completa: `REPL.tsx`, `Doctor.tsx`, `ResumeConversation.tsx` |
| Hooks | `src/hooks/` (comunidades 11, 21, 23) | ~80 hooks de React: input, integración con IDE, sesión, permisos |
| Context | `src/context/` | Proveedores de context de React (notificaciones, reloj, stats) |
| UI web | `src/server/web/`, `web/` (comunidad 22) | Cliente de navegador + render de Markdown (bundle `terminal.js`) |

### 4.2 Agente y herramientas

| Área | Ubicación | Función |
|------|-----------|---------|
| Herramienta de Agente | `src/tools/AgentTool/` (comunidad 2, 235 nodos) | Crea/gestiona subagentes; `agentSummary`, `resumeAgent`, `forkSubagent` |
| Base de herramientas | `src/Tool.ts`, `src/tools.ts` | Abstracción de herramienta + registro |
| Herramienta Bash | `src/tools/BashTool/`, `src/utils/bash/` (comunidad 24) | Parseo de comandos shell, manejo de operadores de control |
| Herramienta PowerShell | `src/tools/PowerShellTool/`, `src/utils/powershell/` (comunidad 19) | Parseo/clasificación de comandos de Windows |
| Scheduling | `src/tools/ScheduleCronTool/` (comunidad 23) | Programación de tareas cron/de sesión |
| Esquemas del SDK | `src/entrypoints/sdk/` (comunidad 32) | Esquemas Zod para la API programática |

### 4.3 Servicios (integraciones externas)

| Servicio | Ubicación | Función |
|----------|-----------|---------|
| Cliente API Anthropic | `src/services/api/` (comunidad 13, 64 nodos) | `claude.ts`, cache breakpoints, bloques de system prompt, ajuste de parámetros |
| OAuth | `src/services/oauth/` | Login con authorization-code + PKCE (`auth-code-listener.ts`) |
| MCP | `src/services/mcp/` | Conexiones de cliente, `Transport`, descubrimiento de herramientas |
| LSP | `src/services/lsp/` (comunidad 12) | Manager de language server |
| Compactación | `src/services/compact/` (comunidades 4, 15) | Compresión de contexto, micro-compact, compact de memoria de sesión |
| Analytics | `src/services/analytics/` (comunidad 33) | Flags de GrowthBook, OpenTelemetry, logging de eventos |
| Memoria de sesión | `src/services/SessionMemory/` | Persistencia a nivel de sesión |
| Sugerencia de prompts | `src/services/PromptSuggestion/` (comunidad 33) | Prompts de seguimiento sugeridos |
| Límites de política | `src/services/policyLimits/` | Rate limits / cuota de la organización |

### 4.4 Plataforma / Infraestructura

| Área | Ubicación | Función |
|------|-----------|---------|
| Estado de bootstrap | `src/bootstrap/` (comunidad 27) | Estado global mutable en runtime |
| Config | `src/utils/config.ts` (comunidad 8) | `getGlobalConfig()`, `saveGlobalConfig()` |
| Bridge (IDE) | `src/bridge/` (comunidad 31, 166 nodos) | Canal bidireccional CLI↔IDE, auth JWT |
| Permisos | `src/utils/permissions/` (comunidad 9) | Decisiones de sandbox, classifier, ejecución de hooks |
| Motor de hooks | `src/utils/hooks/` (comunidad 21) | Registro de hooks async, manejadores de eventos |
| Plugins | `src/utils/plugins/` (comunidades 14, 18, 28) | Loader de plugins, marketplace, handlers de CLI |
| Skills | `src/skills/` (comunidad 18) | Skills incluidas, estilos de salida, loader de skills |
| Migraciones | `src/migrations/` (comunidad 8) | Actualizaciones de formato de config |
| Almacenamiento seguro | `src/utils/secureStorage/` (comunidad 26) | Tokens de dispositivo confiable, secretos |

---

## 5. Cómo se relacionan los componentes (evidencia del grafo)

El grafo hace concretas las relaciones. Hallazgos clave de las travesías `path`/`explain`:

### 5.1 `Message` es el hub central de datos

Los caminos más cortos entre las piezas grandes del pipeline casi siempre pasan por el **tipo `Message`**:

```
main() ──contains── main.tsx ──imports── Message ──referenced by── QueryEngine
QueryEngine ──references── Message ──imported by── extractMemories.ts ──imports── Tool
```

`Message` (en `src/types/message.ts`, comunidad 6) es el vocabulario compartido de todo el sistema:
el entrypoint, el Query Engine, las herramientas y la extracción de memorias hablan todos en términos
de `Message`. Si cambiás la forma de `Message`, esperá ondas en todo el pipeline.

### 5.2 `Tool` es un hub de imports, no de llamadas

`Tool` tiene 69 edges, en su abrumadora mayoría **`imports` entrantes** (REPL, messages, `claude.ts`,
`client.ts`, `compact.ts`, `permissions.ts`, `tools.ts`, `runAgent.ts`, `ManagePlugins.tsx`,
`yoloClassifier.ts`, `analyzeContext.ts`, …). Esta es la firma de una **abstracción/interfaz** bien
ubicada: muchos módulos dependen del contrato, y las herramientas concretas lo implementan.

### 5.3 El triángulo Query Engine ↔ API ↔ Herramientas

`QueryEngine` referencia `Message` y `FileStateCache`; el cliente API (`src/services/api/claude.ts`)
importa `Tool` y construye bloques de system prompt + cache breakpoints; las herramientas devuelven
resultados al bucle del Query Engine. Este triángulo es el núcleo en runtime: **la UI envía un
Message → QueryEngine hace streaming desde la API → la API pide una Tool → la Tool se ejecuta → el
resultado vuelve como un Message**.

### 5.4 El Bridge envuelve el mismo núcleo

`bridgeMain()` (`src/bridge/bridgeMain.ts:1980`, 57 edges) importa el mismo `state.ts`, `config.ts`,
`auth.ts`, `hooks.ts`, `permissions.ts` y `git.ts` que usa el camino del CLI, y luego llama a
`runBridgeLoop()` y `checkAndRefreshOAuthTokenIfNeeded()`. En otras palabras, el bridge del IDE es un
**segundo front-end sobre el mismo núcleo**: enruta los prompts de permisos y los mensajes a un IDE en
vez de a la terminal, pero reutiliza el QueryEngine, las Herramientas y la capa de servicios. `REPL.tsx`
y `bridgeMain()` incluso comparten utilidades (ambos tocan `errorMessage()`).

---

## 6. Subsistemas en profundidad

Los siguientes subsistemas son gated (detrás de flags), opcionales o transversales. La prosa detallada
está en [`subsystems.md`](subsystems.md); el grafo confirma sus fronteras y dependencias.

- **Bridge (Integración con IDE)** — `src/bridge/` (comunidad 31). Canal bidireccional CLI↔IDE con
  auth JWT (`jwtUtils.ts`), gestión de sesión y proxy de permisos. Detrás de `BRIDGE_MODE`.
- **MCP** — `src/services/mcp/`. Roles de cliente (consume herramientas/recursos externos) y de
  servidor (`entrypoints/mcp.ts`); JSON-RPC sobre transportes stdio / Streamable HTTP (ver research
  §5). El grafo marca un vínculo semántico entre el subsistema MCP interno y el servidor explorador
  MCP Codemaster (standalone).
- **Sistema de permisos** — `src/utils/permissions/` + `src/hooks/toolPermission/` (comunidad 9).
  Toda llamada a herramienta pasa por un chequeo de permisos: reglas con patrones wildcard, modos
  (`default`, `plan`, `bypassPermissions`, `auto`), decisiones de sandbox (`shouldUseSandbox()`) y un
  classifier especulativo.
- **Sistema de plugins** — `src/plugins/` + `src/utils/plugins/` (comunidades 14, 18, 28). Loader,
  handlers de marketplace y plugins incluidos. Descubrimiento → instalación → carga → ejecución →
  auto-update.
- **Sistema de skills** — `src/skills/` (comunidad 18). Workflows con nombre que agrupan prompts +
  configuración de herramientas; se cargan desde disco, se registran y se invocan vía `SkillTool`.
- **Sistema de tareas** — `src/tasks/`. Trabajo en background/paralelo: shell local, agentes
  locales/remotos, compañeros in-process. Respaldado por las herramientas Task*.
- **Sistema de memoria** — `src/memdir/` + `src/services/extractMemories/` (comunidad 10) +
  `SessionMemory/`. Jerarquía basada en `CLAUDE.md` más memorias auto-extraídas y sincronizadas con
  el equipo.
- **Coordinador (Multi-Agente)** — `src/coordinator/`. Orquesta agentes en paralelo; detrás de
  `COORDINATOR_MODE`.
- **Voz** — `src/voice/` + `src/services/voice*.ts`. Streaming STT; detrás de `VOICE_MODE`.
- **Capa de servicios** — `src/services/`. La superficie de integraciones externas (API, MCP, OAuth,
  LSP, analytics, compactación, límites de política, tips, sugerencia de prompts, pagos x402, …).

---

## 7. Infraestructura transversal (God Nodes)

Los nodos más conectados revelan las preocupaciones penetrantes — lo que casi todo módulo toca. Son
**infraestructura**, no features:

| Rank | Nodo | Edges | Ubicación | Preocupación |
|-----:|------|------:|-----------|--------------|
| 1 | `logForDebugging()` | 1.186 | `src/utils/debug.ts:203` | Logging de depuración |
| 2 | `logError()` | 575 | `src/utils/log.ts:158` | Logging de errores |
| 3 | `jsonStringify()` | 381 | `src/utils/slowOperations.ts:180` | Serialización segura |
| 4 | `logEvent()` | 370 | `src/services/analytics/index.ts:133` | Eventos de analytics |
| 5 | `isEnvTruthy()` | 343 | `src/utils/envUtils.ts:32` | Chequeo de flags de entorno |
| 6 | `errorMessage()` | 318 | `src/utils/errors.ts:119` | Formateo de errores |
| 7 | `getFsImplementation()` | 263 | `src/utils/fsOperations.ts:621` | Abstracción de filesystem |
| 8 | `getGlobalConfig()` | 262 | `src/utils/config.ts:1044` | Acceso a config global |
| 9 | `feature()` | 251 | `src/shims/bun-bundle.ts:39` | Feature flags en build |
| 10 | `getCwd()` | 214 | `src/utils/cwd.ts:26` | Acceso al directorio de trabajo |

**Lectura:** la cima de la lista es **observabilidad** (logging, telemetría, manejo de errores): la
preocupación más transversal de la app. Después vienen las **costuras de plataforma**: config,
filesystem, entorno, feature flags y cwd. Un cambio en cualquiera de estos tiene el radio de impacto
más amplio del código, así que merecen la revisión más cuidadosa y los tests más fuertes.

---

## 8. Hallazgos estructurales del grafo

Hechos medidos del grafo, útiles para quien mantenga el proyecto:

- **`logForDebugging()` es el puente central del sistema.** Tiene la mayor betweenness centrality
  (0,167) y enlaza ~180 comunidades. Es el lugar más probable donde un cambio afecte a módulos
  aparentemente no relacionados.
- **La UI domina por volumen.** Las comunidades más grandes son todas clústeres de `src/components`,
  seguidas por la herramienta de Agente y los servicios/API. El proyecto es pesado en UI y en agentes,
  consistente con una app de terminal reactiva que orquesta IA.
- **Existen ciclos de import y conviene vigilarlos.** El reporte marca ciclos de 1 y 2 archivos, p. ej.
  `src/utils/analyzeContext.ts ↔ src/utils/toolSearch.ts`, y los ciclos del registry de backends de
  swarm (`ITermBackend`/`TmuxBackend` ↔ `registry.ts`). Son candidatos a inversión de dependencias.
- **~3.400 nodos débilmente conectados.** Muchos símbolos tienen pocos edges — esperable en utilidades
  hoja y declaraciones solo-de-tipos, pero también una pista de dónde la documentación o el wiring
  explícito es escaso.
- **Dos front-ends, un solo núcleo.** El camino del CLI (`main.tsx` → `REPL.tsx`) y el del IDE
  (`bridgeMain()`) dependen ambos del mismo `state`, `config`, `auth`, `permissions` y QueryEngine —
  el núcleo está genuinamente compartido, no duplicado.
- **Modularidad en tiempo de build.** Los subsistemas opcionales están detrás de `feature()` y se
  eliminan físicamente de las builds que no los usan — el grafo de dependencias que se distribuye es un
  subconjunto del que se midió acá.

> ⚠️ **Nota de confianza.** Los edges de AST (imports/calls/contains) son `EXTRACTED` y confiables.
> Algunos edges `calls` cross-module en los god nodes son `INFERRED` (razonados por el modelo) y están
> marcados en `GRAPH_REPORT.md` para verificación — tratalos como pistas, no como garantías. Un grafo
> te dice DÓNDE mirar; no reemplaza leer el código en los puntos críticos.

---

## 9. Cómo navegar este código

Como existe `graphify-out/`, conviene usar queries del grafo antes que navegar el código crudo:

```bash
graphify query "how does the tool-call loop work"     # subgrafo acotado para una pregunta
graphify explain "QueryEngine"                          # un nodo + sus conexiones
graphify path "REPL.tsx" "Anthropic API client"        # relación entre dos cosas
```

Orden de lectura sugerido para alguien nuevo:
1. Este documento (el mapa) + [`architecture.md`](architecture.md) (la narrativa, en inglés).
2. [`tech-stack-research.md`](tech-stack-research.md) para entender Bun/Ink/MCP/etc. desde la fuente.
3. `src/main.tsx` → `src/QueryEngine.ts` → `src/Tool.ts` para trazar el núcleo en runtime.
4. [`subsystems.md`](subsystems.md) para el subsistema que estés tocando.
5. `graphify-out/GRAPH_REPORT.md` para god nodes, conexiones sorprendentes y ciclos de import.

---

### Fuentes

- **Grafo de conocimiento:** `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`,
  `graphify-out/graph.html` (interactivo, vista de 406 comunidades).
- **Investigación de stack con fuentes primarias:** [`tech-stack-research.md`](tech-stack-research.md).
- **Docs existentes del repo:** [`architecture.md`](architecture.md), [`subsystems.md`](subsystems.md),
  [`tools.md`](tools.md), [`commands.md`](commands.md).
