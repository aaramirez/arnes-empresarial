# Pi Agent Harness — Análisis de arquitectura desde el grafo de graphify

> Documento generado a partir del grafo de conocimiento de **graphify** (`graphify-out/`), reconstruido sobre el commit `4181f66e`.
> Estadísticas exactas del grafo: **15.299 nodos · 31.826 aristas · 953 comunidades** (751 mostradas, 202 "thin" omitidas) sobre 1.302 archivos (~1,25 M palabras). Extracción: 99 % EXTRACTED · 1 % INFERRED.
> Todo lo que sigue está trazado a fuentes primarias: consultas a la CLI de graphify, secciones del `GRAPH_REPORT.md`, y los archivos reales de `packages/*/src`. Cada afirmación cita su origen. Es un sucesor natural de `pi-arquitectura.md` y `pi-arquitectura-detallada.md`, pero recalculado sobre el grafo FRESCO.

---

## 1. Qué es Pi Agent Harness

**Pi** es un **agente de código con IA que corre en la terminal**, publicado como monorepo de npm bajo el scope `@earendil-works/*`. El `README.md` lo define en una línea: *"the home of the Pi agent harness project including our self extensible coding agent"*. En criollo: le hablás desde la consola, el mensaje va a un modelo de lenguaje (Anthropic, OpenAI, Google, Bedrock, Azure, OpenRouter, Mistral…), el modelo decide qué herramientas usar (leer, correr bash, editar, buscar), y todo se dibuja en una interfaz de terminal con historial de sesión persistente.

La idea de fondo — verificable en la estructura del grafo — es que **el harness del agente, la capa de IA y la UI de terminal son piezas independientes y reutilizables**. Cada una es un paquete con una responsabilidad clara. Eso es lo que permite que el mismo motor de agente se use desde la CLI interactiva, desde un servidor remoto o embebido como SDK.

Fuente: `README.md` (encabezado y tabla "All Packages"), `graphify-out/GRAPH_REPORT.md` (sección Summary).

---

## 2. Arquitectura en capas

El grafo agrupa el código en capas que se comunican de arriba hacia abajo. La regla que sostiene todo: **ninguna capa de abajo conoce a las de arriba**. Se verifica en el mapa de dependencias entre paquetes (§6.2) — ninguna arista de importación apunta hacia arriba.

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTACIÓN            packages/tui                         │
│  Renderizado diferencial · Component · TUI · layout · editor │
│  temas · imágenes · teclado                                  │
└───────────────▲─────────────────────────────────────────────┘
                │ Component / TUI (god nodes, referenciados por InteractiveMode)
┌───────────────┴─────────────────────────────────────────────┐
│  APLICACIÓN / CLI        packages/coding-agent               │
│  InteractiveMode · SettingsManager · SessionManager          │
│  AgentSession · ModelRuntime · tools (read/bash/edit/find)   │
│  extensiones · compactación · resource-loader                │
└───────────────▲─────────────────────────────────────────────┘
                │ AgentSession → Agent / Harness (referencia + import)
┌───────────────┴─────────────────────────────────────────────┐
│  MOTOR DE AGENTE         packages/agent                      │
│  Agent · agent-loop · harness (reducer · lanes · state)      │
│  AgentMessage (el "lenguaje común")                          │
└───────────────▲─────────────────────────────────────────────┘
                │ ModelRuntime → ApiProvider / Model (god nodes de ai)
┌───────────────┴─────────────────────────────────────────────┐
│  ABSTRACCIÓN DE IA       packages/ai                         │
│  ApiProvider · registro de proveedores · stream/lazyStream   │
│  auth OAuth · catálogo de modelos · formateo de errores      │
└───────────────▲─────────────────────────────────────────────┘
                │
