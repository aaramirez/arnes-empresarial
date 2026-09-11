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

### Variables de entorno del cliente A2A saliente

Configuración del cliente A2A saliente (Hito 6, `src/adapters/a2a/config.ts`) usado para delegar hacia destinos externos (`riesgo-credito`, `kpi-incidente`). Todas son opcionales y comentadas por defecto en `.env.example` — con `HARNESS_A2A_SALIENTE` apagado el comportamiento es idéntico a v2.1.0. Los valores numéricos son best-effort: ausente, vacío o inválido cae al default sin lanzar:

| Variable | Default | Descripción |
| --- | --- | --- |
| `HARNESS_A2A_SALIENTE` | apagado | Interruptor **opt-in**: sólo `"on"` (tras trim + lowercase) activa el mecanismo. Al revés que `HARNESS_DELEGACION_ROLES`/`HARNESS_ESCRITURA_DELEGADA`, que están activos por default. |
| `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` | — (sin default) | URL base (Agent Card) del destino `riesgo-credito`. Ausente = destino no disponible. |
| `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` | — (sin default) | URL base (Agent Card) del destino `kpi-incidente`. Ausente = destino no disponible. |
| `HARNESS_A2A_TOKEN_RIESGO_CREDITO` | — (sin default) | Bearer token opcional para `riesgo-credito`. Nunca aparece en un log ni en un mensaje. |
| `HARNESS_A2A_TOKEN_KPI_INCIDENTE` | — (sin default) | Bearer token opcional para `kpi-incidente`. Nunca aparece en un log ni en un mensaje. |
| `HARNESS_A2A_REQUEST_TIMEOUT_MS` | `30_000` | Timeout (ms) por request JSON-RPC individual. |
| `HARNESS_A2A_POLL_INTERVAL_MS` | `1_500` | Intervalo (ms) entre consultas del loop de polling de `GetTask`. |
| `HARNESS_A2A_TASK_TIMEOUT_MS` | `120_000` | Timeout total (ms) del loop de polling antes de `CancelTask` con motivo `"timeout"`. |
| `VENTA_GRANDE_UMBRAL` | `5_000` | Umbral de venta grande (`src/core/ventas/ventas-config.ts`). A partir de este monto, `registrarVenta` dispara una consulta de riesgo/crédito no bloqueante hacia `riesgo-credito`. |

El comando TUI privilegiado `/consultar-kpi <consulta>` (Hito 6, ADR 85) es el productor real del destino `kpi-incidente`: **espera** (síncrono, bloqueante) la respuesta del agente externo antes de responder — con `HARNESS_A2A_SALIENTE` apagado responde que está desactivado, sin crear caso ni fila.

#### Cómo correr la integración A2A contra un sample real

`src/test/integration/a2a-client.integration.test.ts` sondea el Agent Card del destino configurado (`GET .well-known/agent-card.json`) antes de decidir si corre contra la red real o degrada a *skip* — mismo molde que el test de integración de `git`/`vitest` (`src/test/integration/run-tests.integration.test.ts`), nunca falla por una dependencia externa ausente. Para levantar un sample a mano y correrlo de verdad:

