# Exploration: Hito 3 — Bot de revisión de PRs (v1.2.0)

## Current State

- **Origen del turno hoy — 100% TUI, pero `handleTurn` ya es agnóstico al origen.** `handleTurn(casoId, prompt, deps)` (`src/core/turn-selector/handle-turn.ts:228`) no importa nada de `src/adapters/tui/` ni conoce Ink — recibe `casoId`/`prompt` como datos puros y `deps` (memoria, hooks, agentes candidatos, `queryFn`, `mcpServers`, `knowledgeFeedback`) como colaboradores inyectados. El único punto TUI-específico es el tipo `SubmitPromptHandler` (`src/adapters/tui/tui-port.ts:39`) y el wiring en `src/build-on-submit.ts`, que cierra sobre `casoId` fijo y llama `resolveTurn` + `handleTurn`.
- **El obstáculo real no es `handleTurn`, es el composition root de `main.ts`.** `startHarness()` (`src/main.ts:92-146`) crea **un único `caso`** (`tipo: "conversacion"`) **una sola vez por corrida del proceso**, antes de montar la TUI, y `buildOnSubmit` cierra sobre ese `casoId` fijo para todos los turnos de esa sesión. Un webhook necesita **un `caso` nuevo por evento** (`tipo: 'pr_review' | 'solicitud_interna' | 'incidente'`), disparado en cualquier momento mientras el proceso ya está corriendo — el patrón actual "un caso por arranque" no alcanza.
- **`assembleContext` exige que el `caso` ya exista** (`src/core/turn-selector/assemble-context.ts:106-130`, `CasoNotResolvedError`): quien dispare el turno del webhook tiene que crear el `caso` (vía `createCaso`, `src/adapters/memory/repository.ts:98`) **antes** de llamar `handleTurn` — mismo orden que `main.ts` ya sigue para la TUI, solo que ahora ocurre por evento, no al boot.
- **SQLite hoy: sin WAL.** `openDatabase` (`src/adapters/memory/db.ts:24-40`) solo setea `db.pragma("foreign_keys = ON")` — no hay `journal_mode = WAL`. El arc42 (Riesgo 2, línea 632-636) ya anticipaba esto como pendiente explícito para cuando haya escrituras concurrentes reales, que es exactamente lo que este hito introduce (dos webhooks casi simultáneos).
- **Sin HTTP saliente ni entrante en el repo todavía.** El único subproceso externo es `execFile` hacia el binario `graphify` (`src/adapters/knowledge/graphify-cli.ts`) — no hay `fetch`/`http.createServer` en ningún adaptador. Este hito sería el primer punto de entrada/salida HTTP real del harness.
- **Patrón de puerto/adaptador ya asentado (Hito 2), replicable:** núcleo define un módulo `src/core/<dominio>/<dominio>-contract.ts` sin imports (solo constantes + interfaces de puerto: `KNOWLEDGE_TOOL_QUALIFIED_NAME`, `KnowledgeFeedbackPort` en `src/core/knowledge/knowledge-contract.ts`); el adaptador vive en `src/adapters/<dominio>/` con `config.ts` (env → config tipada, pura, `resolveXConfig(env = process.env)`), una fachada `index.ts` que es el único archivo que importa el composition root, y funciones puras testeables con un colaborador inyectable (`execFileFn`, `runQuery`, etc.) con default real. `main.ts`/`build-on-submit.ts` son los únicos que conocen adaptadores concretos — nunca un adaptador importa a otro.
- **Config por env var, punto único:** `src/core/config/env.ts` carga `.env` una vez (side-effect import), y cada adaptador expone su propio `resolveXConfig()` (ver `src/adapters/knowledge/config.ts:56-65`) — nunca se mete configuración de un adaptador dentro de `src/core/`.
- **Node 18+ nativo relevante para este hito** (no verificado en vivo por el subagente, pero estable desde Node 18 LTS — no requiere dependencia nueva; a confirmar en vivo en `sdd-propose`/`sdd-design`):
  - `node:crypto` → `createHmac("sha256", secret)` + `timingSafeEqual` para verificar `X-Hub-Signature-256` sin librería.
  - `node:http` → `http.createServer` alcanza para un único endpoint `POST /webhooks/github` con verificación de firma + `JSON.parse` manual del body.
  - `fetch` global → suficiente para `PATCH /repos/{owner}/{repo}/issues/{number}` sin cliente HTTP adicional.
