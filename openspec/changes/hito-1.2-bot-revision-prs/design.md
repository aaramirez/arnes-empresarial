> **Nota de proceso (hook de graphify)**: el hook de este repo exige correr `graphify query`/`explain` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), igual que `sdd-explore`, `sdd-propose` y `sdd-spec`, así que no se pudo invocar el binario. Se compensó con lectura directa y **verificada** de `src/main.ts`, `src/build-on-submit.ts`, `src/core/turn-selector/handle-turn.ts`, `src/core/turn-selector/assemble-context.ts`, `src/core/knowledge/knowledge-contract.ts`, `src/adapters/knowledge/index.ts` y `config.ts`, `src/adapters/memory/db.ts`, `repository.ts`, `migrations/0001_casos_sesiones_agente.ts`, `migrations/index.ts`, `src/core/logging/turn-logger.ts`, `src/core/config/env.ts`, `src/adapters/tui/start-tui.tsx`, `.gitignore`, `package.json` y el bloque de Hito 3 de `docs/Plan_Implementacion_Harness_Empresarial.md`. Toda afirmación sobre código existente en este documento está citada contra esos archivos. Se recomienda correr `graphify update .` una vez persistido este archivo.

# Diseño técnico: Hito 3 — Bot de revisión de PRs (v1.2.0)

**Entra con**: [`proposal.md`](proposal.md) (aprobada por checkpoint humano, incluidos **ADR 5**, **ADR 6** y el alcance de **R4**) · [`specs/activity-webhook-turn/spec.md`](specs/activity-webhook-turn/spec.md) · [`specs/activity-board-mirror/spec.md`](specs/activity-board-mirror/spec.md) · [`specs/knowledge-query/spec.md`](specs/knowledge-query/spec.md) · [arc42](../../../docs/ARC42_Harness_Empresarial.md) (Caja Negra "Adaptador de Webhooks", Riesgo 2, Escenario de calidad 4) · [`AGENTS.md`](../../../AGENTS.md) (reglas no negociables).

**Alcance de este documento**: el *cómo* arquitectónico — ADRs, componentes, **contratos literales** (firmas, interfaces, SQL), flujo de datos, fronteras, logging, riesgos. No es la lista de tareas (eso es `tasks.md`, que este documento **no** toca) ni el contrato de requisitos (eso es `specs/`).

**Numeración de ADR**: el arc42 fijó ADR 1-2, Hito 2 fijó ADR 3 / 3.1 / 4, y la propuesta de este hito fijó **ADR 5** y **ADR 6**. Este diseño arranca en **ADR 7**.

---

## 1. Resumen de la arquitectura elegida

Dos adaptadores nuevos (uno entrante, uno saliente) y un bloque de núcleo nuevo (`src/core/activity/`), pegados por **un módulo hermano de `build-on-submit.ts`**. El núcleo aprende que existe *una actividad con cuatro estados*, *un almacén de actividades* y *un tablero abstracto*; no aprende que existe GitHub, ni HTTP, ni labels.

```
                         composition root (src/main.ts)
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
  buildOnSubmit                 buildOnActivity              openDatabase / bootstrapHarness
  (Hito 1, intacto)             (NUEVO, este hito)                  │
        │                             │                             │
        ▼                             ▼                             ▼
  startTui(onSubmit)          startWebhookServer({ onEvent })   MemoryPort / ActivityStorePort
   (I1, intacto)                      │                          (closures sobre repository.ts)
                                      │
                       ┌──────────────┴───────────────┐
                       │  keyedQueue.run(proyectoId)  │   ← src/core/concurrency/
                       └──────────────┬───────────────┘
                                      ▼
                        runActivityTurn (src/core/activity/)
                            │        │        │
       store.createCasoConActividad  │        └── board.mirrorEstado / publicarRevision
                                     ▼                        │
                        runTurn(casoId, prompt)               ▼
                        = handleTurn(...) + createKnowledgeAdapter({ casoId })
                          (handle-turn.ts NO se modifica)   src/adapters/board/
```

Ninguna flecha va de `src/core/` a `src/adapters/*`. Ningún adaptador le habla a otro: el Adaptador de Webhooks recibe un callback inyectado y nunca importa memoria, agentes ni tablero (ADR 5, punto 3); el Adaptador de Tablero se invoca **desde el núcleo** a través de `ActivityBoardPort` (ADR 6). Las únicas flechas que cruzan la frontera nacen en el composition root — la excepción documentada de `AGENTS.md` y del module doc de `main.ts`.

**Lo que NO cambia** (garantía de no-regresión, R2 de la propuesta): `handle-turn.ts`, `invoke-model.ts`, `assemble-context.ts`, `close-turn.ts`, `resolve-turn.ts`, `definitions.ts`, `turn-error.ts`, `build-on-submit.ts`, todo `src/adapters/tui/`, todo `src/adapters/knowledge/`. La TUI conserva su camino exacto de hoy.

---

## 2. Decisiones de arquitectura (ADR 7-10)

Mismo formato que Hito 2: **Contexto / Decisión / Alternativas consideradas / Consecuencias**. Al cerrar el hito se copian a `docs/ARC42_Harness_Empresarial.md`, sección *Decisiones de Diseño*, junto con ADR 5 y 6.

### ADR 7: `engines.node` sube a `>=20`

**Contexto**. La propuesta dejó esto explícitamente abierto ("Salvedad honesta"). `package.json` declara hoy `"engines": { "node": ">=18" }` (verificado). Este hito usa `fetch` global para las 3 llamadas REST del Adaptador de Tablero. En Node 18 `fetch` existe pero emite `ExperimentalWarning: The Fetch API is an experimental feature` en stderr al primer uso. Ese warning va a **stderr**, y el module doc de `turn-logger.ts` documenta en detalle por qué cualquier escritura cruda a un stream que la terminal muestre corrompe el render de Ink: "stdout y stderr son streams separados a nivel de proceso, pero una terminal real los intercala en la misma pantalla". O sea: en Node 18, la primera llamada al tablero ensucia la TUI con una línea de warning en medio de la conversación. Además `@types/node` ya está en `^20.14.0` (verificado en `devDependencies`), así que el tipado con el que se compila **ya es el de Node 20** — `engines` dice una cosa y el chequeo de tipos asume otra.

Extra no anterior al análisis pero decisivo: `AbortSignal.timeout()` (que este diseño usa para acotar cada request del tablero, §5.2) es estable desde Node 17.3 pero solo está tipado sin fricción con `@types/node@20`.

**Decisión**. `"engines": { "node": ">=20" }`. Es un cambio de metadato, no una dependencia: `package.json` no gana ni un paquete, y el compromiso de la propuesta ("ninguna dependencia nueva") se mantiene literalmente.

**Alternativas consideradas**:

- *Convivir con el warning en Node 18*: rechazada. El síntoma es visible en la demo (línea de warning atravesando la TUI) y el diagnóstico para quien lo ve es indistinguible de un bug del arnés. Silenciarlo con `--no-warnings` sería peor: apaga *todos* los warnings del proceso, incluidas deprecaciones reales que sí queremos ver.
- *`undici` como dependencia para tener un `fetch` no experimental en Node 18*: rechazada, y con fuerza. Es exactamente la trampa que ADR 3.1 de Hito 2 nos enseñó a mirar de frente: pagar una dependencia entera para no tocar un número en `engines`. La propuesta avisó que si la decisión terminaba requiriendo un paquete debía volver al checkpoint humano — no hace falta, porque no lo requiere.
- *Subir a `>=22` (LTS actual)*: rechazada por ahora. No hay ninguna API de este hito que lo pida, y `@types/node` está en 20; subir de más agrega fricción de entorno sin ganancia.

**Consecuencias**. Quien corra la demo necesita Node 20+. El Escenario de calidad 4 del arc42 ("el único requisito es Node + credenciales de Anthropic") sigue cumpliéndose — cambia el *número*, no la naturaleza del requisito. `npm install` avisa (no falla) si el Node local es menor, salvo que exista un `engine-strict`.

### ADR 8: La cola por `proyecto_id` es un `KeyedQueue` puro en `src/core/concurrency/`

**Contexto**. La propuesta fija *qué* (un `Map<string, Promise<void>>` encadenado por `proyecto_id`) y *por qué* (serializar el ciclo lógico leer-actividad → `await` del modelo → escribir-actividad, no las sentencias SQL — `better-sqlite3` es síncrono y dos sentencias nunca se interleavan). No fija **dónde vive**. Tres ubicaciones plausibles: `src/adapters/memory/` (protege filas de SQLite), un módulo nuevo en `src/`, o `src/core/`.

**Decisión**. `src/core/concurrency/keyed-queue.ts`, **sin imports** (ni de Node, ni del SDK, ni de adaptadores), exportando `createKeyedQueue()` genérico por clave `string` — no por `proyecto_id`. El composition root (`build-on-activity.ts`) es quien elige la clave `evento.proyectoId`.

Tres razones, en orden de peso:

1. **Lo que serializa no es SQLite, es un turno.** El ciclo protegido incluye `await runTurn(...)` — una llamada al modelo que dura decenas de segundos y no toca la base. Ponerlo en `src/adapters/memory/` obligaría al adaptador de memoria a saber que existe un concepto de "turno", que es justo lo que su propio diseño evita (`repository.ts` documenta que "`estado` es intencionalmente un string abierto, no un enum — el conjunto de estados válidos es asunto del núcleo, no de este adaptador").
2. **Es lógica pura sin I/O**, o sea exactamente lo que TDD estricto quiere testeable con promesas controladas y cero fixtures — el propio spec lo pide así ("test con la cola, sin I/O real"). `src/core/` es donde vive la lógica pura de este repo.
3. **Precedente del repo**: `src/core/logging/` y `src/core/hooks/` ya son utilidades transversales dentro del núcleo, no conceptos de dominio. Una cola por clave es del mismo tipo.

**Alternativas consideradas**:

- *`src/adapters/memory/write-queue.ts`*: rechazada por (1). Además invitaría a que un futuro `repository.ts` la use internamente, lo que serializaría escrituras *dentro* de la transacción síncrona que ya es atómica — protección duplicada y engañosa.
- *Un módulo suelto en `src/` (nivel composition root)*: rechazada. `src/main.ts` y `src/build-on-submit.ts` están ahí porque **importan adaptadores concretos**; ese es el criterio que sus module docs argumentan. Un módulo sin ningún import no cumple ese criterio y quedaría ahí solo por comodidad.
- *`Map<string, Promise<void>>` inline en `build-on-activity.ts`*: rechazada. Es la pieza con el modo de falla más sutil del hito (R6: fuga de memoria) y necesita test propio; enterrarla en el wiring la vuelve intesteable sin ejercitar todo el ciclo.

**Consecuencias**. Aparece un directorio nuevo `src/core/concurrency/` con un solo archivo. La cola no sabe nada de actividades: si mañana hay que serializar por `caso_id` o por `responsable_id`, se pasa otra clave. La responsabilidad de elegir la clave queda en el composition root, donde ya vive el resto de las decisiones de wiring.

### ADR 9: El body HTTP se acumula con tope duro de bytes y corte temprano de la conexión

**Contexto**. La firma `X-Hub-Signature-256` se calcula sobre los **bytes exactos** recibidos, así que el handler necesita el body crudo completo como `Buffer` antes de poder verificar nada, y necesita verificar **antes** de cualquier `JSON.parse` (requisito literal del spec `activity-webhook-turn`). Eso implica bufferizar entrada de red no autenticada — la única superficie de este hito que acepta bytes de un tercero antes de saber quién es. El spec además exige: "Un body que exceda el tope de tamaño configurado SHALL rechazarse **sin verificar firma**". Un payload de `pull_request` de GitHub ronda decenas de KB; el techo documentado de GitHub para un delivery es 25 MB.

**Decisión**. Acumulación de chunks en un array de `Buffer` con **contador de bytes incremental** y corte en `config.maxBodyBytes` (default **1 MiB**):

1. Se suma `chunk.length` **antes** de guardar el chunk. Si el acumulado supera el tope: se responde `413`, se llama `req.destroy()` para cortar la conexión, se emite `webhook-rechazado-tamano`, y **no se concatena, no se calcula HMAC y no se parsea nada**. El límite es una guardia de memoria real, no un chequeo cosmético post-hoc.
2. `Content-Length` **no** se usa como única defensa: es un header que el cliente controla y que en `Transfer-Encoding: chunked` no existe. Se puede usar como rechazo temprano *adicional*, nunca como el rechazo.
3. Recién en `"end"`, con el body completo bajo el tope, se hace `Buffer.concat(chunks)` y se verifica la firma.
4. `req.on("error", ...)` responde `400` y no invoca el callback: una conexión cortada a mitad no puede producir una actividad.

**Alternativas consideradas**:

- *HMAC incremental por chunk (`hash.update(chunk)` sobre el stream, sin bufferizar)*: rechazada **por ahora**, aunque es la solución de menor memoria. Necesitamos igual el body completo para `JSON.parse` después de verificar, así que no se ahorra el buffer; solo se ahorraría *si* la firma fuera inválida, que es el caso patológico. A cambio, complica el orden verificar-antes-de-parsear y hace el test de "firma inválida no crea filas" más difícil de escribir con un `req` falso.
- *Confiar en `Content-Length` y rechazar solo por header*: rechazada por (2). Es la mitigación que parece funcionar hasta que alguien manda `chunked`.
- *Sin tope, confiando en que el emisor es GitHub*: rechazada. El endpoint es público por definición (tiene que serlo para que GitHub lo alcance) y la verificación de firma ocurre *después* de recibir los bytes. Un POST ilimitado de un tercero cualquiera es un OOM del proceso que también corre la TUI.

