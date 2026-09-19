# Diseño técnico: Devolución sin token, iniciada por el vendedor y cerrada por un administrador distinto

**Change**: `devolucion-sin-token-dos-personas` · **Propuesta**: `openspec/changes/devolucion-sin-token-dos-personas/proposal.md` (revisión 2 — ADR 223-226, R1-R13, RD-106 a RD-111).

**Numeración verificada en esta fase** (`Grep`/`Read` sobre `openspec/`, `src/`, `docs/`): la propuesta cerró en **ADR 226** y **RD-111**, y su riesgo más alto es **R13** (R12 es herencia de v3.10). Este diseño abre en **ADR 227** y en **R14**. **No abre RD nuevas**: las seis pendientes (**RD-106 a RD-111**) se resuelven acá con mecanismo. ★ **El change hermano `ergonomia-canal-empleado` tiene `ADR 221-222` reservados pero todavía NO tiene `design.md`** (verificado por `Glob`: sólo `proposal.md` + dos specs): si su diseño abre ADRs, tiene que hacerlo **desde el 234**, o el checkpoint reparte. Ver **Open Question 6**.

> **Nota de proceso**: este ejecutor no tiene herramienta de shell (sólo `Read`/`Edit`/`Write`/`Grep`/`Glob`), así que no pudo correrse `graphify query` pese al hook del repo. Misma nota y mismo criterio que `operaciones-negocio-conversacionales`, `autorizacion-empleado`, `aprobacion-conversacional-hitl` y la propia propuesta ya dejaron escritos. **Toda afirmación de abajo está verificada por `Read`/`Grep` con archivo:línea, contra `main` post-v3.10 (merge `4fa003c`).**

---

## 0. Correcciones al encargo — una de ellas BLOQUEANTE

### 0.1 ★ BLOQUEANTE: el retiro de `GET`/`POST /confirmar/:token` **no se diseña**, y no es una omisión

El encargo de esta fase pidió *"retiro de la ruta pública `/confirmar/:token` y su plantilla … la propuesta dice que este mecanismo nuevo hace innecesaria esa superficie sin autenticar"*. **La propuesta dice exactamente lo contrario, cuatro veces**, y el código dice que retirarla rompería el change entero.

**Qué dice la propuesta aprobada** (revisión 2, la que el checkpoint firmó):

| Lugar | Texto verificado |
|---|---|
| Aclaración 2, `proposal.md:50` | *"`GET`/`POST /confirmar/:token` (`server.ts:420-495`), `POST /devolucion` y `POST /ventas` quedan **exactamente como están**, y `render.ts` no se toca"* |
| Out of Scope, `:116` | *"`server.ts`, `render.ts`, la CSP y `/confirmar/:token` **no se tocan**"* |
| Affected Areas, `:289` | `src/adapters/web/server.ts`, `render.ts` ⇒ **Sin cambio** |
| Success Criteria, `:354` | *"**`git diff` VACÍO sobre `src/adapters/web/server.ts` y `src/adapters/web/render.ts`**"* |

**Qué dice el código — y es lo que decide la cuestión.** `/confirmar/:token` **no es la ruta de la devolución**: es la ruta con la que **el cliente confirma o rechaza la venta**.

- `handleConsultaVenta` — `GET /confirmar/:token` → `renderConfirmacionHtml` (`server.ts:420-447`).
- `handleDecisionVenta` — `POST /confirmar/:token` → `onDecisionVenta` → `resolverDecisionVenta` ⇒ venta `pendiente_confirmacion → confirmada | rechazada` (`server.ts:449-495`).
- La devolución del cliente es **otra ruta**: `POST /devolucion` (`server.ts:497`).

★ **Retirarla sería aritméticamente suicida para este change**: `escalarReembolso` es un CAS `WHERE estado = 'confirmada'` (`ventas-contract.ts:138-148`). Sin `/confirmar/:token` **ninguna venta llega jamás a `confirmada`**, así que `solicitar_devolucion` no tendría **ni una sola entrada válida**. El mecanismo nuevo **consume** la confirmación del cliente como precondición; no la reemplaza.

**Decisión de esta fase**: `server.ts`, `render.ts` y la CSP **no entran al diff**, tal como la propuesta lo fijó. **Esto queda como retiro explícito del pedido, no como olvido.** Si el checkpoint efectivamente quiere retirar alguna superficie pública, el candidato que tiene sentido discutir es **`POST /devolucion`** (el camino del cliente con token) — y aun así **no acá**: la propuesta lo dejó fuera con argumento (`:111`, *"el camino del token queda intacto, incluida su auto-aprobación bajo el umbral"*), y hacerlo requiere decidir antes qué pasa con las ventas de `POST /ventas`, que **no tienen vía nueva** (**R5**). **Open Question 1.**

### 0.2 El contrato tiene **OCHO** operaciones hoy — verificado, no asumido

`OPERACIONES_NEGOCIO` enumera ocho (`operaciones-contract.ts:52-61`), la octava es `resolver_reembolso` (`:50`, su propio doc-comment dice *"octava y última"*). Entonces **`solicitar_devolucion` es la NOVENA y `consultar_venta` la DÉCIMA**, y el *Purpose* de `herramienta-operaciones-negocio` pasa de **ocho a diez**, como la propuesta anticipó. ★ **El número de operación no depende del orden de merge de los slices**: el `as const` es una sola lista.

### 0.3 El borde MCP **no necesita ningún campo zod nuevo** — corrección a *Affected Areas*

La propuesta lista `src/adapters/operaciones/index.ts` implícitamente entre lo que cambia. Verificado: el objeto zod plano **ya declara `motivo`** (`index.ts:71`, de `procesar_devolucion`) **y `ventaId`** (`:94`, de `resolver_reembolso`), los dos `.optional()`. Las dos operaciones nuevas usan **exactamente esos dos campos** y `operacion`, que es `z.enum(OPERACIONES_NEGOCIO)` y crece solo. ★ **El único cambio real en ese archivo es `OPERACIONES_TOOL_DESCRIPTION`** (ADR 233). Es una economía sana y hay que decirla, porque un `apply` apurado agregaría campos duplicados.

### 0.4 ★ La sesión deslizante necesita **DOS escritores**, y la propuesta lista uno

`sesionVigente` tiene **seis call sites de producción**, verificados por `Grep`: `sesion-empleado-store.ts:57,65` (HTTP) y `build-on-comando-empleado.ts:817,880,901,1495,1517` (TUI, sobre una **ranura mutable de closure**, `:1495-1500`). Renovar por inactividad exige **escribir** la sesión renovada, y hay dos lugares donde la sesión vive: el `Map` del store HTTP y esa ranura de la TUI.

Consecuencia de alcance: **`src/build-on-comando-empleado.ts` y `src/main.ts` entran al diff** (una línea cada uno) y **no figuran** en *Affected Areas*. Si sólo se renovara el lado HTTP, la capability que la propuesta manda modificar —`autenticacion-empleado-tui`, cuyo nombre dice *tui*— quedaría con el comportamiento viejo. Ver **ADR 231 pto 4** y **R16**.

### 0.5 El tope absoluto es un **segundo campo sellado**, y eso no contradice el Out of Scope

La propuesta dice (`:121`): *"El único campo de sesión que puede cambiar es `expiraEn`, y sólo por el ADR 226"*. Pero el ADR 226 pto 1 pide **dos vencimientos que responden dos preguntas distintas** — inactividad renovable y tope absoluto no renovable — y dos vencimientos no caben en un campo. **Se lee esa frase como lo que protege: ningún campo de IDENTIDAD cambia** (`empleadoId` y su invariante del ADR 37, intactos). El ADR 231 agrega **un** campo de vencimiento y **no toca** `expiraEn` ni su significado. **Open Question 4.**

---

## 1. Qué NO se reabre acá

Fijado por el checkpoint vía ADR 223-226 y consumido como dado: la iniciación **escala siempre** y nunca mira el monto (223 pto 2), el módulo nuevo **no importa ni menciona** `evaluarReembolso`/`aprobarReembolso` (223 pto 3), el cierre lo hace `resolver_reembolso` de v3.10 **sin una línea de diff** (223 pto 4), dos turnos + `motivo` no vacío (223 pto 5), `procesarDevolucion` intacta (223 pto 6), el escopado a venta propia como fuente de la separación de funciones (224), la proyección **sin token** con test mecánico (225 pto 3) y la sesión por inactividad con tope (226).

Este documento **elige mecanismos**; no negocia esos invariantes. Y las dos reglas duras del repo atraviesan todo: `src/core/` nunca importa de `src/adapters/*`, y ningún adaptador importa de otro adaptador (`AGENTS.md`).

---

## 2. Resumen de la arquitectura elegida

Siete decisiones, en una frase cada una:

1. **La exclusión del token vive en el SQL, no en un `map` de JS**: hay una lista de columnas propia, `VENTA_PROPIA_SELECT_COLUMNS`, que es `VENTA_SELECT_COLUMNS` menos `token_confirmacion`, y `getVentaById` **sigue sin exponerse a ningún puerto**. **ADR 227.**
2. ★ **El token entra igual al módulo nuevo — por la puerta de atrás**: `store.escalarReembolso(...)` devuelve `Venta`, que **tiene** `tokenConfirmacion` (`ventas-contract.ts:76`), y ese método **no se puede cambiar** (Out of Scope). Entonces el test mecánico de ausencia **no alcanza con prohibir `evaluarReembolso`/`aprobarReembolso`: tiene que prohibir también `token`**. **Hallazgo de esta fase, ADR 227 pto 5.**
3. **El módulo de iniciación evalúa `motivo` ANTES de leer la venta, y el gate de alcance ANTES del eco** — dos decisiones de orden que cierran dos fugas chicas que v3.10 tiene declaradas (R16). **ADR 228.**
4. **La ranura de confirmación usa dominio propio `"devolucion"` y acción `"solicitar"`**, y el store del adaptador **no cambia ni una línea de código** — es genérico sobre `DominioConfirmacion`. **ADR 229.**
5. **Cero literales de `resultado` nuevos, un literal de `comando` nuevo, y `consultar_venta` NO deja fila de auditoría**. **ADR 230.**
6. ★ **`SESION_TTL_MINUTOS` NO cambia de significado: sigue siendo el tope absoluto.** Lo que se agrega es una variable nueva de inactividad y un campo nuevo de sesión. **Eso hace desaparecer casi toda la R11.** **ADR 231.**
7. **El test de `.env.example` no puede ser un `grep` de `env.NOMBRE`**: hay una familia de variables cuyo nombre se **calcula** (`claveAVariableEntorno`, `a2a/config.ts:99-104`). **ADR 232.**

### 2.1 El mapa de piezas

```
  modelo ──{operacion, ventaId?, motivo?}──► zod plano  [★ SIN CAMPOS NUEVOS, §0.3]
                                             validarOperacion  (whitelist + motivo ≤ 256)
                                                    │
                                                    ▼
      ejecutar-operacion.ts   ← ★ CERO lógica de alcance (ADR 224 pto 4, test mecánico)
          │
          ├─ consultar_venta ──► consultarVentaPropia ──► ConsultaVentaPropiaPort
          │                         (0 escrituras, 0 ranura, 0 fila)   └─► VentaPropia ★ sin token
          │
          └─ solicitar_devolucion
                 ├─ estaConfirmada({dominio:"devolucion", itemId:ventaId, accion:"solicitar"})
                 └─ solicitarDevolucion
                       motivo → alcance → eco → [justificación] → [CAS escalarReembolso]
                                                      0014            ★ nunca evaluarReembolso
                                                                      ★ nunca aprobarReembolso
                                                    ▼
                                      venta `reembolso_pendiente` + caso `pendiente_aprobacion_humana`
                                                    ▼
                          resolver_reembolso (v3.10)  ── DIFF VACÍO, es el control ──► `reembolsada`
```

---

## 3. ADR 227 (RD-108): la proyección `VentaPropia` — el token se excluye **en el SQL**, y el test de ausencia cubre la palabra `token`

**Contexto.** La fila de `ventas` incluye `token_confirmacion` en la lista de columnas que **todos** los lectores usan (`VENTA_SELECT_COLUMNS`, `repository.ts:724-725`), y `rowToVenta` lo mapea a `tokenConfirmacion` (`:737`). `getVentaById` (`:835`) usa esa misma lista. **R1 es el riesgo más alto del change**: si el token llega al dispatcher, el empleado lee el token de su propia venta y ejecuta `procesar_devolucion { token }`, que **auto-aprueba bajo el umbral** (`procesar-devolucion.ts:102-114`) — el control entero evitado, con los tests en verde.

**Decisión**:

1. **Tipo de proyección nuevo `VentaPropia`**, en un contrato nuevo `src/core/ventas/consulta-venta-contract.ts` (molde: `consulta-reembolsos-contract.ts`, que ya es un puerto de lectura aparte). **Sin campo de token, y sin lugar donde ponerlo** — la garantía es estructural, mismo criterio que `AccionEmpleado` (`registro-acciones-contract.ts:63-67`) y que `VentaPublica` (`ventas-contract.ts:93-98`, *"SIN token"*) ya aplican.
2. ★ **La exclusión vive en el SQL, no en un mapeo de JS.** Se agrega a `repository.ts` una constante propia:

   ```ts
   /** ★ `VENTA_SELECT_COLUMNS` MENOS `token_confirmacion`. La exclusión es de SQL: el token
    *  no sale de SQLite, no existe en memoria, no hay refactor que lo "vuelva a incluir sin querer". */
   const VENTA_PROPIA_SELECT_COLUMNS =
     "id, vendedor_id, cliente_id, plan_anterior, plan_nuevo, monto, estado, caso_id, created_at, confirmed_at, expires_at";
   ```
   con `rowToVentaPropia` propia (no reusa `rowToVenta`, que escribe `tokenConfirmacion`).
3. ★ **`getVentaById` NO se reusa y NO se expone** — y es la única parte de este ADR donde me aparto del encargo. Reusarlo cumple la letra del ADR 225 pto 3 (se podría descartar el campo en el closure del adaptador) y **falla su espíritu por dos motivos concretos**: (a) el token **sí** viaja a memoria de proceso y a cualquier log/volcado accidental del objeto; (b) el test mecánico se degrada de *"la consulta SQL no nombra la columna"* —verificable sobre una constante— a *"nadie escribió `.tokenConfirmacion`"*, que es disciplina. **El ADR 225 pto 6 de la propuesta ya había fijado que `getVentaById` sigue sin exponerse a ningún puerto: este punto lo ejecuta, no lo contradice.** `getVentaById` queda vivo, intacto y sin llamadores nuevos.
4. **Un solo lector escopado, dos consumidores** (ADR 225 pto 6): `ConsultaVentaPropiaPort` lo usan **las dos** operaciones. `solicitar_devolucion` resuelve `ventaId → { casoId, vendedorId, estado, monto, clienteId }` con la **misma** proyección. ★ **Consecuencia que ordena el trabajo: el módulo de iniciación no puede ver el token aunque quisiera, porque su único lector no lo trae.**
5. ★ **PERO el token entra igual, y por un camino que no se puede cerrar: `store.escalarReembolso(...)` devuelve `Venta | undefined`** (`ventas-contract.ts:144-148`), y `Venta` **tiene `tokenConfirmacion`** (`:76`). Ese método está **explícitamente fuera de alcance** (`proposal.md:120`), así que su tipo de retorno no se toca. **Mitigación, y es obligatoria**: el módulo nuevo **descarta el valor de retorno salvo para distinguir `undefined`** (`const aplicada = store.escalarReembolso(...); if (aplicada === undefined) …`), nunca lo desestructura, nunca lo devuelve en su `Result`. ★ **Y el test mecánico de ausencia del ADR 223 pto 3 se AMPLÍA: además de `evaluarReembolso` y `aprobarReembolso`, la fuente del módulo nuevo no puede contener la subcadena `token`.** Un test que sólo mirara los dos primeros símbolos **dejaría R1 abierto en el archivo que más importa**.
6. **Campos exactos de `VentaPropia`** (RD-108): `ventaId`, `vendedorId`, `clienteId`, `planAnterior?`, `planNuevo`, `monto`, `estado`, `casoId`, `createdAt`, `confirmedAt?`, `expiresAt?`. `vendedorId` está porque **el gate del ADR 224 vive en el núcleo** y necesita compararlo; el dispatcher **no lo lee** (test mecánico del ADR 224 pto 4, molde `ejecutar-operacion.test.ts:975`). `expiresAt` está porque responde *"el link venció y por eso el cliente no confirmó"*, que es la mitad del hallazgo 3. ★ **Ningún dato personal del cliente más allá de `clienteId`** (ADR 18).
7. **Listado**: `LIMITE_LISTADO_VENTAS_PROPIAS = 20`, constante propia del dominio con el mismo valor que `LIMITE_LISTADO_ESCALACIONES` (`ventas-contract.ts:62`) y `LIMITE_LISTADO_SOLICITUDES` — **es el patrón vigente, una constante por dominio, no un techo nuevo inventado** (ADR 208 pto 5). Orden `created_at DESC`: lo primero que el empleado busca es lo que acaba de registrar. El filtro por estado es del **llamador**: `consultar_venta` lista **todos** los estados (ver la decisión del cliente es el punto), `solicitar_devolucion` lista **sólo `confirmada`** (ADR 223 pto 1).

**Alternativas consideradas**:

| Opción | Costo | Por qué se rechaza |
|---|---|---|
| **Reusar `getVentaById` y descartar el token en el closure** | Cero SQL nuevo | Pto 3: el token viaja a memoria y el test de ausencia pasa a ser disciplina |
| **Filtrar `vendedor_id` en el `WHERE` del lector por id** | Falla cerrada en SQL | ★ Haría **indistinguible** "ajena" de "no existe", y el Success Criterion `:352` exige **distinguirlas**. Además movería el gate del ADR 224 fuera del núcleo, contra el pto 4 de ese ADR |
| **Devolver `Venta` y "que el texto no lo imprima"** | Ninguno | Ya rechazada por el ADR 225, alternativas: *"un dato que llega al dispatcher es un dato que alguien va a imprimir en el próximo refactor"* |

**Consecuencias**: `repository.ts` gana ~35 líneas (una constante, un mapper, dos lectores) y **`getVentaById` no gana ni un llamador**. ★ **Riesgo residual declarado, no resuelto: distinguir "ajena" de "no existe" permite sondear qué `ventaId` existen** — ver **R14**.

---