1. Cloná [`a2aproject/a2a-samples`](https://github.com/a2aproject/a2a-samples) y levantá el sample `helloworld` (`samples/python/agents/helloworld`, `python -m venv .venv`, `python __main__.py`) — o cualquier otro agente conforme a A2A v1.0.0 que publique su Agent Card en `/.well-known/agent-card.json` con un transporte JSON-RPC declarado.
2. Exportá `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO=http://localhost:<puerto>` apuntando a ese sample (sin barra final).
3. Corré `npm test`. Con el sample arriba, el archivo corre sus dos primeros tests contra la red real.
4. (Opcional, evidencia RD-26): levantá un segundo sample y exportá también `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` apuntando a él — el tercer test del archivo corre exactamente el mismo código contra ese segundo destino, como evidencia de que el cliente es agnóstico al dominio.

Sin ninguna de esas dos variables (o con el sample caído/inalcanzable), el `describe` entero se reporta como **skipped**, nunca como fallo — el estado esperado en CI y en cualquier checkout sin un sample corriendo a mano.

### Variables de entorno del servidor A2A entrante

Configuración del servidor A2A entrante (Hito 7, `src/adapters/a2a/server-config.ts`) que expone el arnés como agente invocable por otros agentes A2A externos. El único gate del listener es el token: con `HARNESS_A2A_ENTRANTE_TOKEN` ausente o en blanco, el adaptador queda deshabilitado y no se abre ningún puerto. Los valores numéricos son best-effort: ausente, vacío o inválido cae al default sin lanzar:

| Variable | Default | Descripción |
| --- | --- | --- |
| `HARNESS_A2A_ENTRANTE_TOKEN` | `""` (deshabilitado) | Bearer token que exige `POST /a2a`. `""` o sólo espacios = servidor apagado, sin puerto abierto. Nunca aparece en un log ni en un mensaje. |
| `HARNESS_A2A_ENTRANTE_PORT` | `8888` | Puerto TCP en el que escucha el servidor HTTP entrante. |
| `HARNESS_A2A_ENTRANTE_PUBLIC_URL` | `http://localhost:8888` | Base pública publicada en `supportedInterfaces[0].url` del Agent Card. Se normaliza sin `/` final. |
| `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES` | `65_536` (64 KiB) | Tope de tamaño del body de `POST /a2a`; por encima, `413` sin parsear. |
| `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | `4` | Tope de turnos A2A entrantes en curso simultáneamente; por encima, el `SendMessage` sobrante responde `REJECTED` sin crear caso. |

### Cómo consultar el arnés como agente A2A

Con `HARNESS_A2A_ENTRANTE_TOKEN` seteado y el arnés levantado, el servidor expone dos rutas: el Agent Card en `GET /.well-known/agent-card.json` (sin autenticación) y el endpoint JSON-RPC en `POST /a2a` (con `Authorization: Bearer <token>`).

1. Consultar el Agent Card (sin auth):

   ```sh
   curl http://localhost:8888/.well-known/agent-card.json
   ```

2. Enviar una consulta con `SendMessage` (responde `SUBMITTED` de inmediato — el turno sigue en curso en background):

   ```sh
   curl -X POST http://localhost:8888/a2a \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "SendMessage",
       "params": {
         "message": {
           "parts": [{ "text": "¿En qué estado está la revisión del PR 42 del proyecto X?" }]
         }
       }
     }'
   ```

   La respuesta trae `result.task.id` (el `a2aTaskId` a usar en el loop de `GetTask`) y `result.task.status.state: "TASK_STATE_SUBMITTED"`.

3. Hacer polling de la tarea con `GetTask` hasta que `status.state` sea un estado terminal (`TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_REJECTED` o `TASK_STATE_CANCELED`):

   ```sh
   curl -X POST http://localhost:8888/a2a \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 2,
       "method": "GetTask",
       "params": { "id": "<a2aTaskId devuelto por SendMessage>" }
     }'
   ```

   Reintentar cada `HARNESS_A2A_POLL_INTERVAL_MS` (mismo intervalo que usa el Cliente A2A saliente propio) hasta un estado terminal. En `TASK_STATE_COMPLETED`, el texto de la respuesta viaja en `result.task.artifacts`.

### Tool MCP `mcp__worktree__run_tests`

Expuesta únicamente al Developer cuando trabaja dentro de un worktree aislado. No acepta parámetros — siempre corre la suite completa (`vitest run`) fijada al `cwd` del worktree, sin poder filtrar por archivo, patrón ni test individual. Devuelve el resultado real (verde o rojo) con la salida de vitest, o indica explícitamente si la corrida no se pudo ejecutar en vez de afirmar que los tests pasan.

### Comandos de propuesta de cambio

Comandos TUI privilegiados (Hito 5.1) para revisar el diff que produjo el Developer antes de aplicarlo:

| Comando | Uso | Descripción |
| --- | --- | --- |
| `/ver-propuesta` | `/ver-propuesta [propuestaId]` | Muestra una propuesta de cambio pendiente (lista las pendientes si se omite el id). |
| `/aplicar-propuesta` | `/aplicar-propuesta <propuestaId>` | Aplica el patch de una propuesta de cambio aprobada. |
| `/descartar-propuesta` | `/descartar-propuesta <propuestaId> [motivo]` | Descarta una propuesta de cambio pendiente sin aplicarla. |

### Comandos de solicitud interna

Comandos TUI privilegiados para resolver una solicitud interna (`/solicitar`) mientras está `pendiente_aprobacion_humana`:

| Comando | Uso | Descripción |
| --- | --- | --- |
| `/aprobar-solicitud` | `/aprobar-solicitud [solicitudId]` | Aprueba una solicitud interna pendiente (lista las pendientes si se omite el id). |
| `/rechazar-solicitud` | `/rechazar-solicitud [solicitudId]` | Rechaza una solicitud interna pendiente (lista las pendientes si se omite el id). |
| `/cancelar-solicitud` | `/cancelar-solicitud [solicitudId]` | Retira una solicitud propia que todavía está pendiente (lista las pendientes si se omite el id). |

`/aprobar-solicitud` y `/rechazar-solicitud` los ejecuta cualquier empleado autorizado sobre solicitudes de otros. `/cancelar-solicitud`, en cambio, sólo lo puede ejecutar el propio solicitante (`solicitud.solicitanteId === sesion.empleadoId`) — un tercero recibe un rechazo sin ver el `detalle` de la solicitud. Los tres comandos sólo alcanzan una solicitud en estado `pendiente_aprobacion_humana`: una ya `aprobada`, `rechazada` o `cancelada` responde igual que un id inexistente. No existe `/reabrir-solicitud`: cancelar deja la solicitud en un estado terminal.

### Reporte de comisiones: dos vías

Desde v3.2.0 hay dos formas de generar el mismo reporte mensual, y conviven a propósito (ADR 118) — no una reemplaza a la otra:

| Vía | Cuándo usarla | Requiere sesión |
| --- | --- | --- |
| `npm run reporte:mensual -- --periodo <YYYY-MM>` | Operar la máquina: SSH, un `cron` del sistema operativo, un pipe a un archivo, o cualquier caso sin la TUI montada. | No |
| `/reporte-comisiones [periodo]` (comando TUI privilegiado) | Operar el negocio: un empleado con sesión (`/login`) consulta el reporte durante su turno conversacional. | Sí |

Sin argumento, ambas resuelven al mes corriente. Las dos vías reusan exactamente las mismas funciones puras y los mismos lectores del repositorio, así que no pueden divergir.

> **Ancho de terminal**: el reporte usa un layout de 77 columnas fijas; en terminales más angostas Ink lo envuelve línea por línea. Recomendado: terminal ≥80 columnas al usar `/reporte-comisiones`.

### Comandos de visibilidad A2A entrante

Desde v3.4.0, comando TUI privilegiado (`privilegiado: true`) de solo lectura sobre las solicitudes A2A que otros agentes externos enviaron al arnés:

| Comando | Uso | Descripción |
| --- | --- | --- |
| `/ver-solicitudes-a2a` | `/ver-solicitudes-a2a [a2aTaskId]` | Sin argumento, lista las solicitudes A2A entrantes en curso; con `a2aTaskId`, muestra el detalle de una. |

El protocolo A2A v1.0.0 no transporta la identidad del agente externo que envió la solicitud: la columna correspondiente se rotula **"origen de transporte"**, nunca "agente" ni "solicitante" — es la dirección de red por la que llegó el mensaje, no una identidad verificada. `agente_externo_url` es siempre `NULL` en este hito.

`/ver-solicitudes-a2a` es de **sólo lectura**: si una fila queda huérfana (por ejemplo, en `TASK_STATE_WORKING` porque el proceso que la atendía terminó sin actualizar su estado), este comando la hace visible pero no actúa sobre ella. Cancelarla o reconciliarla con un barrido de arranque queda fuera de su alcance.

### Skills (`.claude/skills/`)

El arnés descubre skills en `.claude/skills/<nombre>/SKILL.md` — no en `src/core/skills/` (ese directorio es el cargador en TypeScript; el contenido de cada skill vive en el árbol versionado del repo, fuera de `src/`). Una skill empaqueta un procedimiento opcional que el modelo puede elegir invocar durante el turno; a diferencia de `allowedTools`, habilitarla no concede ninguna herramienta nueva.

**Cómo se agrega una skill**: crear una carpeta bajo `.claude/skills/` con un `SKILL.md` cuyo frontmatter declare exactamente dos campos — `name` (idéntico al nombre de la carpeta) y `description` (hasta 1024 caracteres, la única señal que el modelo ve antes de decidir si invoca). Ningún otro campo de frontmatter está permitido: `allowed-tools`, `model`, `license`, `metadata` o cualquier otro aborta el arranque del arnés. Agregar una skill no requiere ninguna edición en `src/core/` — el cargador la descubre sola, al arrancar.

**Los tres límites de contenido (ADR 106)** — toda skill nueva se revisa contra estos tres antes de mergear:

1. **Nada del camino del dinero**: cero menciones a comisiones, reembolsos, confirmación de venta o escalaciones; cero referencias a `src/core/ventas/`.
2. **Ninguna herramienta que el agente invocante no tenga ya**: una skill empaqueta un procedimiento sobre herramientas/contexto que el agente ya tiene concedidos, nunca amplía su `allowedTools`.
3. **Cero secretos**: ninguna credencial, token ni ruta de datos real dentro del `SKILL.md`.

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
