# Exploración: operaciones-negocio-tui

Fase `sdd-explore` (Spec Author). Sin código de producción. Store: `openspec`.

## Problema

En la TUI, tras `/login`, el agente conversacional responde "no tengo disponible la herramienta `mcp__operaciones__operacion_negocio`" cuando el empleado pide listar solicitudes internas para aprobar (skill `resolver-solicitud`). El chat web (`POST /operaciones`) no tiene el problema.

## Causa raíz (verificada contra el código)

- **Texto libre en la TUI.** `main.ts` monta `startTui(onComandoEmpleado)`. `buildOnComandoEmpleado` (`src/build-on-comando-empleado.ts`, ~`:1387-1415`) llama `parsearComando(texto)`; si devuelve `undefined`, delega byte a byte a `onSubmit`.
- **`onSubmit` nunca recibe la tool.** Se arma con `buildOnSubmit(caso.id, memory, hooks, agents, undefined, createKnowledge(caso.id))` (`main.ts:~290`). `resolveTurn` devuelve `agente-conversacional`, cuyo `allowedTools` es `[KNOWLEDGE_TOOL, "Skill", CONSULTAS_TOOL]` (`definitions.ts:~158`). `build-on-submit.ts:94` reenvía solo `knowledge.mcpServers`: no hay servidor `operaciones` ni `OPERACIONES_TOOL_QUALIFIED_NAME` en `allowedTools`.
- **Por qué el modelo nombra la tool.** Carga `.claude/skills/resolver-solicitud/SKILL.md` vía la tool `Skill` (permitida). Esa skill menciona la tool, pero no está registrada ni permitida.
- **Camino web (contraste).** `main.ts:~528` arma `buildOnOperacionesEmpleado`: usa `construirAgenteEmpleadoOperaciones()` (agente conversacional + tool operaciones, mismo id), pasa `mcpServers: {...knowledge, ...operaciones}` (`build-on-operaciones-empleado.ts:338`), crea un `casoId` nuevo por turno. Entrada: `{consulta, sesion, confirmacion, conversacion}`; `server.ts` resuelve la sesión desde el bearer token, nunca del body.
- **Sesión de la TUI.** Ranura privada de closure `let sesion` (`:702`). El paso 1 del dispatcher (`:1395-1404`) purga la sesión expirada o renueva la activa *antes* de parsear; en la rama de texto libre `sesion` ya es válida o `undefined`. `confirmacionPendiente` (dominio `propuesta`) es otra ranura, solo para `/aplicar-propuesta` y `/descartar-propuesta`.

## Áreas afectadas

- `src/build-on-comando-empleado.ts`: deps opcionales nuevas, rama de ruteo (~`:1412-1415`), limpieza en login / logout / expiración.
- `src/main.ts`: instanciar stores de la TUI e inyectarlos junto con `onOperacionesEmpleado` (~`:576`).
- `src/build-on-comando-empleado.test.ts`: el test de delegación sin sesión (`:421`) debe seguir verde (deps opcionales + ruta gateada por sesión).
- Sin cambios: `build-on-operaciones-empleado.ts` (se reusa), `src/core/*`, `build-on-submit.ts`, `startTui`.
- `docs/progreso/vX.Y-.../` y un delta de spec del requisito del dispatcher ("texto libre → `onSubmit`").

## Enfoques

- **A. Ruta gateada por login dentro del dispatcher (recomendado).** `buildOnComandoEmpleado` recibe `onOperaciones` (el mismo handler web) + `confirmacionStore` + `conversacionStore`. Si `comando === undefined && sesionVigente(sesion, ahora)` → `onOperaciones({consulta, sesion, confirmacion, conversacion})`; si no → `onSubmit` sin cambios. Pros: la sesión sigue privada (ADR 31), la frontera `mcpServers` la decide una rama que ya tiene la sesión, tests viejos intactos. Contras: dispatcher +60-80 líneas; hilo conversacional distinto del previo al login. Esfuerzo bajo-medio.
- **B. `buildOnSubmit` consciente de la sesión.** Fuerza a sacar la ranura privada del dispatcher, acopla submit con auth, y `onSubmit` usa `caso.id` fijo vs `casoId` por turno de operaciones (rompe semántica ADR 166). Medio-alto.
- **C. Dar siempre el servidor operaciones a la TUI con sesión atada tarde.** Rechazado: un turno sin sesión recibiría la tool; rompe la frontera por turno (ADR 176).
- **D. Unificar la sesión TUI en el `sesionStore` web.** Excesivo; se acopla con `sesiones-web-persistentes`.
- **E. Solo docs ("usá el chat web").** No corrige el bug.

## Decisiones a superficiar (con recomendación)

