# Propuesta: `consultar_solicitud` — que el solicitante pueda ver el estado y el desenlace de SU solicitud interna desde el chat

**Origen**: **hallazgo H2 de la sesión de pruebas post-v3.12** que hizo el stakeholder sobre el canal conversacional del empleado. Es la primera de **tres** propuestas livianas que se abren juntas para que el checkpoint decida **el corte y el orden ANTES** de invertir en specs/design. Las otras dos: `visibilidad-a2a-entrante-chat` y `consulta-kpi-a2a-chat`. El **H1** del mismo hallazgo (conocimiento en el chat) vive aparte en `conocimiento-chat-empleado` (v3.13) y **esta propuesta no lo toca**.

**Rama prevista**: `hito/v3.14-consulta-solicitud-propia` · **Tag**: `v3.14.0` · **Progreso**: `docs/progreso/v3.14-consulta-solicitud-propia/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`, mismo tratamiento que `chat-web-empleado` o `devolucion-sin-token-dos-personas`. **La numeración `v3.14.0` es propuesta, no fijada**: depende del orden que apruebe el checkpoint (ver *Dependencies*). **La rama se crea DESPUÉS del checkpoint** (AGENTS.md, Convención de ramas).

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo — misma nota que ya dejaron `ergonomia-canal-empleado` y `devolucion-sin-token-dos-personas`. **Toda afirmación de abajo está verificada por `Grep`/`Read` con archivo:línea**, sobre la rama `hito/v3.12-devolucion-sin-token-dos-personas`.

**Techo de numeración reverificado por `Grep` sobre `openspec/changes/**`, `src/**` y `docs/**` en esta fase**: **ADR 233** (`devolucion-sin-token-dos-personas/design.md`, citado en código vivo: `src/adapters/operaciones/index.ts:110`, `src/core/agents/definitions.ts:225,232`) y **RD-111** (`src/core/auth/auth-config.test.ts:130`). No existe ninguna cita de ADR 234-246 ni de RD-112+ en el repo. **Rangos disjuntos a propósito**: `conocimiento-chat-empleado` toma ADR 234-236 / RD-112-113, **esta propuesta abre en ADR 237-239 y RD-114/115**, y las otras dos siguen desde 240. `sdd-spec`/`sdd-design` **deben reverificar** — v3.12 aún no cerró y puede subir el techo. **La colisión histórica ADR 174-187 (RD-94) NO se reabre.**

---

## Intent

Hoy el empleado que crea una solicitud interna **no tiene forma de saber cómo terminó**. Lo único que existe es una lectura parcial y de otro flujo: `cancelar_solicitud_interna` **sin** `solicitudId` lista las solicitudes propias, pero el puerto que la sirve lee **únicamente `estado = 'pendiente_aprobacion_humana'`** — el literal va fijo en el SQL a propósito, para usar `idx_solicitudes_estado` (`src/adapters/memory/repository.ts:2266-2285`). Es decir: en cuanto la solicitud se resuelve, **desaparece de la única vista que el solicitante tiene**, junto con su dictamen.

Eso deja el caso de uso real sin cubrir: *"pedí una excepción hace dos días, ¿me la aprobaron y qué dijeron?"*. El empleado tiene que pedírselo a otra persona o mirar la base — que es exactamente lo que el canal conversacional vino a evitar.

**Por qué ahora**: porque v3.12 acaba de construir el molde exacto para esto con `consultar_venta` (puerto de lectura aparte, gate de propiedad dentro del núcleo, "ajena" distinguible de "no encontrada", sin auditoría). Repetirlo mientras el patrón está fresco cuesta poco; hacerlo dentro de seis meses cuesta redescubrirlo. Y es la **más barata y menos riesgosa de las tres** propuestas que se abren juntas: lee datos **propios** del empleado, sin texto externo y sin salidas a terceros.

---

## Scope

### In Scope

