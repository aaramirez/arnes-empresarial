# Propuesta: operaciones de negocio desde la TUI — el texto libre autenticado llega a `operacion_negocio`

**Origen**: bug reportado en uso real. Tras `/login` en la TUI, el agente responde *"no tengo disponible la herramienta `mcp__operaciones__operacion_negocio`"* al pedir, p. ej., listar solicitudes internas para aprobar (skill `resolver-solicitud`). El chat web (`POST /operaciones`) no tiene el problema. Exploración completa: `exploration.md` (causa raíz, enfoques A-E, D1-D7, R1-R8).

**Rama prevista**: `hito/v3.19-operaciones-negocio-tui` · **Tag**: `v3.19.0` · **Progreso**: `docs/progreso/v3.19-operaciones-negocio-tui/`. ★ **`v3.19` es RECOMENDACIÓN PENDIENTE del checkpoint** (alternativa `v3.18.1`, ver pto 1 de *Qué necesita el checkpoint*). La rama se crea **después** del checkpoint (AGENTS.md).

**No es un hito del Plan.** Corrección de paridad de canal, carpeta descriptiva.

> **Nota de proceso**: este ejecutor no tiene shell; no pudo correrse `graphify query` pese al hook. Lo afirmado se apoya en `exploration.md` y en `Grep`/`Read` sobre `openspec/` hechos en esta fase.

**Numeración**: ADR más alto en planeación **296** (`slos-y-dashboard`); `permisos-granulares` reserva 291-293. Este change abre en **ADR 297+**. **Reverificar en `sdd-spec`.**

---

## Intent

La TUI y el chat web son dos canales del mismo empleado, pero sólo el web registra la tool de operaciones. Causa raíz verificada:

- `buildOnComandoEmpleado` delega todo texto sin `/` a `onSubmit` (`src/build-on-comando-empleado.ts:~1412-1415`).
- `onSubmit` sale de `buildOnSubmit(...)` (`main.ts:~290`) y sólo reenvía `knowledge.mcpServers` (`build-on-submit.ts:94`). El `agente-conversacional` no tiene `OPERACIONES_TOOL_QUALIFIED_NAME` en `allowedTools` (`definitions.ts:~158`).
- El modelo nombra la tool porque la carga la skill `resolver-solicitud` (vía `Skill`, permitida), pero la tool no está registrada.

**Éxito**: un empleado autenticado en la TUI opera en lenguaje natural igual que en el chat web, **sin que un turno sin sesión reciba jamás la tool**.

---

## Scope

### In Scope

- **Ruteo protegido por login en el dispatcher**: texto sin `/` **con sesión vigente** va a `onOperaciones`, que es el **mismo** handler de `buildOnOperacionesEmpleado`, reusado sin cambios.
- **Tres deps OPCIONALES nuevas** en `buildOnComandoEmpleado`: `onOperaciones`, `confirmacionStore`, `conversacionStore`.
- **Limpieza de estado** en `/login`, `/logout` y expiración (D3, D4).
- **Cableado en `main.ts`**: instancias NUEVAS de los stores para la TUI, junto a `onOperacionesEmpleado` (~`:576`).
- **Tests de invariante de seguridad** (R1) + integración `/login` → texto → texto → `/logout`.
- Delta de spec del requirement *"Texto sin prefijo `/` se delega intacto"*.

### Out of Scope

- **Aviso "iniciá sesión con /login"** para usuarios sin sesión: sería otro change (R4).
- **Unificar la sesión TUI con el `sesionStore` web** (enfoque D) ni nada de `sesiones-web-persistentes`.
- **Timeout del turno TUI** (hoy no existe; sigue sin existir, R7).
- **Cablear `knowledgeFeedback`** en el turno de operaciones (ADR 235; D6).
- Cambios a `build-on-operaciones-empleado.ts`, `build-on-submit.ts`, `src/core/*`, `startTui`, comandos slash.
- **Corregir la asimetría de `consultar_kpi`** entre el comando slash y la operación (N7-R13 de `permisos-granulares`; ver Riesgos).

---

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- **`comando-empleado-tui`** (`tui-canal-empleado/specs/comando-empleado-tui/spec.md:13`): el requirement *"Texto sin prefijo `/` se delega intacto al turno conversacional"* pasa a: **con sesión vigente → turno de operaciones; sin sesión o con sesión vencida → `onSubmit`, byte a byte como hoy**.
- **`herramienta-operaciones-negocio`**: **delta a evaluar**. Si su Purpose/alcance nombra sólo el canal web, agregar la TUI autenticada y D6 (sin feedback).
- **`autenticacion-empleado-tui`**: **delta a evaluar**, sólo si `/logout` y la expiración tienen requirements observables sobre el estado que limpian. ★ `sesiones-web-persistentes` ya tiene un delta sobre esta capability (ver Dependencias).

---

## Approach