- **TDD estricto activo** (confirmado por el precedente de Hito 1.1) — cualquier verificación de firma HMAC o parseo de payload necesita fixtures, no un webhook real de GitHub en el suite por defecto.

## Affected Areas

- `src/main.ts` — composition root: el patrón "un `caso` al boot" (líneas 119-145) tiene que convertirse en algo que también sepa crear un `caso` **por evento webhook**, en paralelo a la TUI. Punto de mayor incertidumbre arquitectónica de este hito.
- `src/build-on-submit.ts` — plantilla directa de cómo un origen externo arma `HandleTurnDeps` y llama `handleTurn`; el adaptador de webhooks necesita el mismo tipo de wiring, pero disparado por HTTP en vez de por `SubmitPromptHandler`.
- `src/adapters/memory/db.ts` — falta `journal_mode = WAL`.
- `src/adapters/memory/migrations/` (nueva `000X_proyectos_actividades.ts`) — tablas `proyectos`, `responsables`, `actividades` del plan, siguiendo el estilo de `0001_casos_sesiones_agente.ts`.
- `src/adapters/webhooks/` (nueva carpeta) — endpoint HTTP entrante, verificación HMAC, traducción a turno.
- `src/adapters/board/` o `src/adapters/project-board/` (nueva carpeta, nombre a decidir en propuesta) — cliente REST de GitHub Issues saliente.
- `src/core/webhooks/` y/o `src/core/board/` (posibles, nuevos) — contrato(s) mínimo(s) que el núcleo necesita conocer, análogos a `src/core/knowledge/knowledge-contract.ts`. Ambigüedad real: no está claro todavía si el núcleo necesita un puerto de "tablero" (si la sincronización de labels ocurre como parte del cierre de turno, análogo a `KnowledgeFeedbackPort`) o si vive enteramente en el adaptador de webhooks sin que el núcleo se entere. Ver Risks.
- `src/core/logging/turn-logger.ts` — sin cambios de contrato esperados (mismo criterio que Hito 2: eventos nuevos son datos, no requieren tocar la función), pero se agregarían eventos nuevos (`webhook-recibido`, `firma-invalida`, `actividad-creada`, `tablero-actualizado`, etc.).
- `src/core/turn-selector/turn-error.ts` — evaluar si la traducción webhook→turno necesita su propio tipo de error o reutiliza `TurnFailedError` (no debería necesitar una `TurnStage` nueva, mismo argumento que Hito 2 con `"knowledge"`).
- `package.json` — candidato a **cero dependencias nuevas** si se usan `node:http`, `node:crypto` y `fetch` nativos (a confirmar en propuesta/diseño, mismo criterio de minimalismo que ADR 3.1 de Hito 2 aplicó a `zod`).

## Investigación por punto — opciones comparadas

### 1. Cómo entra un turno disparado externamente

`handleTurn`/`invokeModel` **no** asumen origen TUI en ningún import ni tipo — ya reciben `casoId`+`prompt` puros. Lo que sí falta es **quién crea el `caso` y arma `HandleTurnDeps` para un evento que no pasa por `SubmitPromptHandler`**.

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. Adaptador de Webhooks expone `startWebhookServer(onEvent)`, mismo molde que `startTui(onSubmit)` | El adaptador HTTP solo parsea/verifica y llama un callback inyectado; el composition root (`main.ts` o un nuevo entrypoint) arma el `caso`+`HandleTurnDeps` dentro de ese callback, igual que `buildOnSubmit` hoy | Simetría total con el patrón TUI ya aprobado; el adaptador de webhooks no importa nada de memoria/agentes, se mantiene "tonto"; fácil de testear con un callback fake | El composition root (`main.ts`) crece en responsabilidad — tiene que orquestar dos fuentes de turnos concurrentes en el mismo proceso | Medium |
| B. El adaptador de webhooks importa `handleTurn` y arma sus propios `deps` directo | Analogía con cómo `src/adapters/knowledge/index.ts` importa `src/core/knowledge/` | Menos código de wiring nuevo en `main.ts` | El adaptador necesitaría su propia conexión a memoria (duplicar el `db`/`MemoryPort` que `main.ts` ya abrió) o recibir el `MemoryPort` ya armado igual — en la práctica termina pareciéndose a la opción A pero con la responsabilidad mal ubicada; rompe la separación "el composition root es quien conecta adaptadores concretos" que `main.ts`/`build-on-submit.ts` ya documentan explícitamente | Medium |
| C. Proceso separado para webhooks (segundo entrypoint Node, escucha en otro puerto/proceso) | Aislamiento total del listener HTTP respecto de la TUI | Ninguna interferencia entre TUI y HTTP | Contradice "monolito modular de un solo paquete" y "sin servidor adicional" de `AGENTS.md`; duplica apertura de SQLite (dos procesos escribiendo al mismo archivo sin el mismo `db` handle ni la cola en memoria del punto 4, que por definición es *intra-proceso*) — el propio plan fija la cola de escritura "dentro del mismo proceso Node.js" | Alto, y probablemente inválido contra las reglas no negociables |

