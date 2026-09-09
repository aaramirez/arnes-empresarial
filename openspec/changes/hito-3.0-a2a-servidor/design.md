> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. **Esta fase NO tuvo shell**: sin `Bash` no hay `graphify`, y tampoco hubo `WebFetch`/`WebSearch`. Se compensó con lectura directa y completa de los archivos reales: `AGENTS.md`; `openspec/config.yaml` (`strict_tdd: true`, `rules.design`); `proposal.md` y `exploration.md` de este change (completos); `openspec/changes/hito-2.2-a2a-cliente/design.md` (§0, §1-3, §7, §8-15 — molde de formato) y su `tasks.md` (§0); **`src/adapters/web/server.ts` completo (572 líneas)**; **`src/adapters/webhooks/server.ts` completo (327 líneas)**; `src/adapters/web/http.ts`, `src/adapters/web/body.ts`, `src/adapters/web/config.ts`, `src/adapters/web/index.ts`, `src/adapters/webhooks/config.ts`, `src/adapters/webhooks/index.ts` (todos completos); **`src/adapters/a2a/client.ts` completo (675 líneas)** y `src/adapters/a2a/config.ts` completo; **`src/core/agents/a2a-contract.ts` completo**; `src/build-on-soporte.ts` completo; `src/core/ventas/soporte-prompt.ts` completo; `src/core/turn-selector/handle-turn.ts` (firma de `handleTurn` y `HandleTurnResult`, líneas 195-254); `src/adapters/memory/migrations/index.ts` y `0010_delegaciones_a2a.ts` completos; `src/adapters/memory/repository.ts` (bloque `delegaciones_a2a`, líneas 1739-1874, y `createCaso`, líneas 93-110); `src/main.ts` (imports 80-97, wiring 264-378, `finally` 453-495); `README.md` (líneas 1-130); `src/core/agents/subagents.ts` (`TAREA_DELEGADA_MAX_CHARS`) por `Grep`.
>
> **Lo que esta fase NO pudo verificar en primera persona, y cómo se compensa** — dos cosas, ambas declaradas como riesgo residual y ambas con verificación obligatoria en `sdd-apply`:
> 1. **Los códigos de error JSON-RPC específicos de A2A** para *tarea no encontrada* y *tarea no cancelable*. Sin `WebFetch` no se pudo abrir `raw.githubusercontent.com/a2aproject/A2A/v1.0.0/specification/a2a.proto`. **No se inventan**: el **ADR 94** fija la *semántica* completa y aísla los dos números en dos constantes con nombre, y `sdd-apply` los verifica contra la fuente antes de escribirlos — el mismo tratamiento exacto que recibió **RD-24** en el Hito 6. Ver **RD-37**.
> 2. **El techo real de migraciones en `main` HOY**. Sin `Bash` no se pudo correr `git show main:src/adapters/memory/migrations/index.ts`. Se derivó por evidencia del repo (ver §7.1) y se aplica la **regla** del ADR 63, no un número fijo. Ver **RD-38**.

# Diseño técnico: Comunicación A2A entrante — Servidor A2A (v3.0.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 86-92, R1-R12, RD-32 a RD-35) · [`exploration.md`](exploration.md) · [`hito-2.2-a2a-cliente/design.md`](../hito-2.2-a2a-cliente/design.md) (molde de formato y profundidad) · [Plan](../../../docs/Plan_Implementacion_Harness_Empresarial.md) Hito 7 (368-400) · arc42: Caja Negra 5 (188-198), **I4** (226-232), Caja Blanca 3.2 (362-370), **Escenario de ejecución 6** (614-620), **Riesgo 2** (632-636), **Deuda 2**.

**Rama**: `hito/v3.0-a2a-servidor` · **Tag**: `v3.0.0` · **Progreso**: `docs/progreso/v3.0-a2a-servidor/`. **Último hito del Plan.**

**Numeración de ADR**: la propuesta cerró en el **92**. Este diseño abre en el **93** y llega al **102** — diez decisiones que aparecieron **al bajar la propuesta a firmas reales** y que ningún ADR 86-92 podía anticipar. Riesgos residuales: **RD-32 a RD-43** (RD-1 a RD-31 son de `v2.0.0`/`v2.1.0`/`v2.2.0` y siguen vigentes).

**Cerrado por la propuesta y NO reabierto por este documento**: ADR 86 (servidor a mano sobre `node:http`), ADR 87 (`SendMessage` asíncrono, `GetTask` como canal del resultado), ADR 88 (auth bearer obligatoria, el token como único interruptor), ADR 89 (`agente_externo_url` nullable y hoy siempre `NULL`, `origen_transporte` agregada), ADR 90 (sin `KeyedQueue`, con tope de turnos en vuelo), ADR 91 (cero archivos de núcleo modificados), ADR 92 (tres métodos, `capabilities` en `false`, una skill).

**Estado de los specs al escribir este documento**: `openspec/changes/hito-3.0-a2a-servidor/specs/` **no existe todavía** (verificado por `Glob`: el directorio del change sólo tiene `exploration.md` y `proposal.md`). Este diseño se escribe contra la propuesta y contra las **dos capabilities que la propuesta declara** — `servidor-a2a-jsonrpc` y `solicitud-a2a-entrante` — usando sus descripciones y los *Success Criteria* como requirements hipotéticos (§14). Cualquier deriva menor de nombres la reconcilia el Reviewer de `sdd-tasks`.

---

## 0. Gate de secuencia — `sdd-apply` NO arranca sin esto

**Esta sección va primero a propósito, igual que en `v2.1.0` y `v2.2.0`. No es una nota al pie: es una precondición de proceso del mismo rango que el checkpoint humano.** Es el **R1** de la propuesta, y **no bloquea este diseño** — bloquea su implementación.

### GATE NO CUMPLIDO — ninguna de las cuatro condiciones se cumple hoy

Este diseño **no se puede aplicar** hasta que `hito-2.2-a2a-cliente` esté **mergeado a `main`** con su checklist de cierre completo y su tag `v2.2.0`.

| # | Comprobación | Comando | Estado hoy |
|---|---|---|---|
| 1 | El tag `v2.2.0` existe | `git tag -l \| rg -x v2.2.0` | **NO CUMPLE** — el Hito 6 tiene **20 de 23** tareas commiteadas en `hito/v2.2-a2a-cliente` (último commit verificado: `7ae7ef3`, tarea 20), sin Reviewer, sin merge, sin tag |
| 2 | `src/adapters/a2a/` es código en `main` | `git ls-tree main --name-only src/adapters/a2a/` con salida no vacía | **NO CUMPLE** — `client.ts`/`config.ts`/`index.ts` viven **sólo** en la rama del Hito 6 |
| 3 | `src/core/agents/a2a-contract.ts` es código en `main` | `git ls-tree main --name-only src/core/agents/a2a-contract.ts` con salida no vacía | **NO CUMPLE** — mismo motivo |
| 4 | La migración `0010` está en `main` | `git show main:src/adapters/memory/migrations/index.ts \| rg migration0010` | **NO CUMPLE** — `0010_delegaciones_a2a.ts` es de la tarea 9 del Hito 6 y vive sólo en su rama |

**Diferencia honesta con `hito-2.2`**: su `design.md` §0 (líneas 27-33, leídas) reportó exactamente lo mismo — **las tres condiciones "No cumple"** — y fue su `tasks.md` §0 (línea 13, leída) el que las registró como cumplidas *después* del merge de PR #6 (`6442002`). Este documento está en el mismo punto del ciclo que aquel: **el gate se cumple, si se cumple, entre este `design.md` y el `tasks.md` de este hito.** Lo que sí es distinto y peor: este es el **tercer hito consecutivo** que arrastra el mismo gate, y los dos anteriores lo incumplieron al arrancar.

**Por qué es duro, concretamente**:

- Sin (2) y (3), este change **no tiene de dónde importar** `TASK_STATE_*`, `esTaskStateConocido`, `esEstadoTerminal` ni `delegarTarea` — es decir, ni el vocabulario del protocolo ni el cliente con el que se prueba (§10.D). No es "arrastra un merge": es que **el 100% de lo que reusa no existe en `main`**.
- Sin (4), el número de migración de este change colisiona (§7.1) y habría que reordenar `migrations/index.ts` — justo lo que su propia convención (líneas 14-21, leídas: *"existing entries are never edited or reordered once committed"*) prohíbe.

**Regla de citación mientras el gate no se cumpla**: todo objeto de `hito-2.2` que este documento nombre (`a2a-contract.ts` entero, `client.ts` entero — en particular `TaskLike`, `extraerResultado`, `estadoDeTarea`, `idDeTarea`, `delegarTarea`, `DestinoA2AConfig` —, `resolveA2AConfig`, la migración `0010`, `insertDelegacionA2A`/`actualizarDelegacionA2A`) se cita como **referencia verificada contra la rama `hito/v2.2-a2a-cliente`**, donde hoy es código real y donde fue leído línea por línea para este diseño. **El primer paso de `sdd-apply` es revalidar cada uno contra `main` y reportar cualquier deriva antes de escribir una línea.**

**Lo que sí avanza en paralelo, sin gate**: `sdd-spec`, este `design.md` y `sdd-tasks`. Ninguno toca código.

---

## 1. Resumen de la arquitectura elegida

Un adaptador nuevo (4 archivos), **un** módulo de núcleo nuevo y puro, un composition root nuevo, una tabla, **cero dependencias nuevas** — séptimo change consecutivo sin romper la racha.

```
 ┌───────────────────── src/core/ (nunca importa de adapters/) ─────────────────────┐
 │                                                                                  │
 │  agents/a2a-contract.ts          REUSADO TAL CUAL. Único cambio: su doc-comment   │
 │      (SIN imports)               ("del Cliente A2A saliente" → "del protocolo     │
 │                                   A2A, en sus dos direcciones"). ADR 91 pto 7     │
 │                                  TASK_STATE_* · esTaskStateConocido ·             │
 │                                  esEstadoTerminal · TaskState                     │
 │                                                                                  │
 │  agents/a2a-entrante-prompt.ts   ★ NUEVO, PURO, SIN IMPORTS (ADR 95)              │
 │                                  buildSolicitudA2APrompt(texto): string           │
 │                                  MAX_SOLICITUD_A2A_CHARS = 8_000                  │
 │                                                                                  │
 │  turn-selector/handle-turn.ts    INTACTO — el MISMO Selector de Turno             │
 │  activity/*, ventas/*, …         INTACTOS. `git diff --stat main -- src/core/`    │
 │                                  ⇒ CERO archivos modificados, UNO agregado        │
 └───────▲──────────────────────────────────────────────────────────────────────────┘
         │  (adapters → core: permitido; core → adapters: JAMÁS)
 ┌───────┴─────────────────────────────────────┐
 │ src/adapters/a2a/  (4 archivos NUEVOS)      │   ¡CERO contacto con memory/,
 │   server-config.ts  env + rutas + topes     │    web/ y webhooks/! (AGENTS.md)
 │   agent-card.ts     card PURO (ADR 96)      │    `pathFromUrl`, `esAutorizado`,
 │   server.ts         listener + auth +       │    el recorte estructural de
 │                     ruteo JSON-RPC +        │    request/response y el `Set` de
 │                     construirTask (ADR 93)  │    drenaje se DUPLICAN a propósito
 │                     + startServer (drenaje) │    (ADR 13, tercer servidor HTTP
 │   server-index.ts   startA2AServer()        │    de la misma familia)
 │                     ⇒ undefined sin token   │
 │  (client.ts, config.ts, index.ts: INTACTOS) │
 └───────▲─────────────────────────────────────┘
         │  tres callbacks cerrados por el composition root (ADR 102)
         └──── src/build-on-a2a-entrante.ts ────  createCaso → buildSolicitudA2APrompt
               (hermano de build-on-soporte.ts)   → handleTurn → actualizar la fila
                        │
                        └──── src/main.ts (bloque 5d + `finally`)
                              HARNESS_A2A_ENTRANTE_TOKEN = EL interruptor (ADR 88)
```

**La línea de corte, en una frase**: el adaptador decide **quién puede hablar, qué forma tiene la conversación, cuántos turnos entran a la vez y qué se responde mientras tanto**; el Núcleo decide **qué contesta** — con el mismo `handleTurn` que atiende al empleado, al webhook y al canal web. **El adaptador no le enseña nada al núcleo: sólo le trae trabajo.**

**Las tres disciplinas de espera que ahora conviven en el proceso** — hay que leerlo antes que cualquier firma, porque es lo que hace que este hito sea el cuarto camino de entrada sin ser un cuarto camino de código:

| Camino | Quién espera la respuesta HTTP | Disciplina | Precedente |
|---|---|---|---|
| `POST /soporte` (Hito 4) | un navegador | **BLOQUEA** hasta el turno o `SOPORTE_TIMEOUT_MS` ⇒ `504` | `handleSoporte`, `web/server.ts:391-449` |
| `POST /webhooks/github` (Hito 3) | GitHub, que **no espera contenido** | **`202` primero**, `onEvent` sin `await` | ADR 10, `webhooks/server.ts:233-241` |
| **`POST /a2a` `SendMessage` (este hito)** | un cliente A2A **con su propio reloj**, que **sí parsea un `Task`** | **Responde `SUBMITTED` con contenido, y el turno arranca después sin `await`** — el gesto del ADR 10 **con cuerpo** | ADR 87 |

**Lo que NO cambia**: `handleTurn`, `resolveTurn`, `runActivityTurn`, `IncomingActivityEvent`, `KeyedQueue`, `dispatch-delegation*.ts`, `client.ts`, `DESTINOS_A2A` (sigue con exactamente dos claves), y todas las tablas existentes.

---

## 2. Mapa capability → módulos de código

> Los `specs/` de este change **todavía no existen** (verificado). La tabla usa las dos capabilities que la propuesta declara, con la descripción textual que les dio.

| Capability (propuesta) | Módulos de código reales | ¿1:1? |
|---|---|---|
| `servidor-a2a-jsonrpc` | `src/adapters/a2a/server-config.ts` + `agent-card.ts` + `server.ts` + `server-index.ts` + `src/test/integration/a2a-server.integration.test.ts` | **1:N.** Es la capability del adaptador: card, auth, ruteo por `method`, sobre JSON-RPC, forma del `Task`, mapeo de errores, tope de body, tope de turnos en vuelo, drenaje |
| `solicitud-a2a-entrante` | `src/core/agents/a2a-entrante-prompt.ts` + `src/build-on-a2a-entrante.ts` + migración `NNNN` + `src/adapters/memory/repository.ts` + `src/main.ts` | **1:N**, mismo criterio con el que `delegacion-a2a-saliente` alojó núcleo + migración + repositorio + composition root en `v2.2.0` |

**Cobertura**: los dos conjuntos cubren todo lo que este diseño construye, y este diseño no construye nada que la propuesta no pida. Verificación punto por punto en **§14**.

---

## 3. Decisiones de arquitectura (ADR 93-102)

### ADR 93: El texto del resultado viaja en **`artifacts`**, no en `status.message` — y `construirTask` es una función **PURA y TOTAL, sin reloj y sin ids nuevos** (★ **RD-34 resuelto**)

