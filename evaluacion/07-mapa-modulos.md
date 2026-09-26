# Mapa de módulos — grafo de dependencias real

A diferencia de `01-arquitectura.md` (que describe la arquitectura *declarada*), este documento describe la arquitectura *real*, extraída mecánicamente: un script (`node`, sin dependencias) recorrió los 127 archivos de producción de `src/`, extrajo cada `import` con especificador relativo (`"./..."`/`"../..."`), lo resolvió a un módulo (carpeta de segundo nivel bajo `core/`/`adapters/`, o el archivo raíz de composición), y construyó el grafo dirigido módulo→módulo. Los imports de paquetes npm (SDK de Anthropic, `zod`, etc.) se descartan; los imports dentro del mismo módulo (mismo archivo de contrato) no cuentan como arista.

**Resultado central, confirmado por el grafo real y no solo por lectura de código**: cero aristas `core/* → adapters/*`. La regla no negociable de `AGENTS.md` se cumple estructuralmente, no solo por disciplina de code review.

## El patrón de composición: un único punto ve ambos mundos

`main.ts` y los seis archivos `build-on-*.ts` (`build-on-activity`, `build-on-comando-empleado`, `build-on-soporte`, `build-on-submit`, `build-on-venta`, `build-on-a2a-entrante`) son, en conjunto, el **composition root**: el único lugar del repo donde una misma unidad de código importa tanto de `core/` como de `adapters/`. `main.ts` solo tiene **23 aristas de salida** (fan-out) y **cero de entrada** — es una hoja terminal del grafo, coherente con ser el punto de arranque del proceso.

| Composition root | Adaptadores que instancia | Módulos de core que consume |
| --- | --- | --- |
| `main.ts` | a2a, board, crypto, git, knowledge, memory, notificaciones, tui, web, webhooks | auth, concurrency, config, logging, startup, turn-selector, ventas |
| `build-on-comando-empleado.ts` | git, memory, tui | agents, auth, commands, hitl, logging, propuestas, solicitudes, startup, turn-selector, ventas |
| `build-on-activity.ts` | git, knowledge, memory, test-runner | activity, agents, concurrency, logging, startup, turn-selector |
| `build-on-a2a-entrante.ts` | a2a, knowledge, memory | agents, logging, startup, turn-selector |
| `build-on-venta.ts` | memory | agents, logging, turn-selector, ventas |
| `build-on-soporte.ts` | knowledge, memory | logging, startup, turn-selector, ventas |
| `build-on-submit.ts` | knowledge, tui | logging, startup, turn-selector |

Ningún adaptador ni módulo de core conoce a estos siete archivos — son los únicos "que ven todo", y son también los archivos con más aristas de salida del repo entero (`main.ts`: 23, `build-on-comando-empleado.ts`: 16). Esto es exactamente lo que un composition root de arquitectura hexagonal debería ser: mucho fan-out, cero fan-in, cero lógica de negocio propia.

## Las aristas que importan: adaptador → núcleo

Estas son las únicas dependencias reales entre un adaptador y el resto del sistema — el contrato de puerto que cada adaptador consume:

| Adaptador | Importa de `core/` | Qué consume |
| --- | --- | --- |
| `a2a` | `agents`, `config` | `a2a-contract.ts` (vocabulario del protocolo), config de timeouts |
| `board` | `activity`, `config`, `text` | `ActivityBoardPort`, truncado de comentarios |
| `git` | `agents`, `config` | `worktree-contract.ts` |
| `knowledge` | `config`, `knowledge`, `text` | `knowledge-contract.ts` (nombre calificado de la tool MCP) |
| `notificaciones` | `config`, `ventas` | tipos de venta para el cuerpo del email |
| `test-runner` | `agents`, `config`, `text` | contrato del subagente Developer |
| `web` | `config`, `ventas` (7 imports — el más alto) | toda la máquina de estados de venta |
| `webhooks` | `activity`, `config` | `IncomingActivityEvent` |

`adapters/memory` y `adapters/tui` tienen **fan-out = 0**: no importan nada de `core/`, ni de otro adaptador. Esto es coherente con su rol — `memory` es persistencia pura (recibe llamadas, no consulta contratos de dominio) y `tui` es I/O puro (recibe un `SubmitPromptHandler` ya resuelto). `adapters/shared` (política de subprocess) tiene fan-in=3 y fan-out=0: es la única pieza de código compartida entre adaptadores (`git`, `knowledge`, `test-runner`), nunca importa nada — infraestructura pura, no lógica.