- **D1 Criterio de ruteo:** todo texto libre (sin `/`) con sesión válida, nada más. Comandos slash intactos, sin heurística por intención.
- **D2 Sin sesión / expirada:** cae a `onSubmit` exactamente como hoy; `operaciones` nunca se registra. Residuo UX: el usuario sin sesión sigue oyendo "no tengo disponible la herramienta" (un hint "iniciá sesión con /login" sería otro change). Aviso al expirar: ninguno (mínimo).
- **D3 Memoria conversacional:** clave por login = `randomUUID` en el closure (nunca `empleadoId`), `conversacionStore.paraSesion(key)` por turno, `eliminar(key)` en logout / expiración / re-login. Instancia NUEVA de `crearConversacionEmpleadoStore()`. Consecuencia: el login es frontera de conversación.
- **D4 Confirmación:** instancia SEPARADA de `crearConfirmacionOperacionesStore()` para la TUI (`paraEmpleado(sesion.empleadoId)` por turno): cero confirmación cruzada web↔TUI. `limpiarEmpleado(empleadoId)` en `/login`, `/logout` y expiración (el store no tiene TTL, solo tope de 8 ranuras). Semántica ADR 166/214 intacta (`origenCasoId !== casoIdActual` funciona porque hay `casoId` nuevo por llamada). No colisiona con `confirmacionPendiente` (dominios y ranuras distintos). Un comando slash entre los dos turnos NO limpia confirmaciones de operaciones (la web tampoco).
- **D5 Concurrencia:** `App.tsx` bloquea input mientras hay turno pendiente (`pendingRef`); un solo turno en vuelo, sin locking. Snapshot de sesión al inicio del turno (igual que web).
- **D6 Feedback:** `knowledgeFeedback` NO se cablea en `buildOnOperacionesEmpleado` (ADR 235); los turnos TUI autenticados dejan de escribir `graphify-out/memory`. Consistente con ADR 235; debe quedar explícito en el spec.
- **D7 Resultado/etiqueta:** mapear `{casoId, respuesta}` a `{responseText: respuesta, agentLabel: CONVERSATIONAL_AGENT_ID}` y llamar `onAgentResolved?.(id)` sincrónicamente antes del await. Propaga `TurnFailedError` como el camino `onSubmit`. Sin timeout de TUI (igual que hoy).

## Seguridad

- La frontera de autorización es `mcpServers` por turno. `onOperaciones` se invoca solo en la rama protegida por `sesionVigente(sesion, ahora)`; `empleadoId` sale de `resolverLogin`, nunca del texto.
- Tests de invariante obligatorios: sin sesión → `onOperaciones` no se llama y `onSubmit` recibe el texto intacto; sesión expirada → igual; tras `/logout` → igual; un comando slash nunca llega a `onOperaciones`. Idealmente check de mutación: quitar el guard `sesionVigente` y ver fallar el test.
- El gate de rol sigue dentro de `ejecutarOperacion`/`rolPort` (ADR 236); auditoría por el `registro` compartido.
- `mcpServers` de `onSubmit` nunca debe incluir `operaciones` (`build-on-submit.test.ts` ya afirma knowledge-only).

## Tests a extender / espejar

- `build-on-comando-empleado.test.ts`: describes nuevos junto a "sin sesión" (`:480`), "/login" (`:517`), "con sesión" (`:568`); reusar `makeDeps(reloj, overrides)` con `onOperaciones` como `vi.fn`.
- `build-on-operaciones-empleado.test.ts`: espejar "decorador de memoria conversacional" (`:1101`) para `registrarTurno` tras éxito.
- Integración en `src/test/integration/`: `buildOnComandoEmpleado` real + stores reales + `handleTurn` falso, flujo `/login` → texto → texto (confirmación de dos turnos) → `/logout`.
- TDD estricto activo (`npm test`, vitest).

## ADR y nombre de hito

- ADR más alto en planeación: **296** (`slos-y-dashboard`); `permisos-granulares` reserva 291-293; `carga-y-capacidad` usa ≤284. Próximo libre: **297+** (re-verificar con Grep en `sdd-spec`). RD llegan al menos a 168 (re-verificar).
- Último tag: `v3.18.0` (`salud-operativa`, PR #32). No hay tags de parche; todo change previo fue minor. El paraguas `operabilidad-produccion` usa "3.17+ por hijo" y `v4.0.0` para el cierre solo-docs.
- Opciones: `v3.19-operaciones-negocio-tui` (consistente con precedente, pero toma un número que otros hijos en cola esperan) vs `v3.18.1` (sin precedente). Decide el checkpoint; se inclina por `v3.19`.

## Tamaño

Producción ~100 líneas (`build-on-comando-empleado.ts` +60-80, `main.ts` +15-20); tests ~250-350; más docs/spec. Con el factor real 3-4x del proyecto: ~450-700 líneas cambiadas; riesgo de presupuesto de 400 líneas: Medio. Corte sugerido si `sdd-tasks` pronostica High: slice 1 = rama de ruteo + unit tests; slice 2 = limpieza en login/logout/expiración + cableado `main.ts` + integración.

## Riesgos

- **R1 (Alto):** si el handler de operaciones se filtra a un turno sin sesión = regresión de seguridad → tests de invariante + check de mutación.
- **R2:** store de confirmación compartido permite confirmar en la TUI algo iniciado en web → instancia separada.
- **R3:** la memoria conversacional se parte en el login (D3).
- **R4:** el usuario sin sesión sigue viendo el mensaje engañoso (D2).
- **R5:** interacción con `sesiones-web-persistentes` y `permisos-granulares` (sin commitear; sus specs tocan auth TUI / dispatcher). Reconciliar en spec.
- **R6:** `knowledgeFeedback` deja de guardarse en turnos TUI autenticados (D6).
- **R7:** sin timeout TUI para el turno de operaciones (igual que hoy).
- **R8:** el store de confirmación no tiene TTL → la limpieza en login/logout/expiración es obligatoria (D4).

## Puntos para el checkpoint

Nombre del hito (`v3.19` vs `v3.18.1`); D2 (aviso al expirar: ninguno); D4 (slash entre turnos no limpia); hint "iniciá sesión" para no autenticados: fuera de alcance (recomendado).

## Listo para propuesta

Sí — Enfoque A con D1-D7.