**Contexto**. El ADR 92 pto 8 fijó que el `Task` que devolvemos **tiene** que ser parseable por nuestro propio cliente, y dejó la forma exacta a este documento. La respuesta está en el código, no en una preferencia: `extraerResultado` (`client.ts:309-336`, leído línea por línea) hace **exactamente esto**, en este orden:

1. Si `task.artifacts` es un array ⇒ concatena las partes `text` de `artifacts[*].parts[*]`; **si el resultado no es `""`, devuelve eso y no mira nada más**.
2. Si no ⇒ cae al `Message` de `task.status.message` y concatena `message.parts[*].text`.
3. Si tampoco ⇒ `""` — *"un agente que completó sin texto sigue siendo éxito, no un fallo de protocolo"*.

**Decisión**:

1. **`artifacts` es el portador del resultado.** Un `TASK_STATE_COMPLETED` con `resultado` no vacío devuelve `artifacts: [{ artifactId, name: "respuesta", parts: [{ text: resultado }] }]` y **NO** pone `status.message`. Dos razones, las dos verificables: (a) es la **primera** rama que lee nuestro cliente, así que el test de integración ejercita el camino principal y no un fallback; (b) semánticamente, el resultado producido por la tarea **es** un artefacto, y `status.message` es un mensaje *sobre el estado*.
2. **No se duplica el texto en los dos lugares.** Sería peso muerto para nuestro cliente (la primera rama gana y la segunda nunca se lee) y un riesgo real para un tercero que concatene ambos: recibiría la respuesta **dos veces**.
3. **`status.message` queda reservado para los terminales de FRACASO** (`FAILED`, `CANCELED`, `REJECTED`), con un texto fijo, corto y sin datos del caso. Nuestro cliente lo ignora (en fracaso sólo lee `status.state`), pero un tercero recibe un motivo legible en vez de un estado pelado. Los tres textos son constantes de módulo, no strings del modelo:

   | Estado | `status.message.parts[0].text` |
   |---|---|
   | `TASK_STATE_FAILED` | `"El turno del arnés no pudo completarse."` |
   | `TASK_STATE_CANCELED` | `"La tarea fue cancelada por el llamador."` |
   | `TASK_STATE_REJECTED` | `"El arnés está al máximo de solicitudes en curso. Reintentá más tarde."` |

4. **`SUBMITTED` y `WORKING` no llevan ni `artifacts` ni `status.message`.** No hay nada que decir todavía, y un mensaje de relleno sería ruido que el llamador tiene que aprender a ignorar.
5. **`construirTask` es PURA y TOTAL, y no necesita reloj ni generador de ids** — esto es lo que la vuelve trivial de testear y lo que hace que `GetTask` sea literalmente *una lectura y una función*:
   - `status.timestamp` = **`fila.updatedAt`**, que ya está en la fila y además es *más verdadero* que `now()`: dice cuándo el estado pasó a ser el que es, no cuándo alguien preguntó.
   - `artifactId` = **`` `${a2aTaskId}-0` ``** — derivado, determinista, sin `randomUUID`. Mismo criterio para `status.message.messageId` = `` `${a2aTaskId}-msg` ``.
   - `contextId` = el `caso_id` de la fila; y cuando no hay caso (única fila sin caso: `REJECTED`, ADR 90 pto 4) = el propio `a2aTaskId`. La columna nunca se lee como `null` desde acá.
6. **Total, sin `throw` posible.** Un `COMPLETED` sin `resultado` (que ningún camino produce, pero que el tipo admite) devuelve un `Task` **sin** `artifacts`; nuestro cliente lo resuelve como éxito con texto `""`, que es exactamente lo que ya decidió tratar como válido. La función no tiene ninguna rama que lance.
7. **El `Task` no lleva `history`.** No es una omisión por alcance: `history` transportaría el prompt sintético y el texto del turno hacia afuera por un segundo canal, y este hito **ya** entrega el resultado por `artifacts`. Menos superficie, menos filtración.

**Alternativas consideradas**:

- *El resultado en `status.message` (y `artifacts` vacío)*: **rechazada**. Funciona con nuestro cliente (rama 2), pero deja el camino principal sin ejercitar y usa el campo de "mensaje de estado" como si fuera el de "producto de la tarea".
- *El resultado en LOS DOS*: **rechazada** por el punto 2.
- *`status.timestamp = now()` con un reloj inyectado*: **rechazada**. Agrega una costura (`now`) a una función que no la necesita, y devuelve un dato menos informativo que el que la fila ya tiene.

### ADR 94: Semántica exacta de `CancelTask` y `GetTask` sobre tareas terminales o inexistentes — y los dos códigos de error A2A se fijan **por regla, con verificación obligatoria en `sdd-apply`** (★ **RD-33 resuelto en semántica; su número, por regla**)

**Contexto**. El ADR 92 pto 4 dejó explícitamente abierto *"el comportamiento exacto ante un `CancelTask` sobre una tarea ya terminal"*, y la exploración tampoco cerró qué error define la especificación para una tarea no cancelable. Esta fase **no tuvo `WebFetch`** (ver *Nota de proceso*), así que no repite el ejercicio de RD-24: **fija la semántica completa, que sí se puede decidir con el código real, y aísla los dos números.**

**Decisión — semántica, cerrada acá**:

1. **`CancelTask` sobre `SUBMITTED` o `WORKING`** ⇒ la fila pasa a `TASK_STATE_CANCELED`, se responde `result` con el `Task` en `CANCELED`. **No interrumpe el cómputo** (ADR 92 pto 4, sin cambios).
2. **`CancelTask` sobre una tarea YA `CANCELED`** ⇒ **éxito idempotente**: se responde `result` con el `Task` tal cual está, **sin tocar la fila ni `updated_at`**. Cancelar algo que ya está cancelado no es un error: es una petición cuyo efecto deseado ya se cumple. Un reintento del llamador (que es exactamente lo que hace un cliente ante una respuesta perdida) no debe convertirse en un fallo.
3. **`CancelTask` sobre `COMPLETED`, `FAILED` o `REJECTED`** ⇒ **error JSON-RPC**, no un `result`. Devolver `result: Task{state: "TASK_STATE_COMPLETED"}` a una petición de cancelación sería indistinguible de un éxito para cualquier cliente que sólo mire que vino `result`: el llamador creería que canceló algo que en realidad terminó. **La fila no se toca y el resultado no se descarta.**
4. **`GetTask`/`CancelTask` con un `id` que no existe** ⇒ **error JSON-RPC** de tarea no encontrada. Nunca un `Task` sintético en `FAILED` (mentiría sobre una tarea que nunca existió) y nunca un `404` HTTP (rompería el sobre JSON-RPC: ver punto 7).
5. **La escritura del turno de fondo es CONDICIONAL, y por eso el punto 1 es verdadero.** El `UPDATE` que hace `COMPLETED`/`FAILED`/`WORKING` lleva `AND estado IN ('TASK_STATE_SUBMITTED','TASK_STATE_WORKING')` en el `WHERE` (§7.2). Sin esa guarda, un turno que termina **después** de un `CancelTask` pisaría `CANCELED` con `COMPLETED` y entregaría el resultado que acabamos de prometer descartar. La cancelación no se implementa con un `if` en el composition root: **se implementa en el `WHERE`**, que es el único lugar donde no hay ventana.
6. **Consecuencia declarada**: un turno cancelado a mitad de camino **igual gasta la invocación al modelo** y su texto **se descarta sin persistirse** (evento `a2a-turno-entrante-descartado`). Es el precio ya asumido por el ADR 92 pto 4, ahora con el mecanismo exacto.

**Decisión — los códigos, por regla**:

7. **Todo error JSON-RPC bien formado se responde con HTTP `200` y un sobre `{ jsonrpc, id, error: { code, message } }`.** Verificado contra el consumidor real: `consultarOControlarTarea` (`client.ts:475-495`) clasifica `!response.ok` como **`transporte`** (una falla de red, reintentable) y un sobre con `error` como **`protocolo`** (indeterminado, no reintentable). Responder `4xx` a un error de aplicación haría que nuestro propio cliente lo lea como "la red falló" y **siga poll-eando** contra un error definitivo. El `200` no es laxitud: es lo que hace que la clasificación del cliente sea correcta.
8. **Los tres códigos base de JSON-RPC 2.0 quedan fijados acá** (son del transporte, no de A2A, y no dependen de ninguna verificación pendiente): `-32700` parse error, `-32600` invalid request, `-32601` **method not found** (el que el ADR 92 pto 1 ya había fijado), `-32602` invalid params, `-32603` internal error.
9. **Los DOS códigos específicos de A2A** — *tarea no encontrada* y *tarea no cancelable* — se declaran como **dos constantes con nombre** en `server-config.ts`:
   ```ts
   /** ★ VERIFICAR en sdd-apply contra specification/a2a.proto + docs/specification.md del tag v1.0.0. */
   export const A2A_ERROR_TASK_NOT_FOUND = /* ver tarea 1 de sdd-apply */;
   export const A2A_ERROR_TASK_NOT_CANCELABLE = /* ídem */;
   ```
   **Regla**: si la especificación v1.0.0 define códigos propios para esos dos casos, se usan **los suyos, literales**. Si no los definiera, se usan dos valores del rango `-32000..-32099`, que la especificación JSON-RPC 2.0 reserva para errores definidos por la implementación. **`sdd-apply` verifica antes de escribir**, en su primera tarea, y anota el hallazgo en `docs/progreso/v3.0-a2a-servidor/` junto a las otras correcciones — el tratamiento textual de RD-24.
10. **Por qué aislarlos alcanza**: los dos números aparecen **una sola vez cada uno** en todo el código, el resto del diseño depende de la *semántica* (que es lo que este ADR cierra) y no del número, y nuestro propio cliente clasifica **cualquier** sobre con `error` de la misma forma — así que ningún camino del test de integración depende del valor. Ver **RD-37**.

**Alternativas consideradas**:

- *`CancelTask` sobre terminal ⇒ éxito devolviendo el `Task` como está*: **rechazada** por el punto 3 — indistinguible de una cancelación real para el llamador.
- *`GetTask` de un id inexistente ⇒ `Task` sintético en `FAILED`*: **rechazada**. Inventa una tarea. Y además rompería el escenario de éxito del propio cliente, que trata `FAILED` como terminal de fracaso: un typo en el id se leería como "el arnés falló".
- *Responder `4xx`/`404` HTTP a los errores de aplicación*: **rechazada** por el punto 7, con el consumidor real como evidencia.

### ADR 95: `buildSolicitudA2APrompt` vive en **`src/core/agents/a2a-entrante-prompt.ts`**, sin imports, y **es dueño del único tope de longitud** (★ **RD-32, parte 1**)

**Contexto**. El ADR 91 pto 5 fijó el criterio (puro, sin imports, hermano de `buildSoportePrompt`) y dejó la ubicación exacta a este documento. El repo tiene dos precedentes leídos completos: `src/core/ventas/soporte-prompt.ts` (junto a `ventas-contract.ts`) y `src/core/activity/activity-prompt.ts` (junto a `activity-contract.ts`). La regla que los dos encarnan es la misma: **el prompt vive al lado del contrato de su dominio**.

**Decisión**:

1. **`src/core/agents/a2a-entrante-prompt.ts`** — al lado de `a2a-contract.ts`, que es donde ya vive todo el vocabulario A2A del núcleo. **No** se crea `src/core/a2a/`: partiría el vocabulario del protocolo entre dos directorios de núcleo por una función pura de ~40 líneas, y dejaría a `a2a-contract.ts` (que no se mueve, ADR 91) huérfano de su vecino natural.
2. **Sin un solo `import`**, igual que `soporte-prompt.ts` y que `a2a-contract.ts`. Testeable sin base, sin red y sin modelo.
3. **`MAX_SOLICITUD_A2A_CHARS = 8_000`, exportada desde este módulo, y es el ÚNICO tope de longitud del texto entrante.** El adaptador la importa (adapter → core: permitido) para truncar **una sola vez**, antes de persistir `mensaje_recibido`. Así la columna y el prompt dicen exactamente lo mismo: **no existe un estado en el que la fila guarde un texto y el modelo haya visto otro.**
4. **Por qué `8_000` y no `4_000`** (el de `soporte-prompt.ts`): el simétrico de una solicitud A2A entrante no es una consulta de cliente final, es **una tarea delegada entre agentes** — y ese tope ya existe en el repo, verificado: `TAREA_DELEGADA_MAX_CHARS = 8_000` (`subagents.ts:38`), el mismo que la propuesta pide replicar en `mensaje_recibido` (ADR 89 pto 4). Es el mismo número por el mismo motivo, no una tercera perilla.
5. **Firma y forma del texto** — molde literal de `buildSoportePrompt`, incluida la marca de truncado `[…truncado]`:
   ```ts
   export const MAX_SOLICITUD_A2A_CHARS = 8_000;
   /** PURA: mismo input, mismo string. Sin imports. */
   export function buildSolicitudA2APrompt(texto: string): string;
   ```
   Cuatro secciones unidas por `\n\n`, en este orden:
   1. **Rol**: *"Sos el arnés empresarial respondiendo a una solicitud de otro agente de IA de la empresa, recibida por el protocolo A2A. Respondé la solicitud de abajo de la forma más útil y concreta posible, dentro de tus limitaciones."*
   2. **La solicitud**, truncada: `` `Solicitud del agente externo:\n${truncado}` ``.
   3. **LIMITACIÓN DECLARADA, literal y de seguridad — no de estilo**: *"Esta solicitud es de sólo lectura. No podés crear, modificar ni cerrar actividades, proyectos, ventas, incidentes ni solicitudes internas, y no podés delegar a otro agente. No afirmes ni des a entender que realizaste una acción."* Es el gemelo exacto del párrafo 3 de `buildSoportePrompt`, y existe por el mismo motivo verificado allá: *"sin esa línea, un modelo servicial le dice al cliente 'listo, te cancelé la venta', y la venta sigue igual"*. Acá el interlocutor es un agente automático que **va a creerle**.
   4. **Instrucción de honestidad ante lo que no sabe**: *"Si la solicitud requiere una acción o un dato que no podés obtener, decilo explícitamente en vez de inventarlo."*
6. **El framing NO va al system prompt de `CONVERSATIONAL_AGENT`** — `definitions.ts` no se toca. Mismo argumento textual que `soporte-prompt.ts` documenta: contaminaría los turnos de TUI, y un segundo `AgentDefinition` obligaría a bifurcar el Selector de Turno, que es exactamente lo que el Escenario 6 del arc42 prohíbe.
7. **El párrafo 3 es la contracara *en el prompt* de lo que el ADR 98 hace *en la firma*.** Ninguno de los dos alcanza solo: la firma impide que el arnés escriba, el prompt impide que el arnés **diga** que escribió.

**Alternativas consideradas**:

- *`src/core/a2a/a2a-entrante-prompt.ts` (directorio nuevo)*: **rechazada** por el punto 1.
- *`src/core/activity/`*: **rechazada** — el ADR 91 pto 3 ya demostró que una solicitud A2A **no** es una actividad; poner su prompt ahí volvería a sugerir el parentesco que ese ADR descartó con argumento.
- *Dos topes (uno de columna, uno de prompt)*: **rechazada** por el punto 3.