**Único punto realmente abierto:** cómo `main.ts` pasa de "un `caso` fijo al boot" a "N `caso`s, uno por sesión TUI y uno por evento webhook, todos dentro del mismo proceso". Ninguna opción de arriba resuelve esto solo con wiring — es una decisión de diseño real para `sdd-design`.

### 2. Verificación HMAC-SHA256

`node:crypto` alcanza sin dependencia nueva:

```ts
const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
const expected = `sha256=${digest}`;
timingSafeEqual(Buffer.from(expected), Buffer.from(header)); // longitudes iguales antes de comparar
```

| Opción | Pros | Contras |
|---|---|---|
| `node:crypto` nativo (recomendado) | Cero dependencias nuevas; mismo criterio de minimalismo del ADR 3.1 de Hito 2; función pura y testeable con fixtures | Hay que manejar a mano el caso de longitudes distintas antes de `timingSafeEqual` (lanza si difieren) — detalle de implementación, no bloqueante |
| Librería (`@octokit/webhooks-methods` u otra) | API ya probada por GitHub | Dependencia nueva para ~10 líneas que Node ya resuelve solo; no hay justificación de minimalismo como la hubo para `zod` (que sí era peer-dependency obligatoria del SDK) |

**Nota:** el body crudo (`rawBody`) tiene que capturarse **antes** de cualquier `JSON.parse` — la firma se calcula sobre los bytes exactos que GitHub envió, no sobre el objeto re-serializado. Esto condiciona la opción del punto 3 (el parser tiene que exponer el buffer crudo).

### 3. Forma del endpoint HTTP entrante

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. `node:http` nativo (recomendado) | `http.createServer((req, res) => ...)`, un solo `if (req.method === "POST" && req.url === "/webhooks/github")`, acumular chunks del body a mano | Cero dependencias; el plan solo pide **una** ruta — un router es sobre-ingeniería para un endpoint; consistente con "monolito modular... sin servidor adicional" (el listener corre en el mismo proceso) | Manejo manual de streams/chunks del body (bien conocido, pero hay que escribirlo con cuidado para no romper el cálculo de firma del punto 2) | Low-Medium |
| B. Framework liviano (`express`, `fastify`, `polka`) | Ergonomía de routing/middleware si el hito creciera a más endpoints | Ninguna ventaja real con un solo endpoint; dependencia nueva sin justificación, mismo criterio de rechazo que el ADR 3 de Hito 2 aplicó a la alternativa "más pesada" | Bajo valor para el costo | Low |

**Recomendación de esta exploración (no vinculante):** A. El plan de Hito 5/6/7 reutiliza este mismo molde para A2A — vale la pena que el patrón "listener HTTP mínimo, sin framework" quede establecido acá si va a repetirse.

### 4. Cola de escritura en memoria por `proyecto_id` + WAL

**Estado real confirmado:** `openDatabase` NO activa WAL hoy (`src/adapters/memory/db.ts:32`, solo `foreign_keys = ON`). Falta agregar `db.pragma("journal_mode = WAL")` — cambio de una línea, pero afecta el archivo `.db` en disco (dos archivos auxiliares `-wal`/`-shm` aparecen junto a `data/harness.db`; irrelevante para SQLite pero sí para cualquier script de backup/gitignore).

