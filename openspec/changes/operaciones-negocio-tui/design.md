# Diseño técnico: `operaciones-negocio-tui` — el texto libre autenticado de la TUI llega a `operacion_negocio`

**Change**: `operaciones-negocio-tui` · **Propuesta**: `openspec/changes/operaciones-negocio-tui/proposal.md` (Enfoque A, D1-D7, invariantes R1 1-8, R1-R9).

**Numeración**: este diseño **abre ADR 297, 298 y 299** y **RD-170 y RD-171**. Techo reverificado por `Grep` sobre `openspec/`, `docs/` y `src/` **en esta fase**: el ADR más alto citado es **296** (`slos-y-dashboard`, también `empaquetado-contenedor/design.md:7`); `permisos-granulares` usa 291-293. La RD más alta es **RD-169** (`slos-y-dashboard`). Por ahora, `ADR 297` sólo aparece en `proposal.md:11` de este change. ★ **`sdd-spec` corre en paralelo y debe citar ESTOS números, no abrir otros.**

> **Nota de proceso**: este ejecutor no tiene shell, así que no pudo correr `graphify query` aunque el hook lo pide. Es la misma nota que dejaron la propuesta y los changes hermanos. Todo `archivo:línea` de abajo lo verifiqué con `Read`/`Grep` **en esta fase** sobre `main` (`4f591f2`).

---

## 0. Hallazgos de esta fase (la propuesta no los podía ver)

| # | Hallazgo | Consecuencia de diseño |
|---|---|---|
| **H1** ★ | Un **import cíclico** está a un paso: `build-on-operaciones-empleado.ts:91` ya importa **en runtime** de `build-on-comando-empleado.ts` (`createSolicitudStore`, `createSolicitudA2AEntranteStore`, `SolicitudTipoEstadoInvalidoError`) | El dispatcher **NO** importa nada de `build-on-operaciones-empleado.ts`, ni siquiera `import type`. El tipo de `onOperaciones` se declara **estructuralmente** (ADR 299) |
| **H2** ★ | Los tipos de los stores (`ConfirmacionOperacionesStore`, `ConversacionEmpleadoStore`) viven en `src/adapters/web/` (`confirmacion-operaciones-store.ts:91-96`, `conversacion-empleado-store.ts:60-65`). Los puertos que devuelven sí son del núcleo: `ConfirmacionOperacionPort` (`core/operaciones/operaciones-contract.ts:334`) y `ConversacionEmpleadoPort` (`core/conversacion/conversacion-contract.ts:11`) | Tipos estructurales locales que referencian **sólo puertos del núcleo**. Cero import nuevo desde `adapters/web`, **cero puerto nuevo en `src/core/`** (ADR 299) |
| **H3** ★★ | **Un `/login` fallido también destruye la sesión vigente**: `manejarLogin` pone `sesion = undefined` en la rama `invalida` (`build-on-comando-empleado.ts:746-748`). La propuesta enumeró tres puntos de limpieza (login, logout, expiración) sin distinguir éxito de fallo | La limpieza del estado de operaciones corre **al ENTRAR** a `manejarLogin`, antes de `resolverLogin`, sin importar si el login sale bien o mal. Es el mismo criterio de ADR 36 que ya aplica a `confirmacionPendiente` (`:729-730`) (ADR 298) |
| **H4** | `onOperacionesEmpleado` se construye en `main.ts:528-544`, **antes** de `onComandoEmpleado` (`:576-589`), así que se referencia sin reordenar nada. El ancla de `main.test.ts:682` es `bloqueEntre(source, "buildOnOperacionesEmpleado({", "\n});")`: usa el **primer** `indexOf`, que hoy cae en `:528` | El cableado nuevo va **dentro del bloque 5c (`:564-589`)**. ★ Está prohibido escribir el literal `buildOnOperacionesEmpleado({` en cualquier comentario nuevo **antes** de `:528`, porque correría el ancla |
| **H5** | `handleTurn` devuelve `agentLabel: agent.id` (`handle-turn.ts:283`), y `construirAgenteEmpleadoOperaciones()` conserva el id de `CONVERSATIONAL_AGENT` (`definitions.ts:255-260`, `:72`). `OperacionesEmpleadoResult` descarta el `agentLabel` (`build-on-operaciones-empleado.ts:137-140`) | Usar la constante `CONVERSATIONAL_AGENT_ID` da la **misma** etiqueta que habría producido `handleTurn` (D7) |
| **H6** | `conversacion-empleado-store.ts:86-89` rota la conversación por inactividad y por tope de turnos (`CONVERSACION_INACTIVIDAD_MS`/`CONVERSACION_MAX_TURNOS`) | La TUI hereda la rotación **sin configurarla**. Es la misma semántica que la web y se declara en el spec |