**Consecuencias**. Un payload legítimo enorme (un PR con miles de archivos) podría chocar el tope de 1 MiB y perderse silenciosamente para el arnés (GitHub lo verá como `413`). Se acota con `WEBHOOK_MAX_BODY_BYTES` configurable y con el evento de log correspondiente, que es lo que hace el modo de falla diagnosticable en vez de misterioso.

### ADR 10: El webhook responde `202` **antes** de correr el turno, y el cierre del proceso drena los turnos en vuelo

**Contexto**. Dos hechos que se tocan. Primero: GitHub considera fallida una entrega cuyo endpoint no responde en ~10 s. Un turno de este arnés incluye una llamada al modelo con tools MCP — decenas de segundos, sin techo garantizado. Si el handler HTTP hiciera `await onEvent(...)` antes de responder, **toda entrega real fallaría por timeout** y GitHub reintentaría, disparando turnos duplicados sobre la misma actividad. Segundo: ADR 5 punto 4 fija que "la TUI sigue siendo dueña del ciclo de vida del proceso... en el `finally` se cierra primero el servidor HTTP y después `db.close()`". Pero `server.close()` de `node:http` solo **deja de aceptar conexiones nuevas** y espera a que las existentes terminen — y si respondimos `202` antes de procesar, no queda ninguna conexión abierta que represente al turno en vuelo. `db.close()` correría con un turno a mitad de camino y la escritura del estado canónico explotaría contra un handle cerrado.

**Decisión**. Las dos mitades, indivisibles:

1. **Ack inmediato**: verificada la firma y mapeado el evento, el handler responde `202 Accepted` y **recién después** invoca `onEvent(evento)` sin `await`, con un `.catch` que loguea. El resultado del turno nunca viaja en la respuesta HTTP — el canal de salida del turno es el comentario en el PR y el label, no el cuerpo de la respuesta al webhook.
2. **Drenaje explícito al cerrar**: el servidor mantiene un `Set<Promise<void>>` con los `onEvent` en vuelo. `WebhookServerHandle.close()` hace, en orden: (a) `server.close()` para dejar de aceptar; (b) `await Promise.allSettled([...enVuelo])` con carrera contra `SERVER_CLOSE_TIMEOUT_MS` (**5 000 ms**); (c) resuelve. `main.ts` hace `await webhook.close()` **antes** de `db.close()`, dentro del mismo `finally`.
3. El timeout de (b) es un techo, no una promesa: si un turno tarda más, se loguea `webhook-cierre-con-turnos-en-vuelo` y se cierra igual. Colgar el Ctrl+C del usuario indefinidamente por un turno lento es peor que perder ese turno.

**Alternativas consideradas**:

- *`await onEvent(...)` y responder `200` con el resultado*: rechazada — rompe el entregable contra GitHub real por timeout de entrega (10 s) y genera reintentos que duplican actividades. Es el modo de falla más caro de diagnosticar del hito, porque en tests con fixtures **nunca aparece**.
- *`server.closeAllConnections()` inmediato*: rechazada como estrategia única. Corta sockets sanos que podrían estar recibiendo una entrega válida en ese instante. Queda como último recurso *después* del timeout, no como primera acción.
- *`server.unref()` y dejar que el proceso muera solo*: rechazada. Hace el cierre no determinista y, peor, invisible para los tests: nadie puede afirmar "no quedaron turnos en vuelo".
- *Cola de trabajos persistida en SQLite con reintentos*: rechazada por alcance — es la respuesta correcta para un despliegue real y está fuera de este hito, igual que el modo headless.

**Consecuencias**. `202` significa "recibido y encolado", no "revisado". Un turno puede fallar después de que GitHub ya vio un `202` — por eso el logging del ciclo de actividad (§9) es la única traza de esa mitad. La cola de `proyecto_id` (ADR 8) queda *dentro* del `onEvent` fire-and-forget, así que dos entregas casi simultáneas ya recibieron `202` y se serializan del lado nuestro, exactamente como el spec pide.

---

## 3. Componentes del Núcleo

### 3.1 `src/core/activity/activity-contract.ts` (nuevo)

Lo único que el núcleo sabe sobre actividades y sobre el tablero. **Sin imports** — misma regla que `knowledge-contract.ts` cumple hoy (verificado: ese archivo no importa nada).

```ts
/* ── Tipos canónicos de actividad (esquema del plan, migración 0003) ── */

export const ACTIVIDAD_TIPO_PR_REVIEW = "pr_review";
export const ACTIVIDAD_TIPO_SOLICITUD_INTERNA = "solicitud_interna";
export const ACTIVIDAD_TIPO_INCIDENTE = "incidente";

/** Los tres valores que el esquema acepta. Este hito solo ejercita el primero (ADR 5). */
export const ACTIVIDAD_TIPOS = [
  ACTIVIDAD_TIPO_PR_REVIEW,
  ACTIVIDAD_TIPO_SOLICITUD_INTERNA,
  ACTIVIDAD_TIPO_INCIDENTE,
] as const;
export type ActividadTipo = (typeof ACTIVIDAD_TIPOS)[number];

/* ── Estados canónicos. SQLite es la fuente de verdad; el tablero es espejo ── */

export const ESTADO_PENDIENTE_REVISION = "pendiente_revision";
export const ESTADO_OBSERVADO = "observado";
export const ESTADO_RESUELTO = "resuelto";
export const ESTADO_APROBADO = "aprobado";

export const ACTIVIDAD_ESTADOS = [
  ESTADO_PENDIENTE_REVISION,
  ESTADO_OBSERVADO,
  ESTADO_RESUELTO,
  ESTADO_APROBADO,
] as const;
export type ActividadEstado = (typeof ACTIVIDAD_ESTADOS)[number];

/** Veredicto que el agente emite al cerrar la revisión. NO incluye `pendiente_revision`: ese es un estado inicial, no un juicio. */
export const VEREDICTO_APROBADO = "aprobado";
export const VEREDICTO_OBSERVADO = "observado";
export const VEREDICTO_RESUELTO = "resuelto";
export const VEREDICTOS = [VEREDICTO_APROBADO, VEREDICTO_OBSERVADO, VEREDICTO_RESUELTO] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

/** Prefijo de la línea legible por máquina. Fuente única: lo usa el prompt Y el parser. */
export const VEREDICTO_PREFIX = "VEREDICTO:";

/* ── Evento normalizado: contrato adaptador → composition root ── */

/**
 * Traducción neutral de un evento externo. El Núcleo NUNCA ve un payload de
 * GitHub. Registrar un segundo origen (incidentes de IT) es escribir otro
 * verificador + otro mapper hacia este mismo tipo — sin tocar nada más.
 */
export interface IncomingActivityEvent {
  /** Sistema emisor, p. ej. `"github"`. Solo para logging y ruteo futuro. */
  readonly origen: string;
  /** `"owner/repo"` — clave de `proyectos.id` Y clave de serialización de la cola. */
  readonly proyectoId: string;
  readonly proyectoNombre: string;
  readonly repoUrl: string;
  readonly tipo: ActividadTipo;
  /** Número del Issue/PR, como texto (`actividades.referencia_externa`). */
  readonly referenciaExterna: string;
  /** Login de quien debe actuar (autor del PR). Ausente si el payload no lo trae. */
  readonly responsableId?: string;
  readonly titulo: string;
  readonly cuerpo: string;
  readonly archivosCambiados: readonly string[];
  /** Cuerpo del comentario que disparó el evento (`issue_comment`). Ausente en `pull_request`. */
  readonly comentarioDisparador?: string;
  /** Id de correlación del emisor (`X-GitHub-Delivery`). Ver §9. */
  readonly deliveryId: string;
  /** ISO-8601 de recepción. */
  readonly recibidoEn: string;
}

/* ── Actividad tal como el núcleo la maneja ── */

export interface Actividad {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: ActividadTipo;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: ActividadEstado;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ── Puertos ── */

/**
 * Persistencia del estado canónico. Implementado por closures sobre
 * `src/adapters/memory/repository.ts`, inyectadas desde el composition root.
 *
 * SÍNCRONO a propósito: `better-sqlite3` lo es, y `MemoryContextPort` /
 * `MemoryWritePort` (verificados en `assemble-context.ts` y en el wiring de
 * `main.ts`) ya establecen esa forma en este repo. Además hace visible, sin
 * leer una línea de implementación, que los ÚNICOS `await` del ciclo de
 * actividad son el modelo y el tablero — que es exactamente el punto de
 * interleaving que la cola de ADR 8 existe para serializar.
 *
 * CONTRATO: falla RUIDOSAMENTE. Si el estado canónico no se persiste, el
 * turno mintió — el error propaga como fallo del turno (ADR 6).
 */
export interface ActivityStorePort {
  /** Actividad viva para ese par, o `undefined` si es la primera vez que se ve esa referencia. */
  findActividadPorReferencia(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
  }): Actividad | undefined;

  /** Crea `proyecto` (si no existe), `responsable` (si viene y no existe), `caso` y `actividad` en UNA transacción. */
  createCasoConActividad(input: CreateCasoConActividadInput): Actividad;

  updateActividadEstado(input: {
    readonly actividadId: string;
    readonly estado: ActividadEstado;
    readonly responsableId?: string;
    readonly updatedAt: string;
  }): Actividad;
}

export interface CreateCasoConActividadInput {
  readonly proyecto: {
    readonly id: string;
    readonly nombre: string;
    readonly repoUrl: string;
  };
  readonly responsable?: { readonly id: string; readonly nombre?: string };
  readonly caso: {
    readonly id: string;
    readonly tipo: string;
    readonly estado: string;
  };
  readonly actividad: {
    readonly id: string;
    readonly tipo: ActividadTipo;
    readonly referenciaExterna: string;
    readonly estado: ActividadEstado;
  };
  /** Un único timestamp para `created_at`/`updated_at` de las cuatro filas. */
  readonly timestamp: string;
}

/**
 * Metadatos del PR que alimentan el prompt sintético. NO incluye el diff
 * completo — decisión de alcance del MVP (R4 de la propuesta), reflejada
 * en el tipo para que nadie la reintroduzca por descuido.
 */
export interface PullRequestMetadata {
  readonly titulo: string;
  readonly cuerpo: string;
  readonly autor: string;
  readonly archivosCambiados: readonly string[];
  /** `true` si la lista de archivos se cortó en el tope del adaptador. */
  readonly archivosTruncados: boolean;
}

/**
 * Espejo del estado canónico sobre el tablero externo. Implementado por
 * `src/adapters/board/`, inyectado desde el composition root.
 *
 * CONTRATO: **nunca rechaza y nunca lanza**, ninguno de los tres métodos —
 * mismo contrato que `KnowledgeFeedbackPort` (`knowledge-contract.ts`).
 * Cualquier falla (red, HTTP ≠ 2xx, timeout, JSON inesperado) se traga y se
 * loguea adentro del adaptador. El estado canónico ya se persistió; el
 * tablero es cosmético.
 *
 * El núcleo habla de estados y responsables. NUNCA de labels, ni de números
 * de issue de una API concreta: el mapeo estado → label vive en
 * `src/adapters/board/labels.ts` (ADR 6).
 */
export interface ActivityBoardPort {
  /** `undefined` si no se pudieron leer (sin token, red caída, PR inexistente). */
  leerMetadatos(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly casoId: string;
  }): Promise<PullRequestMetadata | undefined>;

  publicarRevision(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly texto: string;
    readonly casoId: string;
  }): Promise<void>;

  mirrorEstado(input: {
    readonly proyectoId: string;
    readonly referenciaExterna: string;
    readonly estado: ActividadEstado;
    readonly responsableId?: string;
    readonly casoId: string;
  }): Promise<void>;
}
```

**Precisión del diseño sobre ADR 6**: la propuesta enumeró dos métodos en `ActivityBoardPort` (`mirrorEstado`, `publicarRevision`) y describió la lectura de metadatos del PR como una operación del adaptador de tablero, sin decir por qué puerto entra. Este diseño la pone **en el mismo puerto**, como tercer método, porque: (a) el spec `activity-board-mirror` la exige "antes de invocar `handleTurn`", y quien invoca `handleTurn` es el núcleo (`runActivityTurn`); (b) si viviera fuera del puerto, el composition root tendría que leer metadatos y pasárselos al núcleo, lo que le devuelve al wiring una decisión de negocio ("qué contexto lleva el prompt") que ADR 6 puso deliberadamente en el núcleo; (c) un segundo puerto para un solo método, contra el mismo adaptador y con la misma semántica de "nunca falla", sería ceremonia. Se agrega `casoId` a los tres métodos por correlación de logs (Concepto Transversal 3), no como dato de negocio.

### 3.2 `src/core/activity/` — lógica pura

Cuatro archivos, cada uno con su `*.test.ts` colocado (estilo del repo).

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `activity-contract.ts` | constantes, tipos, `ActivityStorePort`, `ActivityBoardPort`, `IncomingActivityEvent` | §3.1. Sin imports. |
| `transicion-estado.ts` | `parseVeredicto`, `transicionarEstado` | Máquina de estados. Puro, sin I/O. |
| `activity-prompt.ts` | `buildActivityPrompt`, topes de truncado | Prompt sintético. Puro. |
| `run-activity-turn.ts` | `RunActivityTurnDeps`, `RunActivityTurnResult`, `runActivityTurn` | Orquestador. Envuelve `handleTurn`, no lo modifica. |

#### `transicion-estado.ts`

