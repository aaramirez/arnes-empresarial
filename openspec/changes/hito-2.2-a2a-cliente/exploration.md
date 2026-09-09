# Exploration: Hito 6 — Comunicación A2A saliente (Cliente A2A)

> Nota de proceso: exploración corrida con `graphify query` disponible (`graphify-out/graph.json` existe en este repo) — se usó para orientar la lectura antes de abrir archivos crudos, más `WebSearch`/`WebFetch` reales contra la especificación oficial de A2A y el registro de npm (no se asumió nada del SDK o del protocolo sin verificar la fuente). Artifact store: `openspec` (archivos versionados), por regla de `AGENTS.md`.

## Corrección de versión (ya decidida por el checkpoint humano — no es pregunta abierta)

`docs/Plan_Implementacion_Harness_Empresarial.md:366` etiqueta este hito como **`v2.1.0 — docs/progreso/v2.1-a2a-cliente/`**. Eso es un error del Plan, confirmado por el propio repo: `v2.1.0` ya está usado por el hito de **escritura delegada** (`openspec/changes/hito-2.1-escritura-delegada/`, rama actual `hito/v2.1-escritura-delegada`, commits recientes `fix(...)(Hito 5.1, code-review hito completo)` en el log). Ese hito ya cerró un ciclo completo de ADR (62-70) y RD (9-18) bajo el nombre `v2.1.0`.

Este change usa el tag/carpeta correcto: **`v2.2.0` / `hito-2.2-a2a-cliente` / `docs/progreso/v2.2-a2a-cliente/`**. La numeración de ADR/RD para la fase de propuesta debería continuar desde donde cerró `hito-2.1` (ADR 71 en adelante, RD-19 en adelante) — dato informativo para el Spec Author de la próxima fase, no una decisión que tome esta exploración.

## Resumen del caso de uso y alcance

Del Plan (líneas 328-366, leídas completas):

- **Madurez del Núcleo:** v2 (A2A cliente) — el arnés delega **hacia afuera**, a un agente externo, por primera vez.
- **Casos de uso:** coordinación de un incidente técnico con un agente externo; consolidado ejecutivo de KPIs; verificación de riesgo/crédito antes de confirmar una venta grande (Hito 4, `src/core/ventas/`) delegada a un agente externo de Finanzas/Riesgo.
- **Componentes:** Cliente A2A (Caja Blanca 3.1, `src/adapters/a2a/client.ts` según arc42 línea 358) ↔ Despachador de Delegación (1.4, `src/core/turn-selector/dispatch-delegation.ts`), vía **I4** (Núcleo ↔ Adaptador A2A, arc42 líneas 226-232: "delegación/coordinación con agentes externos", formato "JSON-RPC sobre el protocolo A2A").
- **Entregable funcional:** el agente delega parte del diagnóstico/consulta a un agente externo real y recibe su resultado (Escenario de ejecución 4 del arc42, líneas 438-454).
- **Tabla propuesta por el Plan:** `delegaciones_a2a` (id, caso_id, agente_externo_url, tarea_delegada, a2a_task_id, estado, resultado, created_at, updated_at) — mismo patrón de correlación caso_id + tarea acotada que `delegaciones` del Hito 5 (v2.0.0).
- **Agentes externos de prueba sugeridos por el Plan:** dos samples de `github.com/a2aproject/a2a-samples`, en Python, cada uno como proceso separado — sample `langgraph` (conversión de moneda) para riesgo/crédito, sample `analytics` (CrewAI, gráficos vía Matplotlib) para KPIs/incidente. No se verificó la existencia actual de esos samples específicos en el repo oficial (fuera del alcance de esta exploración: es una decisión de la fase de tareas/apply, no de diseño).

## Qué ya existe y hay que reusar (no reinventar)

**El Despachador de Delegación (1.4) ya fue diseñado en `hito-2.0-delegacion-subagentes` con este hito en mente.** No hay que proponer un despachador nuevo — el gateway ya existe:

- `src/core/turn-selector/dispatch-delegation.ts` declara `DestinoDelegacion` como unión discriminada (línea 47-49):
  ```ts
  export type DestinoDelegacion =
    | { readonly kind: "in-process"; readonly agentId: string }
    | { readonly kind: "a2a"; readonly agentId: string; readonly endpoint: string };
  ```
- La rama `a2a` HOY lanza `DelegacionA2ANoImplementadaError` (línea 56-64), documentada explícitamente como el **único punto del sistema donde el brazo A2A falla** (ADR 45 punto 2) — y el doc-comment de la clase dice literalmente: *"Hito 6: reemplazar el `throw` que la usa por el Cliente A2A real y BORRAR el test que la asserta"* (línea 52-54).
- `despacharDelegacion` (línea 201-275) ya tiene el punto de enganche exacto: `if (destino.kind === "a2a") { throw new DelegacionA2ANoImplementadaError(destino); }` (línea 216-218) — este `throw` es lo que este hito reemplaza por una llamada real al Cliente A2A.
- `resolverDestino` (línea 80-88) hoy SIEMPRE devuelve `{kind: "in-process", ...}` para todo `agentId` en `SUBAGENT_REGISTRY` — el doc-comment (línea 15-24) documenta que la rama `a2a` "no es alcanzable por esta función en v2.0.0" y que el contrato con Hito 6 es "reemplazar el throw... y borrar ese test" (ADR 45 punto 3). Este hito necesita decidir **cómo** `resolverDestino` (o quien la reemplace) llega a producir `{kind: "a2a", agentId, endpoint}` en producción — hoy nada lo hace, el test de `hito-2.0` lo construye a mano vía el campo opcional `input.destino` de `despacharDelegacion`.
- El test `dispatch-delegation.test.ts` que hoy assertea `DelegacionA2ANoImplementadaError` (documentado en `tasks.md` de `hito-2.0` como "el test que documenta el contrato con Hito 6 — ADR 45 punto 3, borrar en Hito 6") es la pieza concreta a eliminar cuando el Cliente A2A reemplace el `throw`.
- `src/adapters/a2a/` **no existe todavía** — confirmado por el propio doc-comment de `dispatch-delegation.ts` (línea 32-34: *"Deliberadamente ningún import de `src/adapters/a2a/` — ese directorio no existe en este hito (ADR 45 punto 4)"*) y por inspección directa del árbol de adaptadores (`src/adapters/`: `board`, `crypto`, `git`, `knowledge`, `memory`, `notificaciones`, `shared`, `test-runner`, `tui`, `web`, `webhooks` — sin `a2a`).

**Precedentes de convención a reusar, ya asentados en el repo:**

- **Tope de tamaño en caracteres para texto delegado**: `src/core/agents/subagents.ts` define `TAREA_DELEGADA_MAX_CHARS = 8_000` (mitigación de R2) y `construirTareaDelegada` lo aplica con `TAREA_TRUNCADA_SUFIJO`. La tabla `delegaciones_a2a` del Plan reusa literalmente el campo `tarea_delegada` ("texto acotado, igual que en delegaciones (Hito 5)") — mismo tope debería aplicar, salvo decisión explícita en contra.
- **Cliente HTTP saliente con truncado de error**: `src/adapters/board/github-client.ts` y `src/adapters/notificaciones/email-client.ts` ya son adaptadores que hablan HTTP hacia afuera (GitHub API, servicio de email), ambos con `ERROR_BODY_MAX_CHARS = 500` y una función `truncate()` compartida para no persistir/loguear cuerpos de error sin cota. Es el molde estructural más cercano a lo que sería `src/adapters/a2a/client.ts`.
- **Migración de esquema**: `TAREA_DELEGADA_MAX_CHARS`/columnas nullable en `delegaciones` (ADR 48 de `hito-2.0`) es precedente directo para cómo `delegaciones_a2a` debería declarar sus propias columnas (p. ej. si `a2a_task_id`/`resultado` deben ser nullable porque se completan después, mismo criterio "registrar antes de invocar").
- **Test de integración real, gateado**: `src/test/integration/` (Hito 5.1 / `v2.1.0`) ya tiene precedente de un test que lanza un **proceso externo real** (`run-tests.integration.test.ts`, `git` real) con `skip` explícito si el binario falta (RD-17 de `hito-2.1/design.md`), acotado a un puñado de archivos, mientras el resto de la suite usa dobles puros. Es el molde a seguir para probar el Cliente A2A contra un sample real de `a2a-samples` sin volverlo obligatorio en CI.