---

## 1. Enfoque técnico

La **única** rama nueva vive en el paso 3-4 del dispatcher (`build-on-comando-empleado.ts:1411-1415`). Un texto sin `/`, **con sesión vigente** y **con la dependencia de operaciones inyectada**, va a `onOperaciones`. En cualquier otro caso cae en `return onSubmit(texto, onAgentResolved)`, **byte a byte como hoy**. `onOperaciones` es la **misma instancia** que sirve a `POST /operaciones`, y la frontera `mcpServers` la sigue decidiendo `build-on-operaciones-empleado.ts:338`, **sin cambios**.

Sin cambios: `build-on-operaciones-empleado.ts`, `build-on-submit.ts`, `src/core/**`, `startTui`/`App.tsx` y los comandos slash.

---

## 2. ADR 297 — Ruteo protegido por sesión en el dispatcher, activado por UNA dependencia opcional agrupada

**Decisión.**

1. **Una sola** dependencia opcional nueva, `operacionesTui?: OperacionesTuiDeps`, que agrupa `onOperaciones`, `confirmacionStore` y `conversacionStore` (§5).
2. La guarda es `deps.operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)`. Es explícita aunque el paso 1 (`:1395-1404`) ya garantiza "vigente o `undefined`": es **el** punto que exige el check de mutación (invariante 7).
3. La sesión se copia (`const sesionTurno = sesion`) antes de evaluar la guarda y se usa durante todo el turno (D5). `empleadoId` sale **sólo** de esa copia (invariante 5).
4. La rama corre **antes** del paso 5 (log de recepción) y del 6.5 (gate de administrador). El texto libre nunca fue un `comando`, y el gate de rol de operaciones sigue dentro de `ejecutarOperacion` (invariante 8).

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **Una dep agrupada `operacionesTui?`** | Una inyección parcial (handler sin stores) **no se puede representar en el tipo**. El rollback es borrar **una** clave en `main.ts` | ★ **Elegida** |
| Tres deps opcionales sueltas (lo que decía la propuesta) | Admite "`onOperaciones` sin stores": obliga a elegir entre un default runtime (que importa `adapters/web` desde el dispatcher) o un fallback silencioso | Rechazada. **Desvío menor y deliberado respecto de la propuesta**: el observable es el mismo |
| Heurística por intención (D1) | Frágil, y cualquier texto "no reconocido" volvería al camino sin tool | Rechazada por D1 |

**Pseudocódigo (el diff real del paso 3-4):**

```ts
const comando = parsearComando(texto);
if (comando === undefined) {
  const sesionTurno = sesion;                                   // D5: copia
  if (operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)) {
    return manejarTextoLibreAutenticado(texto, sesionTurno as SesionEmpleado, onAgentResolved);
  }
  return onSubmit(texto, onAgentResolved);                     // intacto (test :421)
}
```