### ADR 96: Los strings del Agent Card, y `supportedInterfaces` verificado contra **nuestro propio cliente** (★ **RD-32, parte 2**)

**Contexto**. El ADR 92 pto 5-7 fijó el criterio (una skill verdadera y no tres falsas; los siete campos requeridos poblados; la URL pública por env) y dejó los strings exactos a este documento. Hay además una restricción **dura y verificable** que ningún documento previo escribió: `extraerEndpointJsonRpc` (`client.ts:170-188`, leído) sólo acepta un card que traiga `supportedInterfaces: [...]` con **al menos una entrada** cuyo `protocolBinding === "JSONRPC"` **exactamente** y cuyo `url` sea un string no vacío; si no, devuelve `undefined` y la delegación muere en `reason: "protocolo"` **sin intentar `SendMessage`**.

**Decisión**:

1. **`agent-card.ts` expone una función PURA**: `construirAgentCard(config: A2AServerConfig): AgentCardJson`. Sin I/O, sin reloj: se testea comparando el objeto entero contra un literal. Cero costura.
2. **Los siete campos requeridos, con estos valores** (todos constantes de módulo, ninguno del modelo):

   | Campo | Valor |
   |---|---|
   | `name` | `"Arnés Empresarial"` |
   | `description` | `"Arnés de agentes de IA de una empresa. Responde consultas sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas."` |
   | `version` | `"3.0.0"` — el tag del hito (ADR 92 pto 6) |
   | `capabilities` | `{ streaming: false, pushNotifications: false, extendedAgentCard: false }` — las tres **explícitas**, no omitidas |
   | `defaultInputModes` / `defaultOutputModes` | `["text/plain"]` |
   | `skills` | **una** entrada (punto 3) |
   | `supportedInterfaces` | **una** entrada (punto 4) |

   Los strings van en **castellano** porque todo el dominio, los prompts y los mensajes de este repo lo están (`buildSoportePrompt`, `renderConfirmacionHtml`, los motivos de `ventas-contract.ts`): un card en inglés sería el único documento del arnés que habla otro idioma.
3. **La skill, una sola y verdadera**:
   ```
   id:          "consulta-arnes"
   name:        "Consulta al arnés empresarial"
   description: "Respondé una consulta en lenguaje natural sobre el estado de proyectos,
                 actividades de desarrollo, incidentes, solicitudes internas y ventas
                 registradas en el arnés. Es una consulta de sólo lectura: el arnés no
                 modifica nada a pedido de un agente externo."
   tags:        ["consulta", "estado", "proyectos", "incidentes", "solo-lectura"]
   examples:    ["¿En qué estado está la revisión del PR 42 del proyecto X?",
                 "¿Qué incidentes abiertos hay hoy?",
                 "¿Cuántas ventas quedaron pendientes de confirmación esta semana?"]
   ```
   **`"solo-lectura"` como tag, y la frase en la `description`, no son decoración**: son la declaración pública del límite de alcance del que depende el ADR 90 (sin cola). El día que se levante, el card cambia junto con el ADR.
4. **`supportedInterfaces: [{ protocolBinding: "JSONRPC", url: `${config.publicUrl}${RUTA_JSONRPC}` }]`** — un solo transporte, la URL armada con el `publicUrl` del env (ADR 92 pto 7) más la ruta constante. **Esto es un requirement, no una preferencia**: con `protocolBinding` mal escrito o `url` vacío, **nuestro propio cliente no puede hablarnos**, y el test de integración de §10.D falla en el primer `GET` — que es exactamente la prueba que queremos.
5. **`securitySchemes` con un esquema HTTP bearer** (ADR 88 pto 5), y el card **se sirve sin autenticación**. Lo único que revela es que hay un agente que exige token.
6. **`preferredTransport` / `additionalInterfaces` NO se emiten.** Es la contracara de la corrección que el propio Hito 6 asentó al cerrar RD-24: **esos campos no existen en v1.0.0**. Emitirlos sería reintroducir del lado servidor el error que el lado cliente ya corrigió.

### ADR 97: Los cinco números operativos, y por qué el puerto **necesita** default acá y `WEB_PORT` no (★ **RD-35 resuelto**)

**Contexto**. La propuesta propuso `MAX_EN_VUELO = 4` y candidatos para el resto, y los dejó como *"fijados con criterio, revisables en el checkpoint"*.

**Decisión**:

| Constante / env | Valor | Por qué exactamente ese |
|---|---|---|
| `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | **`4`** | Es un tope de **invocaciones simultáneas al modelo desde afuera**, no de conexiones. El proceso ya puede tener en vuelo 1 turno de TUI + N turnos de webhook + M de `/soporte`; 4 agrega un caudal acotado y previsible sobre una cuota de API de pasantía. Superado, la respuesta es inmediata (`REJECTED` persistido), nunca una cola que crece |
| `HARNESS_A2A_ENTRANTE_PORT` | **`8888`** | **Acá el puerto SÍ lleva default, y `WEB_PORT` no** — y la asimetría es del ADR 88, no un descuido: en el adaptador Web *el gate es el puerto* (`isWebEnabled: port > 0`), así que un default lo rompería; acá **el gate es el token**, así que un puerto sin default sería un segundo interruptor implícito, justo lo que el ADR 88 pto 4 declara inexpresable. Molde exacto de `DEFAULT_WEBHOOK_PORT = 8787`, cuyo gate también es un secreto. **`8888` no colisiona** con `8787` (webhooks) ni con el `8080` de `DEFAULT_WEB_PUBLIC_URL` |
| `HARNESS_A2A_ENTRANTE_PUBLIC_URL` | **`"http://localhost:8888"`** | Molde literal de `DEFAULT_WEB_PUBLIC_URL` (`web/config.ts:19`), incluida la normalización sin `/` final. Un servidor no puede inferir su URL externa desde una request (ADR 92 pto 7) |
| `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES` | **`65_536`** (64 KiB) | El de `web/config.ts`, **no** el `1_048_576` de webhooks: el payload de GitHub es un JSON de plataforma que puede ser enorme; acá el cuerpo es un sobre JSON-RPC con **un texto de 8 000 caracteres como máximo** (ADR 95 pto 3). 64 KiB deja ~8× de holgura sobre el peor caso legítimo |
| `A2A_CLOSE_TIMEOUT_MS` | **`5_000`** — **constante, NO env var** | Idéntico a `WEB_CLOSE_TIMEOUT_MS` y a `SERVER_CLOSE_TIMEOUT_MS`, y por el mismo motivo que ellos documentan: *"es un presupuesto de UX, no un hecho del entorno"*. Tercera instancia del mismo número, deliberada |

**Y un número que NO existe a propósito**: **no hay `HARNESS_A2A_ENTRANTE_TURNO_TIMEOUT_MS`.** Un techo por turno entrante sería una cuarta perilla sin consumidor: **nadie está esperando** esa respuesta (ADR 87), así que un `504` no tendría a quién dárselo, y el llamador ya tiene su propio techo (`taskTimeoutMs`, 120 s por default del lado cliente). El repo rechazó dos veces una perilla sin consumidor propio (`hito-2.2/design.md` §15 ptos 1-2); esta es la tercera.

**Los tres numéricos son best-effort** (`resolvePositiveNumber`: ausente, vacío, no numérico, no finito o ≤ 0 ⇒ default, **nunca lanza**) — molde literal de los cinco archivos de config de adaptador que el repo ya tiene, con la misma duplicación deliberada que todos ellos documentan.

### ADR 98: **La escritura es INEXPRESABLE por firma** — `BuildOnA2AEntranteDeps` tiene exactamente los mismos ocho campos que `BuildOnSoporteDeps`, ni uno más (cierra **R8** de la propuesta)

**Contexto**. El **R8** de la propuesta lo dejó como encargo textual a esta fase: *"la afirmación 'el turno entrante es de sólo lectura' no está garantizada por el tipo — es una propiedad del wiring, y de ella depende que el ADR 90 (sin cola) sea verdadero… `sdd-design` debe elegir cómo hacerla verificable"*. Y el ADR 90 pto 3 le puso condición de disparo: **el día que una solicitud entrante pueda escribir, ese ADR se reabre.**

**Decisión**:

1. **`BuildOnA2AEntranteDeps` tiene los MISMOS OCHO CAMPOS que `BuildOnSoporteDeps`** (`build-on-soporte.ts:50-60`, leído completo), sin agregar ni uno: `db`, `memory`, `hooks`, `agents`, `createKnowledge`, `newId?`, `now?`, `logDeps?`. **El molde no es una analogía: es la misma interfaz.**
2. **Lo que NO recibe, y por eso no puede hacer** — cada ausencia mata una capacidad concreta:

   | Dep ausente | Qué vuelve imposible |
   |---|---|
   | `ActivityStorePort` / `createActividad` | Crear o modificar `actividades` |
   | `ActivityBoardPort` (`board`) | Espejar cualquier cosa al tablero de GitHub |
   | `escritura` / `WorktreePort` | Abrir un worktree o escribir código |
   | `ClienteA2APort` | Disparar una delegación A2A **saliente** desde un turno entrante |
   | `notifier` | Mandar un mail |
   | `VentaStorePort` | Tocar `ventas`/`comisiones` |
   | `KeyedQueue` | Serializar algo — porque no hay nada compartido que serializar (ADR 90) |

3. **Es verificable por inspección de la firma, no por lectura de la implementación** — que es exactamente lo que R8 pedía. Y se refuerza con un test de núcleo/módulo que afirma la **lista de imports** de `build-on-a2a-entrante.ts` (mismo mecanismo que `v2.2.0` usó para *"el núcleo no importa el adaptador"*).
4. **Mismo criterio estructural que el ADR 57 pto 4, el ADR 67 y el ADR 78**: hacer imposible lo que no se quiere, en vez de prohibirlo con un `if`. Un `if` se borra en un refactor distraído; una dependencia que no está no se puede usar sin que alguien la agregue **a la firma**, y eso aparece en el diff.
5. **El día que se levante el límite, el diff lo grita**: agregar un dep a esta interfaz es la señal, mecánica y visible en el review, de que el **ADR 90 se reabrió** y hay que elegir la clave de serialización antes de mergear.
6. **La contracara en el prompt** es el párrafo 3 del ADR 95 pto 5: la firma impide escribir, el prompt impide **decir** que escribió.

### ADR 99: **Una sola estructura** para el tope y el drenaje — `hayCupo` viaja como argumento, la política de rechazo vive en el composition root

**Contexto**. El ADR 90 pto 6 fijó que *"el mismo contador es el `Set<Promise>` del drenaje al cerrar… no se agregan dos mecanismos donde alcanza uno"*. Bajado a firmas, eso choca con una restricción del molde: el `Set` de drenaje vive en **`startServer`** (verificado dos veces: `web/server.ts:509-525` y `webhooks/server.ts:259-277`, con el comentario textual *"`createRequestListener` no conoce el `Set` de drenaje"*), pero la decisión de aceptar o rechazar tiene que tomarse **antes de responder** y **antes de crear el caso**, es decir del lado del composition root.

**Decisión**:

1. **`const enVuelo = new Set<Promise<void>>()` vive en `startServer`, y es a la vez el contador del tope y el conjunto del drenaje.** `enVuelo.size` **es** el número de turnos en vuelo. Cero estado duplicado.
2. **`startServer` envuelve `deps.onSolicitudA2A` exactamente como `web/server.ts` envuelve `onSoporte`** (`onSoporteConDrenaje`, líneas 515-523 — molde literal, incluido el `.then(olvidar, olvidar)` en vez de `.finally` y el motivo escrito):
   ```ts
   const onSolicitudConTopeYDrenaje = async (
     input: Omit<SolicitudA2AEntrada, "hayCupo">,
   ): Promise<SolicitudA2AAceptada> => {
     const resultado = await deps.onSolicitudA2A({
       ...input,
       hayCupo: enVuelo.size < deps.config.maxEnVuelo,
     });
     if (resultado.estado === TASK_STATE_SUBMITTED) {
       enVuelo.add(resultado.turno);
       const olvidar = (): void => { enVuelo.delete(resultado.turno); };
       resultado.turno.then(olvidar, olvidar);
     }
     return resultado;
   };
   ```
3. **`hayCupo: boolean` viaja como ARGUMENTO, no como callback.** El servidor sabe **cuántos** hay en vuelo; el composition root sabe **qué significa** rechazar (persistir una fila `REJECTED` sin caso, ADR 90 pto 4). Cada uno decide lo suyo y ninguno importa al otro. La alternativa — dos callbacks (`onSolicitud` + `onSolicitudRechazada`) — parte una decisión en dos entradas que siempre se usan juntas y duplica el cableado en `main.ts`.
4. **Un solo callback, resultado discriminado.** `SolicitudA2AAceptada` es una unión por `estado`: la rama `SUBMITTED` trae `turno: Promise<void>`, la rama `REJECTED` **no trae ninguno** — así es imposible registrar en el `Set` un turno que no existe. El tipo lo impide, no un `if`.
5. **`turno` NUNCA rechaza, por contrato** (§5.2): el composition root traga y persiste `FAILED`. El `Promise.allSettled` del drenaje es red de seguridad, no el mecanismo — mismo criterio que `webhooks/server.ts:237-241` documenta sobre `onEvent`.
6. **`createRequestListener` sigue sin saber nada del `Set`**, con firma de dos parámetros y sin estado de ciclo de vida. Se testea entero con dobles planos, y el tope se testea por separado inyectando un `hayCupo` fijo.

### ADR 100: `onConsultarTarea` y `onCancelarTarea` son **SÍNCRONAS por firma** — *"`GetTask` no invoca al modelo"* deja de ser una convención

**Contexto**. El ADR 87 pto 6 dice, textual: *"`GetTask` no invoca nada: es una lectura de una fila. Sin modelo, sin `await`, sin efectos. Ese es su contrato y es lo que lo hace barato de servir bajo polling."* En `web/server.ts`, **los cinco** handlers de negocio son `=> Promise<...>` (verificado, líneas 68-78), así que copiar el molde sin pensar daría tres handlers `async`.

**Decisión**:

1. **`onConsultarTarea(a2aTaskId: string): SolicitudA2AEntranteVista | undefined`** y **`onCancelarTarea(a2aTaskId: string): CancelacionA2AResultado`** — **sin `Promise`**. Sólo `onSolicitudA2A` es `async`.
2. **Es honesto, no una optimización**: `better-sqlite3` **es síncrono**, hecho documentado textualmente en el propio núcleo (`activity-contract.ts:117`) y del que el ADR 87 pto 5 ya depende para afirmar que no hay carrera entre el `INSERT` y el `res.end()`. Una firma `Promise` prometería una asincronía que no existe.
3. **Y es el mecanismo, no la documentación, lo que sostiene el contrato**: sin `Promise` en el tipo de retorno, **no se puede `await` un modelo adentro**. Meter una invocación al modelo en `GetTask` dejaría de ser un error de criterio para ser un error de compilación. Mismo criterio con que el ADR 78 angostó `input.destino` y el ADR 57 pto 4 hizo `git commit` inexpresable.
4. **Consecuencia en el listener**: las ramas `GetTask` y `CancelTask` de `despacharJsonRpc` **no tienen ningún `await`** y responden dentro del mismo tick. Es lo que hace que un llamador poll-eando a 1,5 s (el `pollIntervalMs` default de nuestro cliente) sea barato de servir.
5. **`CancelacionA2AResultado` es una unión discriminada**, no un booleano, porque el ADR 94 distingue **tres** desenlaces que se responden distinto:
   ```ts
   export type CancelacionA2AResultado =
     | { readonly resultado: "cancelada";   readonly vista: SolicitudA2AEntranteVista }
     | { readonly resultado: "ya-cancelada"; readonly vista: SolicitudA2AEntranteVista }
     | { readonly resultado: "no-cancelable"; readonly vista: SolicitudA2AEntranteVista }
     | { readonly resultado: "no-encontrada" };
   ```

### ADR 101: `A2AServerHandle.port` es el puerto **EFECTIVO** (`server.address()`), no el configurado — sin esto, el test de integración en puerto efímero es **imposible**

**Contexto**. Hallazgo de esta fase, verificado línea por línea y no anticipado por ninguna fase previa: `web/server.ts:546` devuelve `port: deps.config.port`, y `webhooks/server.ts:300` hace lo mismo. Con `port: 0` — la forma estándar de pedirle al SO un puerto libre — **el handle reportaría `0`**, y el test de integración no tendría forma de saber a qué puerto apuntar `delegarTarea`. La propuesta da por hecho un *"puerto efímero"* (ADR 86 pto 6, Success Criteria) que con el molde copiado tal cual **no funcionaría**.

**Decisión**:

1. **El recorte estructural del servidor gana un método**: `A2AHttpServerLike` declara, además de `listen`/`close`/`on`, **`address(): { readonly port: number } | string | null`** — que el `http.Server` real satisface estructuralmente, igual que el resto del recorte.
2. **`startServer` resuelve el puerto efectivo dentro del callback de `listen`**, cuando el SO ya lo asignó:
   ```ts
   const direccion = server.address();
   const puertoEfectivo =
     typeof direccion === "object" && direccion !== null ? direccion.port : deps.config.port;
   ```
   El fallback cubre el caso de un doble de test que no implemente `address()`, sin romper ninguna suite existente.
3. **`a2a-servidor-escuchando` loguea el puerto efectivo**, no el configurado — si no, con `PORT=0` el log diría `0` y la evidencia de `docs/progreso/` sería inservible.
4. **No se toca `web/server.ts` ni `webhooks/server.ts`.** Ninguno de los dos necesita puerto efímero hoy (sus tests usan dobles y nunca hacen `listen`), y este change no reabre hitos cerrados por simetría. Queda como **RD-42**: la asimetría está declarada, con el disparador escrito (el día que uno de esos dos necesite un test con socket real).

### ADR 102: El Servidor A2A **no importa `repository.ts`** ni reusa los parsers privados de `client.ts` — dos independencias, un solo ADR

**Contexto**. Dos tentaciones distintas con la misma pinta de "reuso", y las dos hay que rechazarlas por motivos distintos.

**Decisión**:

1. **`server.ts` NO importa `src/adapters/memory/repository.ts`.** Regla no negociable de `AGENTS.md`: *"Ningún adaptador se comunica directamente con otro adaptador"*. La base llega como **tres callbacks ya cerrados sobre `db` por el composition root** — molde literal de los cinco handlers de `WebServerDeps` (`web/server.ts:65-82`, leído), que es exactamente el mismo problema resuelto de la misma forma en el Hito 4.
2. **No se crea un puerto de núcleo para esto.** El ADR 91 fue explícito: el núcleo no gana ningún puerto. Los tipos de los tres callbacks (`SolicitudA2AEntrada`, `SolicitudA2AAceptada`, `SolicitudA2AEntranteVista`, `CancelacionA2AResultado`) viven **en `src/adapters/a2a/server.ts`** y el composition root los satisface — igual que `SoporteResult` vive en `web/server.ts` y `build-on-soporte.ts` lo satisface estructuralmente (el propio archivo lo documenta en su bloque *"DECISIÓN PARA EL REVIEWER"*, líneas 51-63).
3. **`server.ts` NO importa nada de `client.ts`, ni siquiera exportando lo que hoy es privado.** Es el mismo directorio y `AGENTS.md` no lo prohibiría, así que el motivo tiene que ser propio — y lo es: **el valor entero del test de integración es que cliente y servidor sean dos implementaciones independientes del mismo protocolo** (ADR 86 pto 6: *"un cliente independiente probando nuestro servidor es exactamente la prueba de conformidad que un SDK no da"*). Si el servidor extrajera el texto de `parts` con la misma función con la que el cliente lo lee, el round-trip probaría esa función **contra sí misma**. Un bug simétrico pasaría verde.
4. **Consecuencia asumida**: `extraerTextoDePartes` (server) y `concatenarPartesDeTexto` (client) son ~12 líneas gemelas y **deliberadamente separadas**, con un comentario en cada una que apunta a la otra y a este ADR. Es la novena instancia de duplicación declarada del repo, y la primera cuyo motivo es *preservar la independencia de un oráculo de test* en vez de un límite de arquitectura.
5. **`a2a-contract.ts` sí se importa, de los dos lados.** Núcleo → núcleo, permitido, y es lo correcto: el **vocabulario** debe ser único (si el servidor inventara sus propios `TASK_STATE_*`, el bug simétrico sería en los strings). Lo que no se comparte es el **código de parseo**, que es donde vive la interpretación.

---

## 4. Flujos completos

### 4.1 `SendMessage` — de la llamada externa al `SUBMITTED`, y el turno después

```
agente externo            a2a/server.ts           build-on-a2a-entrante.ts        db / handleTurn
      │                         │                           │                          │
      │ POST /a2a  Bearer …     │                           │                          │
      ├────────────────────────►│                           │                          │
      │            ① método+ruta                            │                          │
      │            ② leerBody con tope (413 + destroy)      │                          │
      │            ③ AUTH  ──401 (+WWW-Authenticate)────┐   │  ← ADR 88 pto 6:         │
      │            │            │                       │   │    NINGUNA fila creada   │
      │            ④ parse JSON-RPC (-32700/-32600)      │   │                          │
      │            ⑤ despacho por `method` (-32601)      │   │                          │
      │            ⑥ a2aTaskId = newTaskId()             │   │                          │
      │                         │  onSolicitudA2A({ a2aTaskId, texto, origenTransporte,│
      │                         │                   hayCupo: enVuelo.size < maxEnVuelo })
      │                         ├──────────────────────────►│                          │
      │                         │                           │ ¿hayCupo?                │
      │                         │                           │  no ──► INSERT REJECTED  │
      │                         │                           │         (sin caso) ──────┤
      │                         │                           │  sí                      │
      │                         │                           ├─ createCaso(a2a_entrante)┤
      │                         │                           ├─ INSERT fila SUBMITTED ──┤
      │                         │                           │   ← better-sqlite3 SÍNCRONO:
      │                         │                           │     la fila ESTÁ antes de responder
      │                         │◄──{ estado, contextId, updatedAt, turno? }────────────┤
      │                         │  enVuelo.add(turno)       │                          │
      │◄─200 { result: Task{ id, contextId, status:{ state: SUBMITTED, timestamp } } }  │
      │                         │                           │                          │
      │                         │      ─── y RECIÉN AHORA, sin await (ADR 87 pto 1) ───│
      │                         │                           ├─ UPDATE→WORKING (guarda) ┤
      │                         │                           ├─ buildSolicitudA2APrompt ┤
      │                         │                           ├─ await handleTurn ───────►│
      │                         │                           ├─ ok    → UPDATE COMPLETED + resultado
      │                         │                           └─ error → UPDATE FAILED    │