```ts
import {
  ESTADO_APROBADO,
  ESTADO_OBSERVADO,
  ESTADO_RESUELTO,
  VEREDICTO_APROBADO,
  VEREDICTO_OBSERVADO,
  VEREDICTO_RESUELTO,
  VEREDICTO_PREFIX,
  type ActividadEstado,
  type Veredicto,
} from "./activity-contract.js";

/**
 * Extrae el veredicto de la respuesta del agente.
 *
 * REGLA DURA: cualquier ambigüedad cae en `VEREDICTO_OBSERVADO`. Un fallo de
 * parseo JAMÁS puede aprobar un PR solo (spec `activity-webhook-turn`,
 * "Parseo de veredicto y transición de estado"; R5 de la propuesta).
 *
 * Tolerancia deliberada, en este orden:
 * 1. Busca la ÚLTIMA línea que matchee `/^\s*[*_`#\s]*VEREDICTO\s*:\s*(.+)$/im`
 *    — la última y no la primera, porque el modelo suele repetir la
 *    instrucción antes de cumplirla.
 * 2. Del valor capturado quita backticks, asteriscos, comillas, puntos
 *    finales y espacios, y lo pasa a minúsculas sin acentos.
 * 3. Lo matchea contra sinónimos: `aprobado|aprobada|approved|lgtm` →
 *    aprobado · `observado|observada|observaciones|changes_requested` →
 *    observado · `resuelto|resuelta|resolved` → resuelto.
 * 4. Cualquier otra cosa (o ninguna línea) → `VEREDICTO_OBSERVADO`.
 */
export function parseVeredicto(respuestaAgente: string): Veredicto;

/**
 * Máquina de estados de `actividades.estado`. Pura y total.
 *
 * | veredicto \ estadoActual | pendiente_revision | observado | resuelto | aprobado |
 * |---|---|---|---|---|
 * | `aprobado`  | aprobado  | aprobado  | aprobado  | aprobado  |
 * | `observado` | observado | observado | observado | observado |
 * | `resuelto`  | *(sin cambio)* | resuelto | *(sin cambio)* | *(sin cambio)* |
 *
 * `aprobado` y `observado` valen desde cualquier estado: un `synchronize`
 * sobre un PR ya aprobado DEBE poder volver a `observado` si el agente
 * encuentra problemas nuevos — lo contrario dejaría un PR aprobado para
 * siempre por su primera revisión.
 *
 * `resuelto` solo es alcanzable desde `observado`, que es lo único que
 * "resuelto" significa (las observaciones previas quedaron resueltas). Desde
 * cualquier otro estado es una transición inválida y la función devuelve
 * `estadoActual` sin cambio — nunca inventa un estado, y nunca escala a
 * `aprobado` por una transición que no se pidió. El caller loguea el no-op
 * (`actividad-transicion-ignorada`, §9).
 */
export function transicionarEstado(
  estadoActual: ActividadEstado,
  veredicto: Veredicto,
): ActividadEstado;
```

#### `activity-prompt.ts`

```ts
import {
  ESTADO_OBSERVADO,
  VEREDICTO_PREFIX,
  VEREDICTOS,
  type Actividad,
  type ActividadEstado,
  type PullRequestMetadata,
} from "./activity-contract.js";

/** Topes de truncado del prompt sintético. Ver §7 (por qué existen). */
export const MAX_PROMPT_CUERPO_CHARS = 4_000;
export const MAX_PROMPT_COMENTARIO_CHARS = 2_000;
export const MAX_PROMPT_ARCHIVOS = 50;
export const MAX_PROMPT_TITULO_CHARS = 300;

export interface ActivityPromptContext {
  /** `undefined` cuando el tablero no pudo leerlos (sin `GITHUB_TOKEN`, red caída). */
  readonly metadatos?: PullRequestMetadata;
  /** Comentario que disparó este turno (`issue_comment`), si lo hubo. */
  readonly comentarioDisparador?: string;
  /** Estado ANTES de este turno — el agente necesita saber si está revisando por primera vez o verificando observaciones previas. */
  readonly estadoActual: ActividadEstado;
  /** Fallbacks del propio evento, usados cuando `metadatos` es `undefined`. */
  readonly titulo: string;
  readonly cuerpo: string;
}

/**
 * Construye el prompt sintético que reemplaza al texto que un humano
 * tipearía en la TUI. FUNCIÓN PURA: mismo input, mismo string.
 *
 * Aquí vive el framing de "revisor de PRs" — NO en el system prompt de
 * `CONVERSATIONAL_AGENT` (`definitions.ts`, que este hito no toca): cambiar
 * ese system prompt contaminaría también los turnos de la TUI, y un segundo
 * `AgentDefinition` obligaría a bifurcar el Selector de Turno (v2, ADR 1 del
 * arc42). Ver *Approach — agente y prompt sintético* de la propuesta.
 *
 * Estructura del texto generado, en este orden:
 *  1. Rol + tarea ("Sos el revisor automático de PRs de este proyecto...").
 *  2. Referencia: `{proyectoId} #{referenciaExterna}`, tipo, estado actual.
 *  3. Título (truncado a `MAX_PROMPT_TITULO_CHARS`).
 *  4. Descripción (truncada a `MAX_PROMPT_CUERPO_CHARS`, con marca `[…truncado]`).
 *  5. Archivos cambiados: hasta `MAX_PROMPT_ARCHIVOS`, y si se cortó,
 *     `(… y N archivos más)`.
 *  6. Si `comentarioDisparador` existe: el comentario, truncado a
 *     `MAX_PROMPT_COMENTARIO_CHARS`, con framing explícito de "verificá si
 *     esto resuelve tus observaciones anteriores".
 *  7. LIMITACIÓN DECLARADA (honestidad de R4): "No tenés el diff completo,
 *     solo metadatos y la lista de archivos. No afirmes nada sobre líneas de
 *     código que no viste."
 *  8. Instrucción de cierre OBLIGATORIA: última línea exactamente
 *     `` `${VEREDICTO_PREFIX} <valor>` `` con los valores de `VEREDICTOS`
 *     enumerados y su significado. El default de `parseVeredicto` se
 *     menciona explícitamente ("si no la incluís, se asume `observado`") —
 *     mitigación de R5 en el mismo lugar donde se pide.
 *
 * Cuando `metadatos` es `undefined`, los puntos 3-5 se arman con
 * `contexto.titulo`/`contexto.cuerpo` del evento y una lista de archivos
 * vacía, más una línea que lo dice ("No se pudieron leer los archivos
 * cambiados"). El turno completa igual — degradación, no error (§7).
 */
export function buildActivityPrompt(
  actividad: Actividad,
  contexto: ActivityPromptContext,
): string;
```

#### `run-activity-turn.ts` — el orquestador

```ts
import type {
  ActividadEstado,
  ActivityBoardPort,
  ActivityStorePort,
  IncomingActivityEvent,
  Veredicto,
} from "./activity-contract.js";

/**
 * Resultado del turno tal como `handleTurn` lo devuelve
 * (`HandleTurnResult`). Declarado acá, estructuralmente idéntico, por la
 * misma razón que `handle-turn.ts` declara el suyo en vez de importar
 * `TuiTurnResult`: mantener el módulo desacoplado de quién se lo inyecta.
 */
export interface ActivityTurnOutcome {
  readonly responseText: string;
  readonly agentLabel: string;
}

export interface RunActivityTurnDeps {
  readonly store: ActivityStorePort;
  readonly board: ActivityBoardPort;
  /**
   * EL punto clave del hito. El composition root inyecta acá un closure que
   * (a) construye el Adaptador de Conocimiento PARA ESTE `casoId` — fix de
   * R1, spec `knowledge-query` — y (b) llama `handleTurn(casoId, prompt,
   * deps)`. `handle-turn.ts` NO se modifica ni recibe dependencias nuevas
   * (ADR 6): el ciclo de actividad lo envuelve, no lo invade.
   */
  readonly runTurn: (casoId: string, prompt: string) => Promise<ActivityTurnOutcome>;
  /** `randomUUID` en producción; contador determinista en tests. */
  readonly newId: () => string;
  /** `() => new Date().toISOString()` en producción. */
  readonly now: () => string;
  /** Ya cerrado sobre `LogTurnEventDeps`; el núcleo no decide el destino del log. */
  readonly logEvent: (
    casoId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface RunActivityTurnResult {
  readonly actividadId: string;
  readonly casoId: string;
  readonly estadoAnterior: ActividadEstado;
  readonly estado: ActividadEstado;
  readonly veredicto: Veredicto;
  readonly responseText: string;
  /** `true` si esta invocación creó `caso`+`actividad`; `false` si reusó una existente. */
  readonly actividadCreada: boolean;
}

/**
 * Ciclo completo de un turno disparado por un evento externo.
 *
 * PROPAGA: `TurnFailedError` de `handleTurn` y cualquier error del `store`
 * (contrato: el store falla ruidosamente). NUNCA propaga un error del
 * `board` (contrato: el board nunca rechaza).
 *
 * Secuencia exacta:
 *  1. `store.findActividadPorReferencia({ proyectoId, referenciaExterna })`.
 *  2a. Si NO existe → `store.createCasoConActividad({...})` con
 *      `estado: ESTADO_PENDIENTE_REVISION`, `caso.tipo: evento.tipo`,
 *      `caso.estado: CASO_ESTADO_ACTIVO`, ids de `newId()` y timestamp de
 *      `now()`. UNA transacción (spec: "creación transaccional").
 *      → `actividad-creada`.
 *  2b. Si existe → se REUSA, incluido su `caso_id`. Esto no es un atajo: es
 *      lo que hace posible la segunda mitad del entregable. `assembleContext`
 *      resuelve `options.resume` por (`caso_id`, `agent_id`), así que el
 *      turno que atiende el `issue_comment` REANUDA la sesión SDK del turno
 *      que emitió las observaciones — el agente recuerda qué había observado
 *      sin que se lo repitamos en el prompt. → `actividad-reusada`.
 *  3. `await board.leerMetadatos(...)` — nunca lanza; `undefined` degrada.
 *  4. `buildActivityPrompt(actividad, { metadatos, comentarioDisparador,
 *     estadoActual: actividad.estado, titulo, cuerpo })`.
 *  5. `await runTurn(actividad.casoId, prompt)` — propaga si falla.
 *  6. `parseVeredicto(result.responseText)` → `transicionarEstado(
 *     actividad.estado, veredicto)`.
 *  7. `store.updateActividadEstado({ ... })` — SIEMPRE, aunque el estado no
 *     cambie: `updated_at` avanza y deja traza de que hubo un turno.
 *     Propaga si falla.
 *  8. `await board.publicarRevision({ texto: result.responseText, ... })`.
 *  9. `await board.mirrorEstado({ estado, responsableId, ... })`.
 *
 * 7 ANTES de 8-9, sin excepción: el estado canónico se persiste primero y el
 * espejo va después. Si el proceso muere entre 7 y 8, SQLite queda correcto
 * y el tablero desactualizado — el orden inverso dejaría un tablero que
 * afirma algo que la fuente de verdad no dice.
 */
export function runActivityTurn(
  evento: IncomingActivityEvent,
  deps: RunActivityTurnDeps,
): Promise<RunActivityTurnResult>;
```

### 3.3 `src/core/concurrency/keyed-queue.ts` (nuevo — ADR 8)

Sin imports. El contrato está escrito con la precisión con la que hay que testearlo.

```ts
/**
 * Cola de serialización por clave. Tareas con la MISMA clave corren en
 * orden, una tras otra; tareas con claves DISTINTAS corren concurrentes.
 *
 * Lo que serializa este hito es el ciclo lógico `leer actividad → await del
 * modelo → escribir actividad` por `proyecto_id` (ADR 8, y *Approach —
 * Concurrencia* de la propuesta): `better-sqlite3` es síncrono, así que dos
 * sentencias SQL nunca se interleavan dentro del proceso — el peligro real
 * es el `await` del medio.
 */
export interface KeyedQueue {
  /**
   * Encola `task` bajo `key` y devuelve una promesa con SU resultado.
   *
   * Garantías (cada una con test propio, §10):
   * 1. ORDEN: si `run(k, a)` se llama antes que `run(k, b)`, `b` no empieza
   *    hasta que la promesa de `a` se asienta (resuelva o rechace).
   * 2. AISLAMIENTO POR CLAVE: `run(k1, ...)` nunca espera a `run(k2, ...)`.
   * 3. NO CONTAGIO: si `a` rechaza, `b` corre igual. La cadena interna se
   *    construye con `.then(noop, noop)`, así que un rechazo nunca envenena
   *    la cola ni produce un `unhandledRejection`; el rechazo real se
   *    entrega ÚNICAMENTE al caller de `run(k, a)`.
   * 4. SIN FUGA (R6): al asentarse la última tarea de una clave, la entrada
   *    se BORRA del mapa. El borrado es condicional por IDENTIDAD — solo se
   *    borra si la cola actual de esa clave sigue siendo la promesa que
   *    acaba de terminar. Sin ese chequeo, una tarea nueva encolada
   *    mientras la anterior terminaba se borraría del mapa y la siguiente
   *    arrancaría en paralelo, rompiendo la garantía 1.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;

  /** Claves con trabajo en vuelo. Existe para que el test de la garantía 4 pueda afirmar `size === 0`. */
  readonly size: number;
}

export function createKeyedQueue(): KeyedQueue;
```

---

## 4. Adaptador de Webhooks (entrante) — `src/adapters/webhooks/`

Cinco archivos + tests colocados. **No importa** memoria, agentes, tablero ni `src/core/activity/run-activity-turn.js`; solo el contrato (`activity-contract.js`) y el logger.

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `config.ts` | `WebhookConfig`, `resolveWebhookConfig`, `isWebhookEnabled`, defaults | env → config tipada. Pura. |
| `signature.ts` | `computeSignature`, `verifySignature`, headers | HMAC-SHA256 (`node:crypto`). Puro salvo el hash. |
| `github-mapper.ts` | `mapGithubEvent`, acciones soportadas | payload → `IncomingActivityEvent`. Puro. |
| `server.ts` | tipos estructurales, `createRequestListener`, `WebhookServerHandle` | Transporte HTTP, tope de body, ack `202`, drenaje. |
| `index.ts` | `startWebhookServer`, `WebhookAdapter` | Fachada. Lo único que importa el composition root. |

### 4.1 `config.ts`

```ts
import "../../core/config/env.js";

/**
 * El side-effect import de arriba carga `.env` vía el punto único del repo
 * (`src/core/config/env.ts`), igual que `src/adapters/knowledge/config.ts`
 * ya hace hoy (verificado). Así este módulo es correcto sin depender de que
 * `main.ts` se acuerde de importar `env.js` primero.
 */
export interface WebhookConfig {
  /** `""` (o solo espacios) = adaptador DESHABILITADO: no se abre ningún puerto (ADR 5, punto 5). */
  readonly secret: string;
  readonly port: number;
  readonly path: string;
  readonly maxBodyBytes: number;
}

export const DEFAULT_WEBHOOK_PORT = 8787;
export const DEFAULT_WEBHOOK_PATH = "/webhooks/github";
/** 1 MiB. Ver ADR 9. */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;
/** Techo del drenaje de turnos en vuelo al cerrar. Constante, NO env var (es un presupuesto de UX, no un hecho del entorno). Ver ADR 10. */
export const SERVER_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Pura, recibe `env` como parámetro (default `process.env`) — mismo patrón
 * que `resolveGraphifyConfig`, para que los tests pasen un objeto literal en
 * vez de mutar el env global.
 *
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `GITHUB_WEBHOOK_SECRET` | `secret` | `""` (deshabilitado) |
 * | `WEBHOOK_PORT` | `port` | `DEFAULT_WEBHOOK_PORT` |
 * | `WEBHOOK_PATH` | `path` | `DEFAULT_WEBHOOK_PATH` |
 * | `WEBHOOK_MAX_BODY_BYTES` | `maxBodyBytes` | `DEFAULT_MAX_BODY_BYTES` |
 *
 * Un numérico ausente, vacío, no numérico o ≤ 0 cae al default en silencio.
 * `path` se normaliza a que empiece con `/`. NUNCA lanza: un secreto ausente
 * es un modo de operación válido, no un error de arranque.
 */
export function resolveWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig;

/** `config.secret.trim() !== ""`. Único gate del listener. */
export function isWebhookEnabled(config: WebhookConfig): boolean;
```

### 4.2 `signature.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";
export const EVENT_HEADER = "x-github-event";
export const DELIVERY_HEADER = "x-github-delivery";
export const SIGNATURE_PREFIX = "sha256=";

/** `"sha256=" + HMAC-SHA256(secret, rawBody)` en hex minúscula. Exportada para que los tests calculen la firma esperada con el mismo código que GitHub usaría. */
export function computeSignature(rawBody: Buffer, secret: string): string;

/**
 * Verificación en tiempo constante. Devuelve `false` (NUNCA lanza) si:
 * el header falta, viene vacío, viene como array, no empieza con
 * `SIGNATURE_PREFIX`, o su longitud en bytes difiere de la esperada.
 *
 * El chequeo de longitud es OBLIGATORIO antes de `timingSafeEqual`: esa
 * función LANZA `RangeError` si los buffers tienen distinto largo, así que
 * sin el chequeo previo una firma de largo raro sería una excepción no
 * capturada en el handler HTTP en vez de un `401`.
 *
 * Se compara sobre `Buffer.from(x, "utf8")` de las dos cadenas COMPLETAS
 * (con prefijo incluido), no sobre el hex parseado: comparar los bytes tal
 * como llegaron evita cualquier normalización intermedia.
 */
export function verifySignature(
  rawBody: Buffer,
  headerValue: string | string[] | undefined,
  secret: string,
): boolean;
```

### 4.3 `github-mapper.ts`

```ts
import {
  ACTIVIDAD_TIPO_PR_REVIEW,
  type IncomingActivityEvent,
} from "../../core/activity/activity-contract.js";

export const ORIGEN_GITHUB = "github";
export const SUPPORTED_PULL_REQUEST_ACTIONS = ["opened", "synchronize", "reopened"] as const;
export const SUPPORTED_ISSUE_COMMENT_ACTIONS = ["created"] as const;

/**
 * Traduce un payload de GitHub ya verificado y parseado a un
 * `IncomingActivityEvent`. PURA — no toca red, no lanza.
 *
 * Devuelve `undefined` (evento IGNORADO, no error) cuando:
 * - `eventName` no es `"pull_request"` ni `"issue_comment"`;
 * - la acción no está en la lista soportada de ese evento;
 * - es `issue_comment` y `payload.issue.pull_request` NO existe (el issue no
 *   es un PR — escenario literal del spec);
 * - el payload no tiene la forma mínima esperada (`repository.full_name`,
 *   número, título). Un payload deforme se ignora, no rompe: el listener ya
 *   verificó que viene de GitHub, así que una forma inesperada es un cambio
 *   de la API, no un ataque.
 *
 * El narrowing es a mano (type guards locales), sin `zod`: acá TODO camino
 * de invalidez termina en el mismo `undefined`, así que un schema solo
 * aportaría mensajes de error que nadie lee.
 *
 * Mapeo de campos:
 * | `IncomingActivityEvent` | `pull_request` | `issue_comment` |
 * |---|---|---|
 * | `proyectoId` | `repository.full_name` | ídem |
 * | `proyectoNombre` | `repository.name` | ídem |
 * | `repoUrl` | `repository.html_url` | ídem |
 * | `tipo` | `ACTIVIDAD_TIPO_PR_REVIEW` | ídem |
 * | `referenciaExterna` | `String(pull_request.number)` | `String(issue.number)` |
 * | `responsableId` | `pull_request.user.login` | `issue.user.login` |
 * | `titulo` | `pull_request.title` | `issue.title` |
 * | `cuerpo` | `pull_request.body ?? ""` | `issue.body ?? ""` |
 * | `archivosCambiados` | `[]` (los trae el tablero, §5) | `[]` |
 * | `comentarioDisparador` | ausente | `comment.body` |
 *
 * `responsableId` es el AUTOR del PR, no quien comentó: el responsable es
 * quien tiene que actuar sobre las observaciones, y es a quien se asigna el
 * Issue en `mirrorEstado`.
 */
export function mapGithubEvent(input: {
  readonly eventName: string | undefined;
  readonly payload: unknown;
  readonly deliveryId: string;
  readonly recibidoEn: string;
}): IncomingActivityEvent | undefined;
```

### 4.4 `server.ts`

```ts
import type { IncomingActivityEvent } from "../../core/activity/activity-contract.js";
import type { WebhookConfig } from "./config.js";

/**
 * Recorte estructural de `http.IncomingMessage` / `http.ServerResponse` — el
 * mismo truco que `RenderTui` usa sobre el `render` de Ink y `QueryFn` sobre
 * el `query` del SDK (ambos verificados en el repo): los tipos reales de
 * `node:http` los satisfacen estructuralmente, así que producción pasa los
 * objetos reales y los tests pasan dobles planos SIN abrir ningún puerto ni
 * mockear `node:http`.
 */
export interface WebhookRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface WebhookResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface HttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateServerFn = (
  listener: (req: WebhookRequest, res: WebhookResponse) => void,
) => HttpServerLike;

export interface WebhookServerDeps {
  readonly config: WebhookConfig;
  /**
   * Callback inyectado desde el composition root (ADR 5, punto 3; molde
   * `startTui(onSubmit)`). El adaptador NO sabe qué hace: solo que devuelve
   * una promesa y que NUNCA debe rechazar (`build-on-activity.ts` traga y
   * loguea, §6.2). El `.catch` de acá es red de seguridad, no el mecanismo.
   */
  readonly onEvent: (evento: IncomingActivityEvent) => Promise<void>;
  /** Ya cerrado sobre el id de correlación de transporte. Ver §9. */
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly now?: () => string;
}

export interface WebhookServerHandle {
  readonly port: number;
  /** Ver ADR 10: deja de aceptar, drena los `onEvent` en vuelo con techo de `SERVER_CLOSE_TIMEOUT_MS`, resuelve. NUNCA rechaza. */
  close(): Promise<void>;
}

/**
 * El listener HTTP, aislado del ciclo de vida del servidor para poder
 * testear cada respuesta con dobles planos.
 *
 * Tabla de respuestas — EXHAUSTIVA:
 * | Condición | Status | Efecto |
 * |---|---|---|
 * | `method !== "POST"` o path ≠ `config.path` | `404` | nada |
 * | body acumulado > `config.maxBodyBytes` | `413` | `req.destroy()`, sin HMAC, sin parse (ADR 9) |
 * | `"error"` en el request | `400` | nada |
 * | firma ausente/inválida | `401` | `webhook-firma-invalida`. NINGUNA fila creada |
 * | `JSON.parse` falla | `400` | `webhook-payload-invalido` |
 * | `mapGithubEvent` → `undefined` | `202` | `webhook-evento-ignorado`, sin actividad |
 * | evento válido | `202` | responde PRIMERO, después `onEvent(...)` sin `await` (ADR 10) |
 *
 * El path se compara contra `req.url` recortado en el primer `?` — GitHub
 * no manda query string, pero un proxy de forwarding (`smee`, `gh webhook
 * forward`) puede agregar una.
 */
export function createRequestListener(
  deps: WebhookServerDeps,
): (req: WebhookRequest, res: WebhookResponse) => void;

/**
 * Monta el listener sobre un servidor HTTP. `createServer` se inyecta
 * (default: `http.createServer` real) para que ningún test del suite por
 * defecto abra un puerto — criterio de aceptación de la propuesta.
 *
 * `listen(config.port)` y `on("error")`: un `EADDRINUSE` rechaza esta
 * promesa con un error legible; `index.ts` decide qué hacer con eso (§4.5).
 */
export function startServer(
  deps: WebhookServerDeps,
  createServer?: CreateServerFn,
): Promise<WebhookServerHandle>;
```

### 4.5 `index.ts` (fachada)

```ts
export interface WebhookAdapter {
  readonly port: number;
  readonly path: string;
  close(): Promise<void>;
}

/**
 * Punto de entrada único del adaptador — molde `startTui(onSubmit)` (ADR 5,
 * punto 3), con dos diferencias inevitables y deliberadas: es `async`
 * (`listen` lo es) y puede devolver `undefined`.
 *
 * Devuelve `undefined` cuando `!isWebhookEnabled(config)`: NO se abre ningún
 * puerto, se emite `webhook-deshabilitado` y el proceso arranca idéntico a
 * `v1.1.0`. Es la degradación por ausencia total del listener que ADR 5
 * elige sobre un endpoint que responde `503` — misma filosofía que el
 * Adaptador de Conocimiento degradando sin `graphify`.
 *
 * `undefined` y no un objeto no-op a propósito: `main.ts` tiene que poder
 * distinguir "no hay nada que cerrar" de "hay un servidor que cerrar" en su
 * `finally`, y un no-op con `close()` vacío esconde esa diferencia justo en
 * el camino de salida del proceso.
 */
export function startWebhookServer(deps: {
  readonly onEvent: (evento: IncomingActivityEvent) => Promise<void>;
  readonly logEvent: (
    correlationId: string,
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly config?: WebhookConfig;     // default: resolveWebhookConfig()
  readonly createServer?: CreateServerFn; // default: node:http createServer — el seam de los tests
}): Promise<WebhookAdapter | undefined>;
```

---

## 5. Adaptador de Tablero (saliente) — `src/adapters/board/`

Cuatro archivos + tests. Implementa `ActivityBoardPort` (`src/core/activity/`); no lo invoca nadie más que el núcleo.

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `config.ts` | `BoardConfig`, `resolveBoardConfig`, `isBoardEnabled`, defaults | env → config tipada. Pura. |
| `labels.ts` | `ESTADO_LABELS`, `MANAGED_LABELS`, `labelForEstado`, `mergeLabels` | Mapeo estado → label de GitHub. **Detalle de GitHub, no del dominio** (ADR 6). Puro. |
| `github-client.ts` | `FetchFn`, `FetchResponseLike`, `GithubApiError`, `splitProyectoId`, `githubRequest` | Único lugar que habla HTTP. |
| `index.ts` | `createBoardAdapter`, `createNoopBoardAdapter` | Fachada: implementa los 3 métodos del puerto, traga y loguea. |

### 5.1 `config.ts` y `labels.ts`

```ts
import "../../core/config/env.js";

export interface BoardConfig {
  /** `""` = adaptador DESHABILITADO → puerto no-op que loguea. */
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly userAgent: string;
}

export const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
export const DEFAULT_BOARD_TIMEOUT_MS = 10_000;
export const DEFAULT_BOARD_USER_AGENT = "arnes-empresarial";
/** Tope de archivos que se piden y se pasan al prompt (§7). Sin paginación — fuera de alcance. */
export const MAX_CHANGED_FILES = 50;
/** El límite real de un comentario de GitHub es 65 536 caracteres; se corta antes con margen. */
export const MAX_COMMENT_CHARS = 60_000;

/**
 * | Env var | Campo | Default |
 * |---|---|---|
 * | `GITHUB_TOKEN` | `token` | `""` (deshabilitado) |
 * | `GITHUB_API_BASE_URL` | `apiBaseUrl` | `DEFAULT_GITHUB_API_BASE_URL` |
 * | `BOARD_TIMEOUT_MS` | `requestTimeoutMs` | `DEFAULT_BOARD_TIMEOUT_MS` |
 *
 * Mismas reglas que `resolveWebhookConfig`: pura, nunca lanza, numéricos
 * inválidos caen al default.
 */
export function resolveBoardConfig(env: NodeJS.ProcessEnv = process.env): BoardConfig;
export function isBoardEnabled(config: BoardConfig): boolean;
```

```ts
import {
  ESTADO_APROBADO, ESTADO_OBSERVADO, ESTADO_PENDIENTE_REVISION, ESTADO_RESUELTO,
  type ActividadEstado,
} from "../../core/activity/activity-contract.js";

/** Mapeo literal del plan. Vive acá y NO en el núcleo (ADR 6): es vocabulario de GitHub. */
export const ESTADO_LABELS: Readonly<Record<ActividadEstado, string>> = {
  [ESTADO_PENDIENTE_REVISION]: "necesita-revision",
  [ESTADO_OBSERVADO]: "observaciones-pendientes",
  [ESTADO_RESUELTO]: "resuelto",
  [ESTADO_APROBADO]: "aprobado",
};

/** Los cuatro labels que este adaptador administra. Ningún otro label del Issue se toca. */
export const MANAGED_LABELS: readonly string[] = Object.values(ESTADO_LABELS);

export function labelForEstado(estado: ActividadEstado): string;

/**
 * Dada la lista actual de labels del Issue, devuelve la lista que debe
 * quedar: se quitan TODOS los `MANAGED_LABELS` y se agrega el de `estado`.
 *
 * Esto es lo que satisface literalmente el escenario del spec "queda con el
 * label `aprobado` (y sin los otros tres labels de estado)" SIN borrar
 * labels que el equipo puso a mano (`bug`, `docs`, ...). Preserva el orden
 * relativo de los labels no administrados.
 */
export function mergeLabels(
  labelsActuales: readonly string[],
  estado: ActividadEstado,
): readonly string[];
```

### 5.2 `github-client.ts`

```ts
import type { BoardConfig } from "./config.js";

/** Recorte estructural de `fetch` — el `fetch` global real lo satisface. Es EL seam de los tests (ninguno le pega a la API real). */
export type FetchFn = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type GithubFailureReason = "network" | "timeout" | "http" | "parse" | "unknown";

/**
 * Error propio del adaptador — mismo rol que `GraphifyCliError` en el
 * Adaptador de Conocimiento y que `CasoNotFoundError` en `repository.ts`:
 * traducir la falla cruda a vocabulario del adaptador para que el log tenga
 * un `reason` estructurado. NUNCA cruza la frontera del puerto (§7).
 */
export class GithubApiError extends Error {
  readonly reason: GithubFailureReason;
  readonly status?: number;
  constructor(reason: GithubFailureReason, message: string, options?: { status?: number; cause?: unknown });
}

/** `"owner/repo"` → `{ owner, repo }`. Lanza `GithubApiError("parse")` si no tiene exactamente una `/`. */
export function splitProyectoId(proyectoId: string): { readonly owner: string; readonly repo: string };

/**
 * Única función que habla HTTP. Devuelve el JSON parseado (`unknown` — el
 * narrowing es de quien llama) o lanza `GithubApiError`.
 *
 * - Headers fijos: `Authorization: Bearer <token>`, `Accept:
 *   application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
 *   `User-Agent: <config.userAgent>`, y `Content-Type: application/json`
 *   solo cuando hay body.
 * - Timeout con `AbortSignal.timeout(config.requestTimeoutMs)` → `reason:
 *   "timeout"` (se distingue del error de red por `error.name ===
 *   "TimeoutError"`).
 * - `!response.ok` → `reason: "http"` con `status`. El cuerpo de error de
 *   GitHub se lee con `text()` y se recorta para el mensaje; NUNCA se
 *   loguea el token.
 * - Sin reintentos, sin backoff, sin paginación: fuera de alcance
 *   explícito de la propuesta (una llamada por transición no lo justifica).
 */
export function githubRequest(input: {
  readonly method: string;
  /** Path relativo a `apiBaseUrl`, ya con owner/repo/número interpolados. */
  readonly path: string;
  readonly body?: unknown;
  readonly config: BoardConfig;
  readonly fetchFn: FetchFn;
}): Promise<unknown>;
```

### 5.3 `index.ts` (fachada — la implementación del puerto)

```ts
import type { ActivityBoardPort } from "../../core/activity/activity-contract.js";

/**
 * Construye el `ActivityBoardPort` real. Si `!isBoardEnabled(config)`
 * devuelve directamente `createNoopBoardAdapter(logEvent)` — degradación sin
 * `GITHUB_TOKEN` (spec `activity-board-mirror`): el estado canónico se sigue
 * persistiendo y solo se omite el espejo.
 *
 * CONTRATO IMPLEMENTADO: los tres métodos son `try/catch` TOTAL. Capturan
 * `GithubApiError` y cualquier throw inesperado, loguean, y resuelven.
 * `GithubApiError` nunca cruza esta frontera.
 */
export function createBoardAdapter(deps: {
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly config?: BoardConfig;   // default: resolveBoardConfig()
  readonly fetchFn?: FetchFn;      // default: globalThis.fetch — el seam de los tests
}): ActivityBoardPort;

/** Puerto que no llama a nada y loguea `tablero-deshabilitado` con la operación pedida. `leerMetadatos` devuelve `undefined`. */
export function createNoopBoardAdapter(
  logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void,
): ActivityBoardPort;
```

**Llamadas REST exactas** (owner/repo salen de `splitProyectoId(proyectoId)`, `n` = `referenciaExterna`):

| Método del puerto | Requests | Notas |
|---|---|---|
| `leerMetadatos` | `GET /repos/{owner}/{repo}/pulls/{n}` → `title`, `body`, `user.login`<br>`GET /repos/{owner}/{repo}/pulls/{n}/files?per_page={MAX_CHANGED_FILES}` → `filename[]` | `archivosTruncados = files.length >= MAX_CHANGED_FILES`. **No** se pide el diff (`Accept: ...diff`) — R4, límite del MVP codificado en el tipo `PullRequestMetadata`. Si el primer GET falla, devuelve `undefined` sin intentar el segundo. Si falla solo el segundo, devuelve metadatos con `archivosCambiados: []`. |
| `publicarRevision` | `POST /repos/{owner}/{repo}/issues/{n}/comments` con `{ body: texto }` | `texto` truncado a `MAX_COMMENT_CHARS`. El endpoint de *issues* sirve para PRs (un PR es un Issue en la API de GitHub) — es el que el plan nombra. |
| `mirrorEstado` | `GET /repos/{owner}/{repo}/issues/{n}` → `labels[].name`<br>`PATCH /repos/{owner}/{repo}/issues/{n}` con `{ labels: mergeLabels(...), ...(responsableId ? { assignees: [responsableId] } : {}) }` | Dos llamadas y no una: `PATCH` con `labels` **reemplaza** el conjunto completo, así que sin leer primero se borrarían los labels manuales del equipo. `assignees` se OMITE cuando no hay responsable — mandarlo vacío desasignaría a todos. Si el GET falla, se hace el PATCH igual con `mergeLabels([], estado)` y se loguea `tablero-labels-no-leidos`: es mejor un label correcto perdiendo labels manuales que un estado sin espejar. |

Un label que no existe en el repo se **crea automáticamente** al asignarlo por API (color por defecto). No hace falta pre-crear los cuatro, aunque conviene para que tengan color (ver §12).

---

## 6. Memoria y composition root

### 6.1 `src/adapters/memory/`

#### Migración `migrations/0003_proyectos_responsables_actividades.ts` (nueva)

SQL **literal del plan**, con el mismo estilo `IF NOT EXISTS` de `0001_casos_sesiones_agente.ts` (verificado).

```ts
/**
 * Esquema de actividades (Hito 3). `actividades` se liga directamente a
 * `casos` (Hito 1) — no se reinventa la correlación.
 *
 * `tipo` acepta los tres valores del plan aunque este hito solo ejercite
 * `'pr_review'` (ADR 5, *Fuera de alcance*): dejar el esquema completo hace
 * que conectar un segundo emisor sea escribir un mapper, no migrar la base.
 *
 * `estado` queda como TEXT abierto, sin CHECK: los valores válidos son
 * asunto del Núcleo (`activity-contract.ts`), mismo criterio que
 * `repository.ts` ya documenta para `casos.estado` ("intencionalmente un
 * string abierto, no un enum").
 */
export const migration0003ProyectosResponsablesActividades = {
  id: "0003_proyectos_responsables_actividades",
  sql: `
CREATE TABLE IF NOT EXISTS proyectos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responsables (
  id TEXT PRIMARY KEY,
  nombre TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actividades (
  id TEXT PRIMARY KEY,
  proyecto_id TEXT NOT NULL REFERENCES proyectos(id),
  tipo TEXT NOT NULL,
  referencia_externa TEXT NOT NULL,
  responsable_id TEXT REFERENCES responsables(id),
  caso_id TEXT NOT NULL REFERENCES casos(id),
  estado TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actividades_proyecto ON actividades(proyecto_id);
`,
};
```

Y en `migrations/index.ts`, **append** (nunca editar ni reordenar entradas ya commiteadas — regla que ese archivo documenta):

```ts
export const migrations: readonly Migration[] = [
  migration0001CasosSesionesAgente,
  migration0002IdxSesionesCasoAgente,
  migration0003ProyectosResponsablesActividades,
];
```

**Sin índice compuesto**, a propósito: `findActividadPorReferencia` filtra por `WHERE proyecto_id = ? AND referencia_externa = ?`, y `idx_actividades_proyecto` ya sirve como columna líder de ese predicado. Un `idx_actividades_referencia(proyecto_id, referencia_externa)` sería medible recién con miles de actividades por proyecto; si algún día hace falta, entra como `0004`, exactamente como `0002` hizo con `sesiones_agente`.

#### `db.ts` — una línea (en contexto)

```ts
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  // Hito 3: WAL habilita lectores concurrentes con un escritor y elimina el
  // bloqueo de base completa del journal por defecto — la mitad de
  // infraestructura de la estrategia de concurrencia (la otra mitad es la
  // cola por `proyecto_id`, ADR 8). Aparecen `<archivo>.db-wal` y
  // `<archivo>.db-shm` junto a `data/harness.db` (ver `.gitignore`, §8).
  // Reversible con `journal_mode = DELETE` sin pérdida de datos.
  // Para `:memory:` SQLite ignora el pedido y sigue en modo `memory` — los
  // tests que abren bases en memoria no cambian de comportamiento.
  db.pragma("journal_mode = WAL");
  try {
    runMigrations(db, migrationsToApply);
```

#### `repository.ts` — funciones nuevas (firmas completas)

Mismo estilo que lo existente: interfaces `readonly`, `rowToX` privados, errores de dominio traducidos con `isSqliteConstraintError`, `RETURNING` + `COALESCE` para los updates.

```ts
export interface Proyecto {
  readonly id: string;          // "owner/repo"
  readonly nombre: string;
  readonly repoUrl: string;
  readonly createdAt: string;
}

export interface Responsable {
  readonly id: string;          // login de GitHub
  readonly nombre?: string;
  readonly createdAt: string;
}

export interface Actividad {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: string;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ActividadNotFoundError extends Error {
  constructor(id: string);      // name: "ActividadNotFoundError"
}
export class ActividadAlreadyExistsError extends Error {
  constructor(id: string);      // name: "ActividadAlreadyExistsError"
}
/** FK rota: `proyecto_id`, `caso_id` o `responsable_id` no existen. */
export class ActividadInvalidReferenceError extends Error {
  constructor(actividadId: string);  // name: "ActividadInvalidReferenceError"
}

/** `INSERT ... ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, repo_url = excluded.repo_url RETURNING ...`. Idempotente por diseño: el mismo repo llega en cada webhook. */
export function upsertProyecto(
  db: Database.Database,
  input: { readonly id: string; readonly nombre: string; readonly repoUrl: string; readonly createdAt: string },
): Proyecto;

export function getProyectoById(db: Database.Database, id: string): Proyecto | undefined;

/** Ídem, `ON CONFLICT(id) DO UPDATE SET nombre = COALESCE(excluded.nombre, nombre)` — un `nombre` ausente no borra el que ya había. */
export function upsertResponsable(
  db: Database.Database,
  input: { readonly id: string; readonly nombre?: string; readonly createdAt: string },
): Responsable;

export interface CreateActividadInput {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: string;
  readonly referenciaExterna: string;
  readonly responsableId?: string;
  readonly casoId: string;
  readonly estado: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createActividad(db: Database.Database, input: CreateActividadInput): Actividad;

export function getActividadById(db: Database.Database, id: string): Actividad | undefined;

/**
 * La actividad más reciente para ese par. `ORDER BY created_at DESC, rowid
 * DESC LIMIT 1` — mismo desempate por `rowid` que `getLatestSesionAgente` ya
 * documenta (dos filas pueden compartir timestamp).
 */
export function findActividadPorReferencia(
  db: Database.Database,
  proyectoId: string,
  referenciaExterna: string,
): Actividad | undefined;

export interface ActividadUpdate {
  readonly estado?: string;
  /** `null` explícito DESASIGNA; `undefined`/ausente deja el valor actual (semántica de `COALESCE`). */
  readonly responsableId?: string | null;
  readonly updatedAt: string;
}

/** `UPDATE ... SET ... COALESCE ... RETURNING ...`, igual que `updateCaso`. Lanza `ActividadNotFoundError` si `id` no existe. */
export function updateActividad(
  db: Database.Database,
  id: string,
  update: ActividadUpdate,
): Actividad;

export interface CreateCasoConActividadInput {
  readonly proyecto: { readonly id: string; readonly nombre: string; readonly repoUrl: string };
  readonly responsable?: { readonly id: string; readonly nombre?: string };
  readonly caso: CreateCasoInput;
  readonly actividad: Omit<CreateActividadInput, "proyectoId" | "casoId" | "responsableId">;
  readonly timestamp: string;
}

export interface CreateCasoConActividadResult {
  readonly caso: Caso;
  readonly actividad: Actividad;
}

/**
 * `upsertProyecto` + (`upsertResponsable`) + `createCaso` + `createActividad`
 * en UNA transacción — `db.transaction(fn)()` de `better-sqlite3`, que es
 * síncrona y atómica: si cualquiera de los cuatro pasos lanza, SQLite
 * revierte los anteriores y no queda ni un `proyecto` huérfano.
 *
 * Es lo que satisface literalmente el requisito "creación transaccional de
 * caso y actividad" del spec, y lo que hace verdadera la afirmación "una
 * firma inválida no crea NINGUNA fila": no hay estado intermedio observable.
 */
export function createCasoConActividad(
  db: Database.Database,
  input: CreateCasoConActividadInput,
): CreateCasoConActividadResult;
```

### 6.2 `src/build-on-activity.ts` (nuevo — el módulo hermano de `build-on-submit.ts`)

**Nombre decidido**: `build-on-activity.ts`. Simetría literal con `build-on-submit.ts` (`onSubmit` → `onActivity`), mismo nivel (`src/`, encima de `core/` y `adapters/`) y por la misma razón que ese archivo documenta: importa adaptadores concretos (`memory`, `knowledge`) **y** núcleo, así que no puede vivir dentro de ningún adaptador sin volverse, estructuralmente, adaptador→adaptador. Y como `build-on-submit.ts`, se extrae de `main.ts` para tener test propio (`main.ts` no es importable desde un test: corre `bootstrapHarness()`, `openDatabase()` y un `await` top-level).

```ts
import Database from "better-sqlite3";
import { createKeyedQueue, type KeyedQueue } from "./core/concurrency/keyed-queue.js";
import { runActivityTurn } from "./core/activity/run-activity-turn.js";
import type { ActivityBoardPort, ActivityStorePort, IncomingActivityEvent } from "./core/activity/activity-contract.js";
import { handleTurn, type MemoryPort } from "./core/turn-selector/handle-turn.js";
import { logTurnEvent, type LogTurnEventDeps } from "./core/logging/turn-logger.js";
import type { bootstrapHarness } from "./core/startup/bootstrap.js";
import { createKnowledgeAdapter, type KnowledgeAdapter } from "./adapters/knowledge/index.js";

export type ActivityEventHandler = (evento: IncomingActivityEvent) => Promise<void>;

export interface BuildOnActivityDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly board: ActivityBoardPort;
  /** Inyectada para que el test pueda observar `size` y el orden; producción pasa `createKeyedQueue()`. */
  readonly queue: KeyedQueue;
  readonly newId?: () => string;                       // default: randomUUID
  readonly now?: () => string;                         // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;                 // omitir en producción (default: archivo)
  /**
   * Fábrica del Adaptador de Conocimiento POR CASO — fix de R1 y del spec
   * `knowledge-query`. Default: `(casoId) => createKnowledgeAdapter({ casoId,
   * logEvent: (e, f) => logTurnEvent(casoId, e, f, logDeps) })`. Inyectable
   * para que el test pueda afirmar que se construye UNA instancia POR
   * `casoId`, con su propio `CitedNodesRecorder`.
   */
  readonly createKnowledge?: (casoId: string) => KnowledgeAdapter;
  /** Inyectable solo para el test; default: la implementación de abajo sobre `repository.ts`. */
  readonly store?: ActivityStorePort;
}

/**
 * Devuelve el callback `(evento) => Promise<void>` que el Adaptador de
 * Webhooks recibe inyectado (ADR 5, punto 2-3). Es el análogo exacto de
 * `buildOnSubmit`: aplicación parcial en el composition root.
 *
 * CONTRATO: la promesa devuelta **nunca rechaza**. GitHub ya recibió su
 * `202` (ADR 10) y no hay nadie del otro lado a quien entregarle un error;
 * un rechazo acá solo produciría un `unhandledRejection` en un proceso que
 * está sosteniendo una TUI. Toda falla se loguea
 * (`actividad-turno-fallido`) y se traga EN ESTE límite — nunca dentro de
 * `runActivityTurn`, que sí debe propagar (spec: "el error propaga como
 * fallo del turno").
 *
 * Cuerpo, en una sola expresión:
 *
 *   return (evento) =>
 *     queue.run(evento.proyectoId, async () => {
 *       try {
 *         await runActivityTurn(evento, {
 *           store, board,
 *           runTurn: (casoId, prompt) => {
 *             const knowledge = createKnowledge(casoId);
 *             return handleTurn(casoId, prompt, {
 *               memory, hooks, candidateAgents: agents,
 *               ...(logDeps ? { logDeps } : {}),
 *               mcpServers: knowledge.mcpServers,
 *               knowledgeFeedback: knowledge.feedback,
 *             });
 *           },
 *           newId, now,
 *           logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields, logDeps),
 *         });
 *       } catch (error) {
 *         logTurnEvent(evento.deliveryId, "actividad-turno-fallido", {
 *           proyectoId: evento.proyectoId,
 *           referenciaExterna: evento.referenciaExterna,
 *           message: error instanceof Error ? error.message : String(error),
 *           ...(error instanceof TurnFailedError ? { stage: error.stage } : {}),
 *         }, logDeps);
 *       }
 *     });
 *
 * Tres cosas que este cuerpo decide, y que valen leer dos veces:
 *
 * 1. `queue.run(evento.proyectoId, ...)` envuelve el ciclo COMPLETO, no solo
 *    la escritura: lo que hay que serializar es leer-actividad → `await` del
 *    modelo → escribir-actividad (ADR 8).
 * 2. `createKnowledge(casoId)` se llama DENTRO de `runTurn`, o sea una vez
 *    por turno y con el `casoId` que `runActivityTurn` acaba de crear o
 *    resolver. Ese es el fix de R1: cada turno tiene su propio
 *    `CitedNodesRecorder` y las citas no se cruzan con las de la TUI.
 * 3. El spread condicional de `logDeps` es obligatorio bajo
 *    `exactOptionalPropertyTypes: true`, exactamente como `build-on-submit.ts`
 *    ya documenta. `mcpServers`/`knowledgeFeedback` van SIEMPRE (acá el
 *    conocimiento nunca es opcional).
 */
export function buildOnActivity(deps: BuildOnActivityDeps): ActivityEventHandler;

/**
 * `ActivityStorePort` por closures sobre `repository.ts` — mismo patrón, y
 * mismo lugar, que el `MemoryPort` que `main.ts` ya arma hoy (verificado).
 * No merece archivo propio en el adaptador: son tres delegaciones directas
 * sin lógica.
 */
export function createActivityStore(db: Database.Database): ActivityStorePort;
```

### 6.3 `src/main.ts` — cambios exactos

Tres cambios. Ninguno toca el camino de la TUI.

**(a) `startHarness()` deja de construir el Adaptador de Conocimiento por proceso.** Hoy, en las líneas 133-145 (verificadas), `createKnowledgeAdapter({ casoId: caso.id, ... })` se llama una vez y el resultado viaja a `buildOnSubmit`. Con dos fuentes de turnos eso es el bug latente R1. El cambio mínimo que resuelve el spec `knowledge-query` sin tocar `build-on-submit.ts`:

```ts
// startHarness() devuelve, además de lo de hoy:
//   createKnowledge: (casoId: string) => KnowledgeAdapter
// en vez de   knowledge: KnowledgeAdapter
const createKnowledge = (casoId: string): KnowledgeAdapter =>
  createKnowledgeAdapter({
    casoId,
    logEvent: (event, fields) => logTurnEvent(casoId, event, fields),
  });

return { agents, hooks, memory, caso, db, createKnowledge };
```

y el call site de la TUI pasa a:

```ts
const onSubmit = buildOnSubmit(caso.id, memory, hooks, agents, undefined, createKnowledge(caso.id));
```

La TUI sigue con **una** instancia para toda su corrida — su `caso` es uno solo y `App.tsx` ya serializa sus turnos con `pendingRef` — pero ahora esa instancia es *suya*, no compartida con los turnos de webhook. `buildOnSubmit` no cambia ni una línea.

**Verificación de R1 pedida por ADR 5** (hecha en este diseño, leyendo `src/adapters/knowledge/index.ts` completo): `createKnowledgeAdapter` **no tiene efecto global**. Su cuerpo es exactamente: `resolveGraphifyConfig()` (lectura pura de `process.env`), `createCitedNodesRecorder()` (un closure sobre un array local), `createSdkMcpServer({...})` (construcción de un objeto in-process, sin `listen`, sin spawn, sin registro estático) y un objeto literal `feedback`. No hay singleton de módulo, no hay variable mutable a nivel de archivo, no hay puerto ni subproceso. El costo de construcción es el de crear tres objetos y compilar un schema de `zod` de un campo — despreciable frente a una llamada al modelo. **La instanciación por caso es segura.** El único estado compartido que existía era precisamente el `CitedNodesRecorder`, que es lo que esta decisión separa.

**(b) Wiring de la segunda fuente de turnos**, después de `startHarness()` y antes de montar la TUI:

```ts
const board = createBoardAdapter({
  logEvent: (casoId, event, fields) => logTurnEvent(casoId, event, fields),
});

const onActivity = buildOnActivity({
  db, memory, hooks, agents, board,
  queue: createKeyedQueue(),
  createKnowledge,
});

const webhook = await startWebhookServer({
  onEvent: onActivity,
  logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
});
```

`startWebhookServer` va **fuera** del `try` de `startHarness()` (que es síncrono y devuelve `StartupResult`) pero su rechazo — p. ej. `EADDRINUSE` — se atrapa con su propio `try/catch` que loguea `webhook-arranque-fallido` y **continúa con `webhook = undefined`**: que el puerto esté ocupado no puede impedir que el empleado use la TUI. Es la misma filosofía de degradación del resto del hito.

**(c) Cierre ordenado** — el `finally` de hoy (líneas 183-201, verificadas) gana un paso **antes** de `db.close()`:

```ts
} finally {
  // ADR 10: primero se deja de aceptar y se drenan los turnos en vuelo,
  // DESPUÉS se cierra el handle de SQLite. Al revés, un turno a mitad de
  // camino escribiría contra una base cerrada.
  if (webhook !== undefined) {
    try {
      await webhook.close();
    } catch (error) {
      console.error(`No se pudo cerrar el servidor de webhooks: ${toErrorMessage(error)}`);
    }
  }
  try {
    db.close();
  } catch (error) {
    console.error(`No se pudo cerrar la base de datos: ${toErrorMessage(error)}`);
  }
}
```

El `try/catch` alrededor de `webhook.close()` es red de seguridad sobre un método que ya promete no rechazar: si algún día lo violara, no puede impedir que `db.close()` corra — exactamente el mismo razonamiento (y la misma forma) que el `catch` que ya envuelve `db.close()`.

**Orden de imports**: `import "./core/config/env.js"` sigue siendo el **primer** import del archivo. Los imports nuevos (`board`, `webhooks`, `build-on-activity`) van después, como todos los demás. La restricción crítica que el module doc de `main.ts` documenta se respeta sin excepción.

---

## 7. Manejo de errores y degradación

**Regla de oro del hito**: el estado canónico falla ruidosamente, el espejo nunca falla. Los dos puertos existen separados exactamente por eso (ADR 6, alternativa "un puerto único" rechazada).

| Capa | Garantía | Qué pasa si falla |
|---|---|---|
| `verifySignature` | Nunca lanza; devuelve `boolean` | `false` → `401`, cero filas |
| `createRequestListener` | Nunca lanza al servidor HTTP | Toda rama termina en un status y un `res.end()` |
| `mapGithubEvent` | Nunca lanza; `undefined` = ignorar | `202`, sin actividad |
| `onActivity` (`build-on-activity.ts`) | **Nunca rechaza** | Loguea `actividad-turno-fallido` y traga |
| `runActivityTurn` | **Propaga** fallas de `store` y de `runTurn` | El caller de arriba las traga y loguea |
| `ActivityStorePort` | **Falla ruidosamente** | Propaga → turno fallido |
| `ActivityBoardPort` (3 métodos) | **Nunca rechaza, nunca lanza** | Loguea; el turno permanece exitoso |
| `KeyedQueue.run` | Un rechazo no contagia a la cadena | Solo el caller de esa tarea lo ve |

**Matriz de degradación**:

| Falta | Qué pasa | Evento de log |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | No se abre puerto. La TUI arranca idéntica a `v1.1.0` | `webhook-deshabilitado` |
| `GITHUB_TOKEN` | Puerto abierto, turnos corren, estado se persiste. Sin espejo y **sin metadatos**: el prompt usa título+cuerpo del payload y **lista de archivos vacía** | `tablero-deshabilitado` |
| `graphify` ausente | Igual que en Hito 2: el turno completa con respuesta degradada | `conocimiento-consulta-error` |
| Puerto ocupado | `webhook = undefined`, la TUI arranca igual | `webhook-arranque-fallido` |
| GitHub caído a mitad de turno | Estado canónico persistido; tablero desactualizado | `tablero-actualizacion-fallida` |

**`turn-error.ts` NO se toca** — confirmando el *Fuera de alcance* de la propuesta. `TurnStage` (`"context" | "model" | "close"`) modela etapas del turno del Selector de Turno; la traducción webhook→turno pasa *antes* de que exista un turno, y el espejo al tablero pasa *después* de que cerró. Ninguno de los dos es una etapa. Un error de mapeo es un `undefined` (evento ignorado), no una excepción; un error del tablero se traga por contrato. No hay ninguna falla nueva que `TurnFailedError` deba representar.

**Truncados y por qué existen** (todos con constante nombrada y test):

| Constante | Valor | Motivo |
|---|---|---|
| `DEFAULT_MAX_BODY_BYTES` | 1 MiB | Guardia de memoria sobre entrada no autenticada (ADR 9) |
| `MAX_PROMPT_CUERPO_CHARS` | 4 000 | Un `body` de PR puede traer un template enorme; el prompt no es el lugar |
| `MAX_PROMPT_COMENTARIO_CHARS` | 2 000 | Ídem para el comentario disparador |
| `MAX_PROMPT_ARCHIVOS` / `MAX_CHANGED_FILES` | 50 | Sin paginación (fuera de alcance); 50 nombres alcanzan para un juicio de alcance |
| `MAX_COMMENT_CHARS` | 60 000 | El límite duro de GitHub es 65 536; cortar antes evita un `422` |

---

## 8. Concurrencia, WAL y `.gitignore`

**Qué protege qué**, sin ambigüedad (la propuesta ya hizo la precisión y este diseño la codifica):

- `better-sqlite3` es **síncrono**: dos sentencias SQL nunca se interleavan dentro de este proceso. La cola **no** existe para eso.
- La cola existe para el ciclo lógico `findActividadPorReferencia` → `await board.leerMetadatos` → `await runTurn` (decenas de segundos) → `updateActividadEstado`. Ese `await` del medio es donde el event loop puede meter el segundo evento, que leería el estado viejo y escribiría encima del primero. Es *exactamente* el escenario "Dos eventos casi simultáneos del mismo proyecto" del spec.
- WAL protege del **otro** proceso: SQLite en modo WAL permite lectores concurrentes con un escritor y evita el bloqueo de base completa. En este hito su beneficio directo es modesto (un solo proceso), pero es lo que el plan fija como estrategia y es lo que hace que abrir `data/harness.db` con un cliente externo durante la demo no bloquee al arnés.

**Granularidad de la clave**: `proyecto_id`, no `actividad_id`, tal como el plan lo fija. Es más gruesa de lo estrictamente necesario (dos PRs distintos del mismo repo se serializan aunque no compartan fila), y esa es la decisión correcta acá: el volumen es de una demo, y una clave más fina no protegería el caso real de dos eventos sobre el **mismo** PR (`opened` seguido de `synchronize`), que es justo el que puede pisarse.

**`.gitignore`** — líneas nuevas al final de la sección de bases de datos. Necesarias porque `*.db` (ya presente, verificado) **no** matchea `harness.db-wal`:

```gitignore
*.db
*.db-wal
*.db-shm
*.sqlite
*.sqlite3
```

---

## 9. Logging (Concepto Transversal 3)

Se reusa `logTurnEvent(correlationId, event, fields, deps)` **sin cambiar su contrato** — igual que Hito 2 (§5.4 de aquel diseño). El módulo `turn-logger.ts` no gana código; a lo sumo una línea en su module doc listando los consumidores nuevos. **Esto corrige la tabla de la propuesta**, que lo listaba como *Modified*.

### 9.1 El problema del `casoId` antes de que exista un caso

El spec `activity-webhook-turn` pide que "webhook recibido, firma inválida, actividad creada, turno resuelto" se logueen "correlacionados por `casoId`". Los dos primeros ocurren **antes** de que exista ningún `caso` — y el mismo spec exige que una firma inválida **no cree ninguna fila**. Es una imposibilidad literal, no una omisión de este diseño (queda anotada como riesgo R14 en §11).

**Resolución**: dos espacios de id de correlación, unidos por un evento puente.

- **Eventos de transporte** (antes del caso): se correlacionan por el **`X-GitHub-Delivery`**, el UUID que GitHub asigna a cada entrega. Es un id de correlación real, único por evento y visible en la UI de GitHub ("Recent Deliveries"), no un placeholder.
- **Eventos de ciclo de vida del proceso** (sin delivery tampoco): constante `WEBHOOK_LOG_CORRELATION_ID = "webhook-adapter"`.
- **Eventos del turno** (una vez que hay caso): `casoId`, como siempre.
- **Puente**: `actividad-creada` / `actividad-reusada` se loguean con `casoId` **y** llevan `deliveryId` en `fields`. Una sola línea de `data/harness.log` permite saltar de un espacio al otro, y `grep` por cualquiera de los dos ids reconstruye el ciclo completo.

### 9.2 Eventos nuevos

| Evento | Correlación | Cuándo | Campos |
|---|---|---|---|
| `webhook-escuchando` | `"webhook-adapter"` | El servidor quedó escuchando | `port`, `path` |
| `webhook-deshabilitado` | `"webhook-adapter"` | Arranque sin `GITHUB_WEBHOOK_SECRET` | — |
| `webhook-arranque-fallido` | `"webhook-adapter"` | `listen` falló (p. ej. `EADDRINUSE`) | `port`, `message` |
| `webhook-recibido` | `deliveryId` | POST en el path, dentro del tope de tamaño | `event`, `action`, `bytes` |
| `webhook-rechazado-tamano` | `deliveryId` | Body superó `maxBodyBytes` (ADR 9) | `maxBodyBytes` |
| `webhook-firma-invalida` | `deliveryId` | HMAC no coincide, o header ausente | `event`, `firmaPresente` |
| `webhook-payload-invalido` | `deliveryId` | `JSON.parse` falló tras firma válida | `event` |
| `webhook-evento-ignorado` | `deliveryId` | Evento/acción no soportados, o issue que no es PR | `event`, `action`, `motivo` |
| `webhook-cierre-con-turnos-en-vuelo` | `"webhook-adapter"` | El drenaje agotó `SERVER_CLOSE_TIMEOUT_MS` (ADR 10) | `enVuelo` |
| `actividad-encolada` | `deliveryId` | La tarea entró en la cola por `proyecto_id` | `proyectoId`, `colaSize` |
| `actividad-creada` | `casoId` | Tras la transacción (caso+actividad nuevos) | `deliveryId`, `actividadId`, `proyectoId`, `referenciaExterna`, `tipo`, `estado` |
| `actividad-reusada` | `casoId` | Se encontró una actividad viva para esa referencia | `deliveryId`, `actividadId`, `estado` |
| `actividad-metadatos-ok` | `casoId` | `leerMetadatos` devolvió datos | `archivos`, `truncados` |
| `actividad-metadatos-no-disponibles` | `casoId` | `leerMetadatos` devolvió `undefined` | `motivo` |
| `actividad-veredicto` | `casoId` | Tras `parseVeredicto` | `veredicto`, `parseado` (`false` si cayó al default) |
| `actividad-transicion-ignorada` | `casoId` | `transicionarEstado` devolvió el mismo estado por transición inválida | `estado`, `veredicto` |
| `actividad-estado-persistido` | `casoId` | Tras `updateActividadEstado` | `estadoAnterior`, `estado` |
| `actividad-turno-fallido` | `deliveryId` | El `catch` de `build-on-activity.ts` | `proyectoId`, `referenciaExterna`, `stage?`, `message` |
| `tablero-deshabilitado` | `casoId` | Puerto no-op invocado (sin `GITHUB_TOKEN`) | `operacion` |
| `tablero-comentario-publicado` | `casoId` | `publicarRevision` OK | `chars` |
| `tablero-comentario-fallido` | `casoId` | `publicarRevision` falló | `reason`, `status?` |
| `tablero-labels-no-leidos` | `casoId` | El GET del Issue falló; se PATCHea igual | `reason` |
| `tablero-actualizado` | `casoId` | `mirrorEstado` OK | `estado`, `label`, `assignee?` |
| `tablero-actualizacion-fallida` | `casoId` | `mirrorEstado` falló | `reason`, `status?` |

**Qué NO se loguea, deliberadamente** (mismo criterio que Hito 2 con `questionLength` en vez de `question`): el body crudo del webhook, el `secret`, el `GITHUB_TOKEN`, el texto del comentario disparador y el texto de la revisión. `data/harness.log` es un archivo plano sin rotación ni control de acceso. De la revisión solo va `chars`.

---

## 10. Estrategia de testing

TDD estricto activo (`openspec/config.yaml: strict_tdd: true`). **Ningún test del suite por defecto abre un puerto, resuelve un DNS, ni llama a la API de GitHub** — criterio de aceptación explícito de la propuesta. Los tres seams son `CreateServerFn` (webhooks), `FetchFn` (tablero) y `Database` en memoria (`openDatabase(":memory:")`, patrón ya usado en el repo).

### Unitarios

| Archivo | Casos clave |
|---|---|
| `core/activity/transicion-estado.test.ts` | `VEREDICTO:` en la última línea gana a una anterior · con `**` / backticks / punto final · mayúsculas y sin acentos · sinónimos · **sin línea → `observado`, nunca `aprobado`** · matriz completa de `transicionarEstado` (12 celdas) · `resuelto` desde no-`observado` → sin cambio |
| `core/activity/activity-prompt.test.ts` | Pura y determinista · incluye `VEREDICTO_PREFIX` y los tres valores · truncados con marca · `(… y N archivos más)` · sin `metadatos` usa los fallbacks del evento y lo dice · con `comentarioDisparador` cambia el framing · **nunca incluye la palabra "diff"** como si lo tuviera |
| `core/activity/run-activity-turn.test.ts` | Crea cuando no existe / reusa cuando existe (mismo `casoId`) · `store` que lanza → propaga y **`runTurn` NO se llama** · `runTurn` que rechaza → propaga y **el estado NO se actualiza** · orden: `updateActividadEstado` ANTES de `publicarRevision`/`mirrorEstado` · `board` que rechazara igual resuelve · `leerMetadatos` → `undefined` degrada sin error |
| `core/concurrency/keyed-queue.test.ts` | Orden por clave con promesas controladas (deferred) · claves distintas concurrentes · tarea que rechaza no contagia · **`size === 0` tras asentarse todo** (R6) · encolar durante el asentamiento de la anterior no rompe el orden (el chequeo de identidad) |
| `adapters/webhooks/config.test.ts` | Defaults · overrides · numérico inválido/≤0 → default · `path` sin `/` inicial se normaliza · sin secreto → `isWebhookEnabled === false` |
| `adapters/webhooks/signature.test.ts` | Firma calculada con el mismo secreto verifica · un byte distinto → `false` · header ausente/vacío/array → `false` · **header de largo distinto → `false` y NO lanza `RangeError`** · prefijo ausente → `false` |
| `adapters/webhooks/github-mapper.test.ts` | Fixtures reales de `pull_request` (`opened`/`synchronize`/`reopened`) e `issue_comment.created` · **issue sin `pull_request` → `undefined`** · acción no soportada → `undefined` · evento desconocido → `undefined` · payload deforme → `undefined` · mapeo campo por campo |
| `adapters/webhooks/server.test.ts` | Con `req`/`res` dobles: `404` fuera del path y con `GET` · `413` + `destroy()` al pasar el tope, **sin llamar a la verificación de firma** · `401` con firma inválida y **`onEvent` no invocado** · `400` con JSON roto · `202` + `onEvent` invocado para evento válido · **`res.end` ocurre ANTES de que `onEvent` resuelva** (ADR 10) · `close()` espera al `onEvent` en vuelo · `close()` resuelve igual si el turno excede el timeout |
| `adapters/webhooks/index.test.ts` | Sin secreto → devuelve `undefined`, `createServer` **nunca se llama**, se loguea `webhook-deshabilitado` · con secreto → devuelve handle con el puerto configurado |
| `adapters/board/labels.test.ts` | Los cuatro mapeos · `mergeLabels` quita los otros tres y **preserva** labels ajenos · idempotente |
| `adapters/board/github-client.test.ts` | URL/método/headers exactos por operación · `Authorization` presente y **el token nunca en el mensaje de error** · `!ok` → `GithubApiError("http", status)` · abort → `"timeout"` · throw de red → `"network"` · `splitProyectoId` con formato malo |
| `adapters/board/index.test.ts` | Sin token → no-op: `fetchFn` **nunca** se llama, `leerMetadatos` → `undefined` · `fetchFn` que rechaza → los tres métodos **resuelven** igual y loguean · `mirrorEstado` hace GET + PATCH con los labels merged · `assignees` omitido sin responsable · `publicarRevision` trunca a `MAX_COMMENT_CHARS` |
| `adapters/memory/repository.test.ts` (+) | Upserts idempotentes · `createCasoConActividad` atómica: **si `createActividad` falla, no queda `proyecto` ni `caso`** · `findActividadPorReferencia` devuelve la más reciente y desempata por `rowid` · `updateActividad` con `COALESCE` · FK rota → `ActividadInvalidReferenceError` |
| `adapters/memory/db.test.ts` (+) | `pragma("journal_mode")` devuelve `"wal"` en una base de archivo temporal · `:memory:` sigue funcionando |
| `build-on-activity.test.ts` | La promesa **nunca rechaza** aunque `runActivityTurn` lance · `queue.run` se llama con `evento.proyectoId` · **`createKnowledge` se invoca una vez por turno, con el `casoId` del turno** (regresión de R1) · dos eventos del mismo proyecto se serializan · de proyectos distintos, no |
| `build-on-submit.test.ts` | **Sin cambios**. Es la red de regresión de R2: si algo de este hito rompiera la TUI, este archivo lo detecta sin haber sido tocado |

### Test de aislamiento de citas (spec `knowledge-query`)

Un test dedicado, en `build-on-activity.test.ts` o en un `src/test/` propio: dos `createKnowledgeAdapter` para dos `casoId` distintos, cada uno grabando labels distintos vía su handler, y se afirma que el `save-result` de cada uno recibe **solo** sus propios nodos. Sin `graphify` real: el seam es `execFileFn`, que ya existe y está probado en Hito 2.

### Fuera del suite por defecto

Nada de este hito necesita un test de integración opt-in nuevo. El único formato externo del que dependemos (payloads de GitHub) se congela como **fixtures versionados en el repo**, y las firmas HMAC se calculan **dentro del propio test** con un secreto de test — no hay firma hardcodeada que se pudra.

---

## 11. Riesgos residuales, supuestos y decisiones que el Implementer debe verificar

Los riesgos R1-R9 vienen de la propuesta; R10-R15 son nuevos, aparecidos en este diseño.

| # | Riesgo / supuesto | Estado tras este diseño | Acción |
|---|---|---|---|
| R1 | Adaptador de conocimiento compartido cruza citas entre turnos concurrentes | **Resuelto y verificado**: `createKnowledgeAdapter` no tiene efecto global (§6.3, lectura completa de `index.ts`); costo de construcción despreciable | Instanciación por caso vía `createKnowledge(casoId)`; test de regresión en §10 |
| R2 | El composition root toca código aprobado de Hito 1/2 | Acotado: `main.ts` cambia en 3 puntos, `build-on-submit.ts` en **cero** | `build-on-submit.test.ts` sin tocar como red de regresión |
| R3 | Abrir un puerto rompe el Escenario de calidad 4 | Cerrado: sin secreto, `startWebhookServer` devuelve `undefined` y no llama a `createServer` | Test explícito (§10) |
| R4 | Revisión sin diff resulta superficial | **Aceptado por el checkpoint humano.** Codificado en el tipo (`PullRequestMetadata` sin campo de diff) y **declarado en el prompt** ("no afirmes nada sobre líneas que no viste") | Si el tutor lo rechaza en la demo, la extensión es un método más en el puerto + un `Accept: ...diff`, sin tocar el núcleo |
| R5 | El agente no emite `VEREDICTO:` en formato | Acotado: parser tolerante (4 niveles), default seguro, y el prompt **le dice al modelo cuál es el default** si no lo emite | `actividad-veredicto` con `parseado: false` lo hace medible en la demo |
| R6 | La cola filtra memoria | Acotado por contrato explícito (garantía 4 de `KeyedQueue`, con chequeo de identidad) | Test `size === 0` |
| R7 | Segunda fuente sin autenticación | Cerrado por alcance | — |
| R8 | La verificación end-to-end necesita exponer el endpoint | Herramienta fijada: `gh webhook forward` (§12) | Solo demo manual |
| R9 | WAL ensucia el repo | Cerrado: `.gitignore` en este hito (§8) | — |
| **R10** | **El spec exige correlacionar por `casoId` eventos que ocurren antes de que exista un caso** (webhook recibido, firma inválida) — y el mismo spec prohíbe crear filas en ese camino. Es una **imposibilidad literal**, no una omisión | Diseñado con dos espacios de id + evento puente (§9.1). **No se reinterpretó el spec en silencio** | Si el Reviewer exige la letra, hay que **enmendar el spec**, no el diseño: la alternativa (crear un `caso` para poder loguear una firma inválida) violaría el escenario "firma inválida no crea filas" |
| **R11** | **Sin `GITHUB_TOKEN` el prompt se queda sin lista de archivos cambiados**: el payload de `pull_request` no la trae, la aporta `GET /pulls/{n}/files`. El escenario del spec "dispone de título, cuerpo, autor y archivos cambiados antes de invocar `handleTurn`" solo se cumple **con** token | Documentado, no silenciado. El turno completa igual (lo que el spec de degradación pide), con revisión más pobre | La demo del entregable **requiere** `GITHUB_TOKEN`. El caso sin token es la degradación, no el camino feliz |
| **R12** | `202` antes de procesar (ADR 10) significa que GitHub ve éxito aunque el turno falle después | Aceptado y consciente: la alternativa (esperar) rompe contra GitHub real por timeout de entrega | `actividad-turno-fallido` es la única traza; se revisa en `data/harness.log` durante la verificación |
| **R13** | **Reentrada por reintento de GitHub**: si una entrega se reintenta (o llegan `opened` + `synchronize` seguidos), `findActividadPorReferencia` reusa la actividad y se dispara un segundo turno sobre el mismo PR — con un comentario más en el PR | Acotado por la cola (se serializan, no se pisan) y semánticamente correcto (un `synchronize` **debe** re-revisar) | **No** se deduplica por `X-GitHub-Delivery` en este hito. Si en la demo aparecen comentarios duplicados, la mitigación es una tabla `entregas_procesadas` — cambio aditivo, hito futuro |
| **R14** | `engines.node >= 20` (ADR 7) endurece el requisito de entorno de la demo | Bajo — Node 20 es LTS desde 2023 | Verificar `node -v` en la máquina de la demo antes de la verificación manual |
| **R15** | `AbortSignal.timeout` y `fetch` global se asumen presentes y tipados con `@types/node@^20` | Bajo, pero **no verificado en vivo** (sin shell en esta fase) | **Primera tarea de wiring del tablero**: un `npm run typecheck` tras escribir `github-client.ts`. Si el tipado de `fetch` global diera fricción, `FetchFn` es un recorte estructural propio — se satisface con un cast local en el default, sin dependencias |

---

## 12. Plan de verificación manual (entregable funcional)

El TDD corre 100% con fixtures. Esto es lo que demuestra el entregable de punta a punta, y es **manual y fuera de CI** por diseño.

### 12.1 Preparación (una vez)

1. **Repo de prueba** en GitHub con permisos de admin (para el webhook) y al menos una rama para abrir un PR.
2. **Token**: PAT (fine-grained) con permisos de *Issues: read & write*, *Pull requests: read & write*, *Contents: read* sobre ese repo.
3. **Labels** (opcional pero recomendado): crear `necesita-revision`, `observaciones-pendientes`, `resuelto`, `aprobado` con colores distinguibles. Si no existen, la API los crea sola al asignarlos, pero con color gris por defecto y la demo se ve peor.
4. **`.env`** local:
   ```
   ANTHROPIC_API_KEY=...
   GITHUB_WEBHOOK_SECRET=<cadena aleatoria larga>
   GITHUB_TOKEN=<el PAT>
   WEBHOOK_PORT=8787
   ```
5. **Node 20+** (`node -v`) — ADR 7.

### 12.2 Exponer el endpoint local

El endpoint corre en `http://localhost:8787/webhooks/github` y GitHub necesita alcanzarlo. Dos opciones, **ninguna es dependencia del proyecto ni entra en CI** (R8):

**Opción A — `gh webhook forward` (recomendada)**. No requiere crear un webhook en la UI ni exponer nada a internet: la CLI de GitHub abre la conexión saliente y reenvía a localhost.

```bash
gh webhook forward \
  --repo=<owner>/<repo> \
  --events=pull_request,issue_comment \
  --url=http://localhost:8787/webhooks/github \
  --secret="$GITHUB_WEBHOOK_SECRET"
```

El `--secret` es clave: `gh` firma los reenvíos con ese secreto, así que la verificación HMAC se ejercita **de verdad**, no se saltea.

**Opción B — `smee.io`**. Se crea un canal en `https://smee.io/new`, se registra esa URL como webhook del repo (content type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, eventos `pull_request` e `issue_comment`), y se corre `npx smee-client --url https://smee.io/<canal> --target http://localhost:8787/webhooks/github`. Aquí la firma la calcula GitHub y smee la reenvía tal cual — verificación real también.

### 12.3 Guion de la demo (en este orden)

| # | Paso | Qué se demuestra | Qué mirar |
|---|---|---|---|
| 1 | `npm run dev` **sin** `GITHUB_WEBHOOK_SECRET` | Opt-in del listener (R3, Escenario de calidad 4) | TUI arranca normal; `webhook-deshabilitado` en `data/harness.log`; `netstat` sin 8787 |
| 2 | `npm run dev` **con** secreto, + forwarding activo | Arranque de las dos fuentes | `webhook-escuchando { port: 8787 }`; la TUI sigue usable |
| 3 | Abrir un PR en el repo de prueba | **Entregable, mitad 1** | Comentario del agente en el PR; label `necesita-revision`→ el que corresponda; filas nuevas en `proyectos`/`actividades`/`casos` |
| 4 | Escribir un prompt cualquiera en la TUI **mientras** corre el turno del PR | Concurrencia real, R1 | Las dos respuestas llegan; en el log, dos `casoId` distintos y `conocimiento-guardado` con nodos que **no** se cruzan |
| 5 | Comentar en el PR resolviendo lo observado | **Entregable, mitad 2** | Nuevo turno reusando el mismo `caso` (`actividad-reusada`); label pasa a `resuelto`; `assignee` = autor del PR — **sin intervención manual** |
| 6 | `curl -X POST localhost:8787/webhooks/github -H 'X-Hub-Signature-256: sha256=deadbeef' -d '{}'` | Verificación de firma | `401`; `webhook-firma-invalida`; `SELECT count(*) FROM actividades` **no cambia** |
| 7 | Repetir el paso 3 con `GITHUB_TOKEN` vacío | Degradación del tablero (y R11) | El turno completa, `actividades.estado` se actualiza, `tablero-deshabilitado` en el log, **cero excepciones no capturadas** |
| 8 | Abrir PRs en dos repos distintos casi a la vez | Aislamiento por clave de la cola | Los dos turnos se solapan en el log (timestamps intercalados) |
| 9 | Ctrl+C durante un turno de webhook | Cierre ordenado (ADR 10) | El proceso espera hasta ~5 s; `db.close()` después; sin `SQLITE_MISUSE` ni stack traces |
| 10 | `sqlite3 data/harness.db "PRAGMA journal_mode;"` y `ls data/` | WAL (R9) | `wal`; existen `harness.db-wal`/`-shm`; `git status` **limpio** |

### 12.4 Evidencia para `docs/progreso/v1.2-bot-revision-prs/`

Capturas del PR con el comentario del agente y con el label en cada estado, el extracto de `data/harness.log` de un ciclo completo (`grep` por un `deliveryId` y por su `casoId`), la salida de `npm test` y `npm run typecheck` en verde, y el `SELECT` de las tres tablas nuevas.

---

## 13. Trazabilidad — diseño ↔ requisitos de los specs

| Requisito (spec) | Dónde lo resuelve este diseño |
|---|---|
| **webhook-turn** · Verificación de firma sobre el body crudo | §4.2 (`verifySignature`, chequeo de longitud antes de `timingSafeEqual`) + ADR 9 (tope antes de firmar) + §4.4 (tabla de respuestas) |
| **webhook-turn** · Listener opt-in por configuración | §4.1 (`isWebhookEnabled`) + §4.5 (`undefined`, `createServer` nunca llamado) + ADR 5 |
| **webhook-turn** · Traducción de evento a turno normalizado | §4.3 (`mapGithubEvent`, `undefined` = ignorar; `issue.pull_request` ausente → ignorar) |
| **webhook-turn** · Creación transaccional de caso y actividad | §6.1 (`createCasoConActividad` con `db.transaction`) + §3.2 paso 2a + §7 (el store propaga) |
| **webhook-turn** · Serialización por `proyecto_id` | ADR 8 + §3.3 (`KeyedQueue`, garantías 1-4) + §6.2 (`queue.run(evento.proyectoId, ...)`) + §8 |
| **webhook-turn** · Parseo de veredicto y transición de estado | §3.2 `transicion-estado.ts` (default `observado`, matriz completa) |
| **webhook-turn** · Logging correlacionado por `casoId` | §9 — **con la salvedad explícita de R10**, no resuelta en silencio |
| **board-mirror** · El puerto nunca rechaza | §3.1 (contrato) + §5.3 (`try/catch` total) + §7 (tabla de garantías) |
| **board-mirror** · Mapeo estado → label | §5.1 `labels.ts` (`ESTADO_LABELS`, `mergeLabels` quita los otros tres) — en el adaptador, no en el núcleo (ADR 6) |
| **board-mirror** · Actualización automática al resolverse observaciones | §3.2 paso 2b (reuso de actividad + `caso` → `resume` de la sesión SDK) + pasos 6-9 + §5.3 (`PATCH` con `labels` y `assignees`) |
| **board-mirror** · Degradación sin `GITHUB_TOKEN` | §5.3 (`createNoopBoardAdapter`) + §7 (matriz de degradación) |
| **board-mirror** · Lectura de metadatos antes del turno | §3.1 (`leerMetadatos` en el puerto, con la precisión sobre ADR 6) + §3.2 paso 3 + §5.3 (sin `Accept: diff`) — **salvedad R11** |
| **knowledge-query** · Aislamiento de citas entre turnos concurrentes | §6.3(a) (`createKnowledge(casoId)`) + §6.2 punto 2 + §10 (test dedicado) |
| **knowledge-query** · Costo de instanciación no degrada, sin efecto global | §6.3, verificación de R1 leyendo `src/adapters/knowledge/index.ts` completo |
| Rollback (propuesta) | Quitar `GITHUB_WEBHOOK_SECRET`: sin listener, sin actividades, TUI idéntica a `v1.1.0`. Las tablas quedan vacías; `journal_mode = DELETE` revierte WAL sin pérdida |