## El núcleo de la orquestación: quién depende de quién dentro de `core/`

| Desde | Hacia | Relación |
| --- | --- | --- |
| `activity` | `agents`, `propuestas`, `turn-selector` | El orquestador de PR review consulta roles y delega vía el selector |
| `agents` | `knowledge` | El agente conversacional referencia el nombre calificado de la tool MCP |
| `auth` | `ventas` | Comparte `resolveNumeroValidado` de config de negocio |
| `propuestas` | `auth`, `hitl` | Usa `SesionEmpleado` y el vocabulario HITL compartido |
| `solicitudes` | `agents`, `auth`, `hitl`, `turn-selector` | Delega al validador, usa sesión y HITL |
| `startup` | `agents`, `hooks`, `logging`, `skills` | Fija el orden de arranque de los tres registros |
| `turn-selector` | `agents` (12 imports — la más alta de todo el grafo), `hooks`, `knowledge`, `logging`, `skills` | El selector de turno es el consumidor por excelencia del registro de agentes |
| `ventas` | `auth`, `config` | Tipo de sesión autenticada + configuración de negocio |

## Los módulos "hub" — mayor grado de conexión

| Módulo | Fan-in (cuántos dependen de él) | Fan-out (de cuántos depende) | Lectura |
| --- | --- | --- | --- |
| `core/agents` | **11** | 1 | El registro de agentes/subagentes es la pieza más consultada de todo el repo — coherente con ser el punto único de control de seguridad (qué tools tiene cada rol) |
| `core/turn-selector` | 9 | 5 | El corazón operativo: alto fan-in (todo orquestador de dominio pasa por él) y alto fan-out (coordina agentes, hooks, skills, conocimiento, logging) |
| `core/config` | 10 | 0 | Utilidad transversal pura — todo el mundo la usa, ella no depende de nada |
| `core/logging` | 9 | 0 | Ídem — convención de correlación de turnos usada en todo el sistema |
| `core/ventas` | 8 | 2 | El dominio de negocio más grande, consumido tanto por `web`/`notificaciones` (adaptadores) como por `auth`/`main.ts` |
| `adapters/memory` | 8 | 0 | Depende de nada, todos dependen de ella para persistir — el "fondo" del sistema |
| `core/startup` | 6 | 4 | Punto de arranque: depende de los tres registros que fija, y de él dependen los 6 `build-on-*` |

Que `core/config` y `core/logging` tengan fan-out **cero** y fan-in de 2 dígitos es la firma exacta de una utilidad transversal bien diseñada: todo la consume, ella no depende de nada — sin eso, cualquier cambio en configuración o logging arrastraría un ciclo de dependencias sobre el resto del núcleo.

## Qué revela el grafo que la prosa no muestra

1. **La arquitectura hexagonal no es aspiracional**: el grafo mecánico (no una lectura humana de comentarios) confirma cero acoplamiento core→adapters y cero acoplamiento adaptador↔adaptador salvo la excepción documentada (`shared/`).
2. **Hay un único cuello de botella arquitectónico real**: `core/agents`, con fan-in 11. Cualquier cambio de forma en `AgentDefinition` o en el registro tiene el radio de impacto más amplio de todo el sistema — es también, no por casualidad, el módulo donde vive el control de seguridad (`allowedTools`).
3. **El "núcleo" tiene, dentro de sí, su propia mini-jerarquía de dependencia** (`ventas`/`solicitudes`/`propuestas`/`activity` → `auth`/`hitl`/`agents`/`turn-selector` → `config`/`logging`), no es un bolsón plano de 17 carpetas sin relación.
4. **El patrón de composition root está aplicado con disciplina real**: 7 archivos concentran el 100% del acoplamiento cruzado core↔adaptadores del repo; ninguna lógica de dominio vive ahí (son, en esencia, listas de `const x = createXAdapter(...)` y el registro de handlers).


## Actualización 2026-09-25 — el grafo en `v3.21.0`

*(Lo anterior es el grafo de `v3.4.0`. Se regeneró con un script equivalente, basado en imports relativos de los archivos de producción y agrupado por carpeta de segundo nivel, sobre ambos snapshots. Para `v3.4.0` reproduce los fan-in del documento original: `core/agents` 11, `core/turn-selector` 9, `core/logging` 9, `core/ventas` 8, `adapters/memory` 8.)*