```ts
async function manejarTextoLibreAutenticado(texto, sesionTurno, onAgentResolved): Promise<TuiTurnResult> {
  onAgentResolved?.(CONVERSATIONAL_AGENT_ID);                   // D7: sincrónico, antes del await
  claveConversacion ??= newId();                                // ADR 298: perezosa, por login
  const { respuesta } = await operacionesTui.onOperaciones({
    consulta: texto,                                            // intacto, sin trim
    sesion: sesionTurno,
    confirmacion: operacionesTui.confirmacionStore.paraEmpleado(sesionTurno.empleadoId),
    conversacion: operacionesTui.conversacionStore.paraSesion(claveConversacion),
  });
  return { responseText: respuesta, agentLabel: CONVERSATIONAL_AGENT_ID };
}
```

**D7, el mapeo del resultado.** `{casoId, respuesta}` pasa a `{responseText: respuesta, agentLabel: CONVERSATIONAL_AGENT_ID}` (H5). **Sin `try/catch`**: `TurnFailedError`, el fallo de `createCaso` y cualquier rechazo se propagan tal cual, igual que en `onSubmit` (`build-on-submit.ts:89` devuelve la promesa de `handleTurn`). `App.tsx:625-646` ya los muestra como error. No hay timeout (R7), y el `casoId` no se muestra.

---

## 3. ADR 298 — Estado por login: clave de conversación perezosa, store de confirmación separado y limpieza en cuatro puntos

**Decisión.**

1. **Una ranura privada nueva en el closure**, `let claveConversacion: string | undefined`, junto a `sesion`/`confirmacionPendiente` (`:702-703`). El doc-comment del módulo (`:19-24`) pasa de "EXACTAMENTE dos ranuras" a **tres**.
2. **La clave se crea en forma perezosa** con `newId()` en el **primer** texto libre autenticado, **nunca** en `/login`. Así el login no consume ids (cero riesgo sobre las secuencias de `newId` que ya fijan los tests) y ningún login sin operaciones crea entradas. La clave **nunca** es `empleadoId` (D3).
3. **La confirmación se escopea por `empleadoId`** (`paraEmpleado(sesionTurno.empleadoId)`) sobre una **instancia exclusiva de la TUI**, así que no hay cruce web↔TUI (D4, R2). ADR 166 sigue intacto: cada llamada crea un `casoId` nuevo (`build-on-operaciones-empleado.ts:290`), así que `origenCasoId !== casoIdActual` sólo coincide en un turno posterior.
4. **Un helper, `cerrarEstadoOperaciones(empleadoId | undefined)`**, idempotente y no-op si `operacionesTui` falta. Hace `confirmacionStore.limpiarEmpleado(empleadoId)` y después `conversacionStore.eliminar(claveConversacion)` (el mismo orden que el logout web, `server.test.ts:2049`), y deja `claveConversacion = undefined`.

**Sitios de llamada (los cuatro, y ninguno más):**

| # | Dónde | Con qué `empleadoId` | Por qué |
|---|---|---|---|
| L1 | Paso 1, rama expirada (`:1396-1400`) | El `empleadoId` que ya se captura ahí | Invariante 2, R8 (el store no tiene TTL) |
| L2 | `manejarLogout` (`:758-766`), después de capturar `empleadoId` | La sesión saliente | Invariante 3 |
| L3 | `manejarLogin`, **al entrar**, junto a `confirmacionPendiente = undefined` (`:730`) | `sesion?.empleadoId` (la saliente, si hay) | **H3**: un login fallido también mata la sesión. Re-login = conversación nueva (D3) |
| L4 | `manejarLogin`, tras el éxito (`:751`) | El `empleadoId` **nuevo** | Defensivo e idempotente: "un login arranca con la confirmación vacía" queda verdadero **por construcción**, sin depender de que L1-L3 hayan corrido |