## 4. ADR 228 (RD-106): el módulo de iniciación, la tabla `0014` y **el orden en que se evalúa todo**

**Contexto.** RD-106 pide la forma de la tabla, el tope del `motivo`, el orden de escritura frente al CAS, y dónde vive el módulo. Y pide **una verificación obligatoria**: que una venta **bajo el umbral** en `reembolso_pendiente` no rompa ninguna lectura existente.

**Esa verificación está hecha, y el resultado es limpio.** `listarReembolsosPendientes(filtro)` filtra sólo por `ventaId`/`limite` (`ventas-contract.ts:157-158`, `FiltroEscalaciones:207-212`) — **sin monto**. `listVentasEnReembolsoPendiente()` no recibe argumentos (`reporte-contract.ts:19`). `agruparReporteMensual` pasa `reembolsosPendientes` **tal cual, sin filtrar** (`reporte.ts:131-139,185`) y `formatearSeccionReembolsos` sólo formatea (`:260-264`). ★ **El único lugar de todo `src/core/ventas/` donde `umbral` participa de una decisión es `evaluarReembolso` (`reembolso.ts:28-29`), que está en el camino de ESCRITURA de `procesarDevolucion` — no en ninguna lectura.** Una venta de $1 en `reembolso_pendiente` se lista, se reporta y se resuelve igual que una de $100.000. **Verificado, no asumido.**

**Decisión**:

1. **Ubicación**: `src/core/ventas/solicitar-devolucion.ts` — junto a `procesar-devolucion.ts`, su hermano de dominio, con la misma regla de imports (*"únicamente los otros módulos de `src/core/ventas/`"*, `procesar-devolucion.ts:20-22`) **más** `../auth/sesion.js` por el ADR 37, igual que `resolver-escalacion-reembolso.ts:22`. **PURA y SÍNCRONA**, molde literal de `procesarDevolucion`: sin `await`, sin lógica de concurrencia propia.
2. ★ **Orden de evaluación, fijado acá para que `sdd-apply` no improvise** — y **dos de los seis pasos están donde están por un motivo de seguridad**:

   | # | Paso | Escribe | Por qué ahí |
   |---|---|---|---|
   | 1 | `ventaId === undefined` ⇒ **listado** de propias `confirmada` | no | ADR 208. Sin listado no hay de dónde sacar el `ventaId` |
   | 2 | ★ `motivo` ausente / `trim()` vacío / `> MOTIVO_MAX_LENGTH` ⇒ `motivo_invalido` | no | ★ **ANTES de leer la venta**: así un `motivo` vacío **no sirve para sondear** qué ventas existen. Cero lecturas, cero escrituras |
   | 3 | `venta = consulta.buscarPorId(ventaId)`; `undefined` ⇒ `no_encontrada` | no | Sin `casoId` que correlacionar ⇒ tampoco fila (ADR 230) |
   | 4 | ★ `venta.vendedorId !== sesion.empleadoId` ⇒ `no_autorizada` | no | ★ **ANTES del eco**, a diferencia de `resolverEscalacionReembolso` (gate tras el `!confirmado`, **R16** de v3.10). Acá no hay ningún motivo para mostrarle monto y cliente de una venta ajena antes de rechazar. **Es una mejora gratis, no un cambio de criterio de aquel ADR** |
   | 5 | `!confirmado` ⇒ `requiere_confirmacion` con la `VentaPropia` completa | no | El eco del ADR 233 sale de acá |
   | 6 | `confirmado` ⇒ **justificación primero**, **CAS después** | sí | ADR 223 pto 5, literal |
3. ★ **No hay verificación de estado propia** (ADR 223 pto 2, literal): el `WHERE estado='confirmada'` del CAS es la guarda. Una venta `pendiente_confirmacion` **pasa el gate, muestra eco y falla en el CAS** ⇒ `no_aplicable`. **Eso no es un agujero: es la decisión.** Lo que lo vuelve usable es que **el eco muestra `estado`** (está en `VentaPropia`), así que el empleado ve *"estado: pendiente_confirmacion"* antes de confirmar. **Instrucción para `sdd-apply`: no agregar un `if (venta.estado !== CONFIRMADA)` "de prolijidad" — divergiría del CAS, que es lo que el ADR 223 pto 2 prohíbe.**
4. **Orden de escritura del paso 6, y qué pasa si el CAS no matchea**: `justificacion.registrar({...})` **primero** (no tiene efecto de negocio), `store.escalarReembolso({ventaId, casoId, ahora})` **después**. Si el CAS devuelve `undefined`, **queda una fila huérfana en `0014`** y el resultado es `no_aplicable`. ★ **La fila huérfana es una FEATURE auditable**: dice *"alguien intentó devolver esta venta y escribió por qué"*, que es exactamente lo que un auditor quiere ver de un intento fallido. **Al revés — CAS primero, justificación después— una escalación podría quedar sin justificación si el `INSERT` lanza, que es precisamente lo que este ADR existe para impedir.** No se compensa con una transacción conjunta: eso exigiría un método nuevo en `VentaStorePort`, prohibido por el Out of Scope.
5. **Tope del `motivo`: `MOTIVO_MAX_LENGTH = 256`**, declarado en el contrato nuevo y chequeado en el núcleo. **Duplica a propósito** el `MAX_STRING_LENGTH = 256` de `validar-operacion.ts:67` — que ya acota **todo** campo string del borde conversacional, `motivo` incluido. **Dos capas, y la duplicación es la política declarada de ese archivo** (*"una whitelist de seguridad no puede depender de una resolución de módulos ajena"*, `:11-16`). Efecto útil: un `motivo` de 300 caracteres **ni siquiera llega al dispatcher** (`validarOperacion` ⇒ `REJECTION_TEXT`, cero escrituras).
6. **Tabla `0014`** — próxima libre **verificada por `Glob`** (existen `0001`-`0013`), molde literal de `0005_registro_acciones_empleado.ts`:

   ```sql
   CREATE TABLE IF NOT EXISTS justificaciones_devolucion (
     id            TEXT PRIMARY KEY,
     venta_id      TEXT NOT NULL REFERENCES ventas(id),
     caso_id       TEXT NOT NULL REFERENCES casos(id),
     solicitante_id TEXT NOT NULL,
     motivo        TEXT NOT NULL,
     solicitada_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_justificaciones_devolucion_venta ON justificaciones_devolucion(venta_id);
   ```
   - ★ **`solicitante_id` SIN FK a `credenciales_empleado`**, con el argumento textual del 0005 (`:11-18`): *"las filas de auditoría tienen que SOBREVIVIR al empleado que las produjo"*. `venta_id`/`caso_id` **sí** llevan FK: esas dos tablas no se podan.
   - **UN solo índice, por `venta_id`**, porque hay **un** patrón de lectura real (la historia de una venta). Criterio literal de 0005 (`:28-32`).
   - ★ **Ningún índice sobre `motivo`, y `motivo` NUNCA es clave de búsqueda** (**R13**). Tampoco `UNIQUE` sobre `venta_id`: una venta puede tener un intento fallido y otro exitoso, y borrar esa historia sería peor que guardarla.
   - **APPEND-ONLY**: sin `UPDATE`, sin `DELETE`. El puerto expone **una** operación, `registrar`.
7. ★ **El `motivo` no sale de esa tabla.** No viaja a `logEvent` (ningún campo de ningún evento del módulo nuevo lo lleva), no viaja a `registrar()` (`AccionEmpleado` **no gana ningún campo**, ADR 27 intacto), no viaja al texto que ve el modelo. **Test dedicado** (**R13**).

**Alternativas consideradas**:

- **Columna `motivo` en `registro_acciones_empleado`**: rechazada por el ADR 27, estructural (`registro-acciones-contract.ts:63-67`). No se reabre.
- **Escribir justificación y CAS en una transacción**: **rechazada por alcance** — exige un método nuevo en `VentaStorePort`, que el Out of Scope prohíbe (`:120`). El pto 4 muestra que el orden elegido **falla del lado correcto** sin esa transacción.
- **Tope de `motivo` mucho mayor (p. ej. 2000)**: rechazada. El borde ya corta en 256 y subirlo acá dejaría dos topes distintos con el más laxo inalcanzable — un número que miente.

---

## 5. ADR 229 (RD-107): dominio propio `"devolucion"`, acción `"solicitar"` — y el store del adaptador **no cambia**

**Contexto.** RD-107 pregunta si la ranura de dos turnos usa dominio propio o reusa `DOMINIO_REEMBOLSO` con una `accion` nueva, y recomienda dominio propio. **La verificación confirma la recomendación y además abarata el precio.**

**Decisión**:

1. **`DOMINIO_DEVOLUCION = "devolucion"`**, tercer miembro de `DominioConfirmacion` (`operaciones-contract.ts:183-186`).
2. ★ **Reusar `"reembolso"` sería un bug de seguridad, no una economía.** Por el **ADR 213**, `dominio` + `itemId` son **la llave** y `accion` es **predicado** (`confirmacion-operaciones-store.ts:54-57,72-86`). Con dominio compartido, una iniciación pendiente sobre `V1` y una aprobación pendiente sobre `V1` **comparten llave**: `marcarPendiente` **sobreescribe** (`:132`). Un administrador que estaba por aprobar `V1` perdería su ranura porque el vendedor pidió iniciar `V1` — **dos operaciones con controles distintos pisándose**. El Success Criterion `:355` exige justamente el test de las dos pendientes conviviendo.
3. **`AccionConfirmable` gana `"solicitar"`** (`:187`). ★ **No es un campo del schema**: `solicitar_devolucion` **no tiene** campo `accion`, y por eso **no entra** en `VALORES_PERMITIDOS_POR_OPERACION` (`validar-operacion.ts:105-109`). El dispatcher construye la llave con `accion: "solicitar"` **literal**, desde el closure. **Instrucción para `sdd-spec`: redactarlo así, o el próximo lector agrega `accion` al schema y le da al modelo un grado de libertad que esta operación no tiene.**
4. ★ **`confirmacion-operaciones-store.ts` no cambia una sola línea de CÓDIGO.** Verificado leyéndolo entero: `llaveInterna` (`:55-57`), `coincideConfirmacionConversacional` (`:72-86`), `marcarPendiente`, `consumir` y `limpiarEmpleado` son **genéricos sobre `DominioConfirmacion`**. Lo que cambia son **dos doc-comments**: el de módulo (*"las TRES operaciones"* ⇒ cuatro, `:2-4`) y el de `llaveInterna` (*"el prefijo `dominio:` es fijo y cerrado (dos valores)"* ⇒ tres, `:54`). ★ **La demostración de no-colisión del ADR 212 pto 3 se sostiene con tres literales igual que con dos**: ninguno contiene `:`, así que el corte en el primer `:` sigue siendo no ambiguo.
5. **`consultar_venta` NO usa ranura**: es de sólo lectura, no consume ni marca nada (ADR 225 pto 2). **Test con un doble de puerto de confirmación que falla si recibe cualquier llamada.**
6. **El techo de 8 ranuras por empleado y su evicción no se tocan** (`CONFIRMACIONES_PENDIENTES_MAX`, `:96`). Con una operación confirmable más, el techo sigue siendo holgado y **rota, nunca rechaza**.

**Consecuencias**: el costo total de RD-107 es **dos literales en `operaciones-contract.ts` y dos comentarios en el adaptador**. `handleLogout` (`server.ts:820-825`) sigue funcionando sin cambios: `limpiarEmpleado` borra el `Map` del empleado entero, dominios nuevos incluidos — **verificado, no asumido** (`:146-148`).

---

## 6. ADR 230 (RD-110): un literal de `comando` nuevo, cero de `resultado`, y `consultar_venta` **sin fila**

**Contexto.** RD-110: ¿`operacion:solicitar_devolucion` o reuso de `RESULTADO_ESCALADA`? ¿`registro-acciones-empleado` necesita delta?

**Decisión**:

1. **Un literal de `comando` nuevo**: `COMANDO_SOLICITAR_DEVOLUCION = "operacion:solicitar_devolucion"`. El criterio está escrito y aplica exactamente: *"`operacion:` **sólo** para operaciones **sin comando de TUI ancestro**"* (`registro-acciones-contract.ts:26-28`). ★ **Esta operación no tiene ancestro: es nueva, nunca existió como comando.** No se reusa `COMANDO_DEVOLUCION` (`"/devolucion"`, `:10`): son **dos vías con dos precios** (ADR 223 pto 6) y un auditor que filtre por `/devolucion` debe seguir viendo **sólo** el camino del token.
2. ★ **Cero literales de `resultado` nuevos.** Los tres que hacen falta **ya existen**: `RESULTADO_ESCALADA` (`:37`, semántica exacta — la venta quedó escalada), `RESULTADO_NO_AUTORIZADO` (`:53`) y `RESULTADO_NO_APLICABLE` (`:44`). El único cambio en ese archivo es **de comentario**, para anotar que `escalada` ya no llega sólo por `/devolucion`.
3. **Qué ramas escriben fila, desde el dispatcher**:

   | Rama del `Result` | ¿Fila? | Literal | Por qué |
   |---|---|---|---|
   | `escalada` | **Sí** | `RESULTADO_ESCALADA`, con `ventaId` + `casoId` | `escalarReembolso` **no** escribe fila (a diferencia de los tres CAS de resolución, `ventas-contract.ts:163-174`) ⇒ no hay duplicación posible. **Verificado** |
   | ★ `no_autorizada` (venta ajena) | **Sí** | `RESULTADO_NO_AUTORIZADO`, con `ventaId` + `casoId` | ★ **Es la fila más valiosa del change**: un empleado intentó iniciar sobre una venta que no es suya |
   | `no_aplicable` (CAS perdido) | **Sí** | `RESULTADO_NO_APLICABLE` | Molde `ejecutar-operacion.ts:295-302` |
   | `motivo_invalido` | **No** | — | No se leyó ninguna venta ⇒ no hay `casoId` que correlacionar (mismo criterio que `no_encontrada` en v3.10) |
   | `no_encontrada` | **No** | — | Ídem |
   | `requiere_confirmacion` / `listado` | **No** | — | Cero escrituras por definición |
4. ★ **`consultar_venta` NO deja fila de auditoría.** Criterio vigente, literal: *"cada operación que **muta estado o divulga datos sensibles**"* (`herramienta-operaciones-negocio/spec.md`). No muta nada, y **lo que divulga son datos propios del actor** — a diferencia de `consultar_reporte_comisiones`, que **sí** deja fila porque divulga comisiones **de todos los vendedores** (**R12**). Es el mismo razonamiento con el que el ADR 218 pto 6 decidió que el listado de escalaciones tampoco la deja. La traza queda en `logEvent`, que es lo correcto para un acceso permitido.
5. **`registro-acciones-empleado` — delta de UNA línea, a verificar leyendo.** Como se acuña **un** literal de `comando` nuevo, cualquier requirement **exhaustivo** sobre el vocabulario de `comando` queda incompleto. **Instrucción para `sdd-spec`: leer `comandos-administracion-empleados/specs/registro-acciones-empleado/spec.md` y, si el requirement enumera literales de forma cerrada, agregar `operacion:solicitar_devolucion`; si está redactado sobre el efecto, no hay delta.** No asumir ninguna de las dos.
6. ★ **`AccionEmpleado` no gana ningún campo, y el `motivo` no pasa por ahí** (ADR 27, **R13**). `git diff` sobre `registro-acciones-contract.ts:63-79` **vacío**.

---

## 7. ADR 231 (RD-111, parte 1): la sesión vence por inactividad **sin que `SESION_TTL_MINUTOS` cambie de significado**

**Contexto.** `expiraEn` se sella una vez, en el login (`sesion.ts:55-60`), y es **absoluto** (`:19-30`, ADR 31 pto 2). El ADR 226 pide inactividad **con tope absoluto**. La lectura inmediata —*"`expiraEn` pasa a ser deslizante y aparece un tope nuevo"*— **cambia el significado de una variable de entorno existente**, que es justamente lo que la propuesta señaló como el costo del change (**R11**, consecuencias del ADR 226).

★ **Hay una forma de conseguir lo mismo sin pagar ese costo, y es la decisión de este diseño.**

**Decisión**:

1. ★ **`expiraEn` conserva su significado EXACTO: tope absoluto sellado en el login, que no se renueva nunca.** El ADR 31 pto 2 **no se enmienda**. Lo que se agrega es **un campo hermano**:

   ```ts
   export interface SesionEmpleado {
     readonly empleadoId: string;         // ★ INTACTO (ADR 37)
     readonly iniciadaEn: string;
     /** Tope ABSOLUTO desde el login. NO se renueva NUNCA. Ausente = sin tope. (ADR 31 pto 2, significado INTACTO) */
     readonly expiraEn?: string;
     /** ★ NUEVO (ADR 231): vencimiento por INACTIVIDAD. Se RENUEVA en cada uso. Ausente = sin vencimiento por inactividad. */
     readonly inactivaEn?: string;
   }
   ```
2. ★ **`sesionVigente` NO cambia de firma** — dos argumentos, como hoy. Gana una comparación: vigente sólo si `ahora < expiraEn` **y** `ahora < inactivaEn`, cada una salteada si su campo está ausente. **Los seis call sites de producción no se tocan** (`sesion-empleado-store.ts:57,65`; `build-on-comando-empleado.ts:817,880,901,1495,1517`). La comparación sigue siendo lexicográfica sobre ISO-8601 de ancho fijo, y el borde exacto (`ahora === X`) sigue siendo **vencida**.
3. **`renovarSesion(sesion, ahora, inactividadMinutos): SesionEmpleado`**, pura, **en `sesion.ts`**, devolviendo `{...sesion, inactivaEn: calcularExpiraEn(ahora, inactividadMinutos)}`. ★ **Reusa `calcularExpiraEn`, que vive en el MISMO archivo**: el invariante testeado *"`sesion.ts` no carga ninguna dependencia"* (`:46-53`) **se conserva sin una sola excepción nueva**.
4. ★ **Dos escritores, y los dos son obligatorios** (§0.4):
   - **HTTP**: la renovación va **adentro de `SesionEmpleadoStore.buscar`** (`sesion-empleado-store.ts:55-58`), que es el **único punto de paso** de toda request autenticada (`server.ts:235`). Sí, es una mutación dentro de un método de lectura, y se declara: **la alternativa —un `renovar(token)` explícito que el handler llama— deja que un endpoint futuro se lo olvide y vuelva silenciosamente al TTL absoluto para esa ruta.** Mismo criterio que el ADR 98 pto 4 del repo: *"un `if` que se borra en un refactor distraído"*. La indistinguibilidad *"vencida = inexistente"* (`:13-16,24`) **se conserva**.
   - **TUI**: la ranura mutable de `build-on-comando-empleado.ts`, en el **paso 1** del turno (`:1495-1500`, la purga que ya existe): si la sesión sigue vigente, `sesion = renovarSesion(sesion, ahora, ...)`. **Una línea.**
   - `crearSesionEmpleadoStore(inactividadMinutos)` recibe el número en la construcción (`main.ts:484`, una línea; `authConfig` ya está disponible desde `:269`).