**Resultado central, sostenido:** **0 aristas `core/* → adapters/*`** sobre 166 archivos de producción, contra 126 en v3.4. El único acoplamiento adaptador↔adaptador sigue siendo el mismo: `git`, `knowledge` y `test-runner` → `shared`. El grafo pasó de **112 a 168 aristas**.

### Hubs, antes y después

| Módulo | Fan-in v3.4.0 | Fan-in v3.21.0 | Fan-out v3.4.0 → v3.21.0 |
| --- | ---: | ---: | --- |
| `core/agents` | 11 | **16** | 1 → **5** |
| `core/logging` | 9 | 13 | 0 → 0 |
| `core/turn-selector` | 9 | 11 | 5 → 5 |
| `core/ventas` | 8 | 11 | 2 → 2 |
| `core/auth` | 5 | **11** | 1 → 1 |
| `adapters/memory` | 8 | 9 | 0 → 0 |
| `core/operaciones` | — | 5 | — → **7** |
| `core/solicitudes` | 1 | 5 | 4 → 4 |
| `core/commands` | 1 | 5 | 0 → 0 |

`core/auth` casi triplica su fan-in, algo coherente con que la autorización por roles (v3.5) se consulta desde operaciones, solicitudes, ventas, web y el composition root. `core/logging` sigue con fan-out 0, la firma de una utilidad transversal sana.

### Lo que el grafo nuevo revela

1. **Aparecen ciclos a nivel módulo dentro del núcleo**, que no existían en v3.4.0:
   - `core/agents ↔ core/operaciones`: `definitions.ts` importa `OPERACIONES_TOOL_QUALIFIED_NAME`, y `ejecutar-operacion.ts` importa 6 archivos de `agents/` (contratos A2A, textos, catálogo de KPIs, marco de texto externo).
   - `core/agents ↔ core/solicitudes`: `consultas-negocio-tool.ts` importa el puerto de consulta, y `crear-solicitud-interna.ts` importa `VALIDADOR_SOLICITUDES_AGENT_ID`.
   - `core/agents → core/actividad → core/activity → core/agents`.

   No son ciclos entre archivos (no rompen la carga de módulos ES), pero sí rompen la mini-jerarquía que describía la observación 3 de arriba. `core/agents` dejó de ser solo "registro de agentes" y pasó a alojar textos y lógica de consulta de negocio. **El cuello de botella del punto 2 creció**: fan-in 16 y, ahora, también fan-out 5.
2. **Los composition roots se importan entre sí.** `build-on-activity` importa `createPropuestaStore` de `build-on-comando-empleado`, y este importa `createDelegacionStore` de `build-on-activity`. Además, `build-on-operaciones-empleado` (nuevo, 15 aristas de salida) importa de `build-on-comando-empleado` y de `build-on-venta`. El patrón "7 archivos que ven todo" pasó a ser **9 archivos** (se suman `build-on-operaciones-empleado` y `build-on-login-http`; `proceso-cierre.ts`, también nuevo en la raíz, solo importa `core/logging`), con dependencias cruzadas entre ellos. Los CLIs `empleados.ts` y `reporte-mensual.ts` también importan de ambos lados, igual que en v3.4.
3. **`main.ts` pasó de 22-23 a 31 aristas de salida**, con fan-in 0: sigue siendo una hoja terminal.
4. **`adapters/tui` dejó de tener fan-out 0**: ahora importa `core/commands` (v3.20, para saber qué comando es secreto). Está permitido por la regla, pero ya no es "I/O puro".
5. **Adaptadores nuevos bien contenidos**: `ops` tiene fan-out 0 (y un test que lo garantiza), `consultas` depende solo de `core/agents` y `operaciones` de `core/agents`, `core/auth` y `core/operaciones`.
6. **`adapters/web` es ahora el adaptador más acoplado al núcleo**: 4 módulos (`ventas` con 7 imports, `auth`, `conversacion`, `operaciones`), contra 1 en v3.4.

**Recomendación que se desprende:** mover los textos y catálogos que `core/operaciones` consume de `core/agents` (`a2a-*-textos.ts`, `texto-externo.ts`, `consultas-kpi-catalogo.ts`) a un módulo propio o a `core/text`, y sacar `consultas-negocio-tool.ts` de `agents/`. Eso devolvería a `core/agents` su rol de registro y eliminaría los ciclos.