| Opción para la cola por clave | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. `Map<string, Promise<void>>` encadenado a mano (recomendado) | Por cada `proyecto_id`, se guarda la última promesa encolada; la siguiente escritura hace `.then()` sobre ella | ~15-20 líneas, sin dependencia nueva; mismo estilo del resto del repo (función pura + colaborador inyectable, testeable sin I/O real); resuelve exactamente lo que pide el plan ("cola de escritura en memoria por proyecto_id dentro del mismo proceso Node") | Hay que limpiar entradas viejas del `Map` o crece indefinidamente en un proceso de larga vida (mitigable: borrar la entrada cuando la promesa encadenada resuelve) | Low |
| B. Librería de cola por clave (`p-queue` con `concurrency:1` por instancia, o `async-mutex`) | Semántica de mutex ya probada | Dependencia nueva para un patrón de ~20 líneas; ninguna de las dos resuelve "por clave" out-of-the-box sin wrapping propio igual (una instancia de `p-queue` por `proyecto_id`, gestionada en otro `Map` de todos modos) | Bajo valor marginal | Low-Medium |
| C. Cola global única (no por clave) | Serializa TODAS las escrituras de `actividades`, no solo las del mismo proyecto | Más simple de escribir | No es lo que pide el plan explícitamente ("por proyecto_id") — serializaría escrituras de proyectos distintos sin necesidad, matando el paralelismo real que WAL habilita | Low |

**Recomendación de esta exploración:** A + WAL. Es el patrón más chico, sin dependencias, y coincide literalmente con la redacción del plan.

### 5. Adaptador de Tablero saliente (GitHub Issues REST)

No hay cliente HTTP saliente reusable en el repo — el único precedente de "hablar con algo externo" es `execFile` hacia `graphify` (subprocess, no HTTP).

| Opción | Descripción | Pros | Contras | Effort |
|---|---|---|---|---|
| A. `fetch` global nativo (recomendado) | `fetch("https://api.github.com/repos/...", { method: "PATCH", headers: { Authorization: \`Bearer ${token}\` }, body })` | Cero dependencias (Node 18+ ya lo trae global); solo 1-2 endpoints necesarios (`PATCH .../issues/{number}` para labels/assignees) | Manejo manual de rate-limiting/paginación si creciera — no lo necesita este hito (una sola llamada por transición de estado) | Low |
| B. `@octokit/rest` (cliente oficial) | Tipado completo de la API de GitHub, manejo de rate-limit incluido | Dependencia no trivial (varios MB, muchas dependencias transitivas) para 1-2 endpoints; mismo argumento de minimalismo que rechazó `@modelcontextprotocol/sdk` en Hito 2 | Sobre-ingeniería para el alcance actual | Low, pero dependencia pesada |

**Autenticación:** mismo patrón que `GRAPHIFY_BIN`/`GRAPHIFY_GRAPH_PATH` (`src/adapters/knowledge/config.ts:56-65`) — un `resolveBoardConfig(env = process.env)` puro que lee `GITHUB_TOKEN` (o `GITHUB_APP_TOKEN`, a decidir el nombre exacto en propuesta) y `GITHUB_WEBHOOK_SECRET` (para el punto 2), con el mismo side-effect import de `../../core/config/env.js` para asegurar que `.env` ya cargó.

### 6. Precedente de puertos/adaptadores a replicar

Plantilla exacta de Hito 2, confirmada en el código real:

- **Núcleo** (`src/core/knowledge/knowledge-contract.ts`): sin imports, solo constantes + `interface KnowledgeFeedbackPort` con contrato "nunca rechaza".
- **Adaptador** (`src/adapters/knowledge/`): `config.ts` (puro, env→config), `*-cli.ts`/`*-client.ts` (única fuente de I/O externo, con colaborador inyectable tipo `ExecFileFn`), lógica de negocio framework-free (`knowledge-tool.ts`, nunca lanza), fachada `index.ts` (único archivo que el composition root importa).
- **Composition root** (`src/main.ts` + `src/build-on-submit.ts`): arma el adaptador una vez, lo pasa como parte de `HandleTurnDeps` opcional.