5. **`resolverLogin` sella los dos** (`login.ts:123`): `expiraEn = calcularExpiraEn(iniciadaEn, ttlMinutos)` **sin cambio**, más `inactivaEn = calcularExpiraEn(iniciadaEn, inactividadMinutos)`. Un parámetro nuevo en su input, propagado por `build-on-login-http.ts:59` y `build-on-comando-empleado.ts:846` (una línea cada uno). ★ **Los requirements de autenticación —`scrypt`, contraseña que no se persiste ni se loguea— no se tocan.**
6. **Config (RD-111)**: `AuthConfig` gana `sesionInactividadMinutos`.

   | Variable | Significado | Default | Antes |
   |---|---|---|---|
   | `SESION_TTL_MINUTOS` | Tope **absoluto** desde el login — **significado sin cambio** | ★ **480** (8 h) | 30 |
   | `SESION_INACTIVIDAD_MINUTOS` | ★ **Nueva.** Vencimiento por inactividad, se renueva con cada uso | **30** | — |

   ★ **Por qué esos números y no otros**: con `inactividad = 30` la **sesión ociosa muere exactamente cuando muere hoy** — la ventana de exposición del caso peligroso **no crece ni un minuto** (respuesta directa a **R8**), y eso es verificable comparando contra el comportamiento vigente. Con `absoluto = 480` el empleado cubre una jornada sin que lo echen en medio de una conversación. **Las dos** conservan `0` = sin expiración, **las dos** conservan el techo `MAX_SESION_TTL_MINUTOS` (`auth-config.ts:27`) y su motivo (`RangeError` de `Date`), y **las dos** conservan la clase de falla **ABORTA** (ADR 17 de Hito 4). `resolveNumeroValidado` se reusa tal cual para la segunda.
7. ★ **Lo que esto hace con R11**: deja de ser *"una variable cambió de significado"* y pasa a ser *"una variable cambió de default"*. **Un operador con `SESION_TTL_MINUTOS=480` puesto a mano sigue teniendo exactamente lo que creía tener.** El bloque *"Previously:"* del delta de spec sigue siendo obligatorio, pero describe **un default y un mecanismo nuevo**, no una redefinición.
8. **`CONVERSACION_INACTIVIDAD_MS` (`web/config.ts:51`) NO se toca y NO se acopla** (ADR 226 pto 4). `git diff` vacío sobre `src/adapters/web/config.ts`. ★ **Y ahora hay dos variables con "inactividad" en el nombre**: el doc-comment de cada una tiene que decir en una línea que la otra existe y qué decide — una la autenticación, la otra la memoria conversacional. Ver **R17**.

**Alternativas consideradas**:

- **`expiraEn` deslizante + `limiteAbsoluto` nuevo**: **rechazada.** Consigue lo mismo y **cambia el significado de `SESION_TTL_MINUTOS`**, que es el costo que el pto 7 evita. Además obliga a explicar por qué el campo que se llama "expira" ya no expira cuando dice.
- **`ultimaActividadEn` + `inactividadMinutos` como tercer argumento de `sesionVigente`**: **rechazada.** Toca los seis call sites y filtra configuración a lugares que hoy sólo saben de relojes.
- **Subir `SESION_TTL_MINUTOS` a 8 h y listo**: ya rechazada por el ADR 226 pto 2.

---

## 8. ADR 232 (RD-111, parte 2): `.env.example` y por qué el barrido **no puede ser un `grep` ingenuo**

**Contexto.** ADR 226 pto 5 pide `.env.example` (no existe hoy) con **test mecánico** que falle si una variable leída en `src/**` no está documentada. RD-111 pide el alcance exacto del barrido.

**El hallazgo que define el ADR.** Un barrido textual por `env\.([A-Z0-9_]+)` encuentra **43 variables** (verificado por `Grep` sobre `src/**` excluyendo tests) y **se pierde una familia entera**: `a2a/config.ts:110,114` lee `env[claveAVariableEntorno(clave, "ENDPOINT")]`, donde el **nombre se calcula en runtime** (`:99-104`): `HARNESS_A2A_ENDPOINT_<CLAVE>` y `HARNESS_A2A_TOKEN_<CLAVE>`, con `<CLAVE>` recorriendo `DESTINOS_A2A`. **Un test que sólo mire literales daría verde con esa familia indocumentada — es decir, mentiría sobre su propia cobertura.**

**Decisión**:

1. **El barrido tiene dos mitades, y las dos son obligatorias**:
   - **Literales**: regex `env\.([A-Z][A-Z0-9_]+)` sobre `src/**/*.ts`, **excluyendo `*.test.ts`**.
   - ★ **Dinámicas, enumeradas por código, no por texto**: `DESTINOS_A2A.flatMap((c) => [claveAVariableEntorno(c, "ENDPOINT"), claveAVariableEntorno(c, "TOKEN")])`. **Se importa la función real** — si mañana cambia el patrón de nombres, el test cambia con ella sin que nadie lo edite.
2. **El test falla en las dos direcciones**: variable leída y no documentada (el caso de **R10**) **y** variable documentada que ya nadie lee (archivo que envejece al revés). La segunda es la que evita que `.env.example` se vuelva un cementerio.
3. **Formato de cada entrada** — cuatro cosas, porque son las cuatro que el operador necesita y hoy sólo viven en doc-comments de los `resolve*Config`:
   ```
   # <qué hace, una frase>
   # Default: <valor> · Inválida: ABORTA | se ignora y usa el default
   NOMBRE_VARIABLE=
   ```
   ★ **Ningún valor real de secreto.** `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `VENTAS_API_TOKEN`, `HARNESS_A2A_ENTRANTE_TOKEN`, `EMAIL_API_KEY` y `GITHUB_WEBHOOK_SECRET` van **vacías**, y el test verifica que el archivo no contiene ningún valor asignado a esas claves.
4. **`.gitignore`**: `.env.example` **se versiona**; `.env` sigue ignorado. Verificar que la regla vigente no sea `.env*` (que lo tragaría) — **si lo es, hay que exceptuarlo explícitamente y decirlo en el commit**.

---

## 9. ADR 233 (RD-109): prompt en **cuatro** superficies, dos skills nuevas, y un choque de nombres

**Contexto.** RD-109 pide la instrucción exacta. Y el ADR 220 de v3.10 ya dejó verificado que *"prompt del agente"* son **cuatro** superficies, no una.

**Decisión**:

1. **Las cuatro superficies, verificadas en esta fase**: `INSTRUCCION_OPERACIONES_EMPLEADO` (`definitions.ts:207`), `buildOperacionesEmpleadoPrompt` (`soporte-prompt.ts:102`, **duplicación intencional declarada**, `:90-93` — **no se refactoriza acá**), `OPERACIONES_TOOL_DESCRIPTION` (`adapters/operaciones/index.ts:110-125`) y `.claude/skills/` (**nueve** hoy, verificado por `Glob`).
2. ★ **Choque de nombres — el riesgo de prompt de este change.** Ya existe `.claude/skills/devolucion-conversacional/SKILL.md`, para `procesar_devolucion { token }`. La skill nueva es **otra devolución**. **Las dos `description` tienen que discriminar por lo que el empleado TIENE, no por lo que quiere**:
   - `devolucion-conversacional`: *"…cuando el empleado **tiene el token de confirmación** de la venta."*
   - `solicitar-devolucion` (nueva): *"…cuando el empleado **no tiene el token** y la venta **la vendió él**."*

   Sin esa discriminación, el modelo elige por parecido semántico y manda a un empleado sin token a la operación que exige token. **Ver R18.**
3. **Texto obligatorio del resultado — el punto que RD-109 marcó como crítico**: la skill y las tres superficies de prompt dicen, con estas palabras o equivalentes, que **la devolución NO está hecha**:

   > *"Cuando la herramienta te confirme que la devolución quedó iniciada, decíselo al empleado **sin prometer plazos**: la venta quedó pendiente de reembolso y **la tiene que aprobar un administrador distinto** — no vos, y no el que la vendió. **No digas que la plata se devolvió**, porque no se devolvió."*
4. **Eco del primer turno (R2c, puerta de una sola dirección)**: la skill instruye a **repetir el eco tal cual, sin resumir ni redondear**. El eco lleva **`ventaId`, `clienteId`, `monto`, `estado` y `planNuevo`** — lo suficiente para que un `ventaId` mal tipeado se detecte **antes** de escribir. ★ **`estado` está a propósito** (§4 pto 3): es cómo el empleado ve que la venta todavía no está confirmada.
5. **Cómo pedir el `motivo` sin sugerirlo**: *"Si el empleado no dijo por qué, **preguntáselo y esperá su respuesta**. **Nunca escribas vos un motivo**, ni lo deduzcas de la conversación, ni pongas un texto de relleno."* ★ **Motivo técnico, no de estilo: el `motivo` es lo único de este flujo que un auditor lee para entender la decisión. Un motivo escrito por el modelo es una justificación falsificada.**
6. **Dos skills nuevas** (`solicitar-devolucion`, `consultar-venta`), molde `cancelar-solicitud/SKILL.md` — la única con flujo de dos pasos probado. `consultar-venta` **no** tiene paso de confirmación.
7. ★ **Nada de esto es una garantía, y la spec tiene que decirlo.** Los requirements se redactan **sobre el efecto verificable** (que el CAS no corra sin confirmación, que el `motivo` vacío no escriba nada); el prompt es refuerzo. **Lección literal de `soporte-prompt.ts`, que la propuesta mandó tener presente.**

---

## 10. Contratos de interfaz

```ts
// src/core/operaciones/operaciones-contract.ts — SIGUE SIN IMPORTS
export const OPERACION_SOLICITAR_DEVOLUCION = "solicitar_devolucion";  // ★ NOVENA
export const OPERACION_CONSULTAR_VENTA = "consultar_venta";            // ★ DÉCIMA