- **Puerto de lectura nuevo `ConsultaSolicitudPropiaPort`** en `src/core/solicitudes/` (molde literal: `src/core/ventas/consulta-venta-contract.ts:49-61`), con `buscarPorId` **sin** filtro de dueño y `listarDeSolicitante` con límite. **Puerto NUEVO, no una ampliación de `SolicitudStorePort`** (ADR 237).
- **Caso de uso puro** `consultarSolicitudPropia` en el núcleo, hermano exacto de `src/core/ventas/consultar-venta-propia.ts`: `no_encontrada` / `no_autorizada` / `detalle` / `listado`. Sin escrituras, sin auditoría.
- **SQL nuevo** en `repository.ts`: `buscarSolicitudPropiaPorId` y `listSolicitudesPropiasDeSolicitante`, con **lista blanca de columnas** (nunca `SELECT *`), orden `created_at DESC`, límite. Lee la tabla `solicitudes_internas` existente — **cero migraciones**.
- **Operación `consultar_solicitud { solicitudId? }`**, **undécima** del contrato: `OPERACIONES_NEGOCIO` pasa de **10 a 11** (`src/core/operaciones/operaciones-contract.ts:71-82`), las tres tablas de `validar-operacion.ts`, el `case` de `ejecutar-operacion.ts` y el campo requerido en `EjecutarOperacionDeps`, más el closure de wiring en `build-on-operaciones-empleado.ts` (molde `:187-193`).
- **Skill nueva** `.claude/skills/consultar-solicitud/SKILL.md` (auto-descubierta, sin registro en código), molde `consultar-venta`.
- **Actualización del conteo donde está escrito**: `README.md:328` (dice **"diez"**), `docs/ARC42_Harness_Empresarial.md:611`, y el doc-comment de `operaciones-contract.ts:9` que **hoy dice "SEIS" y ya estaba obsoleto antes de este change** — se corrige acá porque lo toca igual.
- **Tests** en TDD estricto, incluido el del conteo (`operaciones-contract.test.ts`), y el mecánico de ausencia de columnas sensibles en la proyección.

### Out of Scope

- **Ampliar `listarSolicitudesPendientes` o `SolicitudStorePort`** para que devuelva otros estados. Es la tentación obvia y está **prohibida**: ese puerto sirve caminos de escritura con CAS y su literal de estado es una decisión de índice (ADR 38 / ADR 132). Ver ADR 237.
- **Cambiar `cancelar_solicitud_interna`** en nada: ni su modo listado, ni su confirmación en dos pasos, ni su distinción `no_es_dueno`/`no_encontrada` (ADR 126).
- **Ver solicitudes AJENAS**, aunque el empleado sea administrador. Esta operación es de alcance propio, punto. La vista del validador ya existe y es otra capability.
- **Auditar la lectura.** `consultar_venta` no audita (delta vigente de `herramienta-operaciones-negocio:47-49`) y este caso es más benigno todavía: son datos que el propio empleado escribió.
- **Migraciones, columnas nuevas, backfill.** La próxima migración libre sigue siendo `0015` y este change no la usa.
- **Tocar prompts o `INSTRUCCION_OPERACIONES_EMPLEADO`.** Están duplicados a propósito y pineados por tests; la `description` de la skill es lo que dispara la selección.

---

## Capabilities

> El repo no tiene `openspec/specs/` poblado: cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. **Catálogo verificado por `Glob` en esta fase: 79 archivos.** `sdd-spec` **debe reverificar** — el conteo cambió en cada change de esta serie.

### New Capabilities

- **`consulta-solicitud-empleado`** — molde literal: `devolucion-sin-token-dos-personas/specs/consulta-venta-empleado/spec.md`. Alcance propio, proyección explícita, "ajena" vs "no encontrada", cero auditoría.

### Modified Capabilities

- **`herramienta-operaciones-negocio`** — **versión vigente: `devolucion-sin-token-dos-personas/specs/herramienta-operaciones-negocio/spec.md`** (que dice "diez"). Delta con bloque `Previously`, mismo formato que esa versión ya usa (`:9-11`, `:19`, `:51`): Purpose diez → **once**, el requirement de enumeración de schemas, y el de auditoría (agregar `consultar_solicitud` a las de sólo lectura que **no** escriben fila).
- **`solicitud-interna-hitl`** — **delta sólo si** algún requirement vigente afirma que *la única lectura del solicitante son las pendientes*. **A verificar leyendo, no asumir**: si está redactado sobre la cancelación y no sobre la visibilidad, no hay delta y no hay que forzar uno.