**Aplicado a este hito:**
- El **Adaptador de Webhooks (entrante)** encaja bien en este molde si expone algo como `createWebhookServer(deps: { onActivity: (input) => Promise<void>, secret: string })` — el análogo a `startTui(onSubmit)`, no a `createKnowledgeAdapter` (la dirección del dato es opuesta: entra, no lo consulta el modelo).
- El **Adaptador de Tablero (saliente)** sí encaja más como `createKnowledgeAdapter`/`KnowledgeFeedbackPort`: un puerto que el núcleo (o el propio adaptador de webhooks, según cómo se resuelva el punto 7) invoca para mirror-ear `actividades.estado` → labels de GitHub.

**Ambigüedad real, no resuelta acá:** ¿el núcleo necesita saber que existe un "tablero" (un puerto tipo `ActividadBoardPort` en `src/core/`, invocado desde `handle-turn.ts` o desde un lugar nuevo), o toda la lógica de "cuándo sincronizar el label" vive enteramente en el adaptador de webhooks, sin que el núcleo se entere? El plan dice "SQLite es la fuente canónica... los labels... son un espejo unidireccional" pero no dice **quién** dispara ese espejo ni en qué momento del ciclo de vida de un turno. Es la decisión de arquitectura real de este hito — análoga al ADR 3 de Hito 2 (in-process vs. stdio) pero sin un candidato tan claramente preferible todavía.

### 7. Riesgos y ambigüedades para el checkpoint humano

- **¿El endpoint HTTP corre siempre o solo si hay config de GitHub presente?** Si `GITHUB_WEBHOOK_SECRET` no está seteado (demo local sin GitHub real), ¿el listener no se abre, se abre mudo, o falla el arranque? Afecta directamente el Escenario de calidad 4 del arc42 ("Operabilidad local... el único requisito es Node + credenciales de Anthropic") — agregar un requisito de config nuevo sin resolver esto podría romper ese escenario para quien no tiene GitHub configurado.
- **Cómo se prueba en TDD sin un webhook real de GitHub.** Necesita: (a) fixtures de payload `pull_request`/`issue_comment` reales o representativos, (b) firmas HMAC calculadas a mano con un secreto de test para verificar el verificador, (c) el mismo patrón `execFileFn`/`runQuery` inyectable de Hito 2 aplicado a `fetch` (un `fetchFn` inyectable) para no pegarle a la API real de GitHub en el suite por defecto.
- **Testing local del endpoint sin exponerlo a internet.** GitHub necesita alcanzar el endpoint para mandar el webhook real — para la demo hace falta algo tipo `ngrok`/`smee.io`/GitHub CLI (`gh webhook forward`) o simular el POST con `curl`/`fetch` directo contra `localhost` firmado a mano. Esto es puramente de **verificación manual del entregable** (no bloquea TDD, que corre 100% con fixtures locales), pero hay que decidirlo antes del checkpoint de diseño para que quede en el plan de verificación.
- **Composition root: cómo coexisten TUI y HTTP listener en el mismo proceso.** Ver punto 1 — no hay antecedente en el repo de dos fuentes de turnos concurrentes en la misma corrida. `main.ts` hoy es fundamentalmente secuencial hasta `startTui`; agregar un listener HTTP que dispara turnos en paralelo mientras la TUI también puede estar en medio de un turno introduce la primera concurrencia real de escritura del proyecto — exactamente lo que el punto 4 (cola por clave) y el Riesgo 2 del arc42 anticipan, pero a nivel de wiring en `main.ts` todavía no hay un patrón que decidir.
- **`actividades.caso_id` liga con Hito 1, pero ¿qué agente resuelve el turno del webhook?** `resolveTurn` hoy siempre devuelve el único agente registrado (`agente-conversacional`) — un prompt sintético ("Revisar PR #123 de owner/repo") pasaría por el mismo agente conversacional, cuyo system prompt no menciona revisión de código. La propuesta necesita decidir si esto alcanza para el MVP del hito o si hace falta un segundo `AgentDefinition` (lo cual anticiparía el ruteo multi-agente que el propio Hito 2 explícitamente evitó "para no bifurcar el Selector de Turno sin ganancia funcional").
- **Segunda fuente (incidentes de IT) enruta por header propio, no por `X-Hub-Signature-256`.** El plan dice que el mismo endpoint discrimina origen por un header del sistema de monitoreo — falta decidir si ese origen alternativo también verifica firma (¿con qué secreto?) o si viaja sin autenticación, lo cual sería una superficie de ataque a resolver explícitamente en diseño, no a asumir.
- **Node y binarios `.cmd` en Windows** (mismo riesgo R2 documentado en `design.md` de Hito 2 para `graphify`) no aplica acá porque este hito no spawnea binarios — es un dato a favor de las opciones nativas (`fetch`/`node:http`/`node:crypto`), que evitan reabrir ese problema.