┌───────────────┴──────────────┬──────────────────────────────┐
│  TRANSPORTE / PERSISTENCIA    │  INFRAESTRUCTURA              │
│  protocol · client · server  │  session-backends/sqlite-node │
│  (CBOR sobre bytes enmarcados)│  telemetry · evals            │
└──────────────────────────────┴──────────────────────────────┘
```

Fuente del diagrama: consultas `graphify explain "InteractiveMode"`, `graphify explain "AgentSession"`, `graphify path "AgentSession" "Model"`, `graphify path "ModelRuntime" "ApiProvider"`, más el mapa de dependencias del `README.md`.

---

## 3. Los componentes (paquetes) y su función

El monorepo tiene **diez paquetes** bajo `packages/`. Nombres y descripciones tomados textualmente de cada `package.json` y del `README.md`.

| Paquete | Nombre npm | Descripción (de su `package.json`) |
|---|---|---|
| **`coding-agent`** | `@earendil-works/pi-coding-agent` | "Coding agent CLI with read, bash, edit, write tools and session management". **El producto.** Orquesta todo. |
| **`agent`** | `@earendil-works/pi-agent-core` | "General-purpose agent with transport abstraction, state management, and attachment support". **Motor genérico**, sin dominio. |
| **`ai`** | `@earendil-works/pi-ai` | "Unified LLM API with automatic model discovery and provider configuration". **Capa multi-proveedor.** |
| **`tui`** | `@earendil-works/pi-tui` | "Terminal User Interface library with differential rendering for efficient text-based applications". **UI de terminal.** |
| **`telemetry`** | `@earendil-works/pi-telemetry` | "Vendor-neutral telemetry contracts and typed schema utilities for pi". **Observabilidad neutral.** |
| **`protocol`** | `@earendil-works/pi-protocol` | "Transport-neutral CBOR protocol for remote pi sessions". **Formato del cable.** |
| **`client`** | `@earendil-works/pi-client` | "Transport-neutral client for remote pi sessions over framed CBOR bytes". **Cliente remoto.** |
| **`server`** | `@earendil-works/pi-server` | "experimental server package for pi". **Servidor** (experimental). |
| **`session-backends`** | *(scope)* | Contiene el subpaquete `sqlite-node`: **persistencia de sesiones en SQLite.** |
| **`evals`** | `@earendil-works/pi-evals` | **Evaluaciones** del comportamiento del agente. |

Fuente: `packages/*/package.json`, `README.md` (tabla "All Packages"), `ls packages/session-backends/`.

### Mapeo comunidad de graphify → componente real

El grafo detectó 953 comunidades. Las principales (hubs de navegación del `GRAPH_REPORT.md`) mapean directamente a subsistemas reales:

| Componente | Comunidades de graphify (fresh) |
|---|---|
| **Motor de agente** (`agent`) | 12 *Agent Session Lifecycle*, 13 *Agent Harness Reducer*, 15 *Agent Lanes & State*, 2 *Compaction & Extension Bindings*, 0 *Agent Messages & Loaders* |
| **Capa de IA** (`ai`) | 7 *AI Provider API Core*, 17 *AI Provider Registry*, 8 *Provider Auth (OAuth)*, 14 *AI Node Context & Env*, 11 *AI Error Formatting & Clients*, 5 *AI Streaming Tests*, *Lazy Provider APIs*, *Model Catalogs*, *Builtin Providers*, y una comunidad por proveedor: *Anthropic Messages API*, *OpenAI Completions & Caching*, *OpenAI Codex Provider*, *AWS Bedrock Provider*, *Azure OpenAI Provider*, *OpenRouter & Auth Resolution* |
| **TUI** (`tui`) | 9 *TUI Box Layout*, 10 *TUI Editor Rendering*, *TUI Editor State*, *TUI Editor Autocomplete*, *TUI Image Rendering* |
| **CLI / runtime** (`coding-agent`) | 16 *CLI Argument Parsing*, *CLI Startup & Sandbox*, 3 *Runtime & Built-in Tools*, 4 *Keybindings*, *Session Picker & Loading*, *Theme Detection & Startup*, *Resource Loading & Diagnostics* |
| **Persistencia / sesión** | 6 *SQLite Session Backend*, 1 *Session Auth & Events* |
| **Observabilidad** | *Telemetry Spans* |

Fuente: `graphify-out/GRAPH_REPORT.md` (secciones "Community Hubs" y "Communities"), consultas `graphify explain`.

---

## 4. Los god nodes (abstracciones centrales)

graphify identifica los nodos más conectados: si tocás uno de estos, tocás medio sistema. El `GRAPH_REPORT.md` lista 10 en su sección "God Nodes", pero los cuatro primeros por grado bruto son archivos `Changelog` (271, 197, 183, 182 aristas) — **ruido documental**, no abstracciones de código. Filtrando esos, este es el ranking real de god nodes de código, con `file:line`, grado y comunidad confirmados vía `graphify explain`:

| # | God node | Aristas | `file:line` | Comunidad | Rol |
|---|---|---|---|---|---|
| 1 | `InteractiveMode` | 231 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:385` | 39 | Orquestador del modo interactivo: une TUI + sesión + settings + tema. El main-loop de la experiencia. |
| 2 | `SettingsManager` | 210 | `packages/coding-agent/src/core/settings-manager.ts:281` | 53 | Fuente única de configuración; casi todo la consulta. |
| 3 | `AgentSession` | 168 | `packages/coding-agent/src/core/agent-session.ts:305` | 12 | La bisagra del sistema: una conversación viva. Cruza capas. |
| 4 | `Component` | 155 | `packages/tui/src/tui.ts:23` | 9 | Unidad base de la TUI (todo lo que se dibuja). |
| 5 | `Theme` | 125 | `packages/coding-agent/src/modes/interactive/theme/theme.ts:338` | 156 | Tematización transversal a toda la interfaz. |
| 6 | `TUI` | 122 | `packages/tui/src/tui.ts:291` | 51 | Runtime de la interfaz de terminal. |
| 7 | `SessionManager` | 117 | `packages/coding-agent/src/core/session-manager.ts:855` | 50 | Ciclo de vida y persistencia de sesiones. |
| 8 | `DefaultPackageManager` | 111 | `packages/coding-agent/src/core/package-manager.ts:779` | 120 | Resolución/instalación de dependencias de extensiones. |
| 9 | `ExtensionAPI` | 101 | `packages/coding-agent/src/core/extensions/types.ts:1198` | 78 | Superficie pública para extensiones de terceros. |
| 10 | `AgentMessage` | 84 | `packages/agent/src/types.ts:325` | 2 | El tipo de mensaje que fluye por todo el sistema: el "lenguaje común" entre capas. |

**Lectura clave:** los tres primeros (`InteractiveMode`, `SettingsManager`, `AgentSession`) son el triángulo sobre el que gira el producto. `AgentSession` es la única que cruza capas de verdad — abajo referencia `ModelRuntime` (hacia `ai`) y `Agent` (hacia el motor), arriba la importa `InteractiveMode` y la TUI.

Un dato interesante del grafo fresco: `AgentSession` vive en la comunidad 12, *Agent Session Lifecycle*, una comunidad chica y muy cohesionada de solo 6 nodos (`AgentSession`, `estimateMessagesTokens()`, `withoutDeletedHeaders()`, `wrapRegisteredTools()`, `resolveSystemPrompt()`, `modelsAreEqual()`). Eso confirma que la sesión tiene un núcleo compacto y bien delimitado, aunque irradie 168 aristas hacia afuera.

Fuente: `graphify-out/GRAPH_REPORT.md` (sección "God Nodes"), `graphify explain "AgentSession"`, `graphify explain "InteractiveMode"`, `graphify explain "SettingsManager"`, `graphify explain "Component"`, `graphify explain "TUI"`, `graphify explain "Theme"`, `graphify explain "SessionManager"`, `graphify explain "DefaultPackageManager"`, `graphify explain "ExtensionAPI"`, `graphify explain "AgentMessage"`, `graphify explain "Agent"`.

---

## 5. Las funciones y clases clave por componente

Focalizado en god nodes y nodos de alto grado. `file:line` verificado vía graphify.

### 5.1 `coding-agent` — la aplicación

| Símbolo | `file:line` | Propósito (una línea) |
|---|---|---|
| `InteractiveMode` | `modes/interactive/interactive-mode.ts:385` | Clase orquestadora; expone `.init()`, `.handleEvent()`, `.showStatus()`. Referencia `Component`, `TUI`, `Container`, `Text`, `TuiAltScreen`, `TuiMainScreen`, `KeybindingsManager`, `Spacer`, `FooterDataProvider`. |
| `AgentSession` | `core/agent-session.ts:305` | Conversación viva; método `.modelRuntime()` (L405). Referencia `SettingsManager`, `SessionManager`, `ExtensionRunner`, `ModelRuntime`, `Agent`, `AgentTool`, `ToolDefinition`. |
| `SettingsManager` | `core/settings-manager.ts:281` | Configuración única del sistema. |
| `SessionManager` | `core/session-manager.ts:855` | Ciclo de vida + persistencia de sesiones (delega en SQLite). |
| `DefaultPackageManager` | `core/package-manager.ts:779` | Instala/resuelve dependencias de extensiones; referencia `SettingsManager`. |
| `ExtensionAPI` | `core/extensions/types.ts:1198` | Contrato público de extensiones. |
| `Theme` / `initTheme()` | `modes/interactive/theme/theme.ts:338` | Tema compartido; importado por `interactive-mode.ts`, `agent-session.ts`, `resource-loader.ts`, `read.ts`, `bash.ts`, `startup-ui.ts`, `settings-selector.ts`. |
| Herramientas built-in | `core/tools/` (comunidad 3, *Runtime & Built-in Tools*) | `read.ts`, `bash.ts`, `edit.ts`, `find.ts`, `grep.ts`. Se registran vía `createBuiltInTools()`. |
| Punto de entrada | `main.ts` (comunidad 16, *CLI Argument Parsing*) | Parsea args con `parseArgs()`/`printHelp()`, elige `Mode` (interactive / json / rpc / sdk). No ejecuta lógica de agente. |

### 5.2 `agent` — el motor genérico

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `Agent` | `packages/agent/src/agent.ts:173` | Bucle central: recibe estado, pide el próximo paso al modelo, aplica herramientas, repite. Grado 57, comunidad 160. |
| `AgentMessage` | `packages/agent/src/types.ts:325` | Tipo de mensaje que atraviesa todo el sistema. Grado 84, comunidad 2. |
| Harness reducer | comunidad 13, *Agent Harness Reducer* | Máquina de estados funcional: `deriveEffectiveConfiguration()`, `deriveToolBatch()`, `bySequence()`, `clone()`. |
| Lanes & state | comunidad 15, *Agent Lanes & State* | `AgentLane`, `LaneSnapshot`, `LaneState`, `createRepository()`, con invariantes (`assertJsonSerializable()`). Carriles de ejecución aislados. |

El estado del harness es **JSON-serializable** — por eso la sesión se puede persistir (§7.1, SQLite) y transportar (§5.5 y §7.2, CBOR).

### 5.3 `ai` — abstracción de proveedores LLM

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `ApiProvider` / contrato | `packages/ai/src/compat.ts` (comunidad 7, *AI Provider API Core*) | Contrato que todo proveedor implementa; `complete()`, `stream()`, `lazyStream()`. |
| Tipos base | `packages/ai/src/types.ts` (comunidad 43) | `StreamOptions` (L175), `SimpleStreamOptions` (L304), `StreamFunction` (L320). |
| `Model` / `Provider` | `packages/ai/src/models.ts` (comunidad 26) | Representación de modelo y proveedor; catálogo de modelos. |
| Proveedores concretos | `packages/ai/src/api/` | `anthropic-messages.ts`, `openai-completions.ts`, `openai-responses.ts`, `openai-codex-responses.ts`, `bedrock-converse-stream.ts`, `azure-openai-responses.ts`, `google-generative-ai.ts`, `google-vertex.ts`, `mistral-conversations.ts`, `pi-messages.ts`. Cada uno adapta el contrato `ApiProvider` a su API real. |
| Proveedor faux | `packages/ai/src/providers/faux.ts` (comunidad 112) | Proveedor falso para tests sin red ni API keys. |
| Auth OAuth | comunidad 8, *Provider Auth (OAuth)* | `createAuthorizationFlow()`, `exchangeAuthorizationCode()`, flujo OAuth con servidor de callback local. |
| Resolución de credenciales | comunidad 14, *AI Node Context & Env* | `resolveApiKey()`, `readCredential()`, `overlayEnvAuthContext()`. Entorno / archivo / keychain. |

### 5.4 `tui` — interfaz de terminal

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `Component` | `packages/tui/src/tui.ts:23` | Unidad base del árbol de componentes. |
| `TUI` | `packages/tui/src/tui.ts:291` | Runtime de la interfaz; renderizado diferencial (solo redibuja lo que cambió). |
| Layout | `packages/tui/src/layout.ts` | `getScrollViewBox()`, `getScrollViewsAt()`; primitivas vstack/hstack/scrollview/viewport. |
| Editor | comunidades 10/29/*Autocomplete* | `Editor`, `EditorState`, grafemas, word-wrap, autocompletado. |

`tui` es una librería **independiente del dominio**: `InteractiveMode` la usa, pero `tui` no conoce a `coding-agent`.

### 5.5 `protocol` — el cable (transporte remoto)

Hoja del monorepo: no depende de ningún otro paquete. Serializa mensajes a **CBOR enmarcado** para sesiones remotas.

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `encodeFrame()` | `packages/protocol/src/framing.ts:28` | Enmarca un payload en bytes con longitud prefijada. |
| `FrameDecoder` | `packages/protocol/src/framing.ts:58` | Reensambla frames desde un stream de bytes. `DEFAULT_MAX_FRAME_LENGTH` = 16 MB (`framing.ts:6`); `assertCompleteFrame()` (`framing.ts:42`). |
| `encodeClientMessage()` / `encodeServerMessage()` | `packages/protocol/src/codec.ts:79` / `:84` | Serializan un mensaje a CBOR enmarcado. |
| `parseClientMessage()` / `parseServerMessage()` | `packages/protocol/src/codec.ts:41` / `:48` | Validan y decodifican; error tipado `ProtocolValidationError` (`codec.ts:18`). |
| `ClientMessageDecoder` / `ServerMessageDecoder` | `packages/protocol/src/codec.ts:129` / `:146` | Decoders con estado para streams. |
| CBOR + esquemas | `packages/protocol/src/cbor/{encoder,decoder}.ts`, `schemas.ts` | Implementación CBOR y esquemas de mensajes. |

Descripción del `package.json`: *"Transport-neutral CBOR protocol for remote pi sessions"*.

### 5.6 `client` y `server` — sesiones remotas

Ambos hablan **solo** a través de `protocol`. El server reconstruye un `AgentSession` — el mismo motor que corre la CLI local.

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `PiClient` | `packages/client/src/client.ts:51` | Cliente remoto (grado 47). Métodos `.acquireSession()`, `.#request()`, `.dispose()`. Referencia `ClientState`, `Connection`, `RemoteSession`. |
| `Connection` | `packages/client/src/connection.ts:40` | Abre el transporte (`.#openTransport()`). |
| `PiServer` | `packages/server/src/server.ts:39` | Servidor de sesiones remotas (**experimental**). |
| `LiveSessionManager` | `packages/server/src/sessions.ts:38` | Administra las sesiones vivas del lado servidor. |
| `ConnectionState` | `packages/server/src/connection.ts:22` | Estado por conexión. |
| Listener Unix | `packages/server/src/transports/unix/listener.ts` | Escucha sobre socket Unix. |

Descripciones: client → *"Transport-neutral client for remote pi sessions over framed CBOR bytes"*; server → *"experimental server package for pi"*.

### 5.7 `telemetry` — observabilidad neutral (comunidad 29, *Telemetry Spans*)

Hoja: define un **contrato** de telemetría más un adaptador de referencia, sin atarse a ningún vendor (OpenTelemetry u otro).

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `SpanAttributes` | `packages/telemetry/src/index.ts:3` | Atributos tipados de un span (grado 11). |
| `InMemoryTelemetryContext` | `packages/telemetry/src/memory.ts:192` | Adaptador de referencia en memoria (para tests). |
| `createTelemetryAdapterConformance()` | `packages/telemetry/src/testing/conformance.ts:61` | Suite de conformidad que cualquier adaptador debe pasar. |
| `RecordedTelemetrySpan` / `RecordedTelemetryEvent` | `packages/telemetry/src/index.ts` | Tipos de span/evento registrados. |

Descripción del `package.json`: *"Vendor-neutral telemetry contracts and typed schema utilities for pi"*.

### 5.8 `evals` — evaluación del comportamiento del agente

Corre el agente contra escenarios y captura salidas, sobre `vitest`.

| Símbolo | `file:line` | Propósito |
|---|---|---|
| `createPiCodingAgentHarness()` | `packages/evals/src/pi-harness.ts:246` | Arma un harness de evaluación que ejecuta el agente y captura resultados. |
| `resolveModelSelection()` | `packages/evals/src/pi-harness.ts:46` | Resuelve qué modelo usar en la corrida. |
| `PiCodingAgentInput` | `packages/evals/src/pi-harness.ts:28` | Tipo de entrada de una eval (prompt o reload). |
| Suites | `packages/evals/src/{smoke,extensions}.eval.ts` | Casos de evaluación (smoke y extensiones). |
| Runner sobre vitest | `packages/evals/src/vitest-evals/` | `reporter.ts`, `summary.ts`, `harness-table.ts`, `artifacts.ts`, `setup.ts`; script `scripts/run-evals.mjs`. |

El `package.json` no trae `description`; el rol se resolvió por la estructura de `packages/evals/src`.

Fuente: `graphify explain` de cada nodo, `graphify explain "PiClient"` / `"Connection"` / `"SpanAttributes"`, `graphify query "server package..."`, `graphify query "AI provider registry..."` (que devolvió los `file:line` de `packages/ai/src/api/*`), y lectura dirigida de `packages/{protocol,evals}/src` para símbolos exactos. `pi-arquitectura-detallada.md` para los agrupamientos por comunidad ya trazados al grafo.

---

## 6. La relación entre los componentes

### 6.1 Aristas concretas (de `graphify explain` / `graphify path`)

Las relaciones no son suposición: salen de las aristas EXTRACTED del grafo.

**Desde `InteractiveMode`** (`main.ts` la importa) hacia abajo:
```
InteractiveMode --references--> Component        (packages/tui)
InteractiveMode --references--> TUI              (packages/tui)
InteractiveMode --references--> Container / Text / Spacer / TuiAltScreen / TuiMainScreen
InteractiveMode --references--> KeybindingsManager
InteractiveMode --references--> AgentSessionRuntime
main.ts         --imports----> InteractiveMode
```

**Desde `AgentSession`** (la bisagra):
```
AgentSession --references--> SettingsManager     (config)
AgentSession --references--> SessionManager       (persistencia)
AgentSession --references--> ExtensionRunner      (extensiones)
AgentSession --references--> ModelRuntime         (puente hacia ai)
AgentSession --references--> Agent                (motor genérico, packages/agent)
AgentSession --references--> AgentTool / ToolDefinition
interactive-mode.ts --imports--> AgentSession
sdk.ts / harness.ts / agent-session-runtime.ts --imports--> AgentSession
```

**Cruce de capa `coding-agent` → `ai`** (verificado con `graphify path`):
```
AgentSession --references--> ModelRuntime
ModelRuntime ......... (a través de compat.ts) ......... ApiProvider   (packages/ai)
```
`graphify path "AgentSession" "Model"` confirma que el camino más corto pasa por `ModelRuntime`; `graphify path "ModelRuntime" "ApiProvider"` confirma que el enlace hacia `ai` cae en `compat.ts`, que **contiene** `ApiProvider`. Es decir: `ModelRuntime` es el único puente `coding-agent → ai`. Todo lo demás de la app habla con la IA a través de esa pieza.

**`SessionManager` ↔ `AgentSession`** son mutuamente referentes (`AgentSession --references--> SessionManager` y `session-manager.ts` importa desde `agent-session.ts`) — coherente con que la sesión y su gestor de persistencia sean caras de la misma moneda.

### 6.2 Diagrama de dependencias entre paquetes

Dirección de la flecha = "depende de". Ninguna apunta hacia arriba (regla de capas):

```
coding-agent ──► agent ──► ai
     │            │
     ├──► tui     └──► telemetry
     │
     ├──► session-backends/sqlite-node   (SQLite)
     │
     └──► client ──► protocol ◄── server
                                    │
                                    └──► agent
```

- `ai`, `telemetry`, `protocol` son **hojas**: no dependen de nada del monorepo. Son los cimientos.
- `agent` depende de `ai` (necesita modelos) pero no de `coding-agent` ni de `tui`.
- `coding-agent` es el **techo**: integra todo para dar el producto CLI.
- `tui` es una hoja de presentación: nadie del núcleo depende de ella.
- **El mismo `AgentSession` sirve local (con TUI) o remoto (client/server sobre CBOR).** `protocol` no depende de `client` ni de `server`; ambos dependen de `protocol`, y ninguno de la TUI. Es arquitectura hexagonal: el dominio en el centro, los adaptadores (TUI, CBOR, SQLite) en el borde.

Fuente: `README.md` (mapa de paquetes), `pi-arquitectura-detallada.md` §10 (ya trazado al grafo), `graphify path`/`graphify explain` de esta sección.

---

## 7. Flujo de ejecución end-to-end

Cómo viaja un mensaje desde que lo escribís hasta que ves la respuesta. Cada paso cita el símbolo real (`file:line`) verificado en el grafo y el código.

### 7.1 Modo local (CLI interactiva)

```
1. Escribís en la terminal
        │
2. main.ts  ──parsea args, elige Mode──►  InteractiveMode.init()
        │   packages/coding-agent/src/modes/interactive/interactive-mode.ts:385
        │   (captura teclado vía KeybindingsManager, edición con el Editor de la TUI)
        ▼
3. InteractiveMode  ──llama──►  AgentSession.prompt(text)
        │   packages/coding-agent/src/core/agent-session.ts:1116
        ▼
4. AgentSession  ──.modelRuntime()──►  ModelRuntime
        │   agent-session.ts:405  →  core/model-runtime.ts:130
        │   (puente ÚNICO hacia la capa ai: resuelve modelo + credenciales)
        ▼
5. AgentSession  ──impulsa──►  Agent.prompt(input)
        │   packages/agent/src/agent.ts:350
        ▼
6. Agent.runPromptMessages()  ──►  runAgentLoop()          agent.ts:409 → agent-loop.ts
        │   ─────────────────── EL BUCLE ───────────────────
        │   a. convertToLlm(messages)   → formato del proveedor        agent.ts:179
        │   b. streamFunction(...)      → llama al ApiProvider de ai   agent.ts:181
        │                                  (Anthropic / OpenAI / Bedrock / …)
        │   c. el modelo responde texto y/o tool calls
        │   d. beforeToolCall → ejecuta tools → afterToolCall          agent.ts:185-192
        │      (built-in read/bash/edit/find/grep/ls vía createBuiltInTools,
        │       ejecución "parallel"                                    agent.ts:237)
        │   e. resultados de tools vuelven al contexto como AgentMessage
        │   f. ¿shouldStopAfterTurn? → si NO, vuelve a (a)             agent.ts:193
        ▼
7. El Agent emite eventos (listeners) → InteractiveMode los renderiza vía TUI
        │   packages/tui/src/tui.ts  (Component:23 / TUI:291, render diferencial)
        ▼
8. SessionManager persiste la conversación
            core/session-manager.ts:855  →  session-backends/sqlite-node (SQLite)
```

La clave: **la app (`coding-agent`) no habla con la IA directamente.** Todo pasa por `ModelRuntime` (un solo puente) y por el `Agent` genérico, que no conoce ningún proveedor concreto — recibe un `streamFunction` **inyectado** (`agent.ts:181`). Por eso el motor se puede testear con el proveedor `faux` sin red ni API keys.

### 7.2 Modo remoto (client / server)

El mismo `AgentSession`, pero la entrada/salida viaja por la red enmarcada en CBOR:

```
PiClient.acquireSession()                         packages/client/src/client.ts:51
   │  ── mensaje del cliente ──
   ▼
encodeClientMessage() → encodeFrame()             protocol/src/codec.ts:79 → framing.ts:28
   │  (CBOR enmarcado, máx 16 MB)
   │  ── bytes por el transporte (socket Unix / stdio) ──
   ▼
PiServer → LiveSessionManager                     server/src/server.ts:39 → sessions.ts:38
   │
   ▼
AgentSession   (idéntico al modo local: pasos 4–8 de arriba)
   │  ── respuesta ──
   ▼
encodeServerMessage() → frame → ServerMessageDecoder (en PiClient)   codec.ts:84 / :146
```

El **núcleo del agente es el mismo**; lo único que cambia es el borde: TUI local vs. CBOR sobre la red. Arquitectura hexagonal en acción — el dominio en el centro, los adaptadores (TUI, CBOR, SQLite) en la orilla.

### 7.3 Modos headless

`main.ts` también expone modos **sin TUI** (hyperedge *Pi Headless Integration Modes*, §9.2): **JSON**, **RPC** y **SDK** (`createAgentSession()` en `core/sdk.ts:169`). Los tres reusan `AgentSession`; cambian solo el formato de entrada/salida.

Fuente: `graphify explain "Agent"`, `graphify explain "PiClient"`, `graphify path "ModelRuntime" "ApiProvider"`, `graphify path "AgentSession" "Model"`, y lectura dirigida de `agent.ts`, `agent-session.ts`, `codec.ts`, `framing.ts` para símbolos y líneas exactas.

---

## 8. Subsistemas por comunidad (agrupación del grafo)

graphify encontró 953 comunidades (751 mostradas). Las principales, por hub de navegación del `GRAPH_REPORT.md`:

- **Motor de agente** — *Agent Session Lifecycle* (12), *Agent Harness Reducer* (13), *Agent Lanes & State* (15), *Compaction & Extension Bindings* (2), *Agent Messages & Loaders* (0).
- **Capa de IA** — *AI Provider API Core* (7), *AI Provider Registry* (17), *Provider Auth (OAuth)* (8), *AI Node Context & Env* (14), *AI Error Formatting & Clients* (11), *AI Streaming Tests* (5), *Lazy Provider APIs*, *Model Catalogs*, *Builtin Providers*, y una comunidad por proveedor: *Anthropic Messages API*, *OpenAI Completions & Caching*, *OpenAI Codex Provider*, *AWS Bedrock Provider*, *Azure OpenAI Provider*, *OpenRouter & Auth Resolution*.
- **TUI** — *TUI Box Layout* (9), *TUI Editor Rendering* (10), *TUI Editor State*, *TUI Editor Autocomplete*, *TUI Image Rendering*.
- **CLI / runtime** — *CLI Argument Parsing* (16), *CLI Startup & Sandbox*, *Runtime & Built-in Tools* (3), *Keybindings* (4), *Session Picker & Loading*, *Theme Detection & Startup*, *Resource Loading & Diagnostics*.
- **Persistencia y sesión** — *SQLite Session Backend* (6), *Session Auth & Events* (1).
- **Observabilidad** — *Telemetry Spans*.

Nota sobre cohesión: casi todas las comunidades tienen cohesión baja (0,01–0,14). Es normal en un monorepo grande con responsabilidades cruzadas; sirve como mapa de dónde mirar si un subsistema se vuelve difícil de mantener. La excepción notable es *Provider Auth (OAuth)* (comunidad 8) con cohesión 0,14 — el flujo de auth es el subsistema más autocontenido del repo.

Fuente: `graphify-out/GRAPH_REPORT.md` (secciones "Community Hubs" y "Communities 0–17").

---

## 9. Hallazgos del grafo que conviene conocer

### 9.1 Ciclos de importación (deuda técnica a vigilar)

De la sección "Import Cycles" del `GRAPH_REPORT.md`:

1. `agent/src/index.ts → agent/src/index.ts` — auto-referencia (típicamente re-exports).
2. `agent-session-runtime.ts → agent-session-services.ts → sdk.ts → agent-session-runtime.ts` — ciclo de 3 archivos en el **núcleo de la sesión**. Es el más delicado: acopla runtime, servicios y SDK. Si algún día se quiere extraer el SDK a otro paquete, este ciclo lo bloquea hasta romperlo.
3. `cli/args.ts → extensions/types.ts → model-resolver.ts → cli/args.ts` — los args conocen los tipos de extensión, que conocen el resolver de modelo, que vuelve a los args. Acoplamiento entre parsing de CLI y resolución de modelo. (Este ciclo coincide con el par de nodos del ciclo mutuo entre CLI y extensiones que ya se veía en el grafo anterior.)

### 9.2 Relaciones agrupadas (hyperedges) relevantes

De la sección "Hyperedges" del `GRAPH_REPORT.md`:

- **Agent Session Construction** [EXTRACTED 1.00] — cómo el SDK arma una sesión: `create_agent_session`, `model_runtime`, `default_resource_loader`.
- **Custom provider registration flow** [INFERRED 0.75] — registrar un proveedor de IA propio: `createProvider`, `registerProvider`, skill `add-llm-provider`.
- **Pi Headless Integration Modes** [INFERRED 0.85] — modos sin TUI: JSON, RPC y SDK (`createAgentSession`).
- **Pi Loadable Resource Types** [EXTRACTED 1.00] — recursos declarativos cargables: skills, prompt templates, themes, packages.
- **Implement Workflow Chain** [EXTRACTED 1.00] — cadena de subagentes `scout → planner → worker` (ejemplo de extensión `subagent`).
- **Alternate-Screen Layout Primitives** [EXTRACTED 0.75] — primitivas de layout de la TUI: vstack, hstack, scrollview, viewport, layout engine.
- **Pi protocol server storage stack** [INFERRED 0.75] — la tríada `protocol` + `server` + `sqlite-node`.
- **Telemetry contract and adapters** [INFERRED 0.75] — `telemetry_context`, `telemetry_inmemory`, `telemetry_conformance`: contrato + adaptadores.
- **Contribution Gate Enforcement** [INFERRED 0.85] — el proyecto controla contribuciones vía GitHub Actions (issue gate, PR gate, approve contributor). Confirmado también por el aviso del `README.md`: *"New issues and PRs from new contributors are auto-closed by default."*
- **Release Pipeline** [INFERRED 0.75] — `releasing`, `changelog_policy`, `build_binaries`.

### 9.3 Conexiones INFERIDAS de baja confianza (falsos positivos a no confiar)

La sección "Surprising Connections" marca como INFERRED varias funciones (`getScrollViewBox()`, `getScrollViewsAt()`, `walkGuestFiles()`) conectadas a `visit()` de `scripts/check-ts-relative-imports.mjs` por similitud de nombre — son falsos positivos del extractor semántico, no llamadas reales. graphify las marca justamente para que no te confíes. En total, solo 225 aristas del grafo son INFERRED (avg. confianza 0,8) contra 99 % EXTRACTED.

Fuente: `graphify-out/GRAPH_REPORT.md` (secciones "Import Cycles", "Hyperedges", "Surprising Connections", "Summary"), `README.md`.

---

## 10. Cómo seguir explorando el grafo

Este documento es un mapa. Para profundizar, consultá el grafo directamente:

```bash
graphify query "cómo funciona el registro de proveedores de IA"
graphify explain "AgentSession"
graphify path "InteractiveMode" "Model"
```

Reporte completo: `graphify-out/GRAPH_REPORT.md`. Grafo interactivo: `graphify-out/graph.html`.

---

## Fuentes

Fuentes primarias efectivamente usadas para este documento:

**Consultas a la CLI de graphify (grafo fresco, commit `4181f66e`):**
- `graphify query "overall architecture: packages, layers and how they depend on each other"`
- `graphify query "AI provider registry: how providers register and ApiProvider contract"`
- `graphify query "SettingsManager class in settings-manager.ts responsibilities"`
- `graphify explain` sobre: `AgentSession`, `InteractiveMode`, `SettingsManager`, `Component`, `TUI`, `Theme`, `SessionManager`, `DefaultPackageManager`, `ExtensionAPI`, `AgentMessage`, `Agent`, `ModelRuntime`, `PiClient`, `Connection`, `SpanAttributes`
- `graphify path "AgentSession" "Model"`, `graphify path "ModelRuntime" "ApiProvider"`
- `graphify query` sobre: flujo de ejecución end-to-end, `telemetry` (spans/contratos/adaptadores), `protocol` (CBOR/framing), `client`/`server` (transporte remoto), `evals`, ejecución de herramientas

**`graphify-out/GRAPH_REPORT.md`** — secciones leídas: Summary, Graph Freshness, Community Hubs (Navigation), God Nodes, Surprising Connections, Import Cycles, Hyperedges, Communities 0–17.

**Archivos del repositorio:**
- `packages/*/package.json` (nombres y descripciones de los diez paquetes)
- `README.md` (encabezado, tabla "All Packages", aviso de contribuciones)
- `AGENTS.md` (convenciones de monorepo, layout de `packages/*`)
- `ls packages/session-backends/` (subpaquete `sqlite-node`)
- Lectura dirigida (tras orientar con graphify) para símbolos/líneas exactas del flujo y de los paquetes de transporte: `packages/agent/src/agent.ts`, `packages/coding-agent/src/core/agent-session.ts`, `packages/protocol/src/{framing,codec}.ts`, `packages/evals/src/pi-harness.ts`, y el árbol de `packages/{protocol,evals}/src`

**Documentos de convención previos** (para tono, estructura y agrupamientos ya trazados al grafo):
- `pi-arquitectura.md`
- `pi-arquitectura-detallada.md`

> Nota de método: los `file:line` y grados de los god nodes se tomaron de `graphify explain` sobre el grafo fresco. Donde `graphify explain` devolvió un nodo homónimo de un ejemplo (`examples/`) en lugar de la definición real (caso de `SettingsManager` y `Model`), se resolvió la ubicación real con una `graphify query` dirigida al archivo de `core`/`src`. El grueso del documento se sostiene sobre el grafo y los metadatos de paquete; para el **flujo de ejecución (§7)** y los **paquetes de transporte (§5.5–§5.8)** se abrieron archivos puntuales —siempre después de orientar con graphify— para fijar nombres de símbolos y números de línea exactos (`agent.ts`, `agent-session.ts`, `protocol/src/{framing,codec}.ts`, `evals/src/pi-harness.ts`).
