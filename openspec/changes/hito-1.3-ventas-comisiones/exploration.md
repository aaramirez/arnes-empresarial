# Exploration: Hito 4 — Confirmación de venta y comisiones (v1.3.0)

## Current State

- **Hito 3's `runActivityTurn` shape does not fit this hito's core computation as-is.** `runActivityTurn` (`src/core/activity/run-activity-turn.ts:154`) assumes EVERY event produces exactly one LLM turn whose free-text verdict (`parseVeredicto`, `src/core/activity/transicion-estado.ts:71`) drives a state transition. Hito 4's commission calc and refund-threshold check are explicitly described in the plan as deterministic ("monto × porcentaje fijo", "monto < umbral") — no LLM judgment involved. Reusing the `runActivityTurn` shape verbatim would force a synthetic LLM call to rubber-stamp a multiplication, adding cost/latency/nondeterminism to a financial calculation for zero benefit. This is the central architectural tension of this hito, and it doesn't have a precedent in the repo yet — Hito 3 never had a "turn" that skips the model.
- **`src/core/skills/` and `src/core/commands/` are 100% documented, 0% implemented.** Both appear in arc42 Nivel 2 (Caja Blanca bloques 3 and 5, `docs/ARC42_Harness_Empresarial.md:266-294`) as architectural placeholders ("Registro de Comandos" → `src/core/commands/`, "Registro de Skills" → `src/core/skills/`), but no file exists under either path (confirmed via full `src/**/*.ts` listing). `src/core/agents/definitions.ts`'s own module doc says it plainly: "Comandos/Skills are still not exercised in this hito" (referring to Hito 2). This hito is the FIRST to actually need either concept for real — there is no existing shape to copy, only a one-paragraph responsibility statement in the arc42.
- **No email/notification adapter exists anywhere in the repo.** `package.json` has zero HTTP/mail client dependencies (`@anthropic-ai/claude-agent-sdk`, `better-sqlite3`, `dotenv`, `figlet`, `ink`, `ink-spinner`, `react`, `zod` — that's the full list). Node has no built-in SMTP client (unlike HMAC, where `node:crypto` was a ready-made precedent for Hito 3) — this is a genuine capability gap, not just an unexplored option.
- **The board adapter (Hito 3) already establishes the outbound-HTTP precedent this hito needs.** `src/adapters/board/github-client.ts` takes an injectable `fetchFn: FetchFn` (`github-client.ts:108`) wrapping native `fetch`, with `resolveBoardConfig(env)` (`src/adapters/board/config.ts:56`) as the pure env→config pattern — same shape `resolveWebhookConfig` uses. Any transactional-email HTTP API (Resend, SendGrid) fits this exact mold with zero new dependencies.
- **`db.ts` already has WAL enabled** (`src/adapters/memory/db.ts:42`, `db.pragma("journal_mode = WAL")`) and `createKeyedQueue()` (`src/core/concurrency/keyed-queue.ts:39`) is a generic, dependency-free, by-key serialization queue — both are drop-in reusable for this hito's `vendedor_id` key, no changes needed to either file.
- **arc42's I1-I5 interface catalog does not cover Hito 3's webhooks/board adapters either** (`docs/ARC42_Harness_Empresarial.md:200-240` lists only TUI/Knowledge/Memory/A2A/ModelProvider) — Hito 3 introduced two new adapters ad hoc without retrofitting an "I6"/"I7". This means Hito 4's Web/Notificaciones adapter following the same "introduced ad hoc, not cataloged" pattern is *consistent with precedent*, not a new gap.
- **No CRM/customer-identity adapter exists.** Grep across `src/` for `vendedor`/CRM concepts returns nothing outside `bootstrap.ts` (unrelated match) — confirmed greenfield.
- **Asymmetry in the plan's own schema**: `vendedores` is a real table the plan defines (`id`, `nombre`, `created_at`) — Hito 4 needs at least an `upsertVendedor` analogous to Hito 3's `upsertProyecto`/`upsertResponsable` (`src/adapters/memory/repository.ts:339,384`). `cliente_id`, by contrast, has **no table at all** in the plan's SQL — it's a bare `TEXT NOT NULL` column on `ventas` with no FK. This asymmetry is a real signal: `vendedor_id` needs minimal resolution machinery this hito must build; `cliente_id` looks intentionally out of scope (opaque identifier from whoever triggers the sale).
- **The plan's HITL framing is chronologically backward.** Line 275 says refund-over-threshold uses "el mismo patrón HITL del Hito 5" — but Hito 5 (delegación a subagentes, HITL for internal requests) ships AFTER Hito 4 in the plan's own sequence (`docs/Plan_Implementacion_Harness_Empresarial.md:21,55-59`, `226-289`). There is no existing HITL implementation in the codebase to reuse — grepping for "HITL"/"humano"/"escalar" across `docs/` only turns up Hito 5's OWN description of the pattern, never actual code. This hito is really the FIRST to design and implement human escalation, and Hito 5 will likely reuse WHATEVER this hito builds, not the other way around.
- **TDD estricto activo** (same precedent as Hito 3): any HTTP endpoint, email content, or commission math needs pure functions + fixtures, not real network calls in the default suite — same `fetchFn`/`createServer` injectable pattern Hito 3 already established for `board`/`webhooks`.

## Affected Areas

- `src/adapters/web/` or `src/adapters/ventas/` (new folder, name TBD in propose) — `GET/POST /confirmar/:token`, `POST /soporte`, `POST /devolucion`, molded on `src/adapters/webhooks/server.ts`'s `createRequestListener`/`startServer` split (structural precedent, not the HMAC-verification part — see point 1 below).
- `src/adapters/notificaciones/` or folded into the same adapter above (new) — outbound email; needs a `fetchFn`-injectable client like `src/adapters/board/github-client.ts` if a provider API is chosen, or a dev-mode-only logger if minimalism wins (see point 2).
- `src/core/ventas/` (new, analogous to `src/core/activity/`) — `ventas-contract.ts` (no imports, ports + constants, mirrors `src/core/activity/activity-contract.ts` and `src/core/knowledge/knowledge-contract.ts`), plus pure functions for commission calc and refund-threshold evaluation (mirrors `transicion-estado.ts`'s "pure, no I/O" style).
- `src/core/skills/` and `src/core/commands/` (new — FIRST real implementation of both arc42-documented, never-built registries) — highest-uncertainty affected area; their minimal shape is undecided (see points 3 and 5).
- `src/adapters/memory/migrations/000X_ventas_comisiones_vendedores.ts` (new) — `vendedores`, `ventas`, `comisiones` per the plan's SQL, following `migrations/0003_proyectos_responsables_actividades.ts`'s style (`TEXT` open enums, no `CHECK` constraints, `IF NOT EXISTS`).
- `src/adapters/memory/repository.ts` — new CRUD functions: `upsertVendedor`, `createVenta`, `findVentaByToken`, `updateVentaEstado`, `createComision`, `createCasoConVenta`(?) — TBD in design whether ventas needs a `createCasoConX` transaction helper like `createCasoConActividad` (`repository.ts:568`), since `ventas.caso_id` links to `casos` the same way `actividades.caso_id` does.
- `src/core/concurrency/keyed-queue.ts` — reused unmodified, keyed by `vendedor_id` instead of `proyecto_id` (confirmed generic, zero changes needed).
- `src/adapters/memory/db.ts` — WAL already active, no change needed (confirmed, contrary to what would need adding if this were greenfield).
- `src/main.ts` and a new `src/build-on-venta.ts` (or similar, mirroring `build-on-activity.ts`) — composition root wiring for a THIRD source of "activity" (TUI, webhooks-GitHub, now web-ventas) — or, if propose decides confirm/refund bypass `handleTurn` entirely, this file may NOT be a turn-builder at all, just direct calls into `src/core/ventas/`. This decision cascades into whether `main.ts` grows a third `try`/`catch` block like the webhook one, or something structurally different.
- `package.json` — candidate for **zero new dependencies** if a fetch-based email API is chosen (same minimalism precedent as ADR 3/3.1 from Hito 2 and the board adapter's `fetch` choice), or one new dependency if `nodemailer`/SMTP is chosen instead (see point 2 — this is the one place this hito genuinely risks breaking the "no new deps" streak, because Node has no native SMTP client).

## Investigación por punto — opciones comparadas

### 1. Cómo entra el turno HTTP de venta/soporte/devolución, y si de verdad necesita ser un "turno"

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. Todo pasa por `handleTurn` (uniforme, molde `runActivityTurn`) | El adaptador web arma un prompt sintético para CADA endpoint (confirmar, soporte, devolución) y siempre invoca al modelo | Un solo patrón de wiring en todo el repo, consistente con Hito 3 | Fuerza una llamada LLM a evaluar `monto × porcentaje` y `monto < umbral` — el propio plan dice que esto es determinístico; agrega costo, latencia y una fuente de no-determinismo a un cálculo financiero sin ninguna ganancia funcional | Medium |
| B. Ruteo asimétrico por endpoint (recomendado) | `/confirmar` y `/devolucion` bajo el umbral llaman DIRECTO a funciones puras de `src/core/ventas/` (sin `handleTurn`, sin LLM); `/soporte` (y `/devolucion` sobre el umbral, si se quiere un resumen humano-legible) sí pasa por `handleTurn`, reusando el patrón `caso` tipo `soporte` | Cada caso de uso usa la herramienta que necesita: reglas determinísticas no pagan el costo de un LLM, la consulta de soporte (que sí se beneficia de conversación real) sí lo usa | Dos caminos de wiring distintos en el mismo adaptador — más superficie conceptual que el molde uniforme de Hito 3 | Medium |
| C. Todo evita `handleTurn`, incluido soporte | El caso de soporte también se resuelve con lógica determinística/plantilla, sin agente conversacional | Máxima simplicidad, cero riesgo de no-determinismo | Pierde el valor real de un agente conversacional para triage de soporte (el propio plan lo agrupa como caso de uso "empresarial" junto a los otros dos, sugiriendo que sí espera conversación) | Low |

**Autenticidad del link de confirmación** (no hay firma HMAC posible — no hay un tercero como GitHub firmando la request):

| Opción | Descripción | Pros | Contras |
|---|---|---|---|
| A. Solo `token_confirmacion` único (tal cual el plan) | UUID/random en la URL, columna `UNIQUE` | Simple, ya está en el esquema propuesto | Sin expiración: un link viejo sigue siendo válido indefinidamente; sin invalidación explícita tras el primer uso más allá de lo que ya implica el cambio de `estado` |
| B. Token + expiración (`expires_at`, columna nueva) | Igual que A, más un timestamp de vencimiento chequeado en el handler | Cierra una ventana de uso real; estándar para links transaccionales | Columna nueva no contemplada en el esquema del plan — hay que confirmarlo en propuesta, no asumirlo |
| C. Token + un solo uso explícito | El handler chequea `ventas.estado === 'pendiente_confirmacion'` ANTES de aplicar la confirmación — si ya no lo es (reusado, ya confirmado o rechazado), responde sin efecto | Se obtiene casi gratis: `ventas.estado` YA transiciona fuera de `pendiente_confirmacion` al confirmar, así que un segundo POST con el mismo token es naturalmente un no-op si el handler lo chequea explícitamente — no requiere columna nueva | No cubre el caso "link válido pero viejo" (una venta puede quedar `pendiente_confirmacion` semanas) — la expiración (opción B) es el único gap real que el esquema actual no resuelve solo |

**Recomendación de esta exploración:** B + C (verificación de estado actual antes de aplicar la transición) como mínimo; expiración (B de la segunda tabla) es una decisión de propuesta, no algo que el esquema dado resuelva automáticamente.

### 2. Envío de email saliente

Node no tiene cliente SMTP nativo (a diferencia de `node:crypto` para HMAC en Hito 3, acá no hay un módulo built-in equivalente) — gap real, no solo falta de exploración previa.

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. Proveedor transaccional vía `fetch` nativo (Resend/SendGrid REST API) | Mismo molde que `github-client.ts`: `fetchFn` inyectable, `resolveEmailConfig(env)` puro | Cero dependencias nuevas (reusa el precedente exacto del adaptador de Tablero); testeable con `fetchFn` doble, igual que el board adapter | Requiere una cuenta/API key de un proveedor externo — dependencia operacional, no de código | Low |
| B. `nodemailer` sobre SMTP | Librería madura, cualquier proveedor SMTP sirve | Ampliamente usada, buena documentación | Primera dependencia nueva de este hito — rompe el patrón "cero deps nuevas" que Hito 2/3 mantuvieron; requiere credenciales SMTP reales para verificación manual | Low, pero dependencia nueva |
| C. Log del link en desarrollo + mock en tests (sin envío real) | `console.log`/evento de log con el link; ningún adaptador real de email en el MVP | Máximo minimalismo, cero deps, cero cuentas externas que gestionar; consistente con cómo Hito 2 arrancó sin graphify real disponible | El "entregable funcional" del plan dice explícitamente "cliente confirma la compra por la página web" — implica que el cliente necesita RECIBIR el link de alguna forma; loguear no es un entregable funcional completo, sería una degradación deliberada a documentar como deuda técnica explícita | Low |

**Recomendación de esta exploración:** A si propone acepta una dependencia operacional (cuenta de proveedor) para cumplir el entregable funcional real; C solo como fallback de desarrollo/test, nunca como el "camino feliz" de producción — igual que el board adapter ya se degrada a no-op cuando `GITHUB_TOKEN` está vacío (mismo criterio, aplicado acá al email).

### 3. Dónde vive el cálculo de comisión y la evaluación de umbral de reembolso — la pregunta de la "Skill"

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. Skill formal en `src/core/skills/` | Se construye por primera vez el Registro de Skills que el arc42 documenta ("carga desde disco los paquetes de capacidad... para que el agente los invoque durante el turno") | Cierra la brecha arquitectónica documentada; sienta la base para futuras skills | El propio texto del arc42 define una skill como algo que "el agente invoca durante el turno" — implica una tool-call del LLM. Esto contradice directamente que el cálculo es determinístico y no necesita LLM (plan: "no necesita LLM, es una regla determinística"). Construir un Registro de Skills genérico para UNA sola skill, cuando la semántica documentada asume invocación por el agente, es sobre-ingeniería que además fuerza la Opción C del punto 1 | High |
| B. Módulo puro de núcleo, sin SDK ni LLM (recomendado) | `src/core/ventas/comision.ts` (función pura `calcularComision(monto, porcentaje)`) y `src/core/ventas/reembolso.ts` (`evaluarUmbral(monto, umbral)`), llamados DIRECTO desde el wiring del composition root — nunca pasan por `handleTurn` | Mismo criterio que `activity-contract.ts`/`knowledge-contract.ts` ("núcleo sin imports"); testeable trivialmente sin fixtures de LLM; consistente con la propia redacción del plan | No usa la palabra "Skill" del arc42 literalmente — hay que decidir en propuesta si esto CUENTA como la "Skill de reglas de negocio de ventas" que el plan menciona, aunque nunca pase por un Registro de Skills real | Low |
| C. MCP tool expuesta al LLM (molde `knowledge-tool.ts`) | El agente conversacional decide cuándo invocar el cálculo, como hace hoy con `query_knowledge_base` | Reutiliza un patrón ya probado y testeado (Hito 2) | Solo tiene sentido si existe un paso de razonamiento real decidiendo disparar el cálculo — el flujo de confirmación del plan no tiene ningún paso de razonamiento (el cliente hace click, listo); forzar una tool-call acá es la misma sobre-ingeniería que la Opción A, con el agravante de que además necesita un `caso`/turno activo | Medium |

**HITL para el umbral de reembolso** — no hay ningún patrón de escalación humana implementado en el repo hoy (confirmado: cero código HITL, solo texto descriptivo en la sección del plan dedicada a Hito 5, que ni siquiera está construido todavía). El plan mismo lo atribuye al revés cronológicamente (ver Current State). Recomendación: reusar el patrón `caso`/`actividad` de Hito 1/3 (crear un `caso` con `estado` pendiente cuando el monto supera el umbral, sin transición automática — alguien, humano, lo cierra después) es la opción de menor esfuerzo y mayor coherencia con lo ya construido, pero el "quién y cómo lo cierra" (¿otro endpoint? ¿la TUI? ¿nada todavía, deuda técnica explícita?) es una decisión real de propuesta, no algo que este hito resuelva solo con precedente.

### 4. `vendedor_id` / `cliente_id`

| Dato | Tabla en el plan | Precedente más cercano | Recomendación |
|---|---|---|---|
| `vendedor_id` | `vendedores(id, nombre, created_at)` — tabla real | `upsertProyecto`/`upsertResponsable` (Hito 3, `repository.ts:339,384`) — mismo patrón: si no existe, se crea con lo mínimo que trae el payload | `upsertVendedor(db, {id, nombre})` análogo, invocado desde el mismo lugar donde `createCasoConActividad` hoy resuelve `proyecto`/`responsable` |
| `cliente_id` | Columna `TEXT NOT NULL` en `ventas`, SIN tabla propia, sin FK | Ninguno — es la primera vez que el esquema deja un id así, sin tabla | Tratarlo como identificador opaco que llega en el payload de quien dispara la venta (fuera de alcance de este hito, tal como el propio prompt del usuario ya anticipa) — no crear ninguna tabla `clientes` nueva; documentar explícitamente en propuesta que la resolución de identidad de cliente (CRM real) es deuda técnica futura, no de este hito |

### 5. Reporte mensual y el "Registro de Comandos"

`docs/ARC42_Harness_Empresarial.md:266-274` documenta el Registro de Comandos ("declara los comandos que el arnés expone al empleado, mapeando cada uno a una acción o a un prompt predefinido", ubicación `src/core/commands/`) — CERO archivos existen ahí hoy. No hay ningún scheduler (`node-cron`, `setInterval` de largo plazo, cron del SO) en el repo.

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. Script CLI manual (recomendado) | Nuevo script en `package.json` (ej. `npm run reporte:mensual`), un entrypoint separado de `main.ts` que abre la DB, agrupa `ventas`+`comisiones` por `vendedor_id`/`periodo`, imprime/escribe el reporte, cierra | Cero infraestructura nueva; consistente con el Escenario de calidad 4 (operabilidad local); el plan dice "corre a fin de mes" sin exigir disparo automático — un humano corriéndolo cumple igual el entregable | No es, en sentido estricto, el "Registro de Comandos" que el arc42 describe (no hay mapeo comando→acción consultado por nada) | Low |
| B. Scheduler in-process (`node-cron` o `setInterval` en `main.ts`) | El propio proceso del arnés dispara el reporte automáticamente a fin de mes | Cumple "corre a fin de mes" sin intervención humana | Dependencia nueva (o lógica de temporización no trivial) que el plan no pide explícitamente; el arnés hoy vive mientras la TUI está montada — un `setInterval` de un mes de espera en un proceso de vida corta (TUI cerrada = proceso muerto) no tiene sentido sin un modo "daemon" que no existe | Medium-High |
| C. Construir `src/core/commands/` como el arc42 siempre lo definió, con UN comando registrado (el reporte) | Primer consumidor real del Registro de Comandos documentado | Cierra la brecha arquitectónica de una vez | Sobre-ingeniería para UN solo comando — mismo argumento YAGNI que la Opción A del punto 3; sin un segundo comando real que lo justifique, el "registro" es un `Map` de una entrada envuelto en ceremonia innecesaria | Medium |

**Recomendación de esta exploración:** A. Si propone decide que el "comando" debe ser una entidad de primera clase del Registro de Comandos (arc42), que sea la MÍNIMA forma posible: una función nombrada + un mapeo de un elemento, no una arquitectura de plugins.

## Recommendation

No hay una arquitectura única para recomendar todavía — tres decisiones estructurales reales pendientes para `sdd-propose`, en orden de impacto:

1. **¿El flujo de confirmación/reembolso pasa por `handleTurn` (LLM) o no?** Esta exploración se inclina por NO — reusar el patrón `caso`/`store` de Hito 3 para persistencia y HITL, pero mover el cálculo mismo a funciones puras de `src/core/ventas/` invocadas directo desde el composition root, reservando `handleTurn` para el caso de soporte (que sí es conversacional).
2. **Qué es concretamente una "Skill" en este código, antes de que este hito fuerce la respuesta.** Inclinación: un módulo puro de núcleo (`src/core/ventas/comision.ts`, `reembolso.ts`), NO un Registro de Skills genérico construido para un solo caso.
3. **Qué es concretamente un "Comando", con el mismo criterio.** Inclinación: un script CLI mínimo, no un scheduler ni un registro genérico prematuro.

## Risks

- Construir `src/core/skills/`/`src/core/commands/` por primera vez bajo este hito arriesga sobre-ingeniería: solo hay UNA skill y UN comando reales — un registro genérico sin un segundo caso que lo justifique es deuda de complejidad, no de funcionalidad.
- Reusar el molde `runActivityTurn` (LLM-siempre) para algo que el propio plan llama determinístico introduciría no-determinismo/costo en un cálculo financiero — riesgo de corrección, no solo de estilo.
- Token de confirmación sin expiración es un gap de seguridad real si `sdd-propose` no lo agrega explícitamente (el esquema dado no tiene columna `expires_at`).
- El encuadre "HITL reusa el patrón del Hito 5" es cronológicamente inconsistente con el orden real de los hitos — `sdd-propose` tiene que diseñar la escalación humana desde cero, y probablemente será Hito 5 quien reuse lo que ESTE hito defina, no al revés.
- Sin adaptador de CRM/identidad, si `sdd-propose` no acota `cliente_id` explícitamente como opaco/fuera de alcance, `sdd-tasks` podría intentar construir gestión de clientes real, inflando el esfuerzo muy por encima del entregable declarado del hito.
- Node no tiene cliente SMTP nativo — a diferencia de HMAC (Hito 3), este hito SÍ tiene una opción real de romper la racha de "cero dependencias nuevas" si se elige `nodemailer` sobre una API HTTP de proveedor.
- El binario `graphify` y cualquier herramienta de ejecución de comandos (Bash) no estuvieron disponibles para este subagente — la investigación se hizo 100% con lectura directa de código/docs vía Read/Grep/Glob. Se recomienda que `sdd-propose` corra `graphify explain`/`graphify query` sobre los conceptos nuevos (ventas, comisiones, Skill, Comando) apenas el diseño avance, y `graphify update .` una vez que este archivo quede persistido.

## Ready for Proposal

Sí, con la misma salvedad que Hito 3: `sdd-propose` debe resolver explícitamente las tres preguntas de la sección Recommendation antes de escribir el *Approach* — todas son decisiones de arquitectura reales, no detalles de implementación.

## Archivos leídos

- `docs/Plan_Implementacion_Harness_Empresarial.md` (líneas 1-70, 210-340)
- `docs/ARC42_Harness_Empresarial.md` (líneas 130-295)
- `openspec/changes/hito-1.2-bot-revision-prs/exploration.md` (plantilla)
- `src/main.ts`
- `src/build-on-activity.ts`
- `src/core/activity/activity-contract.ts`, `run-activity-turn.ts`, `transicion-estado.ts`
- `src/core/concurrency/keyed-queue.ts`
- `src/core/knowledge/knowledge-contract.ts`
- `src/core/agents/definitions.ts`
- `src/adapters/webhooks/index.ts`, `server.ts`, `config.ts`
- `src/adapters/board/config.ts`, `github-client.ts` (parcial)
- `src/adapters/memory/db.ts` (grep), `repository.ts` (grep de exports), `migrations/0003_proyectos_responsables_actividades.ts`
- `package.json`

**Nota de proceso**: ni `graphify` (CLI) ni ninguna herramienta de ejecución de comandos estuvieron disponibles en el toolset de este subagente (solo Read/Grep/Glob/WebFetch/WebSearch) — la investigación se hizo enteramente con lectura directa de código y documentación, sin poder correr el hook obligatorio de `graphify query`/`explain`/`path`. Esto replica la misma limitación que la exploración de Hito 3 ya documentó.