```

**El invariante que hace verdadero al ADR 87**: entre el `INSERT` y el `res.end()` no hay ningún `await`. `better-sqlite3` es síncrono, así que un `GetTask` que llegue un milisegundo después **siempre** encuentra la fila. Se testea con un doble de store que observa el **orden** de las llamadas, no con un `setTimeout`.

### 4.2 `GetTask` — el polling del llamador, y por qué es barato

```
cliente A2A (el nuestro, o cualquiera)        a2a/server.ts              db
   │  loop cada pollIntervalMs                     │                      │
   ├─ POST /a2a {method:"GetTask", params:{id}}───►│                      │
   │                          ① método+ruta ② tope ③ AUTH ④ parse ⑤ despacho
   │                                               ├─ onConsultarTarea(id)┤  ← SÍNCRONA (ADR 100):
   │                                               │◄── vista | undefined ┤     un SELECT y nada más
   │                                               ├─ construirTask(vista)│  ← PURA y TOTAL (ADR 93)
   │◄─200 { result: Task{ status:{ state }, artifacts? } }                │
   │                                               │
   │  undefined ⇒ 200 { error: { code: A2A_ERROR_TASK_NOT_FOUND } }  (ADR 94 pto 4)
   │
   └─ estado terminal ⇒ el cliente corta el loop (esEstadoTerminal, núcleo compartido)
```

### 4.3 `CancelTask` — la carrera contra el turno en vuelo, resuelta en el `WHERE`

```
t0   SendMessage         → fila SUBMITTED           enVuelo = {turno}
t1   turno arranca       → UPDATE WORKING           (guarda: estado IN (SUBMITTED, WORKING) ✓)
t2   CancelTask llega    → onCancelarTarea(id)      SELECT estado = WORKING ⇒ no terminal
                         → UPDATE CANCELED          (misma guarda ✓)  ⇒ "cancelada"
                         → 200 { result: Task{ CANCELED, status.message } }
t3   handleTurn resuelve → UPDATE COMPLETED         (guarda ✗: estado = CANCELED)
                         → changes === 0  ⇒  se DESCARTA el resultado, se loguea
                                             `a2a-turno-entrante-descartado`. La fila
                                             queda CANCELED y el llamador nunca recibe
                                             ese texto  (ADR 92 pto 4 + ADR 94 pto 5)
```

**Y el camino que NO existe**: no hay ningún punto donde el turno lea el estado, decida, y después escriba. La decisión **es** la escritura condicional. Sin eso habría una ventana real entre el `SELECT` y el `UPDATE`.

---

## 5. Núcleo y composition root — módulos y firmas

### 5.1 `src/core/agents/a2a-entrante-prompt.ts` (★ NUEVO — el ÚNICO archivo de núcleo que este change agrega)

```ts
/** Tope del texto entrante. Ver ADR 95 pto 3-4: es el ÚNICO, y el adaptador lo importa. */
export const MAX_SOLICITUD_A2A_CHARS = 8_000;

/** PURA: mismo input, mismo string. SIN imports (regla de AGENTS.md, molde de soporte-prompt.ts). */
export function buildSolicitudA2APrompt(texto: string): string;
```

Cuatro secciones, en el orden del ADR 95 pto 5. Marca de truncado `[…truncado]`, copiada de `soporte-prompt.ts:27` (misma constante privada, mismo comportamiento).

### 5.2 `src/build-on-a2a-entrante.ts` (★ NUEVO — hermano de `build-on-soporte.ts`)

```ts
export interface BuildOnA2AEntranteDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly agents: ReturnType<typeof bootstrapHarness>["agents"];
  readonly createKnowledge: (casoId: string) => KnowledgeAdapter;
  readonly newId?: () => string;          // default: randomUUID
  readonly now?: () => string;            // default: () => new Date().toISOString()
  readonly logDeps?: LogTurnEventDeps;    // omitir en producción
}
// ↑ LOS MISMOS OCHO CAMPOS que BuildOnSoporteDeps. Ni uno más (ADR 98).