---

## Approach

Copia deliberada del camino que v3.12 ya recorrió para `consultar_venta`, en **dos slices** (ver *Estimación*):

1. **Slice 1 — lectura**: contrato + puerto + caso de uso puro + SQL + sus tests. No se ve desde afuera; no cambia el contrato de la herramienta ni el conteo. Es un PR autocontenido y verificable.
2. **Slice 2 — superficie**: operación 11 + validación + dispatcher + wiring + skill + docs/README/arc42. Es el PR que "enciende" la función.

El corte no es por tamaño: **el slice 1 no cambia nada observable**, así que se puede mergear sin decidir todavía la proyección final.

---

## ADRs a abrir (237-239)

### ADR 237: Puerto de lectura NUEVO, no ampliación de `SolicitudStorePort`

| Alternativa | Tradeoff | Veredicto |
|---|---|---|
| Ampliar `listarSolicitudesPendientes` con parámetro `estado` | Reusa código, **pero** rompe el criterio explícito de ADR 38/132 ("nunca un lector por id sin filtro de estado") y desoptimiza el índice: el comentario en `repository.ts:2284-2285` dice que envolver el literal en `(@x IS NULL OR …)` lo inutiliza — *"lección ya pagada en `listPropuestasCambio`"* | **Rechazada** |
| Reusar `ConsultaSolicitudesPort` (el del A2A entrante) | Existe y lee solicitudes, **pero** no está escopado por identidad y sólo devuelve pendientes | **Rechazada** |
| **Puerto de lectura aparte, sin las escrituras** | Duplica una query. A cambio: los caminos de escritura con CAS quedan intactos, el índice sigue sirviendo, y el precedente ya está aceptado — **ADR 227 pto 3 de v3.12 resolvió exactamente este conflicto frente a ADR 38** | **Elegida** |

### ADR 238: El gate de propiedad vive en el NÚCLEO, y "ajena" es distinguible de "no encontrada"

`buscarPorId` **no** filtra por solicitante; el núcleo compara `solicitanteId` contra el empleado del turno y devuelve `no_autorizada` (molde `consultar-venta-propia.ts:60-62`, ADR 224 pto 4). **Tradeoff a dejar escrito**: distinguir los dos casos revela la *existencia* de un id ajeno. Mitigación: los ids son `randomUUID`, no enumerables — **mismo argumento ya aceptado en v3.12 y, antes, en ADR 126 para `cancelar`**. La alternativa (filtrar en el store y colapsar todo a `no_encontrada`) es más hermética pero le miente al usuario sobre su propio error de tipeo y mueve una regla de dominio al adaptador.

### ADR 239: Proyección explícita `SolicitudPropia`, por lista blanca

