# Arnés Empresarial

Arnés (harness) básico con memoria compartida para correr agentes de IA multi-turno en un ambiente empresarial, construido sobre el **Claude Agent SDK**. Proyecto de pasantía corta — diseño primero, versionado incremental, arquitectura de puertos y adaptadores.

> **Estado actual:** hitos v1.0.0, v1.1.0, v1.2.0 y v1.4.0 cerrados y tageados (`v1.3.0` no tiene tag — ver la tabla de Hoja de ruta). v2.0.0 (delegación a subagentes) está en curso: las tareas de implementación ya están commiteadas en la rama `hito/v2.0-delegacion-subagentes`, pero el hito todavía no cierra — falta el pase de Reviewer sobre el hito completo, el checklist de cierre de `AGENTS.md` y el tag `v2.0.0`. Ver la sección [Hoja de ruta](#hoja-de-ruta) para el detalle por versión.

## Objetivo

Implementar un arnés que permita:

- Definir agentes, subagentes, comandos, hooks y skills.
- Sostener memoria compartida entre agentes (estado de negocio por caso, no solo historial conversacional).
- Consultar una base de conocimiento propia (Obsidian + Graphify) con fuente citable.
- Comunicarse con agentes externos vía el protocolo **A2A**.
- Correr localmente, sin infraestructura de servidor.

Todo aplicado sobre casos de uso reales de empresa: revisión de PRs, aprobación de solicitudes, gestión de incidentes, confirmación de ventas y comisiones, entre otros.

## Arquitectura

Arquitectura hexagonal (puertos y adaptadores): un núcleo de orquestación desacoplado de la interfaz de usuario, la persistencia, el conocimiento y la comunicación entre agentes.

```
                     ┌─────────────────────┐
       Adaptador     │                     │   Adaptador de
         TUI  ───────┤   Núcleo de         ├─────  Memoria
       (Ink)         │   Orquestación      │       Compartida
                      │                     │       (SQLite)
                      └──────────┬──────────┘
                                 │
            ┌────────────────────────────────────┐
            │                                     │
    Adaptador de Conocimiento              Adaptador A2A
    (MCP propio → Graphify CLI)         (JSON-RPC, entrante/saliente)
```

| Bloque | Responsabilidad | Ubicación prevista |
| --- | --- | --- |
| Núcleo de Orquestación | Resuelve el turno activo, registra agentes/comandos/hooks/skills, expone el puerto `ModelProvider` | `src/core/` |
| Adaptador TUI | Entrada/salida por terminal (Ink) | `src/adapters/tui/` |
| Adaptador de Conocimiento | Traduce consultas a la CLI de Graphify vía un servidor MCP propio | `src/adapters/knowledge/` |
| Adaptador de Memoria Compartida | Persiste el estado de negocio (casos) correlacionado con las sesiones del SDK | `src/adapters/memory/` |
| Adaptador A2A | Expone/consume el arnés como agente A2A | `src/adapters/a2a/` |

Detalle completo de bloques, interfaces, escenarios de ejecución, decisiones de diseño (ADRs) y riesgos: [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md).

## Stack técnico

| Decisión | Elección |
| --- | --- |
| Lenguaje | TypeScript sobre Node.js |
| Motor de agentes | Claude Agent SDK (Anthropic) |
| Interfaz | TUI vía Ink |
| Base de conocimiento | Obsidian, indexado con Graphify (vía servidor MCP propio) |
| Comunicación entre agentes | Protocolo A2A (JSON-RPC) |
| Persistencia | SQLite embebido, sin servidor |

## Configuración

### Roles de subagentes (`SUBAGENT_REGISTRY`)

Desde Hito 5 (v2.0.0), el arnés registra cuatro subagentes delegables (`src/core/agents/definitions.ts`), cada uno con su propio `allowedTools` acotado por rol. Ninguno incluye `Agent`/`Task`/`Write`/`Edit`/`Bash` — eso es lo que hace estructuralmente imposible que un subagente delegue a su vez (un solo nivel de profundidad de delegación).

| Rol (`id`) | Responsabilidad | `allowedTools` |
| --- | --- | --- |
| `planner` | Analiza el cambio de un PR y produce el plan de revisión: qué revisar, en qué archivos y con qué criterio. No emite veredicto. | `Read`, `Glob` |
| `developer` | Ejecuta el plan de revisión sobre el código: rastrea impacto y produce hallazgos concretos. No emite veredicto. | `Read`, `Glob`, `Grep` |
| `reviewer` | Emite el veredicto final de una revisión de PR en una única línea `VEREDICTO: aprobado\|observado\|resuelto`. | `Read` |
| `validador-solicitudes` | Evalúa si una solicitud interna (vacaciones o gasto) está completa y cumple las reglas conocidas, y emite un dictamen. No aprueba ni rechaza. | (ninguna — `[]`) |

### Interruptor `HARNESS_DELEGACION_ROLES`

Variable de entorno que controla si el bot de revisión de PRs delega en los tres roles (`planner` → `developer` → `reviewer`, Hito 5) o usa el agente único de `v1.4.0` (`src/build-on-activity.ts`):

| Valor | Comportamiento |
| --- | --- |
| `"off"` | Comportamiento de `v1.4.0`: un único agente resuelve la revisión completa, sin delegación por roles. |
| Cualquier otro valor, o ausente | Delegación por roles activa (default): cadena determinista Planner → Developer → Reviewer. |

### Interruptor `HARNESS_ESCRITURA_DELEGADA`

Desde Hito 5.1 (v2.1.0), variable de entorno que controla si el rol `developer` escribe código real en un worktree de `git` aislado (`src/build-on-activity.ts`) o se comporta exactamente como en `v2.0.0` (sin escritura, sin worktree, sin propuesta de cambio):

| Valor | Comportamiento |
| --- | --- |
| `"off"` | Comportamiento exacto de `v2.0.0`: el Developer no escribe, no se abre worktree y no se persiste ninguna propuesta de cambio. |
| Cualquier otro valor, o ausente | Escritura delegada activa (default): el Developer trabaja en un worktree aislado, corre su propia suite con `mcp__worktree__run_tests` y el diff resultante queda pendiente de aprobación humana como propuesta de cambio. |

### Variables de entorno de la escritura delegada

Configuración del worktree aislado y del runner de `git`/tests que usa el Developer cuando `HARNESS_ESCRITURA_DELEGADA` está activo (`src/adapters/git/config.ts`, `src/adapters/test-runner/config.ts`). Todas son best-effort: un valor ausente, vacío o inválido cae al default sin lanzar:

| Variable | Default | Descripción |
| --- | --- | --- |
| `HARNESS_GIT_BIN` | `"git"` | Binario de `git` que invoca el runner. |
| `HARNESS_GIT_TIMEOUT_MS` | `30_000` | Timeout (ms) por llamada individual a `git`. |
| `HARNESS_WORKTREE_ROOT` | `".harness/worktrees"` | Directorio, relativo a la raíz del repo, donde se crean los worktrees aislados. |
| `HARNESS_WORKTREE_TTL_MS` | `7_200_000` (2 h) | Tiempo máximo que un worktree huérfano sobrevive antes de que el barrido lo reclame. |
| `HARNESS_WORKTREE_TEST_TIMEOUT_MS` | `300_000` (5 min) | Timeout (ms) de la corrida de `vitest run` dentro del worktree. |

### Tool MCP `mcp__worktree__run_tests`

Expuesta únicamente al Developer cuando trabaja dentro de un worktree aislado. No acepta parámetros — siempre corre la suite completa (`vitest run`) fijada al `cwd` del worktree, sin poder filtrar por archivo, patrón ni test individual. Devuelve el resultado real (verde o rojo) con la salida de vitest, o indica explícitamente si la corrida no se pudo ejecutar en vez de afirmar que los tests pasan.

### Comandos de propuesta de cambio

Comandos TUI privilegiados (Hito 5.1) para revisar el diff que produjo el Developer antes de aplicarlo:

| Comando | Uso | Descripción |
| --- | --- | --- |
| `/ver-propuesta` | `/ver-propuesta [propuestaId]` | Muestra una propuesta de cambio pendiente (lista las pendientes si se omite el id). |
| `/aplicar-propuesta` | `/aplicar-propuesta <propuestaId>` | Aplica el patch de una propuesta de cambio aprobada. |
| `/descartar-propuesta` | `/descartar-propuesta <propuestaId> [motivo]` | Descarta una propuesta de cambio pendiente sin aplicarla. |

## Hoja de ruta

Entrega incremental en tres hitos mayores, cada uno cerrando con un tag semántico y una carpeta `docs/progreso/vX.Y-nombre/`. La columna **Estado** refleja únicamente los tags reales del repositorio (`git tag --list`) — un hito solo se marca cerrado si tiene su tag semántico correspondiente:

| Versión | Estado | Hito | Caso(s) de uso | Entregable |
| --- | --- | --- | --- | --- |
| v1.0.0 | ✅ cerrado | Esqueleto conversacional | — (fundación) | El agente conversa por TUI y recuerda el historial de la sesión |
| v1.1.0 | ✅ cerrado | Consulta de conocimiento | Consulta de política interna, onboarding | Responde con fuente citada del vault |
| v1.2.0 | ✅ cerrado | Bot de revisión de PRs | Revisión de PRs, incidentes de IT | Un PR real dispara revisión automática; el tablero se actualiza solo |
| v1.3.0 | — | Ventas y comisiones | Confirmación de venta, soporte, reembolsos | Cliente confirma por web; reporte comparativo mensual |
| v2.0.0 | 🔄 en curso | Delegación a subagentes | Bot de PRs con roles separados, HITL | Delegación interna entre roles |
| v2.1.0 | — | Comunicación A2A saliente | Incidente coordinado, KPIs, riesgo/crédito | El agente delega en un agente externo |
| v3.0.0 | — | Comunicación A2A entrante | Arnés invocable desde otras áreas | Cierra el objetivo específico 7 por completo |

Plan detallado hito por hito, con estructura de datos, integraciones concretas y conceptos transversales: [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md).

## Documentación

| Documento | Contenido |
| --- | --- |
| [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md) | Arquitectura completa (arc42): metas de calidad, restricciones, vista de bloques, vista de ejecución, vista de despliegue, ADRs, riesgos y deuda técnica |
| [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md) | Plan de implementación por hitos, con casos de uso empresariales y entregables verificables |

## Stakeholders

| Rol | Contacto |
| --- | --- |
| Tutor Empresarial | Alexander Ramirez — ar@conectados.ai |
| Desarrollador | Jimmy Fung — jimmyfung14@gmail.com |