`/logout` sin sesión (`:759-761`) **no limpia nada**, y está bien: cuando la sesión terminó, L1-L3 ya limpiaron. **Un comando slash entre los dos turnos de confirmación la conserva** (D4, RD-170).

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **Clave perezosa por login + store TUI propio** | La conversación se corta en el login (R3, declarado) | ★ **Elegida** |
| Clave creada en `/login` | Consume un `newId` en cada login, lo que corre las secuencias de ids en los tests existentes que inyectan `newId` | Rechazada |
| Clave = `empleadoId` | Dos logins del mismo empleado heredarían el hilo, lo que contradice D3 y el criterio de ADR 196 §2.1 | Rechazada |
| Reusar las instancias web (`main.ts:512-513`) | Se podría confirmar en la TUI algo que se inició en la web (R2) | Rechazada |

---

## 4. ADR 299 — Contrato de tipos: estructural, sólo con puertos del núcleo y sin ciclos

**Decisión.** `build-on-comando-empleado.ts` declara y **exporta** `OperacionesTuiDeps` (§5). Sus únicos imports nuevos son `import type { ConfirmacionOperacionPort }` (`./core/operaciones/operaciones-contract.js`), `import type { ConversacionEmpleadoPort }` (`./core/conversacion/conversacion-contract.js`) y `CONVERSATIONAL_AGENT_ID` (`./core/agents/definitions.js`, un módulo que el archivo ya importa en `:166`). Los tres van de raíz a núcleo, una dirección permitida.

| Opción | Tradeoff | Veredicto |
|---|---|---|
| **Tipos estructurales locales sobre puertos del núcleo** | Unas 10 líneas de tipo. Si la firma de los stores cambiara, TS lo detecta en `main.ts` | ★ **Elegida** |
| `import type` desde `adapters/web/*` | Es legal (el archivo raíz ya importa adapters, `:194-226`), pero acopla el dispatcher de la TUI al adaptador web | Rechazada |
| Puerto nuevo en `src/core/` | Viola el "sin cambios en `src/core/`" de la propuesta, y `limpiarEmpleado` es a propósito del adaptador (ADR 214 pto 4) | Rechazada |
| `import type` de `OperacionesEmpleadoResult` | Crea un ciclo conceptual (H1) | Rechazada |

AGENTS.md sigue intacto: el núcleo no importa adaptadores y ningún adaptador se habla con otro. Los stores reales se unen al dispatcher sólo en `main.ts`.

---

## 5. Interfaces

```ts
export interface OperacionesTuiDeps {
  /** El MISMO handler de `buildOnOperacionesEmpleado` que sirve a `POST /operaciones`. */
  readonly onOperaciones: (input: {
    readonly consulta: string;
    readonly sesion: SesionEmpleado;
    readonly confirmacion: ConfirmacionOperacionPort;
    readonly conversacion: ConversacionEmpleadoPort;
  }) => Promise<{ readonly casoId: string; readonly respuesta: string }>;
  /** Instancia EXCLUSIVA de la TUI (ADR 298), nunca la de la web. */
  readonly confirmacionStore: {
    paraEmpleado(empleadoId: string): ConfirmacionOperacionPort;
    limpiarEmpleado(empleadoId: string): void;
  };
  /** Instancia EXCLUSIVA de la TUI; la clave es por login, nunca `empleadoId`. */
  readonly conversacionStore: {
    paraSesion(clave: string): ConversacionEmpleadoPort;
    eliminar(clave: string): void;
  };
}
// BuildOnComandoEmpleadoDeps gana:  readonly operacionesTui?: OperacionesTuiDeps;
```

---

## 6. Cableado en `main.ts`

Va **dentro del bloque 5c**, justo antes de `const onComandoEmpleado = buildOnComandoEmpleado({` (`:576`). Queda fuera del tramo `:528-544` que lee `main.test.ts:682` y después de todas las anclas `bloqueEntre` de A2A (`:664`, `:671`, `:677`, `:687`).

```ts
// Instancias EXCLUSIVAS de la TUI (operaciones-negocio-tui, ADR 298) — nunca las de la web.
const confirmacionOperacionesStoreTui = crearConfirmacionOperacionesStore();
const conversacionStoreTui = crearConversacionEmpleadoStore();
const onComandoEmpleado = buildOnComandoEmpleado({
  /* …claves actuales, sin cambios… */
  operacionesTui: {
    onOperaciones: onOperacionesEmpleado,
    confirmacionStore: confirmacionOperacionesStoreTui,
    conversacionStore: conversacionStoreTui,
  },
});
```