export interface A2AEntranteHandlers {
  readonly onSolicitudA2A: (input: SolicitudA2AEntrada) => Promise<SolicitudA2AAceptada>;
  readonly onConsultarTarea: (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined; // SÍNCRONA
  readonly onCancelarTarea: (a2aTaskId: string) => CancelacionA2AResultado;                // SÍNCRONA
}

/** Devuelve los TRES handlers que `startA2AServer` necesita, ya cerrados sobre `db`. */
export function buildOnA2AEntrante(deps: BuildOnA2AEntranteDeps): A2AEntranteHandlers;
```

**`CASO_TIPO_A2A_ENTRANTE = "a2a_entrante"`** y **`CASO_ESTADO_ACTIVO = "activo"`** son constantes **locales de este módulo** — sin migración y sin tocar ningún contrato: `casos.tipo` es `TEXT` sin `CHECK`, y el precedente exacto es `CASO_TIPO_CONSULTA_KPI` en `build-on-comando-empleado.ts:598` (ADR 85 pto 9 / ADR 91 pto 6). `CASO_ESTADO_ACTIVO` se duplica con el mismo comentario textual que `build-on-soporte.ts:41-48` ya lleva.

**Secuencia de `onSolicitudA2A`** (`hayCupo === false` ⇒ rama corta):

| # | Paso | Falla ⇒ |
|---|---|---|
| a | `hayCupo === false` ⇒ `insertSolicitudA2AEntrante({ estado: REJECTED, casoId: undefined })`, evento `a2a-solicitud-rechazada-tope`, `return { estado: REJECTED, contextId: a2aTaskId, updatedAt }`. **Sin caso, sin turno, sin modelo** | PROPAGA (sin fila no hay trazabilidad) |
| b | `casoId = newId()`; `createCaso(db, { tipo: CASO_TIPO_A2A_ENTRANTE, estado: activo, … })` | **PROPAGA** — molde del paso 1 de `buildOnSoporte`: sin caso no hay nada que correlacionar |
| c | `insertSolicitudA2AEntrante({ id, a2aTaskId, casoId, origenTransporte, mensajeRecibido: truncado, estado: SUBMITTED, … })` | **PROPAGA** |
| d | `const turno = ejecutarTurno(casoId, a2aTaskId, texto);` — **invocado, NO awaiteado** | — |
| e | `return { estado: SUBMITTED, contextId: casoId, updatedAt, turno }` | — |

**`ejecutarTurno` — contrato: NUNCA rechaza** (contraste deliberado con `build-on-soporte.ts`, que PROPAGA porque allá hay un navegador esperando un `502`; acá **no espera nadie**, así que tragar y persistir `FAILED` es la única forma de que la fila quede verdadera):

1. `actualizarSolicitudEnCurso(WORKING)` ⇒ si devuelve `false`, **alguien canceló antes de arrancar**: se loguea y se vuelve **sin gastar una invocación al modelo**.
2. `prompt = buildSolicitudA2APrompt(texto)` · `knowledge = createKnowledge(casoId)`.
3. `const result = await handleTurn(casoId, prompt, { memory, hooks, candidateAgents: agents, mcpServers: knowledge.mcpServers, knowledgeFeedback: knowledge.feedback, ...(logDeps ? { logDeps } : {}) })` — **firma idéntica a la de `buildOnSoporte`**, incluido el spread condicional de `logDeps` que `exactOptionalPropertyTypes: true` exige.
4. Éxito: `actualizarSolicitudEnCurso(COMPLETED, result.responseText)` ⇒ `false` ⇒ `a2a-turno-entrante-descartado` (ADR 94 pto 5).
5. `catch`: `actualizarSolicitudEnCurso(FAILED)` + `a2a-turno-entrante-fallido`. **Un segundo `catch` alrededor de esa actualización**: si la base rechaza el `UPDATE` en el camino de error, no puede haber un `unhandledRejection` en una promesa que nadie awaitea.

**`onConsultarTarea` / `onCancelarTarea`**: un `SELECT` y, en el segundo caso, un `UPDATE` guardado. Síncronos, sin transacción — `better-sqlite3` es síncrono y dos sentencias no se interleavan dentro del proceso (el mismo hecho del que depende el ADR 87 pto 5); envolverlos en `db.transaction` no agregaría ninguna garantía y sí una capa.

---

## 6. Adaptador — `src/adapters/a2a/` (4 archivos nuevos; `client.ts`/`config.ts`/`index.ts` intactos)

### 6.1 `server-config.ts`

```ts
export interface A2AServerConfig {
  /** `""` (o sólo espacios) = adaptador DESHABILITADO: no se abre ningún puerto (ADR 88 pto 4). */
  readonly token: string;
  readonly port: number;
  /** Base pública para `supportedInterfaces[0].url`. Sin `/` final (se normaliza). */
  readonly publicUrl: string;
  readonly maxBodyBytes: number;
  readonly maxEnVuelo: number;
}

export const DEFAULT_A2A_ENTRANTE_PORT = 8888;
export const DEFAULT_A2A_ENTRANTE_PUBLIC_URL = "http://localhost:8888";
export const DEFAULT_A2A_ENTRANTE_MAX_BODY_BYTES = 65_536;
export const DEFAULT_A2A_ENTRANTE_MAX_EN_VUELO = 4;
/** Techo del drenaje al cerrar. Constante, NO env var (presupuesto de UX). Tercera instancia de 5_000. */
export const A2A_CLOSE_TIMEOUT_MS = 5_000;
/** Correlación de eventos de ciclo de vida sin `a2aTaskId` natural. Análogo de `WEBHOOK_LOG_CORRELATION_ID`. */
export const A2A_SERVER_LOG_CORRELATION_ID = "a2a-servidor";

export const RUTA_AGENT_CARD = "/.well-known/agent-card.json";
export const RUTA_JSONRPC = "/a2a";

export const METODO_SEND_MESSAGE = "SendMessage";
export const METODO_GET_TASK = "GetTask";
export const METODO_CANCEL_TASK = "CancelTask";

/* JSON-RPC 2.0 base — fijos, no dependen de ninguna verificación pendiente (ADR 94 pto 8). */
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

/* ★ A2A-específicos — VERIFICAR en la tarea 1 de sdd-apply (ADR 94 pto 9, RD-37). */
export const A2A_ERROR_TASK_NOT_FOUND: number = /* spec v1.0.0 */;
export const A2A_ERROR_TASK_NOT_CANCELABLE: number = /* spec v1.0.0 */;

/** PURA, `env` con default `process.env`, NUNCA lanza — molde de `resolveWebConfig`/`resolveA2AConfig`. */
export function resolveA2AServerConfig(env: NodeJS.ProcessEnv = process.env): A2AServerConfig;

/** `config.token.trim() !== ""`. ÚNICO gate del listener (ADR 88 pto 4). Molde de `isWebhookEnabled`. */
export function isA2AServerEnabled(config: A2AServerConfig): boolean;
```

| Env var | Campo | Default |
|---|---|---|
| `HARNESS_A2A_ENTRANTE_TOKEN` | `token` | `""` ⇒ **deshabilitado, no se abre puerto** |
| `HARNESS_A2A_ENTRANTE_PORT` | `port` | `8888` |
| `HARNESS_A2A_ENTRANTE_PUBLIC_URL` | `publicUrl` | `"http://localhost:8888"`, normalizada sin `/` final |
| `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES` | `maxBodyBytes` | `65_536` |
| `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | `maxEnVuelo` | `4` |

**No hay `HARNESS_A2A_ENTRANTE=on/off`** — rechazado explícitamente por el ADR 88 pto 4: un booleano separado del token permitiría expresar *"servidor prendido, sin token"*, y con el token como único gate ese estado **es inexpresable**.

### 6.2 `agent-card.ts`

```ts
/** PURA, sin I/O, sin reloj: se testea comparando el objeto entero contra un literal (ADR 96 pto 1). */
export function construirAgentCard(config: A2AServerConfig): AgentCardJson;
```

Forma exacta emitida (los siete campos requeridos del ADR 96 pto 2 + `securitySchemes`):

```jsonc
{
  "name": "Arnés Empresarial",
  "description": "Arnés de agentes de IA de una empresa. …",
  "version": "3.0.0",
  "capabilities": { "streaming": false, "pushNotifications": false, "extendedAgentCard": false },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [{ "id": "consulta-arnes", "name": "…", "description": "…", "tags": [...], "examples": [...] }],
  "supportedInterfaces": [{ "protocolBinding": "JSONRPC", "url": "<publicUrl>/a2a" }],
  "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } }
}
```

### 6.3 `server.ts` — el corazón

**Recorte estructural** (duplicado a propósito de `web/http.ts` y `webhooks/server.ts:30-51`, ADR 13 — **tercer servidor HTTP de la misma familia**), con **dos diferencias reales, no cosméticas**:

```ts
export interface A2ARequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** ★ NUEVO respecto de `WebRequest`/`WebhookRequest`: la única fuente de `origen_transporte` (ADR 89 pto 3). */
  readonly socket?: { readonly remoteAddress?: string | undefined } | undefined;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(error?: Error): unknown;
}

export interface A2AResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface A2AHttpServerLike {
  listen(port: number, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  /** ★ NUEVO respecto de los otros dos: puerto EFECTIVO con `listen(0)` (ADR 101). */
  address(): { readonly port: number } | string | null;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type CreateA2AServerFn = (listener: (req: A2ARequest, res: A2AResponse) => void) => A2AHttpServerLike;
```

**Los tres callbacks y el resto de deps** (molde de `WebServerDeps`):

```ts
export interface SolicitudA2AEntrada {
  readonly a2aTaskId: string;
  readonly texto: string;
  readonly origenTransporte: string;
  /** Lo decide `startServer`, que es el dueño del contador (ADR 99 pto 3). */
  readonly hayCupo: boolean;
}

export type SolicitudA2AAceptada =
  | { readonly estado: "TASK_STATE_SUBMITTED"; readonly contextId: string;
      readonly updatedAt: string; readonly turno: Promise<void> }
  | { readonly estado: "TASK_STATE_REJECTED";  readonly contextId: string;
      readonly updatedAt: string };

export interface SolicitudA2AEntranteVista {
  readonly a2aTaskId: string;
  readonly contextId: string;
  readonly estado: string;      // TASK_STATE_* crudo
  readonly resultado?: string;
  readonly updatedAt: string;
}

export interface A2AServerDeps {
  readonly config: A2AServerConfig;
  readonly onSolicitudA2A: (input: SolicitudA2AEntrada) => Promise<SolicitudA2AAceptada>;
  readonly onConsultarTarea: (a2aTaskId: string) => SolicitudA2AEntranteVista | undefined;
  readonly onCancelarTarea: (a2aTaskId: string) => CancelacionA2AResultado;
  readonly logEvent: (correlationId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  /** `randomUUID` en producción; contador determinista en tests. Molde de `newRequestId` (`web/server.ts:81`). */
  readonly newTaskId?: () => string;
}

export interface A2AServerHandle {
  /** Puerto EFECTIVO (ADR 101). */
  readonly port: number;
  /** Deja de aceptar, drena los turnos en vuelo con techo `A2A_CLOSE_TIMEOUT_MS`, resuelve. NUNCA rechaza. */
  close(): Promise<void>;
}

export function createRequestListener(deps: A2AServerDeps): (req: A2ARequest, res: A2AResponse) => void;
export function startServer(deps: A2AServerDeps, createServer?: CreateA2AServerFn): Promise<A2AServerHandle>;

/** PURA y TOTAL (ADR 93 pto 5-6). Sin reloj, sin ids nuevos, sin `throw`. */
export function construirTask(vista: SolicitudA2AEntranteVista): TaskJson;
```

**Orden de checks — EXHAUSTIVO, no se reordena** (mismo criterio literal que los otros dos servidores documentan):

```
método+ruta → tope de body → AUTH → parseo JSON-RPC → despacho por `method`
```

**Tabla de respuestas — EXHAUSTIVA**:

| Condición | HTTP | Cuerpo | Efecto |
|---|---|---|---|
| `GET` + `RUTA_AGENT_CARD` | `200` | el card (`application/json`) | **Sin auth** (ADR 88 pto 5). `a2a-card-servido` |
| Cualquier `método+ruta` no reconocido | `404` | vacío | nada — primera fila de la tabla, molde `web/server.ts:486` |
| `POST /a2a`, body > `maxBodyBytes` | `413` | vacío | `res.end()` **y después** `req.destroy()` (el orden importa: comparten socket). `a2a-solicitud-rechazada-tamano`. **Sin auth, sin parse** |
| `POST /a2a`, error de transporte leyendo el body | `400` | vacío | nada |
| `POST /a2a`, `Authorization` ausente/vacío/inválido, **o `config.token === ""`** | `401` | vacío + header `WWW-Authenticate: Bearer` | `a2a-solicitud-no-autorizada`. **NINGUNA fila creada** (ADR 88 pto 6). Sin cuerpo JSON-RPC **porque el `id` del request todavía no se parseó** — y parsear antes de autenticar es justo lo que el ADR 88 pto 6 prohíbe |
| `JSON.parse` falla | `200` | `error: -32700`, `id: null` | `a2a-sobre-invalido` |
| Sobre no objeto / `jsonrpc !== "2.0"` / `method` no string | `200` | `error: -32600`, `id: null` | ídem |
| `method` fuera de los tres | `200` | `error: -32601`, con el `id` del request | `a2a-metodo-no-soportado` (`ListTasks`, `SendStreamingMessage`, … — ADR 92 pto 1) |
| `SendMessage` sin `params.message.parts[*].text` no vacío | `200` | `error: -32602` | ninguna fila |
| `GetTask`/`CancelTask` sin `params.id` string no vacío | `200` | `error: -32602` | — |
| `GetTask` de un id inexistente | `200` | `error: A2A_ERROR_TASK_NOT_FOUND` | `a2a-tarea-no-encontrada` |
| `CancelTask` de un id inexistente | `200` | `error: A2A_ERROR_TASK_NOT_FOUND` | ídem |
| `CancelTask` sobre `COMPLETED`/`FAILED`/`REJECTED` | `200` | `error: A2A_ERROR_TASK_NOT_CANCELABLE` | **la fila NO se toca** (ADR 94 pto 3) |
| `CancelTask` sobre `CANCELED` | `200` | `result: Task{CANCELED}` | **idempotente**, `updated_at` intacto (ADR 94 pto 2) |
| `SendMessage` con cupo | `200` | `result: Task{SUBMITTED}` | fila creada **antes** de responder; turno disparado **después** |
| `SendMessage` sin cupo | `200` | `result: Task{REJECTED}` | fila `REJECTED` **sin `caso_id`**, sin modelo |
| `GetTask` existente | `200` | `result: Task` de `construirTask(vista)` | ninguno — es una lectura (ADR 100) |
| Un handler lanza | `200` | `error: -32603` | `a2a-handler-fallido`. Nunca un stacktrace en el cuerpo |

**`esAutorizado(req, token)`** — calcado de `web/server.ts:113-132`, con las dos trampas que el repo ya pagó y documentó: **`token === "" ⇒ false` sin comparar nada** (nunca "abierta por defecto") y **chequeo de longitud ANTES de `timingSafeEqual`** (lanza `RangeError` con buffers de largo distinto). Duplicado deliberado por la regla de `AGENTS.md`, misma justificación que `pathFromUrl` (ADR 13) y `ERROR_BODY_MAX_CHARS` (ADR 71 pto 3).

**Acumulación del body**: se sigue el molde de **`web/`** (`leerBody` + tope en el ruteador), no el de `webhooks/` (listeners `data`/`end`/`error` inline) — el mismo motivo que `web/server.ts:17-22` documenta. `leerBody`/`parseJsonBody` se **duplican** en `src/adapters/a2a/body.ts`… **no**: se reimplementan **dentro de `server.ts`** en una función privada de ~30 líneas, porque acá hay **una sola** ruta con body (contra las cuatro del adaptador Web) y un archivo aparte para un único llamador sería estructura sin uso. Declarado acá para que no se lea como una desviación del molde en el review.

**`origen_transporte`** = `req.socket?.remoteAddress ?? "desconocido"`. **No se lee `X-Forwarded-For`**: es un header que el llamador controla, y una columna de trazabilidad poblada con lo que el llamador afirma de sí mismo es peor que una vacía — el mismo argumento textual del ADR 89 pto 5. Ver **RD-43**.

### 6.4 `server-index.ts` — la fachada opt-in

```ts
export interface A2AServerAdapter {
  readonly port: number;
  readonly publicUrl: string;
  close(): Promise<void>;
}

/**
 * Molde literal de `startWebhookServer` (`webhooks/index.ts:51`) y de
 * `startWebServer` (`web/index.ts:48`), incluida la semántica de `undefined`:
 * sin token NO se abre ningún puerto, se emite `a2a-servidor-deshabilitado` y
 * el proceso arranca idéntico a `v2.2.0`. `undefined` y no un no-op, para que
 * `main.ts` distinga "no hay nada que cerrar" de "hay un servidor que cerrar".
 * Un `listen` que rechaza (EADDRINUSE) PROPAGA tal cual: `main.ts` decide.
 */
export async function startA2AServer(
  deps: Omit<A2AServerDeps, "config"> & {
    readonly config?: A2AServerConfig;
    readonly createServer?: CreateA2AServerFn;
  },
): Promise<A2AServerAdapter | undefined>;
```

---

## 7. Persistencia

### 7.1 Migración `NNNN_solicitudes_a2a_entrantes.ts` (nueva — ADR 89 pto 4 + regla del ADR 63)

**La regla, no el número** (precedente ADR 63, textual): *sea `M` el prefijo numérico más alto presente en `src/adapters/memory/migrations/index.ts` **en `main`** al momento de `sdd-apply`; esta migración es `NNNN = M + 1`, a cuatro dígitos, **agregada al final** del array `migrations`, sin editar ni reordenar ninguna entrada previa.*

**Valor derivado, con su evidencia y su límite** (ver **RD-38**): en la rama actual el techo es **`0010_delegaciones_a2a`** (`migrations/index.ts:38`, leído). En **`main`** el techo es **`0009_propuestas_cambio`** — derivado de tres hechos verificados y **no** de un `git show`, que esta fase no pudo correr: (1) `docs/progreso/` tiene `v2.1`, y por el checklist de cierre de `AGENTS.md` una carpeta de progreso implica merge + tag, así que `v2.1.0` está en `main` con sus migraciones `0007`-`0009`; (2) `hito-2.2/design.md:1000` registró que el techo de `main` era `0006` *antes* de ese merge; (3) `0010` lo creó la tarea 9 del Hito 6 y vive sólo en `hito/v2.2-a2a-cliente` (§0, comprobación 4). **Con el gate de §0 cumplido, `M = 10` y el archivo es `0011_solicitudes_a2a_entrantes.ts`, exportando `migration0011SolicitudesA2AEntrantes`.** Si `hito-2.2` cerrara con otra cantidad, la regla vale igual y el número cambia solo. **`sdd-apply` revalida con `git show main:…` antes de crear el archivo.**

**DDL final** (el del ADR 89 pto 4, sin desviaciones nuevas):

```sql
CREATE TABLE IF NOT EXISTS solicitudes_a2a_entrantes (
  id                  TEXT PRIMARY KEY,
  a2a_task_id         TEXT NOT NULL UNIQUE,
  agente_externo_url  TEXT,
  origen_transporte   TEXT NOT NULL,
  caso_id             TEXT REFERENCES casos(id),
  mensaje_recibido    TEXT NOT NULL,
  estado              TEXT NOT NULL,
  resultado           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_a2a_entrantes_caso ON solicitudes_a2a_entrantes(caso_id);
```

| Columna | Constraint | Por qué |
|---|---|---|
| `a2a_task_id` | `NOT NULL UNIQUE` | Lo asignamos **nosotros** (`newTaskId`), y es la clave por la que `GetTask`/`CancelTask` buscan. Sin índice único el lookup es un scan y la unicidad es una convención en vez de un invariante |
| `agente_externo_url` | **nullable, hoy SIEMPRE `NULL`** | ★ Relajada respecto del Plan. El protocolo v1.0.0 **no transporta** la identidad del emisor (ADR 89). El comentario de la migración lleva el motivo escrito, para que nadie tenga que reconstruirlo en seis meses |
| `origen_transporte` | `NOT NULL` | ★ Agregada. `socket.remoteAddress`, o `"desconocido"`. **No es identidad de agente y el DDL no pretende que lo sea** |
| `caso_id` | **nullable**, `REFERENCES casos(id)` | ★ Relajada. `NULL` **sólo** en `REJECTED` (sin caso, ADR 90 pto 4). Todas las demás filas lo tienen |
| `mensaje_recibido` | `NOT NULL` | ★ Agregada. Tope `MAX_SOLICITUD_A2A_CHARS = 8_000` puesto por el **núcleo**, no por SQL — mismo criterio que `tarea_delegada`, `solicitudes_internas.detalle` y `propuestas_cambio.patch` |
| `estado` | `NOT NULL`, **sin `CHECK`** | `TASK_STATE_*` crudos (ADR 71 pto 5). El vocabulario canónico vive en el núcleo; el SQL no lo conoce. Molde literal de `0010` |
| `resultado` | **nullable** | ★ Agregada. Sólo en `COMPLETED`. **Sin ella, `GetTask` no tiene nada que devolver** (ADR 87) |
| `created_at`, `updated_at` | `NOT NULL` | ISO-8601 UTC, comparado y ordenado lexicográficamente (ADR 16 regla 3) |

**Un solo índice**, y **con lector**: `listSolicitudesA2AEntrantesPorCaso` (§7.2) es el volcado de evidencia de `docs/progreso/`. Sin él, el índice sería peso muerto — el mismo criterio con que `0010` justificó tener uno solo. **Sin FK a `delegaciones_a2a`**: son tablas de direcciones opuestas del mismo protocolo, sin relación entre filas.

### 7.2 `repository.ts` — funciones nuevas

```ts
export interface InsertSolicitudA2AEntranteInput {
  readonly id: string; readonly a2aTaskId: string; readonly casoId?: string;
  readonly origenTransporte: string; readonly mensajeRecibido: string;
  readonly estado: string; readonly createdAt: string; readonly updatedAt: string;
}
/** `agente_externo_url` y `resultado` nacen en NULL SIEMPRE. `casoId` ausente ⇒ NULL (fila REJECTED). */
export function insertSolicitudA2AEntrante(db: Database.Database, input: InsertSolicitudA2AEntranteInput): void;

/** Colisión de `a2a_task_id` (`SQLITE_CONSTRAINT_UNIQUE`) — molde de `VentaAlreadyExistsError`. */
export class SolicitudA2AEntranteYaExisteError extends Error { constructor(a2aTaskId: string); }

export interface SolicitudA2AEntranteRow { /* … camelCase, opcionales condicionales (`...(x !== null ? {x} : {})`),
                                              molde exacto de `rowToDelegacionA2A` … */ }

/** Lookup de `GetTask`/`CancelTask`. SÍNCRONA. `undefined` si no existe. */
export function getSolicitudA2AEntrantePorTaskId(
  db: Database.Database, a2aTaskId: string,
): SolicitudA2AEntranteRow | undefined;

export interface ActualizarSolicitudA2AEnCursoInput {
  readonly a2aTaskId: string; readonly estado: string;
  readonly resultado?: string; readonly updatedAt: string;
}
/**
 * ★ El `UPDATE` CONDICIONAL del que depende el ADR 94 pto 5. `WHERE a2a_task_id = @a2aTaskId
 * AND estado IN ('TASK_STATE_SUBMITTED','TASK_STATE_WORKING')`.
 * Devuelve `changes > 0`: `false` significa "la fila ya no está en curso" (un `CancelTask`
 * ganó la carrera) y el llamador DESCARTA el resultado. **NO lanza** por `changes === 0` —
 * a diferencia de `actualizarDelegacionA2A`, acá el cero es un desenlace esperado, no un bug.
 * `resultado` con `COALESCE(@resultado, resultado)`, molde de `updateCaso`.
 */
export function actualizarSolicitudA2AEnCurso(
  db: Database.Database, input: ActualizarSolicitudA2AEnCursoInput,
): boolean;

/**
 * Las tres ramas del ADR 94 en una función: `SELECT` del estado, y `UPDATE` guardado sólo si
 * no es terminal. Sin transacción: `better-sqlite3` es SÍNCRONO y dos sentencias no se
 * interleavan dentro del proceso (ADR 87 pto 5).
 */
export function cancelarSolicitudA2AEntrante(
  db: Database.Database, input: { readonly a2aTaskId: string; readonly updatedAt: string },
): CancelacionA2ARepoResultado;  // "cancelada" | "ya-cancelada" | "no-cancelable" | "no-encontrada"

/** Lectura de evidencia — el lector del único índice. */
export function listSolicitudesA2AEntrantesPorCaso(
  db: Database.Database, casoId: string,
): readonly SolicitudA2AEntranteRow[];
```

**`agente_externo_url` no aparece en NINGUNA firma.** No hay forma de poblarla desde el código de este hito, y eso es deliberado: el día que exista el registro de agentes del ADR 89 pto 5, agregar el campo a `insertSolicitudA2AEntrante` será el diff que marque el cambio de decisión.

### 7.3 Composition root — `src/main.ts`, bloque 5d

```ts
// 5d. Cuarta fuente de turnos (Hito 7, ADR 88/91): el Servidor A2A entrante.
//     OPT-IN por TOKEN — sin HARNESS_A2A_ENTRANTE_TOKEN no se abre NINGÚN
//     puerto (`startA2AServer` devuelve `undefined` y loguea
//     `a2a-servidor-deshabilitado`), y el proceso se comporta EXACTAMENTE
//     como v2.2.0. Comparte `db`/`memory`/`hooks`/`agents`/`createKnowledge`
//     con la TUI, los webhooks y el canal web — la MISMA fábrica por `casoId`
//     (R1 de Hito 3, no reintroducido). Mismo criterio de wiring que los
//     bloques 5a y 5b: PROPIO `try`/`catch`, un `EADDRINUSE` se loguea como
//     `a2a-servidor-arranque-fallido` y el proceso sigue sin Servidor A2A —
//     que el puerto esté ocupado no puede impedir que el empleado use la TUI
//     (R9 de la propuesta, precedente `webhooks/index.ts:46-49`).
const a2aEntrante = buildOnA2AEntrante({ db, memory, hooks, agents, createKnowledge });

let a2aServidor: A2AServerAdapter | undefined;
try {
  a2aServidor = await startA2AServer({
    ...a2aEntrante,   // onSolicitudA2A · onConsultarTarea · onCancelarTarea
    logEvent: (correlationId, event, fields) => logTurnEvent(correlationId, event, fields),
  });
} catch (error) {
  logTurnEvent(A2A_SERVER_LOG_CORRELATION_ID, "a2a-servidor-arranque-fallido", {
    message: toErrorMessage(error),
  });
  a2aServidor = undefined;
}
```

**Y en el `finally`** (líneas 456-495 hoy), **una tercera guarda del mismo molde**, entre el cierre de webhooks y `db.close()`:

```ts
if (a2aServidor !== undefined) {
  try { await a2aServidor.close(); }
  catch (error) { console.error(`No se pudo cerrar el Servidor A2A: ${toErrorMessage(error)}`); }
}
```

**Lo único no negociable del orden** es que **los tres listeners drenen antes de `db.close()`** — el ADR 10 aplicado ahora a tres fuentes: al revés, un turno entrante a mitad de camino escribiría contra una base ya cerrada.

### 7.4 Archivos de configuración del repo

| Archivo | Cambio | Motivo |
|---|---|---|
| `README.md` | Sección nueva *"Variables de entorno del servidor A2A entrante"* (5 filas) + *"Cómo consultar el arnés como agente A2A"* (`curl` del card, `curl` de `SendMessage`, y el loop de `GetTask`) | Molde de la tabla `HARNESS_A2A_*` ya existente (líneas 105-115) |
| `.env.example` | Las 5 variables, comentadas y **sin valores reales** | Es donde un operador las descubre |
| `docs/ARC42_Harness_Empresarial.md` | Caja Blanca 3.2 sin *"hito posterior"*; **Deuda 2 cerrada**; **Riesgo 2 anotado como confirmado** con la evidencia de §10.C | R12 de la propuesta: un hito que cierra el Plan y deja el documento de arquitectura desactualizado no cierra nada |
| `openspec/config.yaml` | — | Ya no hay nada que sacar: `v2.2.0` sacó A2A de *"Planned"* (su tarea 18) |
| `package.json` | — | **Sin dependencias nuevas** (séptimo change consecutivo) |

---

## 8. Logging (Concepto Transversal 3)

Eventos nuevos, **sin cambiar el contrato de `logTurnEvent`** — dato, no contrato, mismo criterio de todos los hitos anteriores. **Correlación**: `A2A_SERVER_LOG_CORRELATION_ID` para el ciclo de vida del proceso; **`a2aTaskId`** para todo lo que ocurre antes de que exista un caso (molde exacto del `deliveryId` de webhooks); **`casoId`** desde que el caso existe.

| Evento | Correlación | Campos |
|---|---|---|
| `a2a-servidor-escuchando` | `a2a-servidor` | `port` (**efectivo**, ADR 101), `publicUrl` |
| `a2a-servidor-deshabilitado` | `a2a-servidor` | — |
| `a2a-servidor-arranque-fallido` | `a2a-servidor` | `message` |
| `a2a-card-servido` | `a2a-servidor` | `origenTransporte` |
| `a2a-solicitud-no-autorizada` | `a2a-servidor` | `origenTransporte` — **ninguna fila creada** |
| `a2a-solicitud-rechazada-tamano` | `a2a-servidor` | `origenTransporte`, `maxBodyBytes` |
| `a2a-sobre-invalido` | `a2a-servidor` | `code` |
| `a2a-metodo-no-soportado` | `a2a-servidor` | `method` |
| `a2a-solicitud-recibida` | `a2aTaskId` | `chars`, `origenTransporte` |
| `a2a-solicitud-rechazada-tope` | `a2aTaskId` | `enVuelo`, `maxEnVuelo` — fila `REJECTED`, **sin caso** |
| `a2a-turno-entrante-iniciado` | `casoId` | `a2aTaskId` |
| `a2a-turno-entrante-completado` | `casoId` | `a2aTaskId`, `resultadoChars`, `duracionMs` |
| `a2a-turno-entrante-fallido` | `casoId` | `a2aTaskId`, `message` |
| `a2a-turno-entrante-descartado` | `casoId` | `a2aTaskId` — canceló mientras corría (ADR 94 pto 5) |
| `a2a-cancelacion-recibida` | `a2aTaskId` | `resultado` (`cancelada`/`ya-cancelada`/`no-cancelable`/`no-encontrada`) |
| `a2a-tarea-no-encontrada` | `a2aTaskId` | — |
| `a2a-handler-fallido` | `a2aTaskId` | `method` |
| `a2a-servidor-cierre-con-turnos-en-vuelo` | `a2a-servidor` | `enVuelo` |

**NUNCA se loguea**: el valor de `HARNESS_A2A_ENTRANTE_TOKEN` ni el header `Authorization`; el **texto** de la solicitud (sólo `chars` — mismo criterio que `tareaChars` de `v2.2.0`); el **texto** del resultado (sólo `resultadoChars`); ni el prompt sintético.

---

## 9. Errores y degradación

| Falla | Comportamiento | Precedente |
|---|---|---|
| Sin `HARNESS_A2A_ENTRANTE_TOKEN` | `startA2AServer` ⇒ `undefined`, **ningún puerto abierto**, `a2a-servidor-deshabilitado`. `v2.2.0` exacto | ADR 88 pto 4 / `isWebhookEnabled` |
| `EADDRINUSE` al arrancar | `startServer` **propaga**; `main.ts` loguea y sigue **sin** Servidor A2A | R9 / `webhooks/index.ts:46-49` |
| Auth ausente/inválida | `401` + `WWW-Authenticate`, **antes de parsear el body**, **cero filas** | ADR 88 pto 6 |
| Body sobre el tope | `413`, `res.end()` y **después** `req.destroy()`, sin auth y sin parse | ADR 9 / `web/server.ts:198-204` |
| JSON o sobre inválido | `200` + `-32700`/`-32600`, `id: null` | ADR 94 pto 7 |
| `method` no soportado | `200` + `-32601` — **nunca un `500`, nunca un silencio** | ADR 92 pto 1 |
| `params` mal formados | `200` + `-32602`, **ninguna fila** | ADR 94 |
| Tope de turnos en vuelo superado | `200` + `result: Task{REJECTED}`, fila **sin `caso_id`**, **sin modelo**. Nuestro cliente lo lee como `reason: "rejected"` sin una línea nueva | ADR 90 pto 4-5 |
| `createCaso` falla | **PROPAGA** ⇒ el listener responde `-32603`. Sin caso no hay nada que correlacionar | molde `buildOnSoporte` paso 1 |
| `insertSolicitudA2AEntrante` falla | **PROPAGA** ⇒ `-32603`. Sin fila no hay trazabilidad, y una solicitud sin traza es peor que una que no ocurrió | `ActivityStorePort`, ADR 80 pto 4 |
| `handleTurn` rechaza (`TurnFailedError` u otro) | **TRAGADO** por `ejecutarTurno` ⇒ fila `FAILED` + evento. **Contraste deliberado con `build-on-soporte.ts`, que propaga**: acá no espera nadie | ADR 87 / molde `buildOnActivity` |
| El `UPDATE` de cierre falla | Segundo `catch`: se loguea y se vuelve. **Nunca un `unhandledRejection`** en una promesa que nadie awaitea | §5.2 paso 5 |
| `CancelTask` gana la carrera al turno | `changes === 0` ⇒ resultado **descartado**, fila queda `CANCELED`, evento `a2a-turno-entrante-descartado` | ADR 94 pto 5 |
| `CancelTask` sobre terminal de éxito/fracaso | `A2A_ERROR_TASK_NOT_CANCELABLE`, **la fila no se toca** | ADR 94 pto 3 |
| `GetTask`/`CancelTask` de un id inexistente | `A2A_ERROR_TASK_NOT_FOUND` — nunca un `Task` sintético | ADR 94 pto 4 |
| Cierre con turnos en vuelo | `server.close()` ⇒ `Promise.allSettled([...enVuelo])` en carrera contra `A2A_CLOSE_TIMEOUT_MS` ⇒ resuelve. **NUNCA rechaza** | `web/server.ts:547-565` |
| El proceso muere con un turno en vuelo | La fila queda en `WORKING` para siempre y el llamador poll-ea hasta **su** techo | Aceptado: **RD-39** (= RD-20/RD-31 del lado saliente) |

---

## 10. Estrategia de testing (TDD estricto — `strict_tdd: true`, `npm test`)

**Regla del change**: **ningún test del suite por defecto abre un puerto**, salvo el único archivo de §10.D — invariante del repo desde el Hito 3, escrito textualmente en `webhooks/server.ts:249` y protegido por el ADR 86 pto 3. Las costuras son `CreateA2AServerFn` (ciclo de vida), los dobles planos de `A2ARequest`/`A2AResponse` (listener) y los tres callbacks (negocio).

### A. Tests puros (sin dobles, sin I/O)

| Módulo | Qué se afirma |
|---|---|
| `a2a-entrante-prompt.ts` | Las cuatro secciones en orden; **el párrafo de limitación de sólo lectura está, literal**; truncado a `MAX_SOLICITUD_A2A_CHARS` con `[…truncado]`; función total (texto vacío no lanza); **cero imports** (assert sobre el módulo) |
| `agent-card.ts` | El objeto **entero** contra un literal; `capabilities` las tres en `false`; **exactamente una** skill y **exactamente una** `supportedInterfaces` con `protocolBinding === "JSONRPC"`; `url` = `publicUrl + RUTA_JSONRPC`; `version === "3.0.0"`; **no emite `preferredTransport` ni `additionalInterfaces`** (ADR 96 pto 6) |
| `construirTask` | **El test estrella del ADR 93**: `COMPLETED` con resultado ⇒ `artifacts[0].parts[0].text` y **sin** `status.message`; `FAILED`/`CANCELED`/`REJECTED` ⇒ `status.message` y **sin** `artifacts`; `SUBMITTED`/`WORKING` ⇒ ninguno de los dos; `status.timestamp === vista.updatedAt`; `artifactId === \`${id}-0\``; `COMPLETED` sin resultado **no lanza** |
| `resolveA2AServerConfig` / `isA2AServerEnabled` | Los cinco defaults; numéricos inválidos/`Infinity`/≤ 0 ⇒ default sin lanzar; `publicUrl` normalizada sin `/` final; **token en blanco ⇒ deshabilitado** |
| `esAutorizado` | Token `""` ⇒ `false` **sin comparar**; largo distinto ⇒ `false` **sin `RangeError`**; header en array ⇒ primer valor; prefijo `Bearer ` exacto |
| Parseo del sobre | Los cinco errores base con su `code` y su `id` (o `null`); un campo desconocido del sobre **no** hace fallar |

### B. Listener con dobles planos (`A2ARequest`/`A2AResponse`) — **la tabla de §6.3, fila por fila**

Un test por fila. Los que más importan: **`401` sin ninguna llamada a `onSolicitudA2A`** (spy con `toHaveBeenCalledTimes(0)` — la verificación mecánica del ADR 88 pto 6); **`413` con `end()` llamado ANTES de `destroy()`** (orden observado); **el card servido sin `Authorization`**; **`-32601` para `ListTasks` y `SendStreamingMessage`, con `id` echoado**; **`GetTask` no hace ningún `await`** (el doble de `onConsultarTarea` es síncrono y el test afirma que `res.end` ya corrió en el mismo tick). Y el test de credenciales: **ningún cuerpo de respuesta ni ningún `logEvent` contiene el token**, sobre las siete filas de fallo.

### C. Ciclo de vida, tope, drenaje y turno (dobles + `db` real en `:memory:`)

| Qué | Cómo |
|---|---|
| `startServer` con `CreateA2AServerFn` doble | `listen` resuelve; `on("error")` rechaza (`EADDRINUSE`); **`port` es el de `address()`, no el de `config`** (ADR 101) |
| Tope de turnos en vuelo | `maxEnVuelo: 2`, tres `SendMessage` con turnos que no resuelven ⇒ el tercero recibe `hayCupo: false` y responde `REJECTED`; al resolver uno, el siguiente vuelve a tener cupo |
| Drenaje | `close()` con un turno pendiente ⇒ no resuelve hasta que el turno resuelve; con un turno colgado ⇒ resuelve por `A2A_CLOSE_TIMEOUT_MS` (reloj falso) y loguea `a2a-servidor-cierre-con-turnos-en-vuelo`; **`close()` nunca rechaza**, ni con un turno que rechaza |
| `buildOnA2AEntrante` | Molde literal de `build-on-soporte.test.ts` (leído): `vi.mock("./core/turn-selector/handle-turn.js")` + `openDatabase(":memory:")`. Se afirman: `casos.tipo === "a2a_entrante"`; **la fila existe ANTES de que la promesa de `onSolicitudA2A` resuelva**; `createKnowledge(casoId)` **una** vez; `handleTurn` recibe **el prompt de `buildSolicitudA2APrompt`**; `handleTurn` rechaza ⇒ fila `FAILED` **y la promesa `turno` NO rechaza** |
| **`CancelTask` gana la carrera** | Cancelar mientras `handleTurn` está pendiente ⇒ al resolver, la fila sigue `CANCELED`, `resultado` **sigue `NULL`**, y se logueó `a2a-turno-entrante-descartado` |
| **Riesgo 2 — la evidencia del ADR 90 pto 7** | N `SendMessage` concurrentes **más** un turno de actividad de webhook sobre el mismo `proyectoId`, con `db` real en `:memory:` y `handleTurn` doble que resuelve tras un tick ⇒ ninguna fila inconsistente, el sobrante rechazado con `REJECTED`, y **ninguna de las dos fuentes bloquea a la otra** (se afirma el entrelazado, no sólo el resultado final) |
| `repository.ts` | Las cinco funciones sobre `:memory:`, incluida **la guarda del `UPDATE` condicional** (`false` sobre una fila `CANCELED`) y las cuatro ramas de `cancelarSolicitudA2AEntrante` |

### D. Integración real — **UN archivo, y este SÍ corre en CI**

`src/test/integration/a2a-server.integration.test.ts`:

1. `startA2AServer({ config: { token: "test-token", port: 0, … } })` con el `createServer` **real** ⇒ puerto efímero, leído del handle (ADR 101).
2. Se lo consulta con **`delegarTarea` de `client.ts`**, importada directo (mismo directorio de adaptador, sin cruzar ningún límite), con `destino: { baseUrl: \`http://127.0.0.1:${port}\`, authToken: "test-token" }`. **`DESTINOS_A2A` no se toca**: verificado que `delegarTarea` no usa `input.clave` para nada más que el logging del llamador, así que pasar una de las dos claves existentes no ensucia el registro cerrado (R8 del Hito 6 intacto).
3. Se recorre **el ciclo completo del cliente**: `GET` del card ⇒ `SendMessage` ⇒ **loop real de `GetTask`** ⇒ `TASK_STATE_COMPLETED` con el texto. Es el primer test del proyecto que ejercita ese loop **contra un socket**, no con reloj inyectado — el entregable vale doble (ADR 87 pto 4).
4. Casos adicionales: token equivocado ⇒ `reason: "transporte"` (el cliente clasifica el `401` así, verificado); tope superado ⇒ **`reason: "rejected"` sin una línea nueva del lado cliente**; `method` inválido enviado con `fetch` crudo ⇒ `-32601`.
5. `handleTurn` se sustituye por un doble a nivel del composition root del test (no se invoca el modelo): **lo que se prueba es el protocolo, no el turno**.
6. **Sin infraestructura de terceros** — a diferencia del test de integración del Hito 6, no hay sample de Python que levantar: cliente y servidor son los dos nuestros. **No degrada a `skip`.** Es la primera verificación de conformidad A2A automatizable que el proyecto tiene (R6).

---

## 11. Verificación manual del entregable

1. `export HARNESS_A2A_ENTRANTE_TOKEN=…` y arrancar el arnés ⇒ log `a2a-servidor-escuchando {port: 8888}`.
2. `curl -s localhost:8888/.well-known/agent-card.json | jq` **sin `Authorization`** ⇒ card completo, `version "3.0.0"`, `capabilities` las tres en `false`, **una** skill, `supportedInterfaces[0].protocolBinding === "JSONRPC"`.
3. `POST /a2a` **sin** token ⇒ `401`, y `SELECT count(*) FROM solicitudes_a2a_entrantes` **no cambia**.
4. `SendMessage` con token ⇒ respuesta **inmediata** (cronometrada) con `status.state = "TASK_STATE_SUBMITTED"` e `id` no vacío; en la base, la fila ya está, con `origen_transporte` poblado y `agente_externo_url` **`NULL`**.
5. `GetTask` **inmediatamente después** ⇒ encontrado (nunca "no encontrada" por carrera). Repetir a los pocos segundos ⇒ `TASK_STATE_COMPLETED` **con el texto** en `artifacts[0].parts[0].text`, y `resultado` no vacío en la fila.
6. **El ciclo completo contra nuestro propio cliente**, sin modificarlo: correr el test de §10.D con el arnés real levantado.
7. `SendMessage` de un `method` inexistente (`ListTasks`) ⇒ `-32601`, **no un `500`**.
8. **Tope**: `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO=1`, dos `SendMessage` seguidos ⇒ el segundo `TASK_STATE_REJECTED`, fila **sin `caso_id`**.
9. **`CancelTask` en vuelo** ⇒ fila `CANCELED`; cuando el turno termina, la fila **sigue** `CANCELED` y `resultado` **sigue `NULL`**; log `a2a-turno-entrante-descartado`.
10. **`CancelTask` sobre una tarea ya `COMPLETED`** ⇒ error de tarea no cancelable, y `SELECT resultado` **intacto**.
11. **Riesgo 2**: 6 `SendMessage` concurrentes + un webhook de GitHub sobre un proyecto real ⇒ ninguna fila inconsistente, ninguna fuente bloqueada. **Es la evidencia del ADR 90 pto 7.**
12. **`git diff --stat main -- src/core/`** ⇒ **un solo archivo agregado** (`a2a-entrante-prompt.ts`) y **el doc-comment de `a2a-contract.ts`**. Ningún otro archivo de núcleo modificado — **la verificación mecánica del Escenario 6 del arc42**.
13. **Rollback**: quitar `HARNESS_A2A_ENTRANTE_TOKEN` ⇒ `a2a-servidor-deshabilitado`, **ningún puerto**, comportamiento idéntico a `v2.2.0`.
14. **Cierre con turno en vuelo**: Ctrl+C durante un `SendMessage` ⇒ drena con techo, **sin `unhandledRejection`**.
15. **Ningún log lleva el token**: `rg` sobre `data/harness.log` por su valor ⇒ **cero resultados**.
16. `npm test` y `npm run typecheck` en verde, **con el test de integración CORRIENDO** (no `skipped`).
17. **Evidencia** en `docs/progreso/v3.0-a2a-servidor/`: el card servido, el tráfico JSON-RPC de los tres métodos, el volcado de `solicitudes_a2a_entrantes` **en sus cinco estados**, la corrida de concurrencia del punto 11, **la nota de corrección al Plan** sobre `agente_externo_url`, y **el hallazgo de los dos códigos de error** (RD-37).

---

## 12. Presupuesto de review — corte de PRs encadenados (R11)

La propuesta estimó **~1 200-1 400 líneas de producción**. Bajado a firmas concretas y con la relación test:producción ≈ **1:1** de este repo (TDD estricto), el total es **~2 460 líneas de diff**.

### Review Workload Forecast

```
Estimated changed lines (additions + deletions): ~2460
Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High
```

| PR | Contenido | Prod. | Test | Total |
|---|---|---|---|---|
| **1** | `adapters/a2a/server-config.ts` (config + rutas + métodos + los 7 códigos de error) · `.env.example` | ~130 | ~140 | **~270** |
| **2** | `adapters/a2a/agent-card.ts` · `core/agents/a2a-entrante-prompt.ts` · doc-comment de `core/agents/a2a-contract.ts` | ~175 | ~205 | **~380** |
| **3** | Migración `NNNN_solicitudes_a2a_entrantes.ts` · `repository.ts` (5 funciones + row + error) | ~245 | ~235 | **~480** |
| **4** | `adapters/a2a/server.ts` **parte 1**: recorte estructural · `pathFromUrl` · `esAutorizado` · lectura de body con tope · ruteo · card servido · sobre JSON-RPC + los 5 errores base | ~200 | ~230 | **~430** |
| **5** | `adapters/a2a/server.ts` **parte 2**: `construirTask` · los tres métodos · `startServer` (tope + drenaje + puerto efectivo) · `adapters/a2a/server-index.ts` | ~215 | ~255 | **~470** |
| **6** | `src/build-on-a2a-entrante.ts` · `src/main.ts` (bloque 5d + `finally`) · `src/test/integration/a2a-server.integration.test.ts` · `README.md` · `docs/ARC42_*.md` | ~200 | ~230 | **~430** |

**Por qué `server.ts` se parte en dos y no entra en uno solo**: entero son ~445 líneas de producción y ~485 de test — **~930, más del doble del presupuesto**. El corte no es por tamaño sino por **unidad de review**: el PR 4 se revisa preguntando *"¿alguien no autorizado puede entrar, y un sobre malformado rompe algo?"* (transporte y protocolo, **sin ninguna tarea**); el PR 5, *"¿el `Task` que devolvemos es el que el protocolo describe, y el tope y el drenaje funcionan?"*. Son dos preguntas distintas con dos conjuntos de tests distintos, y el PR 4 es demostrable solo (`curl` del card + `401` + `-32601`) sin que exista todavía ninguna fila.

**Orden y autonomía** — cada PR es demostrable solo y revertible sin tocar el anterior:

```
1 (aditivo puro: nadie lo consume) ──▶ 2 (el card y el prompt existen y son puros)
   └──▶ 3 (la tabla existe y se puede escribir/leer a mano por SQL)
          └──▶ 4 (el servidor RESPONDE: card, 401, 404, -32601 — sin ninguna tarea)
                 └──▶ 5 (los tres métodos completos contra callbacks dobles)
                        └──▶ 6 (el turno real + wiring + integración — ENTREGABLE COMPLETO)
```

**Rollback en orden inverso**: 6 → 5 → 4 → 3 → 2 → 1. **Los seis PRs son aditivos puros**: ningún archivo existente cambia de comportamiento (el único cambio sobre código previo es un doc-comment y tres bloques nuevos en `main.ts`/`repository.ts`/`migrations/index.ts`). Todo el adaptador puede quedarse mergeado sin daño: **sin token, no hace nada**. Es el rollback más limpio de todos los hitos del proyecto.

**Estrategia sugerida**: `chain_strategy = feature-branch-chain`, misma que `hito-2.0`, `hito-2.1` y `hito-2.2`. El PR 1 apunta al tracker `hito/v3.0-a2a-servidor` y cada hijo al inmediato anterior.

---

## 13. Riesgos residuales (RD-32 a RD-43)

### Las cuatro que la propuesta dejó abiertas — RESUELTAS

| # | Pregunta de la propuesta | Resolución |
|---|---|---|
| ~~**RD-32**~~ | Ubicación del prompt puro y strings del card | **RESUELTA.** `src/core/agents/a2a-entrante-prompt.ts`, sin imports, dueño del único tope (`8_000`, el de `TAREA_DELEGADA_MAX_CHARS`) — **ADR 95**. Strings del card (una skill, `id: "consulta-arnes"`, tres `examples`) — **ADR 96**, con `supportedInterfaces` verificado contra `extraerEndpointJsonRpc` (`client.ts:170-188`) |
| **RD-33** | Semántica de `CancelTask` sobre tarea terminal + código de error | **RESUELTA EN SEMÁNTICA** (**ADR 94**: cuatro ramas, con la guarda del `WHERE` como mecanismo). **Los dos NÚMEROS quedan por regla + verificación obligatoria en `sdd-apply`** — esta fase no tuvo `WebFetch`. Ver **RD-37** |
| ~~**RD-34**~~ | Dónde va el texto del resultado dentro del `Task` | **RESUELTA.** `artifacts[0].parts[0].text` para `COMPLETED`; `status.message` reservado a los terminales de fracaso; **nunca los dos**. **ADR 93**, decidido leyendo `extraerResultado` (`client.ts:309-336`) línea por línea |
| ~~**RD-35**~~ | Los números operativos | **RESUELTA.** `4` / `8888` / `65_536` / `5_000` + `8_000` de tope de texto, cada uno con su precedente en el repo. **ADR 97**, incluida la explicación de por qué el puerto lleva default acá y `WEB_PORT` no |

### Las nuevas — abiertas y declaradas

| # | Riesgo | Mitigación |
|---|---|---|
| **RD-36** | **Gate de secuencia ignorado (R1)**: `sdd-apply` arranca sin `v2.2.0` en `main` ⇒ este change no tiene de dónde importar **nada** de lo que reusa, y el número de migración colisiona | §0 con **cuatro** condiciones verificables, todas **NO CUMPLIDAS hoy**. `sdd-apply` reporta `blocked`, no "parcial". **No bloquea este diseño** — bloquea su implementación. Tercer hito consecutivo con el mismo gate |
| **RD-37** | **Los dos códigos de error específicos de A2A no se verificaron en esta fase** (sin `WebFetch`/`Bash`) | **ADR 94 pto 9-10**: la *semántica* está cerrada, los dos números están aislados en **dos constantes con nombre** que aparecen **una vez cada una**, y la **tarea 1 de `sdd-apply` los verifica** contra `specification/a2a.proto` + `docs/specification.md` del tag `v1.0.0` antes de escribirlos. Fallback escrito (rango `-32000..-32099`). Ningún camino del test de integración depende del valor: nuestro cliente clasifica cualquier sobre con `error` igual. **Mismo tratamiento exacto que RD-24** |
| **RD-38** | **El techo de migraciones en `main` se derivó, no se verificó con `git show`** | §7.1: se aplica la **regla** del ADR 63 (`NNNN = M + 1`), no un número fijo, y la derivación lleva sus tres evidencias escritas. `sdd-apply` revalida antes de crear el archivo. Si el valor derivado fuera incorrecto, **la regla sigue siendo correcta** y sólo cambia el nombre del archivo |
| **RD-39** | **El proceso que muere se lleva puesta la solicitud en vuelo**: la fila queda en `WORKING` para siempre y el llamador poll-ea hasta su propio techo | **Aceptado y declarado** (ADR 87 pto 8). Es literalmente el mismo riesgo que `v2.2.0` aceptó como **RD-20/RD-31** del lado saliente, con la misma causa (sin asincronía real no hay reanudación, ADR 74 pto 2) y la misma respuesta: la fila **es** la evidencia de "se aceptó y no volvió". El drenaje con techo acota la ventana, no la elimina |
| **RD-40** | **`CancelTask` no interrumpe el cómputo**: el turno cancelado gasta la invocación al modelo igual, y su texto se descarta | Declarado en el ADR 92 pto 4 y ahora con mecanismo exacto (ADR 94 pto 5-6) y evento propio (`a2a-turno-entrante-descartado`). Mitigación parcial real: si la cancelación llega **antes** de que el turno arranque, el paso 1 de `ejecutarTurno` lo corta **sin gastar nada**. Cancelación real = change de motor de ejecución (ADR 74 pto 1) |
| **RD-41** | **El tope de 4 es global al proceso y no distingue llamadores**: con un token compartido, un solo agente externo puede consumirlo entero y dejar afuera a los demás | Aceptado. Acotarlo por llamador exige **identidad por llamador**, que es exactamente el registro de agentes que el ADR 89 pto 5 difirió con condición de disparo escrita. Mientras tanto, `REJECTED` es inmediato, barato y legible — no es una cola que crece ni un cuelgue |
| **RD-42** | **Asimetría declarada**: sólo el Servidor A2A reporta el puerto **efectivo**; `web/server.ts` y `webhooks/server.ts` siguen reportando el configurado (ADR 101 pto 4) | Aceptada, con disparador escrito: el día que uno de esos dos necesite un test con socket real, se les agrega `address()` con este ADR como precedente. Este change **no reabre hitos cerrados por simetría** |
| **RD-43** | **`origen_transporte` detrás de un reverse proxy es la IP del proxy**, no la del llamador | Declarado. **No se lee `X-Forwarded-For`** a propósito: es un header que el llamador controla, y el ADR 89 pto 5 ya fijó que *"una columna poblada con lo que el llamador afirma de sí mismo es peor que una columna vacía, porque parece evidencia"*. La columna dice lo que el transporte observó, ni más ni menos |

---

## 14. Trazabilidad — capability ↔ diseño

> Los `specs/` no existen todavía (§2). La columna izquierda usa las **descripciones textuales de las dos capabilities de la propuesta** y los ***Success Criteria*** como requirements hipotéticos. `sdd-tasks` reconcilia nombres.

| Requirement (propuesta) | Dónde se implementa |
|---|---|
| `servidor-a2a-jsonrpc` · Agent Card en la URL bien conocida, **sin auth** | §6.2 + §6.3 (primera fila de la tabla) + **ADR 96** + §10.A |
| `servidor-a2a-jsonrpc` · auth bearer del endpoint JSON-RPC, `401` **antes** de parsear, **sin filas** | §6.3 (`esAutorizado` + orden exhaustivo) + §9 + **§10.B (spy con `toHaveBeenCalledTimes(0)`)** |
| `servidor-a2a-jsonrpc` · ruteo por `method`; un `method` no soportado ⇒ `-32601`, no un `500` | §6.3 (tabla) + **ADR 92 pto 1** + §10.B |
| `servidor-a2a-jsonrpc` · parseo y validación del sobre JSON-RPC 2.0 | §6.3 (5 filas de error) + **ADR 94 pto 7-8** + §10.A |
| `servidor-a2a-jsonrpc` · **la forma exacta del `Task`, parseable por el Cliente A2A del Hito 6** | **ADR 93** + §6.3 (`construirTask`) + §10.A (test estrella) + **§10.D (la única prueba que vale)** |
| `servidor-a2a-jsonrpc` · mapeo de errores JSON-RPC | **ADR 94** + §6.3 + §6.1 (los 7 códigos, 2 con verificación pendiente) |
| `servidor-a2a-jsonrpc` · tope de body | §6.3 (`413` + `destroy` en ese orden) + **ADR 97** + §10.B |
| `servidor-a2a-jsonrpc` · tope de turnos en vuelo ⇒ `REJECTED` | **ADR 99** + §5.2 paso (a) + §10.C + §11 paso 8 |
| `servidor-a2a-jsonrpc` · drenaje al cerrar | §6.3 (`startServer`) + **ADR 97** (`A2A_CLOSE_TIMEOUT_MS`) + §10.C |
| `solicitud-a2a-entrante` · creación del `caso` propio + prompt sintético | §5.1 + §5.2 pasos (b)-(c) + **ADR 95** |
| `solicitud-a2a-entrante` · **`handleTurn` reusado, sin camino de código paralelo** (Escenario 6) | §5.2 paso 3 (firma idéntica a `buildOnSoporte`) + **ADR 91 intacto** + **§11 paso 12 (`git diff --stat`)** |
| `solicitud-a2a-entrante` · ciclo de vida completo de la fila: crear antes de responder, actualizar siempre | §4.1 + §5.2 + §7.2 (**`UPDATE` condicional**) + **ADR 94 pto 5** + §9 |
| `solicitud-a2a-entrante` · **el turno entrante es de sólo lectura** | **ADR 98 (inexpresable por firma)** + **ADR 95 pto 5 párrafo 3 (declarado en el prompt)** + §10.A (assert de imports) |
| *Success Criteria* · `GetTask` inmediato **siempre** encuentra la tarea | §4.1 (el invariante sin `await`) + **ADR 87 pto 5** + §10.C (doble que observa el orden) |
| *Success Criteria* · el ciclo completo funciona contra el Cliente A2A **sin modificarlo** y **sin tocar `DESTINOS_A2A`** | **§10.D** puntos 2-3 + §11 paso 6 |
| *Success Criteria* · `REJECTED` llega al cliente como `reason: "rejected"` sin código nuevo | **ADR 90 pto 5** (verificado en `a2a-contract.ts:99-101`) + §10.D punto 4 |
| *Success Criteria* · Riesgo 2 confirmado **con prueba** | **§10.C (fila de concurrencia)** + §11 paso 11 + `docs/ARC42` actualizado (§7.4) |
| *Success Criteria* · sin token, ningún puerto abierto; `v2.2.0` exacto | **ADR 88 pto 4** + §6.4 + §7.3 + §11 paso 13 |
| *Success Criteria* · ningún test del suite por defecto abre un puerto salvo el de integración, **que corre en CI** | **§10** (regla del change) + §10.D punto 6 |

---

## 15. Preguntas abiertas para el checkpoint humano

> Las decisiones ya cerradas (ADR 86-92) **no se reabren**. Lo que sigue son las palancas y las honestidades que aparecieron **al bajar la propuesta a firmas reales**.

1. **RD-37 — los dos códigos de error A2A, sin verificar en esta fase.** Es la única deuda de verificación de este documento, y es por falta de herramienta (`WebFetch`), no por criterio. **La semántica está cerrada** (ADR 94: qué pasa con una tarea terminal, con una ya cancelada, con una inexistente, y cómo se resuelve la carrera con el turno). Lo que falta son **dos números**, aislados en dos constantes, con la verificación como **tarea 1 de `sdd-apply`** y con fallback escrito. Si preferís que la verificación se haga **antes** del checkpoint, decilo y se corre en una sesión con `WebFetch` — pero no cambia ninguna firma ni ningún test.

2. **ADR 93 / RD-34 — el resultado va SÓLO en `artifacts`.** Es la decisión que hace que el test de integración pruebe el camino principal del cliente y no el fallback. La alternativa (ponerlo también en `status.message`) es más "defensiva" para un tercero raro y estrictamente peor para nuestro propio cliente y para cualquiera que concatene los dos campos. **Si querés la versión defensiva, es una línea** — y una duplicación del texto en cada respuesta `COMPLETED`.

3. **ADR 97 / RD-35 — `MAX_EN_VUELO = 4` y el puerto `8888`.** Los dos son parámetros de tu máquina y tu cuota de API. `4` es un tope de **invocaciones simultáneas al modelo desde afuera**, encima de lo que la TUI, los webhooks y `/soporte` ya pueden estar haciendo. Mismo estatus que los tres números del ADR 73 y el umbral del ADR 83: fijados con criterio, este es el momento de cambiarlos.

4. **ADR 95 pto 4 — el tope del texto entrante es `8_000`, no `4_000`.** Elegí el de `TAREA_DELEGADA_MAX_CHARS` (agente↔agente) sobre el de `MAX_SOPORTE_CONSULTA_CHARS` (cliente final). Si te parece que una solicitud A2A debería tener el techo del soporte, es un número y cambia en un lugar.

5. **ADR 98 — la escritura inexpresable por firma.** Es mi respuesta al **R8** de tu propuesta, y es la pieza de la que depende que el ADR 90 (sin cola) sea **verdadero** y no sólo declarado: `BuildOnA2AEntranteDeps` tiene **exactamente los mismos ocho campos** que `BuildOnSoporteDeps`, ni uno más. Confirmalo, porque implica que **ningún hito futuro puede darle capacidad de escritura a un turno entrante sin tocar esa interfaz** — que es justamente el punto.

6. **ADR 101 — el puerto efectivo, y la asimetría que deja (RD-42).** Es un hallazgo real de esta fase: con el molde copiado tal cual, el `port` del handle sería `0` y el test de integración en puerto efímero **sería imposible**. Lo arreglo **sólo** en el adaptador nuevo. Si preferís uniformar los tres servidores, es un cambio en dos archivos de hitos ya cerrados y hay que decidirlo ahora, no en el review.

7. **§6.3 — el body se lee dentro de `server.ts`, sin un `body.ts` propio.** Es la única desviación menor del molde del adaptador Web, y el motivo es que acá hay **una** ruta con cuerpo contra las cuatro de allá. Lo declaro para que no se lea como un descuido en el review.

8. **§12 — SEIS PRs encadenados**, con `chain_strategy = feature-branch-chain`. `server.ts` no entra en un PR (~930 líneas): se parte en *transporte y protocolo* (PR 4) y *los tres métodos y el ciclo de vida* (PR 5), que son dos preguntas de review distintas. **Confirmá el corte** — o decidí `size:exception` para uno solo, que con ~2 460 líneas no recomiendo.

9. **RD-36 — el gate de secuencia.** Que quede asentado, por **tercera vez consecutiva** en este proyecto, que `sdd-apply` de este change **no arranca** hasta ver `v2.2.0` mergeada en `main` con su tag. Hoy **no se cumple ninguna de las cuatro condiciones**, y a diferencia de los dos hitos anteriores, acá el incumplimiento no significa "arrastrar un merge": significa que **el 100% de lo que este hito reusa no existe en `main`**.

---

**Nota de formato**: la skill `sdd-design` sugiere un tope de 800 palabras. Se sigue deliberadamente el formato de este repo (`hito-1.2`, `hito-1.3`, `tui-canal-empleado`, `hito-2.0`, `hito-2.1`, `hito-2.2`), sustancialmente más extenso: `AGENTS.md` exige que el Spec Author entregue el contrato técnico **completo** del change y que el repositorio muestre el proceso de construcción paso a paso, y el checkpoint humano decide sobre el texto de los ADR. El tope genérico de la skill cede ante la convención explícita del proyecto, igual que en `exploration.md` y `proposal.md`.

**Nota de persistencia**: artifact store `openspec`, por regla de `AGENTS.md` (*"los artefactos del ciclo quedan como archivos en `openspec/`, versionados en git"*) y de `openspec/config.yaml`. El MCP de engram no está conectado en esta sesión; `mem_save` no se pudo intentar. **No es bloqueante**: el artefacto vinculante de este proyecto es este archivo.
