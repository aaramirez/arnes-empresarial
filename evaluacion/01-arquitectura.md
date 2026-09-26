# Arquitectura

## Qué es el sistema

"Arnés Empresarial" (`arnes-empresarial`) es un *harness* de agentes de IA multi-turno construido sobre el **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` ^0.3.248), pensado para correr casos de uso reales de empresa (revisión de PRs, ventas y comisiones, solicitudes internas, incidentes de IT) sin infraestructura de servidor. Es un proyecto de pasantía: el objetivo explícito no es un producto terminado sino demostrar, con versionado semántico y documentación paso a paso, cómo se construye un sistema de este tipo con diseño-antes-que-código.

Objetivo declarado (arc42, Vista de Requerimientos): *"implementar un arnés básico con memoria compartida para correr agentes de IA multi-turno en un ambiente empresarial"*, con siete objetivos específicos que incluyen investigación comparativa de otros harnesses, elección de lenguaje/SDK, TUI, base de conocimiento propia (Obsidian + Graphify) y comunicación A2A entre agentes.

## Restricciones no negociables

Fijadas en `AGENTS.md` y el arc42, y verificadas en el código (no solo declaradas):

- **TypeScript sobre Node.js ≥20** — sin abstracción de proveedor de modelo (solo Claude Agent SDK).
- **Monolito modular de un solo paquete**: `src/core/` + `src/adapters/*`, no un monorepo. `src/core/` **nunca** importa de `src/adapters/*` — verificado con `grep -rn "from ['\"].*adapters" src/core/`: cero resultados fuera de tests. Ningún adaptador se comunica directamente con otro; todo pasa por el núcleo.
- **Persistencia**: SQLite embebido, sin servidor (`better-sqlite3`).
- **Interfaz**: TUI vía Ink (React para terminal).
- **Comunicación entre agentes**: protocolo A2A (JSON-RPC), tanto cliente (saliente) como servidor (entrante).
- **Testing**: `vitest`, TDD obligatorio para lógica de negocio (red → green → refactor).

## Vista de bloques (arc42, nivel 1)

```
                     ┌─────────────────────┐
       Adaptador     │                     │   Adaptador de
         TUI  ───────┤   Núcleo de         ├─────  Memoria
       (Ink)         │   Orquestación      │       Compartida
                      │   src/core/         │       (SQLite)
                      └──────────┬──────────┘
                                 │
            ┌────────────────────────────────────┐
            │                                     │
    Adaptador de Conocimiento              Adaptador A2A
    (MCP propio → Graphify CLI)         (JSON-RPC, entrante/saliente)
```

A esto se suman, fuera del diagrama original del arc42 (agregados en hitos posteriores, mismo patrón de puerto/adaptador): **Adaptador de Webhooks** (entrante, GitHub), **Adaptador de Tablero** (GitHub Issues, saliente), **Adaptador Web/Notificaciones** (confirmación de venta por link + email), **Adaptador de Git/Worktree** y **Adaptador de Test-Runner** (para que un subagente "Developer" escriba código real en un worktree aislado y corra su propia suite).

| Bloque | Responsabilidad | Ubicación |
| --- | --- | --- |
| Núcleo de Orquestación | Resuelve el turno activo, registra agentes/comandos/hooks/skills, expone el puerto `ModelProvider` | `src/core/` |
| Adaptador TUI | Entrada/salida por terminal (Ink) | `src/adapters/tui/` |
| Adaptador de Conocimiento | Traduce consultas a la CLI de Graphify vía un servidor MCP propio | `src/adapters/knowledge/` |
| Adaptador de Memoria Compartida | Persiste el estado de negocio (casos), correlacionado con las sesiones del SDK | `src/adapters/memory/` |
| Adaptador A2A | Expone/consume el arnés como agente A2A (JSON-RPC) | `src/adapters/a2a/` |
| Adaptador de Webhooks | Recibe eventos de GitHub (PR, comentarios) firmados HMAC | `src/adapters/webhooks/` |
| Adaptador de Tablero | Actualiza Issues/labels/assignees de GitHub como tablero visible | `src/adapters/board/` |
| Adaptador Web | Confirmación de venta / soporte / devolución vía HTTP + email | `src/adapters/web/`, `src/adapters/notificaciones/` |
| Adaptador de Git | Worktrees aislados para escritura delegada de código | `src/adapters/git/` |
| Adaptador de Test-Runner | Corre `vitest` dentro del worktree aislado, expuesto como tool MCP | `src/adapters/test-runner/` |

## Catálogo de interfaces (I1–I5)

| Interfaz | Extremos | Transporta | Formato |
| --- | --- | --- | --- |
| I1 | Núcleo ↔ TUI | Prompt del empleado / respuesta renderizada | Texto, mismo proceso |
| I2 | Núcleo ↔ Conocimiento | Consulta / nodo citable (`src`, `loc`) | Texto plano vía MCP propio → CLI Graphify |
| I3 | Núcleo ↔ Memoria Compartida | Lectura/escritura de estado de negocio (casos) | SQL sobre archivo SQLite local |
| I4 | Núcleo ↔ A2A | Delegación/coordinación con agentes externos | JSON-RPC |
| I5 | Núcleo ↔ `ModelProvider` | Prompt + herramientas / respuesta del modelo | Claude Agent SDK → Anthropic Messages API (HTTPS) |

## Nivel 2 del núcleo — el turno de principio a fin

El **Selector de Turno** (`src/core/turn-selector/`) es el corazón del sistema: cada interacción (del empleado, de un webhook, de una solicitud A2A entrante) recorre la misma tubería:

1. **Resolución de Turno** (`resolve-turn.ts`) — decide qué agente atiende.
2. **Ensamblador de Contexto** (`assemble-context.ts`) — trae historial/caso (I3) y, si aplica, conocimiento (I2).
3. **Invocador del Modelo** (`invoke-model.ts`) — llama al SDK (I5), dispara hooks.
4. **Despachador de Delegación** (`dispatch-delegation.ts`, `dispatch-delegation-a2a.ts`) — si el modelo decide delegar, resuelve si es un subagente in-process o un agente externo (I4).
5. **Cierre de turno** (`close-turn.ts`) — persiste el resultado en memoria compartida (I3).

Esta misma tubería es la que procesan tanto el prompt de un empleado en la TUI como un webhook de GitHub o una solicitud A2A entrante — no hay un camino de código separado por origen (ver `04-historia-hitos.md`, hito 7, y `02-nucleo.md` para el detalle).

## Decisiones de arquitectura clave (ADRs)

El arc42 documenta ~140 ADRs numerados a lo largo del proyecto (ver `05-proceso-sdd.md` para el detalle por hito). Las dos fundacionales, en el propio `docs/ARC42_Harness_Empresarial.md`:

- **ADR 1** — Estrategia de entrega incremental: v1 lineal (un agente) → v2 swarm (subagentes + A2A cliente) → v3 grafo (A2A servidor). Cada hito cierra con tag semántico + `docs/progreso/`.
- **ADR 2** — Monolito modular vs. monorepo: se descarta monorepo (sugerido por una referencia externa, "Pi") por sobrecarga innecesaria para un MVP de un solo desarrollador; las fronteras de puertos/adaptadores ya alcanzan para migrar después si hiciera falta.

## Riesgos y deuda técnica reconocidos por el propio equipo

El arc42 mantiene una sección viva de riesgos/deuda, actualizada hito a hito (no es un documento estático escrito una vez):

- **Riesgo 1 (abierto)**: un solo proveedor de modelo (Claude Agent SDK) — un segundo proveedor exigiría loop de razonamiento propio.
- **Riesgo 2 (confirmado, sin materializarse)**: concurrencia de escritura SQLite bajo múltiples fuentes (A2A entrante + webhooks) — probado con 3 `SendMessage` concurrentes + 1 webhook sobre el mismo `db`, sin colisión en el escenario probado, pero sin garantía bajo volumen mayor.
- **Deuda 2 (cerrada en v3.0)**: adaptador A2A implementado desde temprano pero sin ejercitar en un flujo real hasta el servidor entrante.
- **Deuda 3 (abierta)**: la meta de usabilidad de la TUI se mide de forma cualitativa, sin validación con usuarios reales todavía.
- **Deuda 4 (cerrada en v3.1)**: "Definición de Skills" del objetivo específico 6 quedó sin implementar hasta `definicion-skills` — el propio arc42 registra que se detectó por auditoría de grep (`Options.skills` nunca se leía en `src/core`), no por diseño anticipado.


## Actualización 2026-09-25

*(Lo anterior describe `v3.4.0`. Detalle completo en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md).)*

**Bloques nuevos** (mismo patrón puerto/adaptador; la regla `core ↛ adapters` sigue en 0 aristas sobre 166 archivos de producción):

| Bloque | Responsabilidad | Ubicación | Hito |
| --- | --- | --- | --- |
| Núcleo de Operaciones | Contrato cerrado de 13 operaciones de negocio (venta, devolución, solicitudes, reembolsos, consultas, KPI…), validación con whitelist y ejecución determinista | `src/core/operaciones/` (5 899 líneas, el módulo más grande del núcleo) | v3.6 → v3.16 |
| Adaptador de Operaciones | Expone ese contrato como tool MCP `operacion_negocio` al turno del empleado (web y TUI) | `src/adapters/operaciones/` | v3.6 |
| Adaptador de Consultas | Tool MCP `consultar_negocio`, de solo lectura, para agentes A2A externos | `src/adapters/consultas/` | v3.8 |
| Adaptador Ops | Cuarto listener HTTP: liveness y readiness (política pura `evaluarReadiness`), apagado por defecto | `src/adapters/ops/` | v3.18 |
| Chat web del empleado | `GET /chat`, `POST /login`, `/logout`, `/operaciones`, con CSP y memoria conversacional | `src/adapters/web/` (2 890 → 7 356 líneas) | v3.6, v3.9 |
| Conversación / Actividad | Puertos angostos: memoria del chat (`conversacion`) y consulta de actividad de solo lectura (`actividad`) | `src/core/conversacion/`, `src/core/actividad/` | v3.8, v3.9 |
| Proceso y cierre | Modo headless, cierre ordenado con presupuesto y watchdog | `src/proceso-cierre.ts` (raíz, composition root) | v3.17 |

**Cambio de forma del canal del empleado:** los comandos slash de negocio de la TUI (`/devolucion`, `/solicitar`, `/cancelar-solicitud`, `/aprobar-*`…) se dieron de baja en v3.6 y v3.10. Hoy el empleado opera en **texto libre**: el modelo elige una operación del contrato cerrado. Las cuatro operaciones que resuelven o retiran algo (`resolver_solicitud`, `resolver_reembolso`, `cancelar_solicitud_interna`, `solicitar_devolucion`) exigen además una confirmación en dos turnos distintos antes de ejecutarse (`adapters/web/confirmacion-operaciones-store.ts`). Es el mismo flujo en la web (v3.6) y en la TUI (v3.19). Los comandos slash quedan solo para sesión y administración (`/login`, `/logout`, `/crear-empleado`, `/asignar-rol`, `/estado-bot-prs`).

**Interfaces nuevas, además de I1–I5:** HTTP del empleado (`POST /login` devuelve un token que el chat guarda en memoria de JS y envía como `Authorization: Bearer`; la cookie HttpOnly figura como Deuda 9) e HTTP ops (salud). El protocolo A2A se usa ahora también **desde el chat** (consulta de KPIs, con un catálogo cerrado de 4 consultas, v3.16).

**Riesgos y deudas del arc42, actualizados:**

- **Riesgos 1–9.** Nuevos: 6 (`resume` de sesión del SDK), 7 (`Map`s sin evicción), 8 (colisión vendedor/empleado) y 9 (flujo de dos personas). El Riesgo 3 se cerró en v3.5 y el 5 se reescribió en v3.20.
- **Deudas 1–13.** Se cerró la **Deuda 5** (autoaprobación de reembolso, v3.10) y se abrieron de la 6 a la 13. Entre ellas, la **Deuda 11** (colisión de numeración de los ADRs 174–187) y las 12/13, de clawback de comisiones (B6/B4, v3.21).
- **ADRs.** El conteo pasó de ~144 a **302**, pero solo los ADR 300–302 tienen encabezado propio en el arc42. El resto vive en los `design.md` de cada change.