Los imports `crear*Store` ya existen (`main.ts:125-126`). No hay reordenamiento (H4). **Rollback operativo**: borrar la clave `operacionesTui` (unas 5 líneas).

---

## 7. Secuencias

**Flujo autenticado con confirmación en dos turnos:**

```mermaid
sequenceDiagram
  actor E as Empleado (TUI)
  participant D as buildOnComandoEmpleado
  participant O as onOperacionesEmpleado
  participant C as confirmacionStoreTui
  participant V as conversacionStoreTui
  E->>D: /login ana ****
  D->>C: limpiarEmpleado(prev?) [L3]
  D->>V: eliminar(clave?) [L3]; clave=undefined
  D->>C: limpiarEmpleado("ana") [L4]
  D-->>E: sistema: "Sesión abierta…"
  E->>D: "aprobá la solicitud S1"
  D->>D: paso 1 renueva · parsear=undefined · vigente ✔
  D-->>E: onAgentResolved("agente-conversacional")
  D->>D: clave ??= newId()  (K1)
  D->>O: {consulta, sesion, confirmacion=C.paraEmpleado("ana"), conversacion=V.paraSesion(K1)}
  O->>C: marcarPendiente(origenCasoId=caso1)
  O-->>D: {casoId: caso1, respuesta: eco "¿confirmás?"}
  D-->>E: {responseText: eco, agentLabel: agente-conversacional}
  E->>D: "sí, confirmo"
  D->>O: {…, conversacion=V.paraSesion(K1)}  (casoAnterior=caso1)
  O->>C: estaConfirmada(caso2 ≠ caso1) ✔ → ejecuta → consumir
  O-->>D: {casoId: caso2, respuesta: "aprobada"}
  D-->>E: respuesta
  E->>D: /logout
  D->>C: limpiarEmpleado("ana") [L2]
  D->>V: eliminar(K1); clave=undefined
  D-->>E: sistema: "Sesión cerrada."
```

**Fallback sin sesión (también vale para sesión vencida y después de `/logout`):**

```mermaid
sequenceDiagram
  actor E as Empleado (TUI)
  participant D as buildOnComandoEmpleado
  participant S as onSubmit (knowledge-only)
  participant O as onOperacionesEmpleado
  E->>D: "listá las solicitudes para aprobar"
  alt sesión vencida
    D->>D: paso 1: sesion=undefined; limpiarEmpleado + eliminar [L1]; log sesion-expirada
  end
  D->>D: parsear=undefined · sesionVigente=false
  D->>S: onSubmit(texto, onAgentResolved)  (byte a byte)
  Note over O: NUNCA invocado (invariantes 1-3)
  S-->>D: TuiTurnResult (sin tool operaciones)
  D-->>E: el mismo objeto, sin tocar
```

---

## 8. Archivos

| Archivo | Acción | Detalle |
|---|---|---|
| `src/build-on-comando-empleado.ts` | Modificar | `OperacionesTuiDeps` + dep opcional, ranura `claveConversacion`, rama del paso 3-4, `manejarTextoLibreAutenticado`, `cerrarEstadoOperaciones` en L1-L4, doc-comment del módulo (tres ranuras). Unas **+70-90** líneas |
| `src/main.ts` | Modificar | Dos stores de la TUI y la clave `operacionesTui` (§6). Unas **+10** |
| `src/build-on-comando-empleado.test.ts` | Modificar (sólo agregar) | Un `describe` nuevo. Ningún test existente se edita |
| `src/main.test.ts` | Modificar (sólo agregar) | Identidad de instancias (§9) |
| `src/test/integration/operaciones-negocio-tui-flujo.integration.test.ts` | Crear | Flujo de extremo a extremo (§9) |
| `docs/progreso/v3.19-operaciones-negocio-tui/` | Crear | Evidencia manual y el check de mutación |
| `build-on-operaciones-empleado.ts`, `build-on-submit.ts`, `src/core/**`, `src/adapters/**` | **Sin cambio** | Si aparecen en el diff, el alcance se salió de lo acordado |