/** `ventaId` ausente ⇒ modo listado de ventas propias `confirmada` (ADR 208). `motivo` OBLIGATORIO
 *  cuando hay `ventaId`, y no vacío — pero es `?` en el TIPO porque el modo listado no lo lleva:
 *  la obligatoriedad es del NÚCLEO, no del schema (ADR 228 pto 2, paso 2). ★ SIN campo `accion`. */
export interface OperacionSolicitarDevolucion {
  readonly operacion: typeof OPERACION_SOLICITAR_DEVOLUCION;
  readonly ventaId?: string;
  readonly motivo?: string;
}

/** Sólo lectura. `ventaId` ausente ⇒ listado de TODAS las ventas propias (cualquier estado). */
export interface OperacionConsultarVenta {
  readonly operacion: typeof OPERACION_CONSULTAR_VENTA;
  readonly ventaId?: string;
}

export const DOMINIO_DEVOLUCION = "devolucion";  // ★ ADR 229
export type DominioConfirmacion =
  typeof DOMINIO_REEMBOLSO | typeof DOMINIO_SOLICITUD | typeof DOMINIO_DEVOLUCION;
/** ★ "solicitar" NO es campo de ningún schema: la pone el dispatcher, literal (ADR 229 pto 3). */
export type AccionConfirmable = "aprobar" | "rechazar" | "reabrir" | "cancelar" | "solicitar";
```

```ts
// src/core/ventas/consulta-venta-contract.ts — NUEVO, sin imports salvo VentaEstado
/** ★ Proyección de una venta propia. NO TIENE —y no puede tener— `tokenConfirmacion`.
 *  La garantía es estructural (no hay campo) Y de SQL (ADR 227 pto 2). */
export interface VentaPropia {
  readonly ventaId: string;
  /** Para el gate del ADR 224, DENTRO del núcleo. El dispatcher no lo lee (test mecánico). */
  readonly vendedorId: string;
  readonly clienteId: string;
  readonly planAnterior?: string;
  readonly planNuevo: string;
  readonly monto: number;
  readonly estado: VentaEstado;
  readonly casoId: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly expiresAt?: string;
}

export const LIMITE_LISTADO_VENTAS_PROPIAS = 20;

export interface ConsultaVentaPropiaPort {
  /** Por id, SIN filtro de vendedor: el gate vive en el núcleo (ADR 224 pto 4) y "ajena" tiene
   *  que ser distinguible de "no existe" (Success Criteria). NUNCA devuelve el token. */
  buscarPorId(ventaId: string): VentaPropia | undefined;
  /** `estados` ausente ⇒ todos. Orden `createdAt` DESC. Default de `limite`: 20. */
  listarDeVendedor(filtro: {
    readonly vendedorId: string;
    readonly estados?: readonly VentaEstado[];
    readonly limite?: number;
  }): readonly VentaPropia[];
}
```

```ts
// src/core/ventas/justificacion-devolucion-contract.ts — NUEVO, sin imports
export const MOTIVO_MAX_LENGTH = 256;  // duplica MAX_STRING_LENGTH de validar-operacion.ts a propósito