**Enfoque A: ruta protegida por login dentro de `buildOnComandoEmpleado`.** Si `comando === undefined && sesionVigente(sesion, ahora)`, se llama `onOperaciones({consulta, sesion, confirmacion, conversacion})`; si no, `onSubmit` sin cambios. La sesión sigue privada en el closure (ADR 31), y la frontera de `mcpServers` la decide la única rama que tiene la sesión.

Descartados: **B** (acopla submit con auth y rompe la semántica de `casoId` por turno, ADR 166), **C** (entrega la tool a turnos sin sesión, rompe ADR 176), **D** (demasiado grande, se cruza con `sesiones-web-persistentes`), **E** (sólo docs, no corrige nada).

### Decisiones del change

| # | Decisión |
|---|---|
| **D1** | Criterio de ruteo: **todo** texto sin `/` con sesión vigente, y sólo eso. Sin heurística por intención; los comandos slash no cambian |
| **D2** | Sin sesión o con sesión vencida → `onSubmit` como hoy; `operaciones` nunca se registra. **Sin aviso al expirar** (pendiente del checkpoint) |
| **D3** | Memoria conversacional: la clave es un `randomUUID` por login (**nunca** `empleadoId`), con instancia NUEVA de `crearConversacionEmpleadoStore()`, `paraSesion(key)` en cada turno y `eliminar(key)` en logout, expiración o re-login. **El login marca el inicio de una conversación nueva** |
| **D4** | Confirmación: instancia SEPARADA de `crearConfirmacionOperacionesStore()`, con cero cruce web↔TUI. `limpiarEmpleado` en `/login`, `/logout` y expiración (el store no tiene TTL). No choca con `confirmacionPendiente`. **Un comando slash entre los dos turnos NO limpia la confirmación** (igual que la web; pendiente del checkpoint) |
| **D5** | Un solo turno en vuelo (`App.tsx`/`pendingRef`), sin locking. La sesión se copia al inicio del turno |
| **D6** | Los turnos TUI autenticados **dejan de escribir `graphify-out/memory`** (ADR 235). Debe quedar explícito en el spec |
| **D7** | `{casoId, respuesta}` → `{responseText, agentLabel: CONVERSATIONAL_AGENT_ID}`. `onAgentResolved?.(id)` se llama antes del `await`. `TurnFailedError` se propaga como en `onSubmit`. Sin timeout TUI |

### Invariantes de seguridad (R1, no negociables)