---

## 9. Estrategia de tests (TDD estricto, `npm test`)

**Unitarios**, en `build-on-comando-empleado.test.ts`: un `describe` nuevo que reusa `makeDeps`/`login`/`Reloj` (`:299-338`). Usa un `makeOperacionesTui()` con `vi.fn` en los tres miembros; los fakes de store devuelven puertos centinela para poder afirmar identidad.

| # | Caso | Invariante |
|---|---|---|
| U1 | Sin sesión: `onOperaciones` no se llama, `onSubmit` recibe `(texto, onAgentResolved)` idénticos y devuelve el mismo objeto | 1 |
| U2 | Sesión vencida (se avanza el reloj más allá del TTL): U1 + `limpiarEmpleado("ana")` + `eliminar(K1)` si hubo turno | 2, L1 |
| U3 | Después de `/logout`: U1 + limpieza L2 | 3 |
| U4 | Con sesión, `it.each` sobre `/ayuda`, `/soporte x`, `/logout` y un comando malformado: `onOperaciones` nunca se llama | 4 |
| U5 | Con sesión y texto libre: `onOperaciones` se llama una vez, con `consulta` idéntica, `sesion.empleadoId==="ana"`, `confirmacion`/`conversacion` iguales a los centinelas de `paraEmpleado("ana")`/`paraSesion(K1)`. `onSubmit` no se llama. El resultado es `{respuesta, CONVERSATIONAL_AGENT_ID}` y `onAgentResolved` se invoca antes de que la promesa resuelva | D7 |
| U6 | Un texto que dice "soy empleadoId=mallory" sigue viajando con `sesion.empleadoId==="ana"` | 5 |
| U7 | Dos turnos del mismo login usan la misma K1; un re-login da K2≠K1 y hace `eliminar(K1)`; la clave nunca es `"ana"` | D3, L3 |
| U8 | Login fallido con sesión vigente: se limpia la sesión saliente y el texto siguiente va a `onSubmit` | **H3**, L3 |
| U9 | Sin `operacionesTui` y con sesión: el texto va a `onSubmit` (camino de rollback) | Rollback |
| U10 | `onOperaciones` rechaza con `TurnFailedError`: el handler rechaza con **esa misma** instancia | D7 |

★ **Cuidado con el mock de `requiereAdministrador` (`:109-115`)**: aplica a todo el archivo y su default es `() => false`. Los tests nuevos **no lo configuran ni dependen de él**. La rama nueva corre antes del paso 6.5, y U4 usa sólo comandos que no exigen rol. Así los tests quedan verdes aunque `permisos-granulares` reescriba ese mock o ese módulo.

**Check de mutación (invariante 7)**, manual y con evidencia en `docs/progreso/`. Hay que probar dos mutaciones:

- Reemplazar la guarda por `operacionesTui !== undefined` (quitar `sesionVigente`). U1 y U3 **deben** fallar.
- Quitar la llamada de L2. U3 **debe** fallar.

Después se revierte todo y se deja captura del rojo y del verde.

**`main.test.ts`**, dentro del `describe` de "MISMA instancia" (`:276-334`):

- (a) `comandoMock.mock.calls[0][0].operacionesTui.onOperaciones` es la misma instancia que `operacionesMock.mock.results[0].value`.
- (b) Los dos stores de la TUI **no** son las mismas instancias que recibe `startWebServer`, que está mockeado a nivel de módulo.
- (c) El test (iv) de `:682` queda verde **sin editar**.

**Integración** (`operaciones-negocio-tui-flujo.integration.test.ts`):