/** APPEND-ONLY. Una sola operación: no hay update, no hay delete, no hay búsqueda por `motivo` (R13). */
export interface JustificacionDevolucionPort {
  registrar(input: {
    readonly id: string;
    readonly ventaId: string;
    readonly casoId: string;
    readonly solicitanteId: string;
    readonly motivo: string;
    readonly solicitadaAt: string;
  }): void;
}
```

```ts
// src/core/ventas/solicitar-devolucion.ts — NUEVO. PURO y SÍNCRONO, molde procesar-devolucion.ts
// ★ NO importa reembolso.js. NO menciona evaluarReembolso, aprobarReembolso ni token (ADR 227 pto 5).
export type SolicitarDevolucionResult =
  | { readonly resultado: "listado"; readonly items: readonly VentaPropia[] }
  | { readonly resultado: "motivo_invalido" }
  | { readonly resultado: "no_encontrada"; readonly ventaId: string }
  | { readonly resultado: "no_autorizada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "requiere_confirmacion"; readonly venta: VentaPropia }
  | { readonly resultado: "escalada"; readonly ventaId: string; readonly casoId: string }
  | { readonly resultado: "no_aplicable"; readonly ventaId: string; readonly casoId: string };

export interface SolicitarDevolucionDeps {
  readonly consulta: ConsultaVentaPropiaPort;
  readonly justificacion: JustificacionDevolucionPort;
  /** Se consume SÓLO `escalarReembolso`. ★ El `Venta` que devuelve NO se desestructura (ADR 227 pto 5). */
  readonly store: VentaStorePort;
  readonly newId: () => string;
  readonly now: () => string;
  /** ★ Ningún evento de este módulo lleva `motivo` ni `token` (R13, test dedicado). */
  readonly logEvent: (casoId: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}
```

```ts
// src/core/auth/sesion.ts — un campo, una función, MISMA firma de sesionVigente (ADR 231)
readonly inactivaEn?: string;
export function renovarSesion(s: SesionEmpleado, ahora: string, inactividadMinutos: number): SesionEmpleado;
// src/core/auth/auth-config.ts
readonly sesionInactividadMinutos: number;   // SESION_INACTIVIDAD_MINUTOS, default 30
export const DEFAULT_SESION_TTL_MINUTOS = 480;        // ★ era 30 — significado INTACTO (tope absoluto)
export const DEFAULT_SESION_INACTIVIDAD_MINUTOS = 30; // ★ la sesión ociosa muere igual que hoy
```

**Lo que NO cambia de firma, y es verificable por `git diff`**: `VentaStorePort` **entero** (`escalarReembolso` y `aprobarReembolso` incluidos), `procesarDevolucion`, `resolverEscalacionReembolso`, `resolverSolicitudInterna`, `registrarVenta`, `resolverDecisionVenta`, `crearSolicitudInterna`, las tres funciones puras de reporte, `puedeResolverAjeno`, `RolEmpleadoPort`, `AccionEmpleado`, `RegistroAccionesEmpleadoPort`, `ConfirmacionOperacionPort`, `ConfirmacionOperacionesStore`, `sesionVigente`, `SesionEmpleado.empleadoId`, `getVentaById`, y los contratos de `POST /operaciones`, `POST /login`, `POST /logout`, `POST /ventas`, `POST /devolucion` y `GET|POST /confirmar/:token`.

---

## 11. Archivos — con estimación de líneas para `sdd-tasks`

| Archivo | Acción | Prod | Test | Qué |
|---|---|---|---|---|
| `src/core/ventas/consulta-venta-contract.ts` | **New** | ~45 | ~15 | `VentaPropia`, `ConsultaVentaPropiaPort`, techo de listado |
| `src/core/ventas/consultar-venta-propia.ts` | **New** | ~60 | ~130 | Listado / detalle / gate de alcance. Cero escrituras |
| `src/adapters/memory/repository.ts` | Modified | ~40 | ~70 | `VENTA_PROPIA_SELECT_COLUMNS`, `rowToVentaPropia`, 2 lectores, `insertJustificacionDevolucion`. ★ `getVentaById` **sin llamadores nuevos** |
| `src/core/ventas/justificacion-devolucion-contract.ts` | **New** | ~25 | — | Puerto append-only + `MOTIVO_MAX_LENGTH` |
| `src/adapters/memory/migrations/0014_justificaciones_devolucion.ts` | **New** | ~35 | ~25 | Tabla + índice por `venta_id` + `index.ts` |
| `src/core/ventas/solicitar-devolucion.ts` | **New** | ~95 | ~230 | ★ El módulo del change. 6 pasos, 7 ramas de `Result`, test mecánico de ausencia |
| `src/core/operaciones/operaciones-contract.ts` | Modified | ~35 | ~30 | 2 constantes + 2 interfaces + unión a **10** + `DOMINIO_DEVOLUCION` + `"solicitar"`. Test de "sin imports": **reverificar** |
| `src/core/operaciones/validar-operacion.ts` | Modified | ~12 | ~60 | 2 filas × 3 tablas. ★ **Nada en `VALORES_PERMITIDOS_*`** (no hay campo de enum) |
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | ~130 | ~230 | `ejecutarSolicitarDevolucion` (~75) + `ejecutarConsultarVenta` (~35) + 2 ramas del `switch` + 2 campos de `Deps`. ★ **Cero lógica de alcance**. ★ Territorio compartido (**R7**) |
| `src/build-on-operaciones-empleado.ts` | Modified | ~15 | ~20 | 2 puertos inline, molde `reporteStore` (`:143-147`) |
| `src/adapters/operaciones/index.ts` | Modified | ~8 | ~20 | ★ **Sólo `OPERACIONES_TOOL_DESCRIPTION`** (§0.3) |
| `src/adapters/web/confirmacion-operaciones-store.ts` | Modified | **~0** | ~40 | ★ **Sólo 2 doc-comments** (ADR 229 pto 4) |
| `src/core/commands/registro-acciones-contract.ts` | Modified | ~3 | — | 1 literal de `comando` + comentario. ★ Cero `resultado` nuevos, cero campos |
| `src/core/auth/sesion.ts` | Modified | ~25 | ~70 | `inactivaEn` + `renovarSesion` + comparación. Test de "sin dependencias": **reverificar** |
| `src/core/auth/auth-config.ts` | Modified | ~20 | ~45 | 2ª variable, misma clase de falla y mismo techo |
| `src/core/auth/login.ts` | Modified | ~6 | ~25 | Sella `inactivaEn` además de `expiraEn` |
| `src/adapters/web/sesion-empleado-store.ts` | Modified | ~12 | ~60 | Renovación en `buscar` + parámetro de construcción |
| `src/build-on-comando-empleado.ts` | Modified | ~4 | ~30 | ★ Renovación de la ranura TUI + `inactividadMinutos` al login (§0.4) |
| `src/build-on-login-http.ts`, `src/main.ts` | Modified | ~4 | ~10 | Una línea cada uno |
| `.env.example` | **New** | ~140 | ~70 | 43 literales + la familia A2A dinámica (ADR 232) |
| `.claude/skills/solicitar-devolucion/`, `consultar-venta/` | **New** | ~110 | — | Molde `cancelar-solicitud`. ★ `description` discriminante (**R18**) |
| `definitions.ts`, `soporte-prompt.ts` | Modified | ~10 | ~30 | Duplicación deliberada, no se refactoriza |
| `docs/ARC42_...md`, `README.md`, `docs/progreso/v3.12-.../` | Modified/New | ~170 | — | ★ **ADR 22 ENMENDADO**, invariante correlacionado de v3.10, precondición R5b, TTL como decisión, R12 reconfirmada |
| ★ **`procesar-devolucion.ts`, `resolver-escalacion-reembolso.ts`, el resto de `core/ventas/*`, `ventas-contract.ts`, `autorizacion-resolucion.ts`, `web/server.ts`, `web/render.ts`, `web/config.ts`, `package.json`** | **Sin cambio** | **0** | — | ★ **Si aparecen en el diff, el alcance se filtró — y en los dos primeros eso INVALIDA el mecanismo** |

**Total estimado**: ~+1.000 prod + ~+1.100 test + ~170 docs. **Muy por encima del presupuesto de 400 por PR (R3).**

### 11.1 Corte sugerido en `feature-branch-chain` — **cinco** slices

Respeta el *Approach* de la propuesta (lectura primero, iniciación segunda, demostración tercera, sesión sola). `sdd-tasks` hace el corte fino.

| # | Slice | ~Líneas | Verificación autónoma | Rollback |
|---|---|---|---|---|
| 1 | **`consultar_venta`** + `VentaPropia` + lectores sin token + contrato a **9**→**10** | ~330 | ★ **Rojo inicial #1**: el token no aparece ni en el tipo ni en el texto. Cero escrituras con doble que lanza | Quitar la operación del contrato y su rama. Sin residuo |
| 2 | **`solicitar_devolucion`** + migración `0014` + ranura `"devolucion"` + auditoría | ~420 | ★ **Rojo inicial #2**: monto **muy** bajo el umbral ⇒ `reembolso_pendiente`, **nunca** `reembolsada`. Ausencia mecánica de `evaluarReembolso`/`aprobarReembolso`/`token` | Quitar operación + rama; la tabla **se abandona, no se revierte** |
| 3 | ★ **Composición del cierre por un segundo actor** — casi sin código de producción | ~170 | Vendedor inicia ⇒ **no puede** aprobar (`autoaprobacion_prohibida`); base ⇒ `no_autorizado`; **administrador distinto ⇒ `reembolsada`**; `git diff` **vacío** de `resolver-escalacion-reembolso.ts` | Trivial (son tests) |
| 4 | ★ **Sesión por inactividad + `.env.example`** — **viaja SOLO** (**R3**) | ~380 | Sesión en uso no expira; ociosa expira **igual que hoy**; el tope absoluto la mata igual; `0` sigue siendo opt-out en las dos | Volver a sellar sólo `expiraEn`. Cuesta un login |
| 5 | **Prompt × 4 + dos skills + arc42/README + evidencia manual con DOS cuentas** | ~290 | Success Criteria firmados | Trivial |

★ **El slice 3 conviene que viaje SOLO aunque sea chico**: es **la PR donde se revisa la seguridad del change**, y su valor de review es enteramente *"¿el diff de `src/core/ventas/resolver-escalacion-reembolso.ts` está vacío?"*. Mezclado con código nuevo, esa pregunta se vuelve invisible.
★ **Los slices 1 y 2 no son fusionables ni intercambiables**: la 2 consume `ConsultaVentaPropiaPort` de la 1, y sin listado propio la 2 no tiene entrada usable.

---

## 12. Testing (TDD estricto — `AGENTS.md`: test primero en toda tarea con lógica)

**Los dos rojos iniciales obligatorios, en el orden que la propuesta fijó** — los dos son **inexpresables hoy**:

1. ★ *"`consultar_venta` no devuelve el token"* — falla **de tipo** antes que de aserción (`VentaPropia` no existe todavía), el mejor rojo posible.
2. ★ *"una devolución iniciada sin token sobre un monto muy bajo el umbral NO deja la venta `reembolsada`"*.

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Unit mecánico ★ | **`VENTA_PROPIA_SELECT_COLUMNS` no contiene `token`**, y `VentaPropia` no tiene ningún campo cuyo nombre lo contenga | Aserción sobre la constante y sobre las claves del objeto |
| Unit mecánico ★ | **La fuente de `solicitar-devolucion.ts` no contiene** `evaluarReembolso`, `aprobarReembolso` **ni `token`** (ADR 227 pto 5). Molde ADR 98 pto 3 / `ejecutar-operacion.test.ts:975` | Aserción sobre la fuente como string |
| Unit mecánico ★ | **El texto devuelto por las dos operaciones no contiene el `token_confirmacion` de la venta bajo prueba** — con un token de fixture largo y reconocible | Fixture con token conocido |
| Unit mecánico | **`ejecutar-operacion.ts` no compara `vendedorId` con `empleadoId`** ni reimplementa el alcance (ADR 224 pto 4) | Aserción sobre la fuente |
| Unit ★ | **Monto muy bajo el umbral ⇒ `escalada`**, venta `reembolso_pendiente`, caso `pendiente_aprobacion_humana`. **`aprobarReembolso` nunca invocado** | Doble de `VentaStorePort` que **lanza** si recibe `aprobarReembolso` |
| Unit ★ | **`motivo` ausente / `"   "` / 257 chars ⇒ `motivo_invalido` con CERO lecturas y CERO escrituras** | Dobles que lanzan ante cualquier llamada |
| Unit ★ | **Venta ajena ⇒ `no_autorizada`, distinguible de `no_encontrada`**, cero escrituras, en **las dos** operaciones | |
| Unit ★ | **Orden de escritura**: si `escalarReembolso` devuelve `undefined`, la **justificación ya está escrita** (fila huérfana) y el resultado es `no_aplicable` | Doble que devuelve `undefined` |
| Unit | **`consultar_venta` con cero escrituras**, verificado con un doble de store **y** de confirmación que fallan ante cualquier llamada (ADR 225 pto 2, ADR 229 pto 5) | |
| Unit ★ | **El `motivo` no aparece en NINGÚN evento de `logEvent` ni en ninguna fila de `registro_acciones_empleado`** (**R13**) | `logEvent` espía que acumula todos los `fields` |
| Unit | **Ranura**: una iniciación pendiente sobre `V1` y una aprobación pendiente sobre `V1` **conviven** y cada una exige su propia confirmación (**RD-107**) | Store real, sin dobles |
| Unit | **Sesión**: en uso no expira; ociosa expira a los 30 **igual que hoy**; el tope absoluto la mata aunque se la use; `0` = sin expiración en **las dos**; `renovarSesion` no muta el objeto original | Función pura + reloj inyectado |
| Unit | **`sesion.ts` sigue sin cargar dependencias** y **`operaciones-contract.ts` sigue sin imports** — los dos tests estructurales vigentes, **reverificados** | |
| Unit | **`.env.example`**: toda variable leída en `src/**` (literal **y** dinámica) está documentada; toda documentada se lee; ningún secreto con valor | Importa `claveAVariableEntorno` y `DESTINOS_A2A` |
| Integración ★ | **Separación de funciones, dos sesiones en el MISMO test**: E1 registra la venta ⇒ inicia la devolución ⇒ **E1 no puede aprobar** (`autoaprobacion_prohibida`); **E2 base tampoco** (`no_autorizado`); **E3 administrador sí** ⇒ `reembolsada`. **Los cuatro, o el control no está probado** | SQLite en memoria |
| Integración ★ | **Colisión de identificadores (R6)**: `vendedorId` externo igual a un `empleadoId` real ⇒ **puede iniciar**, **no puede cerrar** | SQLite en memoria |
| Integración | **Una venta bajo el umbral en `reembolso_pendiente` no rompe ninguna lectura**: `listarReembolsosPendientes`, el eco de escalaciones y el reporte mensual la muestran igual (RD-106) | SQLite en memoria |
| Integración | **`git diff` vacío** de `resolver-escalacion-reembolso.ts`, `procesar-devolucion.ts`, `web/server.ts`, `web/render.ts`, `web/config.ts` | Revisión del Reviewer, no test |
| Manual E2E ★ | **Con DOS cuentas**: iniciación sin token con justificación; **el vendedor intentando aprobarla y siendo rechazado**; el administrador aprobándola; intento sobre venta ajena; `consultar_venta` mostrando la decisión del cliente; una sesión que sobrevive a una conversación larga | `docs/progreso/v3.12-.../` |

---

## 13. Migración y rollback

**Una migración, `0014`, aditiva**: tabla nueva, sin datos que migrar, sin lectores previos. **No se revierte: se abandona** (ADR 228 pto 6, *Rollback Plan* pto 3).

Rollback por capas, independientes entre sí:

1. **Prompt, skills y docs** ⇒ borrar dos directorios y revertir cuatro párrafos.
2. **`.env.example`** ⇒ borrar el archivo y su test. ★ **Si se revierte, hay que decirlo**: el repo vuelve a documentar sus variables sólo en doc-comments.
3. **La sesión** (slice 4) ⇒ volver a sellar sólo `expiraEn` y bajar el default. Las sesiones vivas se acortan o vencen: **son estado de proceso, un reinicio ya las borra hoy**. Cuesta un login.
4. **`solicitar_devolucion`** ⇒ quitar la operación del contrato, sus filas de las tres tablas de validación y su rama del dispatcher. ★ **Las escalaciones ya abiertas por la vía nueva SIGUEN SIENDO RESOLUBLES con `resolver_reembolso`, que no se revierte** — no queda nada colgado. Lo que se pierde es la justificación escrita de las que queden abiertas: **auditable pero incompleto, y hay que asentarlo**.
5. **`consultar_venta`** ⇒ ídem, revertible **sin** tocar lo anterior… **pero no al revés**: revertir la 1 sin revertir la 2 deja a `solicitar_devolucion` sin su lector. **El orden de reversión es el inverso del de merge.**

**Ninguna reversión toca una función determinista del núcleo, y ninguna deshace las devoluciones que ya ocurrieron** (*Rollback Plan* pto 7).

---

## 14. Riesgos nuevos que el diseño descubrió

| # | Riesgo | Prob. | Tratamiento |
|---|---|---|---|
| **R14** ★ | **Sondeo de existencia de ventas.** Distinguir `no_autorizada` de `no_encontrada` (exigido por los Success Criteria) le permite a un empleado autenticado descubrir **qué `ventaId` existen** probando ids | **Baja** | **Aceptado y declarado, no escondido.** Los ids son opacos y de alta entropía (`randomUUID`), así que el sondeo es inviable en la práctica; y el atacante es **un empleado autenticado**, que ya puede listar sus propias ventas. ★ **La mitigación real es el paso 2 del ADR 228**: el `motivo` se valida **antes** de leer, así que ni siquiera se puede sondear sin escribir una justificación. **Si el checkpoint prefiere lo contrario, la salida es fusionar las dos ramas en `no_encontrada` — y entonces hay que cambiar el Success Criterion `:352`, no el código a escondidas** |
| **R15** ★ | ★ **El token entra al módulo nuevo por el tipo de retorno de `escalarReembolso`** (`Venta`, con `tokenConfirmacion`), y ese método **no se puede cambiar** | **Media si se ignora** | ADR 227 pto 5: el valor de retorno **sólo se compara contra `undefined`**, nunca se desestructura ni se propaga, y el **test mecánico de ausencia incluye la subcadena `token`**. ★ **Sin ese tercer símbolo en el test, R1 queda abierta en el archivo que más importa** |
| **R16** ★ | **La renovación de sesión necesita dos escritores** y la propuesta lista uno. Renovar sólo en HTTP dejaría la TUI con el comportamiento viejo — en la capability que se llama `autenticacion-empleado-tui` | **Alta si se ignora** | ADR 231 pto 4: los dos escritores, con test en cada superficie. ★ **Ampliación de alcance declarada: `build-on-comando-empleado.ts` y `main.ts` entran al diff** (§0.4). **Open Question 3** |
| **R17** | **Dos variables con "inactividad" en el nombre**: `SESION_INACTIVIDAD_MINUTOS` (auth) y `CONVERSACION_INACTIVIDAD_MS` (memoria del chat), con defaults que **vuelven a coincidir en 30** | **Media** | ADR 231 pto 8: el doc-comment de cada una nombra a la otra y dice qué decide cada una. **Siguen desacopladas**, `git diff` vacío de `web/config.ts`. El ADR 226 pto 4 ya advirtió que "unificarlas" en un refactor sería acoplar ergonomía con postura de autenticación |
| **R18** ★ | **Choque de skills**: `devolucion-conversacional` (exige token) y `solicitar-devolucion` (sin token) compiten por la misma intención del empleado. El modelo puede mandar a alguien sin token a la operación que lo exige — o peor, a alguien **con** token por la vía cara | **Media-Alta** | ADR 233 pto 2: las `description` discriminan por **lo que el empleado tiene**, no por lo que quiere. ★ **Falla del lado seguro en las dos direcciones**: elegir mal hacia `procesar_devolucion` falla por falta de token; elegir mal hacia `solicitar_devolucion` escala y **pide un administrador** (ADR 223 pto 8: el control es el precio, no la elegibilidad). **Es molestia, nunca plata** |
| **R19** | **`.gitignore` con `.env*`** se tragaría `.env.example` y el archivo nacería invisible | **Baja** | ADR 232 pto 4: verificar la regla vigente y, si aplica, exceptuarlo **en el mismo commit**, diciéndolo en el mensaje |

---

## 15. Open Questions para el checkpoint

- [ ] ★ **1. §0.1 — BLOQUEANTE: el retiro de `/confirmar/:token` no se diseñó.** El encargo lo pidió; la propuesta que firmaste lo prohíbe **cuatro veces** (`:50`, `:116`, `:289`, `:354`) y el código muestra que esa ruta es **la confirmación de la venta por el cliente**, no la devolución: sin ella **ninguna venta llega a `confirmada`** y `solicitar_devolucion` se queda sin entradas válidas. **Confirmá que `server.ts`/`render.ts` quedan con diff vacío.** Si lo que querías retirar era **`POST /devolucion`** (el camino del cliente con token), decilo: es un change propio y hay que decidir antes qué pasa con las ventas de `POST /ventas`, que no tienen vía nueva (**R5**).
- [ ] ★ **2. ADR 227 pto 3 — `getVentaById` NO se reusa.** El encargo pedía reusarlo detrás de un puerto que excluya el token; este diseño prefiere **un lector propio cuya lista de columnas ni siquiera nombra `token_confirmacion`**, para que la exclusión sea de SQL y no de disciplina — y porque el ADR 225 pto 6 ya había fijado que `getVentaById` sigue sin exponerse. **Es ~15 líneas más de `repository.ts` a cambio de que el token no exista en memoria. ¿Lo ratificás?**
- [ ] ★ **3. §0.4 / R16 — ampliación de alcance: `build-on-comando-empleado.ts` y `main.ts`.** No están en *Affected Areas*. Son **una línea cada uno**, exigidas porque la sesión vive en dos lugares. Recomendación: **acá**; separarlo dejaría la TUI con TTL absoluto mientras la spec dice lo contrario.
- [ ] **4. §0.5 / ADR 231 pto 1 — `SesionEmpleado` gana `inactivaEn`.** La propuesta dijo *"el único campo de sesión que puede cambiar es `expiraEn`"*, pero el ADR 226 pide dos vencimientos y dos no caben en uno. ★ **A cambio, `SESION_TTL_MINUTOS` conserva su significado exacto y sólo cambia de default (30 → 480), con lo que R11 se reduce a una nota.** ¿Se acepta el campo nuevo con ese canje?
- [ ] **5. ADR 231 pto 6 — los números: tope absoluto 480 min, inactividad 30 min.** Con inactividad 30, **la sesión ociosa muere exactamente cuando muere hoy** (**R8** sin empeorar). ¿Los ratificás, o preferís otros?
- [ ] **6. Numeración.** Este diseño abre **ADR 227-233** y **R14-R19**. `ergonomia-canal-empleado` tiene `221-222` reservados y **todavía no tiene `design.md`**: si su diseño abre ADRs, tiene que hacerlo **desde el 234**. ¿Lo fijás así, o repartís de otra forma?
- [ ] **7. Orden de merge frente a `ergonomia-canal-empleado` (R7).** Sigue abierto desde la propuesta (punto 7) y **es lo único que puede bloquear el arranque**: los dos changes tocan `ejecutar-operacion.ts`. Recomendación de la propuesta y de esta fase: **el hermano primero**.