1. Sin sesión → `onOperaciones` **no se llama** y `onSubmit` recibe el texto intacto.
2. Con sesión vencida → igual que (1).
3. Tras `/logout` → igual que (1).
4. Un comando slash **nunca** llega a `onOperaciones`.
5. `empleadoId` sale de `resolverLogin`, **nunca** del texto.
6. `mcpServers` de `onSubmit` **nunca** incluye `operaciones` (`build-on-submit.test.ts` ya lo afirma).
7. **Check de mutación**: si se quita el guard `sesionVigente`, algún test DEBE fallar.
8. El gate de rol sigue dentro de `ejecutarOperacion`/`rolPort` (ADR 236); no se reimplementa en el dispatcher.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/build-on-comando-empleado.ts` | Modified | 3 deps opcionales, rama de ruteo (~`:1412-1415`), limpieza en login/logout/expiración. +60-80 líneas |
| `src/main.ts` | Modified | Stores TUI + inyectar `onOperacionesEmpleado` (~`:576`). ★ **Fuera** del tramo `buildOnOperacionesEmpleado({` → `\n});` que lee `main.test.ts:682` |
| `src/build-on-comando-empleado.test.ts` | Modified | Describes nuevos; el test de delegación sin sesión (`:421`) sigue verde **sin editar** |
| `src/test/integration/` | New | Flujo con stores reales + `handleTurn` falso |
| `build-on-operaciones-empleado.ts`, `build-on-submit.ts`, `src/core/*`, `startTui` | **Sin cambio** | **Si aparecen en el diff, el alcance se salió de lo acordado** |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★★ | El handler de operaciones se filtra a un turno sin sesión | Baja, impacto alto | Invariantes 1-8 + check de mutación |
| R2 | Confirmar en la TUI algo iniciado en la web | Baja | Store separado (D4) |
| R3 | La conversación se corta en el login | Cierta | Documentado (D3) |
| R4 | El usuario sin sesión sigue viendo el mensaje engañoso | Cierta | Fuera de alcance; change aparte |
| R5 ★ | Choque con `permisos-granulares` y `sesiones-web-persistentes` (sin commitear) | Media | Ver Dependencias |
| R6 | Se pierde `knowledgeFeedback` en turnos autenticados | Cierta | Explícito en el spec (D6) |
| R7 | Sin timeout TUI | Igual que hoy | Fuera de alcance |
| R8 | El store de confirmación no tiene TTL | Media | La limpieza es obligatoria y tiene tests (D4) |
| R9 ★ | La asimetría de `consultar_kpi` queda **dentro de la TUI**: el texto libre exige `administrador`, `/consultar-kpi` no exige rol | Cierta si `consultar_kpi` ya es operación | Declararlo; no corregirlo (N7-R13 lo manda al checkpoint de `permisos-granulares`) |

## Rollback Plan

1. **Las tres deps nuevas son opcionales.** Si faltan, el dispatcher delega a `onSubmit` **byte a byte como hoy**. **El rollback operativo es no inyectarlas en `main.ts`**, un cambio de pocas líneas.
2. `git revert` de los slices en orden inverso. Cero migraciones, cero variables de entorno y cero dependencias npm ⇒ nada que deshacer en la base.
3. El test existente `:421` (delegación sin sesión) prueba que el camino de rollback nunca dejó de funcionar.

## Dependencies

- **`permisos-granulares`** (sin commitear) edita **el mismo archivo**: paso 6.5 (`build-on-comando-empleado.ts:1435-1445`), `manejarAsignarRol` (`:1332-1339`, `:1348`, `:1370`). Son hunks distintos de los nuestros (~`:1412-1415` + handlers de login/logout), pero:
  - Sus tareas fijan líneas base y ya prevén re-anotarlas (`permisos-granulares/tasks.md:110`, `:276`). Si este change se mergea primero, todas corren.
  - Sus criterios exigen *"`build-on-comando-empleado.test.ts` sin editar"* (`tasks.md:176`, `:240`) y *"`git diff` = 0"* en su slice B (`:233`). Eso se mide contra **su** diff, así que no lo rompemos. Aun así, nuestros tests nuevos quedan bajo el `vi.mock` de `requiereAdministrador` (`:109-115`) y **no deben depender de él**.
  - Su gate de operaciones al tope de `ejecutarOperacion` y el rol `auditor` (PG13/PG14) **pasan a aplicarse también a la TUI**. Es coherente, pero los tests de `permisos-granulares` no lo cubren.
- **`sesiones-web-persistentes`** (sin commitear) **no toca la TUI** (`proposal.md:100`) ni este archivo. En `main.ts` edita **sólo `:497`** (fuera de los tramos `bloqueEntre`). Choque probable: **sólo documental**, porque tiene un delta sobre `autenticacion-empleado-tui` (Out of Scope). Si hiciéramos un delta a esa misma capability, habría que combinar ambos al archivar.
- Sin dependencias npm nuevas.

## Success Criteria

- [ ] Con `/login` hecho, pedir "listá las solicitudes para aprobar" ejecuta `operacion_negocio` y la confirmación en dos turnos funciona.
- [ ] Invariantes 1-8 verificados por tests, y el check de mutación falla como se espera.
- [ ] El test `:421` sigue verde **sin editar**.
- [ ] `git diff` no muestra cambios en `build-on-operaciones-empleado.ts`, `build-on-submit.ts` ni `src/core/`.
- [ ] Evidencia manual en `docs/progreso/v3.19-operaciones-negocio-tui/` (número pendiente del checkpoint).
- [ ] `npm test` + `npm run typecheck` en verde, con TDD estricto.

## Estimación vs presupuesto de review (400 líneas)

| Slice | Contenido | Líneas est. |
|---|---|---|
| 1 | Rama de ruteo + deps opcionales + tests unitarios de invariante | ≈ 200-350 |
| 2 | Limpieza en login/logout/expiración + `main.ts` + integración + docs/spec | ≈ 250-350 |
| | **Total** (bruto ~350-450; con el factor real 3-4x del proyecto) | **≈ 450-700** |

**Riesgo de superar las 400 líneas: Medio-Alto.** Con `ask-on-risk`, `sdd-tasks` probablemente pida decidir entre 2 PRs encadenados o `size:exception`.

## Qué necesita el checkpoint

1. **Número del hito**: `v3.19` (recomendado: sigue el precedente, todos los changes previos fueron minor) o `v3.18.1` (no hay tags de parche previos). Si es `v3.19`, confirmar que no le quita el número a otro hijo de `operabilidad-produccion` en cola.
2. **D2**: ¿ningún aviso cuando la sesión expira a mitad de la conversación? (recomendado: ninguno).
3. **D4**: ¿un comando slash entre los dos turnos de confirmación la conserva? (recomendado: sí, igual que la web).
4. **Aviso "iniciá sesión" para quien no tiene sesión**: ¿confirmás dejarlo fuera de alcance?
5. **Orden de merge frente a `permisos-granulares`**: recomendado **este primero** (más chico, corrige un bug visible). `permisos-granulares` re-anota sus líneas según su tarea `:276`.
6. **R9**: ¿aceptás que la asimetría de `consultar_kpi` quede visible dentro de la TUI hasta que la resuelva `permisos-granulares` (OQ1)?