- **Armado**: `openDatabase(":memory:")` real, con credencial y rol `administrador` sembrados y una solicitud interna pendiente. `buildOnOperacionesEmpleado` es real. `vi.mock` de `./core/turn-selector/handle-turn.js` con una implementación que llama al handler registrado de la tool (`mcpServers.operaciones.instance._registeredTools[OPERACIONES_TOOL_NAME].handler`, molde `consulta-kpi-a2a-chat.integration.test.ts:429-440`). `buildOnComandoEmpleado` también es real, con los stores reales.
- **Flujo**: texto sin login ⇒ ni `onSubmit` falso ni la tool. `/login` → texto 1 (la BD no cambia y aparece el eco) → texto 2 (la solicitud queda resuelta en la BD, con auditoría) → `/logout` → texto 3 ⇒ `onSubmit`. Además, una ranura marcada antes del logout **no** confirma después.
- Hay que verificar los campos exactos de la operación contra `validar-operacion.ts` en `sdd-apply`.

---

## 10. Corte en PRs (dos PRs encadenados, si `sdd-tasks` pronostica High)

| PR | Contenido | Estado al mergear | Líneas est. |
|---|---|---|---|
| **#1** | ADR 297-299 en el dispatcher (tipos, rama, ranura, L1-L4, doc-comment) + U1-U10 | **Inerte en producción**: `main.ts` no inyecta la dep, así que el comportamiento queda byte-idéntico | ≈ 300-370 |
| **#2** | Cableado en `main.ts` + tests de `main.test.ts` + integración + evidencia/check de mutación + delta de spec | Activa la función. **Rollback = revertir #2** | ≈ 250-330 |

Difiere del corte de la propuesta, que ponía la limpieza en el slice 2. Los invariantes 2 y 3 dependen de la limpieza, así que el dispatcher tiene que llegar **completo** en una sola PR. Si llegara a producción sin limpieza, el store sin TTL dejaría ranuras colgadas (R8).

---

## 11. Decisiones asumidas (RD) y coordinación

- **RD-170**: se asumen los defaults recomendados del checkpoint. **Ningún aviso cuando la sesión expira** (D2), y **un comando slash entre los dos turnos conserva la confirmación** (D4). Revertir D4 cuesta limpiar en el paso 3-4 cuando `comando !== undefined` (unas 3 líneas y un test).
- **RD-171**: se aceptan y se declaran en el spec dos cosas. Una: los turnos TUI autenticados **ya no escriben** `graphify-out/memory` (D6, ADR 235). Dos: la **asimetría de `consultar_kpi`** (R9). `consultar_kpi` ya es una operación (`src/core/agents/consultas-kpi-catalogo.ts` existe), así que en la TUI el texto libre exige `administrador` y `/consultar-kpi` no. Lo resuelve N7-R13/OQ1 de `permisos-granulares`.
- **`permisos-granulares`**: toca otros tramos del mismo archivo (paso 6.5 `:1435-1445`, `manejarAsignarRol`) y **otro** requirement de `comando-empleado-tui` ("segundo eje de gateo"). Con este change, su gate de `ejecutarOperacion` y el rol `auditor` pasan a aplicarse también a la TUI. Se recomienda mergear **este change primero**: ellos re-anotan líneas (su `tasks.md:276`).
- **`sesiones-web-persistentes`**: su delta sobre `autenticacion-empleado-tui` modifica el párrafo *Fuera de alcance* del Purpose. ★ **Este change NO debe tocar ese Purpose.** Si el spec necesita un requirement de limpieza en logout/expiración, debe agregarse como `ADDED Requirement` para que no choquen al archivar.

## 12. Preguntas abiertas

- [ ] Checkpoint: ratificar RD-170/171 y el número del hito (`v3.19` vs `v3.18.1`).
- [ ] `sdd-spec`: el requirement modificado ("Texto sin prefijo `/`…") debe nombrar la condición completa: dep inyectada **y** sesión vigente.