Columnas disponibles (`repository.ts:2133-2134`): `id, caso_id, solicitante_id, tipo, detalle, estado, dictamen, dictaminada_at, resuelta_por, resuelta_at, created_at, updated_at`. **No hay token ni secreto en esta tabla**, así que el riesgo es menor que en ventas — pero la forma se mantiene: **interfaz explícita + lista blanca en el SQL + test mecánico de ausencia**, igual que `VENTA_PROPIA_SELECT_COLUMNS`. `solicitanteId` entra sólo para que el gate lo compare dentro del núcleo (el dispatcher no lo lee, test mecánico). **`resueltaPor` y el alcance de `dictamen` quedan ABIERTOS al checkpoint** — ver *Qué necesita el checkpoint* pto 3.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/solicitudes/consulta-solicitud-propia-contract.ts` | **New** | Puerto + `LIMITE_LISTADO_SOLICITUDES_PROPIAS` (ADR 237, 239) |
| `src/core/solicitudes/consultar-solicitud-propia.ts` | **New** | Caso de uso puro + gate (ADR 238) |
| `src/adapters/memory/repository.ts` | Modified | Dos funciones de lectura nuevas, lista blanca de columnas. **`listarSolicitudesPendientes` NO se toca** |
| `src/core/operaciones/operaciones-contract.ts` | Modified | Operación 11 + interfaz + unión. También se corrige el doc "SEIS" de `:9` |
| `src/core/operaciones/validar-operacion.ts` | Modified | Las **tres** tablas: `["operacion","solicitudId"]`, `[]`, `[]` |
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | `case` nuevo + `EjecutarOperacionDeps.consultaSolicitudPropia` requerido. **Cero lógica de alcance acá** |
| `src/adapters/operaciones/index.ts` | Modified | **Sólo** `OPERACIONES_TOOL_DESCRIPTION`: `solicitudId` ya está en el zod plano y `z.enum(OPERACIONES_NEGOCIO)` crece solo |
| `src/build-on-operaciones-empleado.ts` | Modified | Closure inline de wiring (molde `:187-193`) |
| `.claude/skills/consultar-solicitud/SKILL.md` | **New** | Auto-descubierta |
| `README.md:328`, `docs/ARC42…:611` | Modified | Conteo "diez" → "once" |
| Esquema / migraciones | **Sin cambio** | Próxima libre sigue siendo `0015` |
| Auditoría, autorización, `sesion.ts` | **Sin cambio** | Ni fila nueva ni eje de rol nuevo |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★ | **Colisión territorial con las otras dos propuestas y con `conocimiento-chat-empleado`**: las tres editan `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts` y los tests que fijan el conteo; H1 edita `build-on-operaciones-empleado.ts` | **Alta si corren en paralelo** | **Se SERIALIZAN.** Esta es la primera de la serie; las otras dos rebasan encima. Decisión de orden: checkpoint |
| **R2** ★ | **Salir antes de que v3.12 se mergee**: el conteo 10→11 y el `switch` chocan de frente con `consultar_venta`/`solicitar_devolucion` | **Alta si se arranca antes** | **Bloqueante duro**: no se abre rama hasta que `devolucion-sin-token-dos-personas` esté mergeado y tageado `v3.12.0` |
| **R3** | **El dictamen del validador contiene juicio sobre el solicitante** y se le muestra a él mismo | **Media** | Ya se le muestra el dictamen al crear la solicitud (`ejecutar-operacion.ts:186-196`), así que no es un canal nuevo — pero es **decisión del checkpoint** (pto 3), no del implementador |
| **R4** | **Presupuesto de review de 400 líneas** | **Alta** (≈450-520 estimadas) | Dos slices, dos PRs encadenadas. Ver *Estimación* |
| **R5** | **El conteo queda desincronizado** entre código, README, arc42 y specs | **Media** | Lista explícita de sitios en *Affected Areas*; el test de `toHaveLength` es el que falla primero en TDD |

## Rollback Plan

1. **Cero migraciones, cero columnas, cero backfill, cero estado nuevo**: la operación **sólo lee**. No hay rollback de datos posible ni necesario.
2. **Revertir el slice 2** (operación + wiring + skill) devuelve el contrato a diez operaciones y deja el puerto nuevo huérfano pero inerte. El chat pierde la función; nada más se degrada.
3. **Revertir los dos slices** vuelve exactamente a v3.12. Ninguna conversación previa queda rota: el transcripto del SDK es texto.
4. **Si el rollback ocurre después de que salió el change siguiente de la serie**, hay que revertir en orden inverso (el conteo es una sola lista `as const`).

## Dependencies

- **BLOQUEANTE — `devolucion-sin-token-dos-personas` (v3.12) mergeado a `main` y tageado `v3.12.0`.** Hoy está implementado en rama, **sin mergear** (ver R2). Aporta además el molde completo: `consulta-venta-contract.ts`, `consultar-venta-propia.ts`, el wiring y el formato del delta de `herramienta-operaciones-negocio`.
- **Relación con `conocimiento-chat-empleado` (v3.13, change hermano en curso)**: **sin dependencia funcional**, pero **sí territorial** — toca `build-on-operaciones-empleado.ts`, el mismo archivo donde va el closure de wiring de esta propuesta. **Recomendación: H1 primero** (es ≈150 líneas y no cambia la superficie del contrato), y este change rebasa encima.
- **Esta propuesta es la PRIMERA de la serie de tres**: `visibilidad-a2a-entrante-chat` y `consulta-kpi-a2a-chat` dependen de ella (conteo 11 → 12 → 13).
- **Reusa sin modificar**: `solicitudes_internas` y su esquema, `SolicitudStorePort`, `registrarAccion`, el modelo de rol y la sesión.
- **Sin dependencias nuevas en `package.json`.**

## Success Criteria

- [ ] **El solicitante puede consultar por id el estado de una solicitud propia en cualquiera de los cuatro estados** (`pendiente_aprobacion_humana`, `aprobada`, `rechazada`, `cancelada` — `solicitudes-contract.ts:42-46`), y sin id obtiene el listado de las suyas.
- [ ] ★ **Una solicitud AJENA devuelve `no_autorizada`, distinguible de `no_encontrada`**, verificado por test (ADR 238).
- [ ] ★ **Existe un test mecánico que FALLA si el SQL usa `SELECT *`** o si la proyección expone una columna fuera de la lista blanca aprobada (ADR 239).
- [ ] ★ **`git diff` confirma cero cambios en `listarSolicitudesPendientes`/`SolicitudStorePort`** y cero cambios en el camino de cancelación (ADR 237).
- [ ] **`consultar_solicitud` no escribe ninguna fila en `registro_acciones_empleado`**, verificado por test.
- [ ] **`OPERACIONES_NEGOCIO` tiene 11 entradas** y el conteo coincide en `README.md`, arc42, specs y tests — sin ningún "diez" huérfano.
- [ ] **Cero migraciones**, verificado por `git diff` sobre `src/adapters/memory/migrations/`.
- [ ] **Evidencia de verificación manual** en `docs/progreso/v3.14-consulta-solicitud-propia/`: consulta de una solicitud aprobada y de una rechazada, más el intento sobre una ajena.
- [ ] `npm test` + `npm run typecheck` en verde. **TDD estricto**: el rojo inicial es el `toHaveLength(10)` de `operaciones-contract.test.ts`.

---

## Estimación vs presupuesto de review (400 líneas)

| Slice | Contenido | Líneas est. | PR |
|---|---|---|---|
| 1 | Contrato + núcleo + SQL + tests | ≈ 200-230 | PR #1 |
| 2 | Operación 11 + validar + dispatcher + wiring + skill + docs | ≈ 250-290 | PR #2, encadenada sobre #1 |
| | **Total** | **≈ 450-520** | **Supera 400 ⇒ chained PRs** |

**Corte natural recomendado**: el slice 1 **no cambia nada observable** (el puerto queda sin consumidor), así que PR #1 es mergeable sin haber cerrado todavía la decisión de proyección del checkpoint. Mismo patrón de slices que usó v3.12. `sdd-tasks` debe confirmar el forecast.

## Qué necesita el checkpoint

1. ★ **¿Aprobás el corte en TRES changes serializados** (éste, `visibilidad-a2a-entrante-chat`, `consulta-kpi-a2a-chat`) **en vez de uno solo "operaciones de lectura del empleado"?** El argumento: son tres perfiles de riesgo distintos — datos **propios**, datos **de la empresa originados por un tercero**, y **salida hacia un sistema externo**. Juntos, la decisión de seguridad del tercero se firma con el ojo puesto en la del primero.
2. ★ **¿Confirmás el orden?** La recomendación de esta fase: v3.12 mergeado → `conocimiento-chat-empleado` → **éste** → A2A entrante → A2A saliente. Es el único punto que bloquea el arranque.
3. ★ **¿Qué ve el solicitante: `resueltaPor` (el id de quién aprobó/rechazó) y el `dictamen` completo, o sólo estado + fecha?** Recomendación de esta fase: **`dictamen` SÍ** (ya se le muestra al crear la solicitud) y **`resueltaPor` SÍ pero como id, nunca nombre** — es el dato que hace accionable la respuesta ("preguntale a quien lo resolvió"). Si preferís lo contrario, queda escrito como decisión, no como omisión.
4. **¿Confirmás abrir en ADR 237-239 y RD-114/115** (techo reverificado: ADR 233 / RD-111; 234-236 y RD-112/113 son de `conocimiento-chat-empleado`) **y no reabrir** la colisión 174-187?
5. **¿Confirmás `v3.14.0`, el nombre de rama y el de la capability `consulta-solicitud-empleado`?** Depende del pto 2.