## Confirmación: A2A no está instalado todavía

`openspec/config.yaml` dice *"Planned (not yet installed): @anthropic-ai/claude-agent-sdk, better-sqlite3 (or similar), Ink (TUI), A2A (JSON-RPC)"*. Verificado contra el repo real:

- `package.json` — sin ninguna dependencia de A2A (`dependencies`/`devDependencies` completos: `@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `dotenv`, `figlet`, `ink`, `ink-spinner`, `react`, `zod`, + dev deps de testing/tipos). Ningún paquete con "a2a" en el nombre.
- `node_modules/@a2a-js` no existe.

Confirmado: el Cliente A2A parte de cero, sin código ni dependencia previa más allá del gateway tipado en `dispatch-delegation.ts`.

## Comparación de opciones para el SDK/cliente A2A (investigación real, no asumida)

Investigado vía `WebSearch`/`WebFetch` contra npm y las fuentes oficiales del protocolo (`a2aproject/A2A`, `a2a-protocol.org`), no por conocimiento previo:

### Opción A — `@a2a-js/sdk` (SDK oficial del proyecto A2A)

- **Qué es:** paquete npm oficial del propio `a2aproject` (mismo dueño que la especificación), instalable con `npm install @a2a-js/sdk`. Repo: `github.com/a2aproject/a2a-js`.
- **Estado verificado (registro de npm, no supuesto):** `dist-tag latest` = **`1.1.0`** (publicado 2026-08-26), con historial `1.0.0-alpha.0` (2025-11-06) → `1.0.0-beta.0` (2025-11-27) → `1.0.0` (2025-12-22) → `1.0.1` (2025-12-28) → `1.1.0`. Es decir: la primera versión estable que implementa A2A v1.0.0 tiene **~9 meses** a la fecha de esta exploración (2026-09-08) — recién salida de beta, no un SDK con años de rodaje.
- **Cobertura:** implementa la especificación A2A v1.0.0 declarada (confirmado por el propio README: *"v1.0 stable release implementing A2A Protocol Specification v1.0"*). Tres transportes — JSON-RPC, HTTP+JSON/REST y gRPC (Node-only) — sobre un único `DefaultRequestHandler`. Expone un `Client` (vía `ClientFactory`) con `sendMessage`, `sendMessageStream`, `getTask`, `cancelTask`. Soporta streaming (eventos `task`/`status-update`/`artifact-update`) y push notifications. Incluye una capa de compatibilidad **opt-in** con v0.3.0 para interoperar con peers viejos durante una migración escalonada.
- **Trade-offs:** trae capacidades que este hito no necesita (REST, gRPC, streaming completo, capa de compat v0.3) — superficie más grande que lo estrictamente requerido (`sendMessage`/`getTask`/`cancelTask` sobre JSON-RPC). Al ser tan reciente, menos precedente de producción y más probabilidad de breaking changes en próximas minor. A favor: mantenimiento activo por el dueño del protocolo, menor riesgo de desalinearse con futuras revisiones del spec (mismo tipo de riesgo de versión que el propio Plan ya señaló entre v0.3.0 y v1.0.0), y evita reimplementar serialización/parsing de tipos del protocolo a mano.

### Opción B — Cliente JSON-RPC hecho a mano (fetch + tipos propios)

- **Qué sería:** un adaptador `src/adapters/a2a/client.ts` que arma manualmente las tres llamadas JSON-RPC 2.0 necesitadas (enviar tarea, consultar estado, cancelar) sobre `fetch` nativo de Node 18+, con tipos TypeScript propios para el subconjunto de la especificación que el arnés realmente usa.
- **Precedente directo en el repo:** exactamente el molde de `src/adapters/board/github-client.ts` y `src/adapters/notificaciones/email-client.ts` — ambos adaptadores HTTP salientes hechos a mano, sin SDK de terceros, con su propio manejo de errores y truncado.
- **Trade-offs:** cero dependencia externa nueva (superficie de auditoría mínima, coherente con el resto de adaptadores del repo, que en general no dependen de SDKs de terceros salvo el propio SDK de Claude y `better-sqlite3`). Contrapartida real: sin garantía de conformidad con el protocolo más allá de lo que se testee a mano, y **hay que rastrear manualmente** cualquier cambio de spec — el propio Plan ya señala el precedente de que v0.3.0→v1.0.0 fue un cambio incompatible de nombres de método (`message/send`→`a2a/sendMessage` según el Plan; ver corrección más abajo). Más código propio para escribir/testear, pero acotado: solo 3 métodos JSON-RPC, no el protocolo completo.

### Opción C — SDKs comunitarios no oficiales (descartados, no investigados en profundidad)

`WebSearch` encontró además `Dexwox-Innovations-Org/a2a-node-sdk` (monorepo TS/Node no oficial), `@ryukez/a2a-sdk` y `@agentic-profile/a2a-client` en npm. Se los nombra por completitud de la búsqueda pero no se profundizó: son paquetes de mantenimiento individual/no oficial, con mucho menos precedente que la Opción A y sin ninguna ventaja clara sobre la Opción B (si de todos modos hay que confiar en un mantenedor chico, escribir el cliente propio da más control). No se descarta que la fase de propuesta quiera revisarlos, pero esta exploración no encontró motivo para preferirlos sobre A o B.

## Corrección verificada contra la especificación real (no es una pregunta abierta — ya se comprobó)

El Plan (línea 354) dice, citando "verificado contra la especificación v1.0.0, vigente": los métodos son `a2a/sendMessage`, `a2a/getTask`, `a2a/cancelTask`, y la tabla propuesta (línea 345) versiona `estado` con valores en minúscula-con-guion: `'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'rejected' | 'auth-required'`.

**Verificado de nuevo en esta exploración, contra dos fuentes independientes de la especificación real** (`github.com/a2aproject/A2A/blob/main/docs/specification.md` §5.3/§9.4, y `a2a-protocol.org/v1.0.0/specification/` §4.1.3/§9.4) — ambas coinciden entre sí:

- **Nombres de método reales en v1.0.0:** `SendMessage`, `GetTask`, `CancelTask` — **sin** el prefijo `a2a/` y en PascalCase (estilo servicio Protobuf), no `a2a/sendMessage`/`a2a/getTask`/`a2a/cancelTask` como dice el Plan.
- **Valores reales de `TaskState` en v1.0.0:** `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_REJECTED`, `TASK_STATE_AUTH_REQUIRED` (SCREAMING_SNAKE_CASE con prefijo `TASK_STATE_`, serialización ProtoJSON) — **no** los strings en minúscula-con-guion que trae el Plan.
- El Agent Card se publica en `/.well-known/agent-card.json` (renombrado desde `/.well-known/agent.json` de v0.3.0) — dato adicional no mencionado por el Plan, relevante para la pregunta de descubrimiento más abajo.

Esto **no invalida** la decisión ya tomada por el checkpoint de usar v1.0.0 (el Plan tiene razón en que v0.3.0 es incompatible y hay que evitarla) — pero el `CREATE TABLE delegaciones_a2a` y la lista de métodos JSON-RPC tal como están escritos en el Plan (línea 339-354) usan naming que no coincide con la especificación real y tendrían que corregirse en la fase de propuesta/diseño (los valores de `estado` en la columna `TEXT` de SQLite, y los nombres de método que arme el cliente). Se documenta acá como corrección verificada, no como pregunta — el checkpoint humano puede decidir si prefiere seguir versionando `estado` en minúscula por legibilidad interna del arnés (una capa de mapeo propia) o adoptar los valores `TASK_STATE_*` tal cual vienen del protocolo; lo que no es discutible es que el Plan cita mal los nombres reales de v1.0.0.

## Preguntas abiertas para el checkpoint humano (decisiones de arquitectura reales — no las resuelve esta exploración)

1. **SDK cliente A2A: Opción A (`@a2a-js/sdk` oficial) vs Opción B (cliente JSON-RPC a mano)** — ver comparación arriba. Ninguna es objetivamente correcta: A da conformidad de protocolo mantenida por terceros a cambio de una dependencia nueva y reciente; B da control total y cero dependencia a cambio de mantener la conformidad a mano. Si se elige A, falta decidir si se consume solo el subconjunto JSON-RPC (`sendMessage`/`getTask`/`cancelTask`) ignorando REST/gRPC/streaming, o si el streaming del SDK reemplaza directamente la pregunta 3 de abajo.

2. **Descubrimiento del Agent Card** — el Plan dice que el Cliente A2A "obtiene el Agent Card... en una URL bien conocida del agente externo" (confirmado: `/.well-known/agent-card.json` en v1.0.0), pero no dice **de dónde sale esa URL por caso concreto**. Opciones no resueltas: (a) un campo nuevo en el caso/actividad (¿quién lo completa — el Empleado, un comando?), (b) una config estática de un único agente externo fijo por ahora (MVP: un solo endpoint hardcodeado o por variable de entorno, sin descubrimiento dinámico todavía), (c) algo derivado del propio prompt/actividad (p. ej. el tipo de actividad `incidente`/`kpi`/`riesgo-credito` mapea a un endpoint fijo por tipo). El Plan sugiere DOS agentes de prueba con dominios distintos (riesgo/crédito vs KPIs), lo cual empuja hacia (b) o (c) más que hacia (a) — pero es una decisión real, no zanjada acá.

3. **Polling vs. push para `TaskState`** — A2A v1.0.0 soporta tanto consulta (`GetTask`) como streaming de actualizaciones (confirmado por el SDK oficial: eventos `task`/`status-update`/`artifact-update`, más push notifications). El arnés ya tiene un adaptador de entrada por webhook (Hito 3, `src/adapters/webhooks/`) que podría, en teoría, recibir push notifications de A2A — pero ese adaptador es HOY exclusivamente de **entrada** (traduce eventos de GitHub a turnos), sin ningún camino de salida ni acoplamiento con el Cliente A2A. Adoptar push implicaría o bien construir un segundo servidor de escucha (parecido a `webhooks/server.ts` pero para callbacks de A2A) o extender el existente — ninguna de las dos cosas está diseñada. Polling vía `GetTask` es más simple y no requiere abrir un puerto nuevo, pero introduce latencia y turnos "en espera".

4. **Esta es la decisión de mayor riesgo arquitectónico**, señalada explícitamente porque puede no ser solo una elección local: **¿el Despachador de Delegación bloquea/espera hasta un estado terminal de `TaskState` (`completed`/`failed`/`canceled`/`rejected`) antes de continuar el resto del turno, o el turno sigue con un placeholder y el resultado llega después, de forma verdaderamente asíncrona?**
   - El **Escenario de ejecución 4 del arc42** (líneas 438-454), tal como está escrito HOY, describe un flujo **síncrono**: "el agente externo procesa la solicitud y devuelve su resultado... el Cliente A2A entrega el resultado al Despachador... continúa como el Escenario 3 desde el paso 6 (el resultado se incorpora como tool result y el turno del padre cierra normal)" — es decir, el arc42 asume que la respuesta llega dentro del mismo turno, igual que la delegación in-process del Hito 5.
   - Pero el propio modelo de `TaskState` de A2A (con `submitted`/`working` como estados intermedios reales, no solo teóricos) sugiere que un agente externo puede tardar — el sample `langgraph` sugerido por el Plan "ejercita un ciclo de tarea real con herramientas", no un eco instantáneo.
   - Si la respuesta puede demorar más que un turno razonable, esto sería el **primer camino verdaderamente asíncrono del arnés**: toda la arquitectura hasta acá (Hito 1 a Hito 5, incluida la cadena Planner→Developer→Reviewer de `despacharCadena`) es síncrona-por-turno, `await` tras `await`, sin ningún mecanismo de "continuar más tarde" ni de reanudar un caso desde un estado pendiente de una llamada externa que todavía no volvió.
   - Esta decisión determina si `delegaciones_a2a.estado`/`a2a_task_id`/`updated_at` son solo trazabilidad de una llamada que de todos modos se espera sincrónicamente (bloqueando con polling interno hasta terminal, análogo a como `despacharDelegacion` ya hace `await invocar(...)`), o si de verdad hay que introducir un mecanismo nuevo (¿un caso que queda en un estado "esperando A2A" y un proceso separado que lo retoma cuando el estado externo llega a terminal, sea por poll periódico o por push?). El checkpoint humano tiene que decidir esto explícitamente — no es algo que la exploración pueda zanjar sin conocer el apetito del proyecto por introducir asincronía real.

5. **Testing sin infraestructura externa real** — mismo criterio que el resto del repo (dobles inyectables + a lo sumo una categoría de test de integración real, opcional, gateada):
   - El puerto que el Despachador consume del Cliente A2A debería ser inyectable (mismo molde que `InvocarSubagente` en `subagents.ts`), para que `despacharDelegacion`/`despacharCadena` se sigan testeando con dobles puros, sin red.
   - Para el propio `src/adapters/a2a/client.ts`, el molde de `src/test/integration/` (Hito 5.1, `run-tests.integration.test.ts`, `git` real con `skip` si falta el binario) es el precedente directo: un test de integración opcional que levanta (o asume levantado) uno de los samples de Python de `a2a-samples` como proceso externo, gateado, sin bloquear el resto de la suite si no está disponible.
   - Falta decidir si el hito incluye instrucciones/script para levantar esos samples de Python (dependencia cruzada de otro lenguaje/runtime, algo que el repo no tiene hoy) o si el test de integración asume un servidor ya corriendo en `localhost` sin automatizar su arranque.

## Archivos relevantes citados (rutas relativas al repo)

- `docs/Plan_Implementacion_Harness_Empresarial.md` (líneas 328-366, Hito 6)
- `docs/ARC42_Harness_Empresarial.md` (líneas 188-198 Adaptador A2A, 226-232 I4, 350-364 Cajas Blancas 3.1/3.2, 438-454 Escenario de ejecución 4)
- `src/core/turn-selector/dispatch-delegation.ts` (completo — `DestinoDelegacion`, `DelegacionA2ANoImplementadaError`, `resolverDestino`, `despacharDelegacion`, ADR 45)
- `src/core/agents/subagents.ts` (líneas 1-120 — `TAREA_DELEGADA_MAX_CHARS`, `construirTareaDelegada`, `InvocarSubagente`)
- `src/adapters/board/github-client.ts`, `src/adapters/notificaciones/email-client.ts` (precedente de cliente HTTP saliente con truncado de error)
- `src/adapters/webhooks/` (precedente de adaptador HTTP, pero de **entrada**, no de salida)
- `src/test/integration/run-tests.integration.test.ts` (precedente de test de integración real gateado)
- `openspec/config.yaml` (confirma A2A "Planned (not yet installed)")
- `openspec/changes/hito-2.0-delegacion-subagentes/` y `openspec/changes/hito-2.1-escritura-delegada/` (completos — molde de formato/profundidad y numeración de ADR/RD)
- `package.json` (confirma ausencia de cualquier dependencia A2A)
- Fuentes externas verificadas: `github.com/a2aproject/A2A/blob/main/docs/specification.md`, `a2a-protocol.org/v1.0.0/specification/`, `a2a-protocol.org/latest/whats-new-v1/`, `github.com/a2aproject/a2a-js`, `registry.npmjs.org/@a2a-js/sdk`