## Recommendation

No hay una sola arquitectura a recomendar todavía — este hito tiene **una decisión estructural real pendiente** (punto 1 + punto 6: cómo coexisten TUI y HTTP en el composition root, y si el "tablero" necesita un puerto de núcleo o vive enteramente en el adaptador). Las inclinaciones de esta exploración, para que `sdd-propose` las confirme o las descarte con criterio:

1. Adaptador de Webhooks con la forma `createWebhookServer(onActivity, secret)` (molde TUI), sobre `node:http` nativo, `node:crypto` para HMAC — cero dependencias nuevas.
2. Cola de escritura `Map<string, Promise<void>>` por `proyecto_id` + `journal_mode = WAL` agregado a `openDatabase`.
3. Adaptador de Tablero sobre `fetch` nativo, config vía `resolveBoardConfig(env)` calcada de `resolveGraphifyConfig`.
4. La pregunta abierta real para `sdd-propose`: si el mirror SQLite→labels es un puerto de núcleo (`ActividadBoardPort`, invocado desde algún punto del ciclo de turno) o lógica 100% del adaptador de webhooks sin que el núcleo se entere del tablero.

## Risks

- Composition root de `main.ts` necesita rediseño para soportar `caso`s creados on-demand (no solo al boot) — es el cambio de mayor superficie de este hito, más que cualquier adaptador nuevo.
- Sin decidir el puerto de tablero, el diseño puede terminar con el adaptador de webhooks conociendo demasiado sobre `actividades`/SQLite directamente, oscureciendo la frontera hexagonal.
- Ambigüedad de disponibilidad del endpoint (config presente vs. ausente) puede romper el Escenario de calidad 4 (operabilidad local) si no se resuelve explícito.
- Falta decidir agente/prompt sintético para el turno de PR — puede exponer que el agente conversacional actual no es apto para revisar código sin ajustar su system prompt o su toolset.
- Verificación de la segunda fuente (incidentes de IT) sin especificar autenticación es una superficie de seguridad no cerrada.
- Testing de integración real (llegar de verdad a un endpoint público) requiere herramienta externa (ngrok/smee/gh) no presente hoy en el stack — solo afecta verificación manual, no TDD.

## Ready for Proposal

Sí, con una salvedad: `sdd-propose` debe resolver explícitamente la pregunta de arquitectura del punto 6/7 (puerto de tablero en el núcleo vs. lógica interna del adaptador de webhooks) y la del composition root (punto 1) antes de escribir el *Approach* — ambas son decisiones reales, no detalles de implementación, igual que el ADR 3 de Hito 2 lo fue para el transporte MCP.

## Archivos leídos

- `AGENTS.md`
- `docs/Plan_Implementacion_Harness_Empresarial.md`
- `docs/ARC42_Harness_Empresarial.md`
- `openspec/changes/hito-1.1-consulta-conocimiento/exploration.md`, `proposal.md`, `design.md`
- `src/main.ts`
- `src/build-on-submit.ts`
- `src/core/turn-selector/handle-turn.ts`, `invoke-model.ts`, `resolve-turn.ts`, `assemble-context.ts`, `turn-error.ts`
- `src/core/agents/definitions.ts`
- `src/core/knowledge/knowledge-contract.ts`
- `src/adapters/knowledge/index.ts`, `config.ts`
- `src/adapters/memory/db.ts`, `repository.ts`, `migrations/0001_casos_sesiones_agente.ts`
- `src/adapters/tui/tui-port.ts`
- `src/core/config/env.ts`
- `package.json`

**Nota de proceso**: el binario `graphify` no se ejecutó en vivo durante esta exploración (limitación de herramientas del subagente que la produjo) — la investigación se hizo con lectura directa de código. Se recomienda que `sdd-propose` corra `graphify explain`/`graphify query` sobre los conceptos nuevos de este hito (webhooks, tablero, cola por proyecto) apenas el diseño avance, y que se corra `graphify update .` una vez que este archivo quede persistido, para que el grafo indexe este nuevo change folder.
