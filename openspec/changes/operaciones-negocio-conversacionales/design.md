# Diseño técnico: Operaciones de negocio por conversación — herramienta acotada, turno de empleado y bifurcación de superficie

**Entra con**: [`proposal.md`](proposal.md) (aprobada por checkpoint, ADR 145-151 — **ADR 151 BLOQUEADO**, Enmienda 2 —, RD-68 a RD-74) · `specs/herramienta-operaciones-negocio/`, `specs/turno-empleado-autenticado/` (nuevas) · deltas de `soporte-web-turno`, `comando-empleado-tui`, y de `solicitud-interna-hitl` acotado a `cancelar` (a verificar por `sdd-spec`, no asumido acá).

**Alcance de este documento**: el *cómo* — resuelve **RD-68 a RD-73** con el código real a la vista (**RD-74 sigue BLOQUEADO por el ADR 151 y NO se toca acá**), el molde exacto de la herramienta MCP, el cableado de `deps` desde el composition root, y la separación quirúrgica de `soporte-prompt.ts` / `build-on-soporte.ts` respecto de la ruta HTTP nueva de operaciones (`adapters/web/server.ts` — ★ **corregido por ADR 172/173**: `build-on-comando-empleado.ts` NO forma parte de este change, ver §4). No es `tasks.md` ni `specs/`.

**Numeración — verificada por grep sobre TODO `openspec/changes/*`, no heredada**: el techo real es **ADR 162** (`autorizacion-empleado/design.md:337`) y **RD-79** (mismo archivo/`proposal.md`, ambas reservadas y resueltas por ese change hermano, escrito en la misma sesión). Este diseño **abre en ADR 163** y no reserva RD nuevas: **RD-68 a RD-73 quedan resueltas acá**; **RD-74 permanece BLOQUEADA** (es del change de ejecución del ADR 151, detrás de `autorizacion-empleado`) y este documento no la toca ni la reabre.

**Verificación cruzada obligatoria (`autorizacion-empleado/design.md`)**: leído completo. Ese diseño modifica `resolver-escalacion-reembolso.ts` y `resolver-solicitud-interna.ts` agregando `rolPort: RolEmpleadoPort` **requerido** en sus `Deps` y las variantes `no_autorizado`/`autoaprobacion_prohibida`. Este change **solo** llama a `resolverSolicitudInterna` con `accion: "cancelar"` (autoservicio, gateado por dueño, **nunca** pasa por el gate de rol nuevo — ADR 159 pto 1 de ese diseño confirma que `esAccionAutoservicio` sigue **antes** de cualquier chequeo de rol). Sin embargo, **hay un acoplamiento real de compilación**: si `autorizacion-empleado` mergea primero, `ResolverSolicitudDeps.rolPort` pasa a ser **campo requerido** y el wiring de este change (§7) debe incluirlo — un objeto literal `{ store, newId, now, logEvent }` sin `rolPort` dejaría de compilar. **No es un conflicto de diseño, es una dependencia de orden de merge** ya nombrada por la propuesta (*Qué necesita el checkpoint* pto 8, sin resolver). Se documenta como riesgo en §11, no se resuelve acá — la propuesta ya estableció que ninguno de los dos changes bloquea al otro y que el orden es decisión de checkpoint.

---

## 1. Resumen de la arquitectura elegida

**Una** tool MCP nueva (`mcp__operaciones__operacion_negocio`), **un** módulo de núcleo puro de validación+traducción, **un** adaptador molde `knowledge/index.ts`, **un** archivo de composition root nuevo (`build-on-operaciones-empleado.ts`, hermano de `build-on-soporte.ts`), **seis** `SKILL.md` nuevos (★ actualizado por ADR 174, Enmienda 5 — eran cinco), y **cero** `AgentDefinition` nuevos en el registro (hallazgo, ADR 164). `build-on-soporte.ts` **no se toca**. `soporte-prompt.ts` gana una función hermana, la existente queda byte-idéntica.

```
 ┌─ src/core/operaciones/ (nuevo, sin imports de adapters/SDK) ─────────────┐
 │  operaciones-contract.ts   ★ NUEVO · sin imports (ADR 163, corregido §2) │
 │                             OPERACIONES_TOOL_QUALIFIED_NAME              │
 │                             OperacionNegocio (6 miembros — ADR 163 pto 1 │
 │                             re-decidido por ADR 171/174, ver §2)         │
 │  validar-operacion.ts      ★ NUEVO · sin imports · whitelist por op      │
 │  ejecutar-operacion.ts     ★ NUEVO · importa SOLO los otros 6 casos de   │
 │                             uso/funciones de core/ventas·solicitudes     │
 │                             (ADR 167/174)                                │
 └───────────────────────────────────────────────────────────────────────────┘
                     │ handleOperacionNegocio(raw, deps) → texto
 ┌─ src/adapters/operaciones/index.ts ★ NUEVO, molde `adapters/knowledge/` ─┐
 │  createOperacionesAdapter({ casoId, sesion, confirmacion, ... })         │
 │  createSdkMcpServer + tool(OPERACIONES_TOOL_NAME, schema zod, handler)   │
 └───────────────────────────────────────────────────────────────────────────┘
                     │
 ┌─ src/core/agents/definitions.ts (MODIFICADO — 1 función nueva, ADR 164) ┐
 │  construirAgenteEmpleadoOperaciones(): AgentDefinition                   │
 │    = { ...CONVERSATIONAL_AGENT, allowedTools: [...+ tool], systemPrompt: │
 │        CONVERSATIONAL_AGENT.systemPrompt + instrucción }                 │
 │  CONVERSATIONAL_AGENT y AGENT_REGISTRY: SIN CAMBIOS                      │
 └───────────────────────────────────────────────────────────────────────────┘
                     │ candidateAgents: [agenteEmpleado]  (NO tocar resolveTurn)
 ┌─ src/build-on-operaciones-empleado.ts ★ NUEVO, molde build-on-soporte.ts┐
 │  buildOnOperacionesEmpleado(deps) → (consulta, sesion, confirmacion) ⇒  │
 │    Promise<{ casoId, respuesta }> — agnóstico del caller (ADR 172 pto 7)│
 └───────────────────────────────────────────────────────────────────────────┘
                     │ invocado por HTTP (ADR 172/173), NUNCA por la TUI
 ┌─ src/adapters/web/server.ts (MODIFICADO — ADR 172/173) ─────────────────┐
 │  +RUTA_LOGIN "/login", RUTA_OPERACIONES "/operaciones"                  │
 │  WebServerDeps += onLogin, onOperacionesEmpleado                        │
 │  handleLogin: credenciales → sesionStore.crear() → { token, expiraEn }  │
 │  handleOperaciones: Bearer <token> → sesionStore.buscar() → 401 | turno │
 └───────────────────────────────────────────────────────────────────────────┘
                     │
 ┌─ src/adapters/web/sesion-empleado-store.ts ★ NUEVO ─────────────────────┐
 │  crearSesionEmpleadoStore() → { crear(sesion)→token, buscar(token) }    │
 │  Map<token, SesionEmpleado> en memoria — checkea sesionVigente reusada  │
 ├─ src/adapters/web/confirmacion-operaciones-store.ts ★ NUEVO ────────────┤
 │  crearConfirmacionOperacionesStore() → { paraEmpleado(empleadoId) }     │
 │  Map<empleadoId, ConfirmacionPendiente> — un slot POR empleado (HTTP es │
 │  concurrente; la TUI tenía un slot único porque servía a un usuario)    │
 ├─ src/build-on-login-http.ts ★ NUEVO, molde build-on-soporte.ts ─────────┤
 │  buildOnLoginHttp(deps) → (input) ⇒ resolverLogin(...) + sesionStore    │
 └───────────────────────────────────────────────────────────────────────────┘

 src/build-on-comando-empleado.ts — SIN CAMBIOS por este change (ADR 172 pto 3,
 revierte lo que el ADR 165/166/167 histórico había planeado sobre este archivo).
```

---

## 2. ADR 163 (RD-68): **UNA** tool con `operacion` discriminada — y **hallazgo que corrige el alcance de la propuesta**: `registrarVenta` queda **FUERA** del contrato

> ⚠️ **Pto 1 (la exclusión de `registrarVenta`) SUPERSEDIDO POR EL ADR 171 (abajo, misma sección)** — misma convención de este repo: se enmienda, no se borra (ADR 103 sobre ADR 8). El checkpoint refinó el invariante del ADR 145 pto 2 vía **ADR 170** (`proposal.md`, Enmienda 3) **después** de esta fase: `registrarVenta` **REINGRESA** como quinta operación del contrato, con `monto: number` admitido por el test mecánico del ADR 170. **El texto original de los ptos 1-2 se conserva íntegro abajo como registro histórico** — los ptos 3-4 (una sola tool discriminada, `empleadoId`/`solicitanteId` nunca en el schema) **siguen vigentes sin cambios**. Leer el ADR 171 antes de tocar el schema de la tool o la tabla del pto 2.

**Contexto**. La propuesta (ADR 145 alternativa rechazada 4) dejó la granularidad para acá. Se escribieron los seis schemas reales para decidir con evidencia, no por preferencia.

**El hallazgo, verificado contra el código, no en la propuesta**: `RegistrarVentaInput` (`registrar-venta.ts:16`, uso real: `input.monto >= config.ventaGrandeUmbral`) tiene un campo `monto: number` **irreducible** — dar de alta una venta *es*, por definición, registrar un monto. Ningún schema de herramienta que exponga `registrar_venta` puede evitar un campo numérico de dinero, sin importar cómo se lo llame o redacte. Esto **choca de frente** con el invariante más citado de esta propuesta, literal: *"el schema de la herramienta no contiene ni un solo campo numérico de dinero"* (ADR 145 pto 2) y con el Success Criterion verificable por test sobre el schema mismo. No hay forma de conceder `registrar_venta` sin violar el invariante que el resto del change se apoya en poder afirmar.

**Decisión**:

1. **El contrato de la herramienta expone CUATRO operaciones, no cinco.** `registrarVenta` **queda fuera** del contrato — la función **no se modifica** (eso no cambia: sigue sirviendo `POST /ventas`, ADR 145 pto 5 intacto) pero **no se envuelve**. Es un recorte de alcance ejecutable respecto de la lista de la propuesta (Scope, bullet 2), en el mismo espíritu con el que la Enmienda 2 recortó `resolverEscalacionReembolso` — **se documenta, no se esconde**, y **`sdd-spec` debe reflejarlo**: la capability `herramienta-operaciones-negocio` cubre cuatro operaciones, no las genéricas "seis funciones".
2. **Las cuatro que SÍ entran, con su schema verificado campo por campo — ninguno numérico de dinero, período, porcentaje ni veredicto libre**:

   | `operacion` | Campos del modelo | Función delegada | ¿Por qué es segura? |
   |---|---|---|---|
   | `resolver_decision_venta` | `token: string`, `decision: "confirmar" \| "rechazar"` | `resolverDecisionVenta` | `decision` es un enum de DOS valores fijos — no es "un veredicto libre" (eso es un juicio de negocio computado; esto es la elección del CLIENTE, ya tomada, que el empleado transcribe). El monto de la venta no viaja: lo resuelve el `token` contra el `store` |
   | `procesar_devolucion` | `token: string`, `motivo?: string` | `procesarDevolucion` | Idéntico al comando `/devolucion` que reemplaza — mismo input, mismo store |
   | `crear_solicitud_interna` | `tipo: string`, `detalle: string` | `crearSolicitudInterna` | `SolicitudInterna` (`solicitudes-contract.ts:57-68`) **no tiene campo numérico** — un "gasto" es prosa libre en `detalle`, igual que hoy con `/solicitar` |
   | `cancelar_solicitud_interna` | `solicitudId?: string` | `resolverSolicitudInterna({ accion: "cancelar", ... })` | Autoservicio, gateado por dueño en el núcleo (`esAccionAutoservicio`). `solicitudId` ausente ⇒ modo listado (mismo comportamiento que `/cancelar-solicitud` sin argumento) |

3. **UNA sola tool, `operacion` como discriminante de primer nivel**, no seis tools. El razonamiento de ADR 145 alternativa 4 se sostiene con más fuerza ahora que son cuatro operaciones reales: seis (o cuatro) tools separadas multiplicarían `allowedTools` y dispersarían la whitelist de campos en N schemas. La forma exacta (§4) es un objeto zod plano con TODOS los campos posibles como opcionales a nivel del wrapper MCP, y una segunda validación **estricta** en el núcleo (`validar-operacion.ts`) que exige exactamente los campos de la fila que corresponde y **rechaza cualquier clave extra** — el mismo espíritu de whitelist que `definicion-skills` ADR 110 aplicó al frontmatter.
4. **`empleadoId`/`solicitanteId` NUNCA son campos del schema** (ADR 147 pto 1, ya fijado) — los cuatro `deps` que los necesitan (`crearSolicitudInterna`, `resolverSolicitudInterna`) los reciben del composition root (§7).

**Alternativas consideradas**:

- *Seis tools separadas (una por función)*: rechazada, ADR 145 la dejó como "la alternativa seria" y este ADR confirma el motivo con los schemas reales a la vista.
- *Incluir `registrar_venta` con `monto` igual, y relajar el invariante a "el modelo no CALCULA un monto, aunque lo transcriba"*: rechazada. El Success Criterion de la propuesta es un test **sobre el schema mismo**, no sobre "quién originó el número" — relajarlo por conveniencia es exactamente el vicio que la Enmienda 2 (ADR 151) ya nombró y rechazó en otro punto ("un texto no vuelve a ser cierto porque su conclusión coincida por accidente"). Se prefiere recortar alcance a relajar un invariante de seguridad ya aprobado por checkpoint.
- *Envolver `registrar_venta` pasando un `cotizacionId` en vez de `monto`, resuelto contra un catálogo de precios*: rechazada — no existe tal catálogo en este repo (verificado: `RegistrarVentaInput` no tiene ninguna referencia a un precio precomputado), inventarlo sería una feature nueva no pedida por nadie.

### ADR 171 (re-decisión del pto 1 de ADR 163, bajo autoridad del ADR 170): `registrarVenta` REINGRESA como quinta operación del contrato

**Contexto**. El pto 1 de arriba excluyó `registrarVenta` leyendo el ADR 145 pto 2 en su literalidad. El checkpoint, vía **ADR 170** (`proposal.md`, Enmienda 3), refinó ese invariante: un campo de monto es admisible cuando la función determinista lo **persiste verbatim** (hecho declarado sobre algo ya ocurrido), nunca cuando lo usa en una operación aritmética que **produce** un monto distinto (resultado calculado). Verificado línea por línea en esta fase: `monto: input.monto` se escribe tal cual en `crearVentaConCaso` (`registrar-venta.ts:121`); la única otra lectura de `input.monto` es `input.monto >= config.ventaGrandeUmbral` (`:143`), un umbral que solo decide si se dispara —sin `await`, informativa— una consulta A2A de riesgo de crédito, y **no deriva ni transforma** el monto persistido. `registrarVenta` pasa el test mecánico del ADR 170 pto 2.

**Decisión**:

1. **El contrato vuelve a CINCO operaciones.** `registrar_venta` se agrega como quinta fila de la tabla del pto 2 de ADR 163 (esa tabla no se reescribe — se agrega acá, mismo criterio "se enmienda, no se borra").

2. **Schema de `registrar_venta`, verificado campo por campo contra `RegistrarVentaInput` real** (`registrar-venta.ts:80-89`) — no es solo `monto`:

   | Campo del modelo | Origen | Por qué |
   |---|---|---|
   | `clienteId: string` | Modelo | Identifica al cliente — mismo nivel de confianza que `token`/`solicitudId` en las otras cuatro operaciones, no autoriza nada |
   | `clienteEmail: string` | Modelo | Solo para notificar, NO se persiste (comentario `registrar-venta.ts:84`) — mismo dato que hoy viaja por `POST /ventas` |
   | `planAnterior?: string` | Modelo | Opcional, texto de plan — no es dinero |
   | `planNuevo: string` | Modelo | Ídem, requerido |
   | `monto: number` | Modelo | Admitido por ADR 170 — hecho declarado, persistido verbatim |
   | `vendedorId: string` | **NO es campo del schema — closure** (`sesion.empleadoId`) | Mismo invariante del ADR 147 pto 1 aplicado por primera vez acá: en el turno conversacional el vendedor que registra la venta ES el empleado autenticado del turno (self-service). Cerrarlo desde el composition root evita que el modelo nombre a otro vendedor |
   | `vendedorNombre: string` | Modelo (ver pto 3) | Dato de reporte, no de autorización — ver gap nombrado abajo |

   `OperacionNegocio` (`operaciones-contract.ts`) gana el quinto miembro `registrar_venta`, y el wrapper zod del adaptador (`src/adapters/operaciones/index.ts`) suma sus campos opcionales al objeto plano, igual que los otros cuatro (ADR 163 pto 3, sin cambios).

3. **Hallazgo, no inventado para esta fase**: este repo **no tiene** ningún puerto que resuelva `empleadoId → nombre` (verificado: `credenciales-contract.ts` solo tiene `{empleadoId, passwordHash}`; `sesion.ts` solo tiene `{empleadoId, iniciadaEn, expiraEn?}`). Hoy, por HTTP (`POST /ventas`, auth de token estático de servicio, `server.ts:107` — **no** de sesión de empleado), `vendedorNombre` ya viaja como dato de body sin ninguna atadura a identidad. Construir un directorio de empleados nuevo excede el alcance de esta corrección dirigida. **Decisión mínima**: `vendedorNombre` se acepta como dato que el modelo transcribe de lo que el empleado declara sobre sí mismo ("soy Juan Pérez, registrame...") — mismo nivel de confianza que tiene hoy por HTTP, no uno menor. No gatea autorización (`vendedorId`, que sí la gatearía si algo la gatease, ya está cerrado por sesión): como máximo, un `vendedorNombre` mal transcripto ensucia un campo de reporte, nunca autoriza una acción que el empleado no pudiera ya ejecutar con su propio `vendedorId`. **Open question no bloqueante** (§13): cerrar el gap con un directorio real de empleados es un change aparte.

4. **Test de verificación obligatorio (ADR 170 pto 5)** — responsabilidad de `sdd-tasks`/`sdd-apply`: debe existir un test que demuestre, para `registrar_venta`, que entre la recepción de `input.monto` en el wrapper de la tool y su escritura en `crearVentaConCaso` **no hay ninguna operación aritmética** sobre ese valor (comparación estricta `===` contra el valor de entrada, no una tolerancia). Documentado en Testing (§11).

5. **Cableado de deps — consecuencia real, no cosmética** (ver ADR 167 §6, actualizado): `registrarVenta` exige por tipo `notifier`, `baseUrlPublica` y `newToken`, y acepta opcional `riesgoCredito` — ninguno de los cuales estaba en `BuildOnOperacionesEmpleadoDeps` porque el ADR 167 pto 5 los había quitado a propósito cuando el contrato tenía cuatro operaciones que no los necesitaban. Se reinstauran, reusando las MISMAS instancias que `main.ts` ya construye para `buildOnVenta` (`notifier`, `webConfig.publicUrl`, `riesgoCredito`) — cero duplicación.

6. **Alcance de exposición — confirmado por el checkpoint**: `registrar_venta` entra **únicamente** por esta tool MCP, dentro del turno de empleado autenticado (ADR 165). No se agrega ninguna ruta HTTP nueva ni ningún comando de TUI para esta operación — `POST /ventas` sigue siendo el único otro camino, sin cambios (ADR 145 pto 5, invariante intacto).

**Alternativas consideradas**: las que el ADR 170 (`proposal.md`) ya evaluó y rechazó (relajar el invariante genérico, tipar `monto` como string, admitir caso por caso sin test mecánico) no se repiten acá — son resorte de esa fase, no de ésta.

- *Inventar un `DirectorioEmpleadosPort` nuevo para resolver `vendedorNombre` con integridad total*: rechazada para esta corrección — excede "corrección dirigida" y el gap es preexistente al canal conversacional (ya existe por HTTP, no lo crea esta fase).

**Consecuencias**:

- El contrato de la tool MCP tiene **cinco** operaciones — todas las tablas/diagramas de este documento que decían "4" se corrigen (§1, §8, §9, §10, §11).
- `ejecutar-operacion.ts` importa un quinto caso de uso (`registrarVenta`, `core/ventas/registrar-venta.js`), sin romper el límite de imports del ADR 167 ("solo los casos de uso de core/ventas·solicitudes").
- Se agrega una **quinta** skill, `registrar-venta-conversacional` (§8, actualizado) — la skill `venta-decision` (ADR 169) no cambia, es sobre `resolver_decision_venta`, operación distinta.
- **Necesita que `sdd-tasks` liste explícitamente** el cableado de `notifier`/`baseUrlPublica`/`riesgoCredito`/`newToken` en `BuildOnOperacionesEmpleadoDeps` y en el wiring de `main.ts` — no es opcional, `registrarVenta` no compila sin ellos.

### ADR 174 (Enmienda 5, `proposal.md`): `consultar_reporte_comisiones` se agrega como sexta operación del contrato — solo lectura, sin campo de dinero ni identidad en el INPUT, sin gate de rol

**Contexto**. La Enmienda 5 nombró la operación a nivel de propuesta y dejó el schema/cableado para esta fase, con un hallazgo de acceso ya declarado ahí: *"dame MI reporte" no puede construirse con el código actual* — verificado en esta fase: `ReporteStorePort.listComisionesPorPeriodo` (`reporte-contract.ts:18`) no filtra por vendedor, y no existe ningún closure de identidad entre la `sesion` del turno y ese store. La única forma honesta es exponer el reporte de la empresa completo, idéntico al que `/reporte-comisiones` ya muestra hoy a cualquier sesión con `privilegiado: true` — que en este repo, sin `autorizacion-empleado` mergeado, significa **"cualquier empleado con sesión vigente"**, no un rol de administrador (verificado: `comando-empleado.ts:265-284` gatea por `privilegiado`/sesión, nunca por rol; no existe hoy ningún `RolEmpleadoPort` fuera del change hermano `autorizacion-empleado`, que este change no toca). El riesgo derivado (**R12**, `proposal.md`) — el mismo reporte sin escopear se vuelve alcanzable por un segundo canal (`POST /operaciones`, sesión de cualquier empleado autenticado) — fue resuelto por el checkpoint: **aceptado, sin restricción nueva**, misma exposición que ya existe hoy por la TUI.

**Decisión**:

1. **El contrato pasa a SEIS operaciones.** `consultar_reporte_comisiones` se agrega como sexta fila de la tabla del pto 2 de ADR 163 (esa tabla no se reescribe — se agrega acá, mismo criterio de ADR 171):

   | `operacion` | Campos del modelo | Función delegada | ¿Por qué es segura? |
   |---|---|---|---|
   | `consultar_reporte_comisiones` | `periodo?: string` | `resolverPeriodoReporte` → `reporteStore.listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente` → `agruparReporteMensual` → `formatearReporteMensual` (pipeline verbatim de `manejarReporteComisiones`, `build-on-comando-empleado.ts:1659-1674`) | Solo lectura, cero escritura, sin doble paso. El INPUT no tiene ningún campo numérico de dinero ni de identidad — `periodo` es un string `YYYY-MM` opcional, igual que el argumento de `/reporte-comisiones`. El invariante del ADR 145 pto 2 rige el **schema de la herramienta** (lo que el modelo puebla), no la respuesta: el TEXTO que devuelve sí contiene montos (`totalComisionado`, `montoVendido`) y nombres (`vendedorNombre`), exactamente como ya lo hace `/reporte-comisiones` hoy — son datos de SALIDA de una función determinista ya aprobada, no un campo que el modelo redacta o calcula |

2. **Sin gate de rol — decisión explícita, no un olvido.** `ejecutar-operacion.ts` NO recibe ni exige un `RolEmpleadoPort` para esta operación. Paridad deliberada con `/reporte-comisiones`: ambos caminos llegan al mismo dato, gateados únicamente por `sesionVigente` (la misma guarda que ya cierran las otras cinco operaciones, ADR 167 pto 1 / ADR 147). Agregar un gate nuevo acá **inventaría** una restricción que el comando gemelo no tiene — inconsistencia de producto, no refuerzo de seguridad — y además pisaría terreno reservado a `autorizacion-empleado`, que esta fase no toca por instrucción explícita del checkpoint.
3. **Sin recorte de campos de salida.** A diferencia del change hermano `consultas-negocio-a2a-entrante` (mismas funciones de `reporte.ts`, pero para un caller A2A externo sin identidad propia, que sí recorta `vendedorNombre`/`clienteId` fila por fila), acá el empleado ya está autenticado por sesión — mismo nivel de confianza que la TUI —, así que el texto que `formatearReporteMensual` produce se devuelve **literal, sin envolver ni recortar** (mismo invariante ADR 124 que ya rige `/reporte-comisiones`). **No se importa ni se reusa la lógica de recorte de ese change hermano acá**: son dos superficies con niveles de confianza distintos, resueltas independientemente.
4. **`periodo` sigue opcional**, mismo default que hoy: ausente ⇒ mes corriente (`resolverPeriodoReporte(undefined, ahora)` ⇒ `periodoDeConfirmacion(ahora)`); inválido ⇒ el mensaje de uso propio de `resolverPeriodoReporte` ("Periodo inválido. Formato esperado: YYYY-MM."), **sin ninguna lectura de `reporteStore`** — mismo corte "SIN fila" que `manejarReporteComisiones` (`build-on-comando-empleado.ts:1663-1666`).

**Alternativas consideradas**:

- *Recortar el output (`vendedorNombre`/`clienteId`) igual que el change A2A hermano*: rechazada — el empleado autenticado por sesión ya tiene el mismo nivel de confianza que la TUI, que hoy muestra el reporte completo; recortar acá sería una restricción nueva no pedida, inconsistente con `/reporte-comisiones`, y confundiría los dos diseños (uno para un caller sin identidad, este para un caller con identidad).
- *Agregar `RolEmpleadoPort`/exigir `administrador`*: rechazada por el checkpoint (R12, `proposal.md`) — ensancharía el alcance de este change hacia el modelo de roles, terreno exclusivo de `autorizacion-empleado`, y crearía una asimetría nueva entre TUI (sin rol) y conversación (con rol) para el MISMO dato.
- *Exigir `periodo` obligatorio en el schema*: rechazada — diverge sin necesidad del comando que complementa (`/reporte-comisiones [periodo]`, ya opcional) y agrega fricción a la skill sin ganancia de seguridad, dado que el default (mes corriente) ya es el comportamiento esperado.

**Consecuencias**:

- El contrato de la tool MCP tiene **seis** operaciones — tablas/diagramas de este documento que decían "cinco" se corrigen (§1, §8, §9, §10, §11).
- `ejecutar-operacion.ts` importa un sexto módulo (`resolverPeriodoReporte`/`agruparReporteMensual`/`formatearReporteMensual`, `core/ventas/reporte.js`), sin romper el límite de imports del ADR 167 ("solo casos de uso/funciones puras de core/ventas·solicitudes").
- Se agrega una **sexta** skill, `reporte-comisiones-conversacional` (§8, actualizado).
- **`BuildOnOperacionesEmpleadoDeps` gana `reporteStore?: ReporteStorePort`** (ver §6, actualizado) — hallazgo de cableado distinto del de `notifier`/`riesgoCredito`: a diferencia de esos dos (que `main.ts` YA construía para `buildOnVenta` y este change solo reusa), **`main.ts` hoy NO construye ninguna instancia de `ReporteStorePort`** — vive únicamente como default inline DENTRO de `build-on-comando-empleado.ts:860-865` (`deps.reporteStore ?? { listComisionesPorPeriodo: (p) => listComisionesPorPeriodo(db, p), listVentasEnReembolsoPendiente: () => listVentasEnReembolsoPendiente(db) }`). Como este change YA modifica `main.ts` (§10, wiring de `buildOnOperacionesEmpleado`/`buildOnLoginHttp`), la consecuencia real es que `main.ts` construye `reporteStore` **una vez**, con el MISMO molde de closures, y lo pasa explícito a AMBOS composition roots (`buildOnComandoEmpleado({ ..., reporteStore })` y `buildOnOperacionesEmpleado({ ..., reporteStore })`) — cero duplicación de la construcción, mismo criterio que ya aplica a `store`/`notifier`/`riesgoCredito`/`baseUrlPublica` (ADR 167 pto 1). `build-on-comando-empleado.ts` sigue **sin cambios de tipo** (`deps.reporteStore` ya era opcional, `:349`) — solo cambia que ahora recibe un valor explícito en vez de caer al default.
- **Necesita que `sdd-tasks` liste explícitamente** el cableado de `reporteStore` en `main.ts` y en `BuildOnOperacionesEmpleadoDeps` — no es opcional a nivel de comportamiento (sin él, la sexta operación cae al default inline de `build-on-operaciones-empleado.ts`, funcionalmente correcto pero duplicando el closure en vez de compartirlo).

---

## 3. ADR 164 (RD-70): Un **segundo `AgentDefinition`, construido por spread — NUNCA registrado** en `AGENT_REGISTRY`. El Selector de Turno **no se toca**

**Contexto**. `soporte-prompt.ts:8-11` documentó el motivo original para NO usar un segundo `AgentDefinition`: *"obligaría a bifurcar el Selector de Turno"*. La propuesta (ADR 146 alternativa 3) marcó que ese motivo ya no alcanza porque los dos turnos deben diferir en `allowedTools`, que vive en el `AgentDefinition`, no en el prompt de texto.

**El hallazgo, leyendo `resolve-turn.ts` y `handle-turn.ts` completos**: `resolveTurn(prompt, candidates)` toma **la lista de candidatos como parámetro**, con default `listAgentDefinitions()` — **no lee `AGENT_REGISTRY` directamente**. Y `buildOnSoporte` (`build-on-soporte.ts:115`) **ya** pasa `candidateAgents: agents` (la lista real) a `handleTurn` en vez de resolver por id. Esto significa que **el "segundo `AgentDefinition`" no necesita una segunda entrada en el registro ni una segunda rama en `resolveTurn`** — alcanza con construir el objeto y pasarlo como lista de UN elemento en `candidateAgents`, exactamente el mismo parámetro que ya existe.

**Decisión**:

1. **`src/core/agents/definitions.ts` gana UNA función exportada nueva**, molde exacto de `construirDeveloperConEscritura` (spread, nunca muta el original, nunca hay una función que devuelva "solo la parte insegura"):

   ```ts
   const INSTRUCCION_OPERACIONES_EMPLEADO =
     "Además tenés disponible una herramienta de operaciones de negocio " +
     `(\`${OPERACIONES_TOOL_QUALIFIED_NAME}\`) para resolver decisiones de venta, ` +
     "devoluciones y solicitudes internas propias que te pida el empleado. " +
     "Nunca calculás ni proponés un monto, porcentaje o veredicto vos mismo — " +
     "eso lo hace la herramienta. Si la herramienta te devuelve un pedido de " +
     "confirmación, comunicáselo tal cual al empleado y esperá su respuesta " +
     "explícita en un mensaje siguiente antes de volver a invocar la misma " +
     "operación: nunca decidas vos que \"ya quedó confirmado\".";

   export function construirAgenteEmpleadoOperaciones(): AgentDefinition {
     return {
       ...CONVERSATIONAL_AGENT,
       allowedTools: [...CONVERSATIONAL_AGENT.allowedTools, OPERACIONES_TOOL_QUALIFIED_NAME],
       systemPrompt: `${CONVERSATIONAL_AGENT.systemPrompt}\n\n${INSTRUCCION_OPERACIONES_EMPLEADO}`,
     };
   }
   ```

   **`CONVERSATIONAL_AGENT` y `AGENT_REGISTRY` NO se tocan.** Corrige la propuesta (Scope, bullet: *"Alta de la herramienta en `CONVERSATIONAL_AGENT.allowedTools`... queda en tres"*): eso mutaría el **único** objeto que también sirve al turno de cliente (`POST /soporte`) y a la TUI pre-login, poniendo la tool en su `allowedTools` también — exactamente lo que R1 (riesgo dominante) prohíbe. Se corrige acá, igual que `autorizacion-empleado/design.md` corrigió la tabla *Affected Areas* de su propia propuesta contra el código real.
2. **El wiring del turno de empleado pasa `candidateAgents: [construirAgenteEmpleadoOperaciones()]`** a `handleTurn` — una lista de un elemento, nunca leída de `AGENT_REGISTRY`. `resolveTurn` sigue devolviendo trivialmente "el primer candidato" (sin cambiar una línea de `resolve-turn.ts`), pero el candidato que ve depende de **quién construye la lista**, no del registro global. `listAgentDefinitions()` sigue devolviendo exactamente `[CONVERSATIONAL_AGENT]`, como hoy.
3. **Consecuencia verificable**: `git diff -- src/core/turn-selector/` queda vacío. El "segundo `AgentDefinition`" que `soporte-prompt.ts` temía en Hito 4 **no bifurca nada** porque el mecanismo para inyectar una lista de candidatos alternativa **ya existía** desde que `buildOnSoporte` lo usó por primera vez — solo que hasta ahora esa lista siempre coincidía con el registro completo.

**Alternativas consideradas**:

- *Registrar un segundo agente real en `AGENT_REGISTRY`* (`empleado-operaciones`): rechazada. Habría que decidir qué hace `resolveTurn` con DOS candidatos reales (`listAgentDefinitions()` pasa a tener 2 elementos) para TODO caller que no pase `candidateAgents` explícito — exactamente el riesgo que motivó la nota original de `soporte-prompt.ts`. Innecesario: el parámetro ya resuelve el problema sin ese riesgo.
- *Seguir con un solo `AgentDefinition` y condicionar `allowedTools` con lógica en `toQueryOptions`*: rechazada — `toQueryOptions` no recibe hoy ninguna señal de "es empleado o cliente", y agregarla ahí acoplaría el Invocador del Modelo (capa genérica, Hito 1) a un concepto de dominio (Hito 4+). El spread en `definitions.ts` mantiene esa distinción donde ya vive (ADR 61/67 con el Developer).

---

## 4. ADR 165 (RD-69 + RD-72): La superficie es **TUI únicamente**, `/soporte` **conserva su nombre y su descriptor tal cual** (`privilegiado: false`), y el modo por defecto de la TUI se vuelve el turno de empleado **cuando hay sesión vigente**

> ⚠️ **SUPERSEDIDO ÍNTEGRO POR EL ADR 172 (abajo, misma sección)** — misma convención de este repo (ADR 103 sobre ADR 8, ADR 171 sobre ADR 163 pto 1): se enmienda, no se borra. **No es un cambio de preferencia técnica: es la corrección de un error de hecho.** El pto 214 de abajo rechazó la ruta HTTP nueva citando *"sin consumidor real declarado por el tutor"*. Verificado contra el requerimiento original del stakeholder (transcripción que esta fase de diseño no tuvo a la vista al escribir el ADR 165 — error de traspaso de contexto entre fases, no un tecnicismo que cambió): el tutor declaró, verbatim, ANTES de este documento, *"los empleados van a estar utilizando la página web para interactuar con el arnés... la TUI nos servirá para que funcione para que el administrador interactúe con el arnés... el chat conversacional (página web) del arnés es de uso para los empleados y estos no utilizan la TUI, posiblemente solo la utilice el administrador"*. Eso **es** un consumidor real, declarado por el tutor, antes de este change — la premisa que sostenía el rechazo de "HTTP nuevo" es **fácticamente falsa**, no una alternativa igualmente válida que se reconsidera por gusto. **El texto original de este ADR se conserva íntegro abajo como registro histórico** (incluida su tabla de alternativas) — leer el ADR 172 antes de tocar la superficie de exposición del turno de empleado.

**Contexto (texto histórico)**. RD-69 pedía decidir TUI, HTTP nuevo, o ambos. RD-72 pedía decidir si `/soporte` conserva el nombre. El Out of Scope de la propuesta excluye explícitamente "un chat web de empleado con UI propia" (una UI *nueva*, no la ruta de datos que consume la web ya prevista por el tutor), y el ADR 148 pto 6 ya anticipó (sin decidir el mecanismo) que `/soporte` "pasa a ser la entrada al turno de empleado autenticado" — anticipo que asumía TUI y que el ADR 172 corrige.

**Decisión — TUI únicamente, sin ruta HTTP nueva**:

1. **No se agrega ninguna ruta HTTP.** El único canal autenticado de empleado que existe hoy es la TUI tras `/login` (`tui-canal-empleado`). Agregar una ruta HTTP nueva exigiría, por ADR 146 pto 4, repetir el molde `esAutorizado` (`server.ts:107-131`) para un caso de uso que el tutor nunca pidió — el requerimiento de negocio es "conversar en vez de tipear comandos", no "un canal HTTP nuevo". Si en el futuro aparece un chat web de empleado real, esa ruta reutilizaría exactamente esta misma herramienta y este mismo `AgentDefinition` — el diseño no lo bloquea, solo no lo construye sin un consumidor (mismo criterio del ADR 150 pto 2).
2. **`/soporte` conserva su nombre, su `uso`, su `ayuda` y su `privilegiado: false` en `DESCRIPTORES` sin ninguna edición** (`comando-empleado.ts:157-165`). **No se resignifica el flag** — sigue siendo utilizable sin sesión, exactamente como hoy, porque el `privilegiado` del comando no es lo que gatea la herramienta (eso lo hace `sesionVigente` dentro del handler, punto 3). Esto es deliberado: un empleado sin sesión vigente que escribe `/soporte <consulta>` sigue recibiendo el turno de **cliente** (ADR 146 pto 2, sin cambios) — útil para probar la experiencia de cliente o para quien todavía no hizo login.
3. **`manejarSoporte` (dispatcher, `build-on-comando-empleado.ts:983`) bifurca por `sesionVigente(sesion, ahora)`**, no por el nombre del comando:

   ```ts
   async function manejarSoporte(
     comando: Extract<ComandoEmpleado, { tipo: "soporte" }>,
     ahora: string,
   ): Promise<TuiTurnResult> {
     if (sesionVigente(sesion, ahora)) {
       return manejarOperacionesEmpleado(comando.consulta, ahora);
     }
     // Rama de cliente — BYTE POR BYTE la función actual, sin editar (ADR 146 pto 2).
     try {
       const resultado = await onSoporte({ consulta: comando.consulta });
       ...
     } ...
   }
   ```

4. **RD-72, resuelto con las dos mitades**: **el nombre `/soporte` se conserva** (mitad 1) **y**, además, **la TUI vuelve conversacional por defecto para quien ya inició sesión** (mitad 2): el paso 3-4 del dispatcher (`:1705-1709`, hoy `comando === undefined ⇒ onSubmit(texto, ...)` sin excepción) pasa a:

   ```ts
   const comando = parsearComando(texto);
   if (comando === undefined) {
     if (sesionVigente(sesion, ahora)) {
       const resultado = await manejarOperacionesEmpleado(texto, ahora);
       return { responseText: resultado.responseText, agentLabel: resultado.agentLabel };
     }
     return onSubmit(texto, onAgentResolved);
   }
   ```

   Un empleado logueado ya **no necesita** escribir `/soporte` ni recordar sintaxis: cualquier texto plano llega al turno con la herramienta habilitada. Un empleado sin sesión (o cualquiera que no hizo `/login`) sigue yendo a `onSubmit` — el turno genérico de hoy, sin la herramienta, sin cambios. `/soporte` queda como **alias explícito** útil para forzar el turno de cliente incluso estando logueado (caso de prueba/soporte), y como la única puerta para quien no está logueado.
5. **Consecuencia de spec, para que `sdd-spec` no la trate como implícita**: `comando-empleado-tui` gana un requisito nuevo — *"con sesión vigente, un envío de texto plano (sin `/`) obtiene el turno de empleado con la herramienta de operaciones habilitada"* — y `soporte-web-turno` no cambia (sigue describiendo únicamente `POST /soporte` y el turno de cliente, que no se toca).

**Alternativas consideradas**:

- *Renombrar `/soporte` a `/operaciones` o similar*: rechazada — cambia el `ayuda`/`/ayuda` sin necesidad, y la propuesta (ADR 148 pto 6) ya había anticipado conservarlo como la inclinación más barata.
- *Que `/soporte` EXIJA sesión (`privilegiado: true`) y sea la única puerta*: rechazada — regresión de comportamiento (hoy funciona sin sesión) y contradice el objetivo de usabilidad: obligaría a loguearse antes de poder usar el turno de cliente vía TUI, cuando hoy no hace falta.
- *Una ruta HTTP nueva autenticada además de la TUI* (la opción "ambas" de RD-69): rechazada por ahora — sin consumidor real declarado por el tutor, mismo criterio de ADR 150 pto 2. Si aparece, es un change nuevo que reutiliza `construirAgenteEmpleadoOperaciones()` sin tocar este diseño.

### ADR 172 (re-decisión de RD-69 y RD-72, corrección de contexto — supersede al ADR 165 íntegro): la superficie es **HTTP autenticado nuevo**, **cero involucramiento de la TUI**

**Decisión**:

1. **El turno de operaciones de empleado se expone EXCLUSIVAMENTE por una ruta HTTP nueva y autenticada, `POST /operaciones`.** No por la TUI, ni siquiera como camino adicional.
2. **La TUI no gana NINGÚN camino al turno de operaciones.** Se descarta explícitamente el híbrido "TUI para que el administrador la pruebe + HTTP para el resto": ahora que el consumidor real está identificado (la página web de empleados), inventarle a la TUI un segundo camino sin que el tutor lo haya pedido repetiría exactamente el vicio que el ADR 165 (mal aplicado, sobre una premisa falsa) creía estar evitando — mismo criterio del ADR 150 pto 2 (infraestructura sin consumidor), ahora aplicado correctamente. Si el administrador necesita probar el turno, usa la misma ruta HTTP con sus propias credenciales de empleado — no hace falta una segunda implementación.
3. **`build-on-comando-empleado.ts` NO se modifica por este change, en absoluto.** Se **revierte** todo lo que el ADR 165 histórico (pts 3-4) y el ADR 167 §6 pt 3 habían diseñado sobre ese archivo: `manejarSoporte` NO bifurca por `sesionVigente`, el paso 3-4 del dispatcher (parseo de texto plano) NO bifurca por sesión, `BuildOnComandoEmpleadoDeps` NO gana `onOperacionesEmpleado`, `ConfirmacionPendiente` NO gana `origenCasoId?` en este archivo. `/soporte` (TUI) queda **byte a byte** como está hoy, antes de este change entero — sigue siendo, únicamente, la puerta al turno de *cliente* cuando el empleado quiere probar esa experiencia (ADR 146 pto 2, sin cambios, nunca tocado).
4. **RD-72 queda sin objeto.** Pedía decidir si `/soporte` conserva su nombre al convertirse en la entrada del turno de empleado — pero el turno de empleado nunca pasa por la TUI, así que no hay nada que renombrar ni bifurcar. Se marca **resuelto por no aplicabilidad**, no pendiente.
5. **Consecuencia de spec, para que `sdd-spec` no la trate como implícita**: `comando-empleado-tui` **no gana ningún requisito nuevo** por este change (contradice el pto 5 histórico del ADR 165) — es delta CERO. La capability `turno-empleado-autenticado` describe la superficie HTTP, no la TUI.

**Alternativas consideradas**:

- *Mantener también la TUI como camino de prueba del administrador (híbrido)*: rechazada — sin consumidor real que lo pida, mismo criterio del ADR 150 pto 2 aplicado ahora con la premisa correcta.
- *Autenticar la ruta nueva reusando el token estático de `/ventas` (`VENTAS_API_TOKEN`)*: rechazada — ese token es un secreto de servicio compartido, sin identidad de empleado. El ADR 147 pto 1 (sin cambios, vigente) exige que `empleadoId` salga de una sesión autenticada real, nunca de un secreto compartido. Ver ADR 173 para el mecanismo real.
- *Autenticar con `empleadoId`+`password` en cada request (HTTP Basic, sin sesión)*: rechazada — `verificarPassword` es deliberadamente cara (scrypt, ADR 30) y correrla en cada turno conversacional generaría un `login-exitoso` por mensaje, ensuciando la auditoría (`AUTH_LOG_CORRELATION_ID`) sin necesidad. Un login por sesión, no por mensaje — mismo modelo mental que ya tiene la TUI.

### ADR 173: mecanismo concreto — `POST /login` emite un token de sesión opaco; `POST /operaciones` lo consume; el `ConfirmacionOperacionPort` pasa a ser **por-empleado**, no un slot único

**Contexto**. `SesionEmpleado` (`sesion.ts:1-9`) está documentada, hoy, como viviendo en la ranura del closure de `build-on-comando-empleado.ts`, "NUNCA se persiste" — diseño correcto para un proceso de TUI con un solo usuario interactivo. HTTP es sin estado y potencialmente concurrente (N empleados a la vez): no existe hoy ningún mecanismo para reconstruir una `SesionEmpleado` a partir de una request. Verificado: `resolverLogin` (`login.ts:98-131`) es **pura y síncrona** — produce una `SesionEmpleado`, no la guarda en ningún lado; guardarla es responsabilidad del caller (hoy, la ranura de la TUI).

**Decisión**:

1. **Rutas nuevas** (`adapters/web/config.ts`): `RUTA_LOGIN = "/login"`, `RUTA_OPERACIONES = "/operaciones"`.
2. **`POST /login`** — body `{ empleadoId, password }`. Llama a `resolverLogin` (núcleo, SIN modificar) con las MISMAS `deps` que ya usa la TUI (`credenciales`, `verificarPassword`, `dummyPasswordHash`, `authConfig.sesionTtlMinutos`, `now`, `logEvent` con `AUTH_LOG_CORRELATION_ID`) — cero duplicación de política de auth. En éxito: genera un token opaco (`newToken()`, mismo default `randomUUID` que `build-on-venta.ts`), lo guarda en el store nuevo (pto 4) junto con la `SesionEmpleado`, responde `200 { token, expiraEn? }`. En fallo: `401` con el MISMO mensaje genérico indistinguible que ya usa la TUI (ADR 30) — no se filtra por HTTP una distinción que el núcleo ya decidió ocultar.
3. **`POST /operaciones`** — body `{ consulta: string }`, header `Authorization: Bearer <token de /login>`. Reusa el **extractor** de `esAutorizado` (`server.ts:102-113`: `firstHeaderValue`, prefijo `Bearer `, `token === "" ⇒ false` sin comparar) — pero la comparación final NO es contra un secreto único estático: es una búsqueda en el store de sesiones por el token como clave, molde `token-confirmacion.ts` (token opaco de alta entropía, `newToken()`/`randomUUID`, buscado por igualdad de clave — no por barrido secuencial, que es donde `esAutorizado` sí necesita tiempo constante porque compara contra UN secreto fijo y adivinable por descarte). Sin coincidencia, o sesión vencida (`sesionVigente`, reusada tal cual de `sesion.ts`, sin duplicar el algoritmo) ⇒ `401` + `logEvent("web-no-autorizado")` (mismo evento que ya usa `/ventas`). Con sesión vigente ⇒ arma `casoId = newId()`, invoca `onOperacionesEmpleado({ consulta, sesion, confirmacion })` (la MISMA función que `buildOnOperacionesEmpleado` ya construye por ADR 167 — **cero cambios a ese archivo**, su firma ya era agnóstica del caller) con la misma carrera contra timeout que `handleSoporte` (`OPERACIONES_TIMEOUT_MS`, constante nueva e independiente de `SOPORTE_TIMEOUT_MS` — son turnos distintos, se permite tunearlos distinto). Responde `{ casoId, respuesta }`, mismo shape que `/soporte`.
4. **Dos stores en memoria nuevos, en `src/adapters/web/`** (no en `core/` — son estado de proceso ligado a la concurrencia HTTP, no lógica de dominio):
   - `sesion-empleado-store.ts`: `crearSesionEmpleadoStore()` → `{ crear(sesion): string, buscar(token): SesionEmpleado | undefined }`. `Map<token, SesionEmpleado>` interno; `buscar` aplica `sesionVigente(sesion, now())` (reusada) antes de devolver — vencida o inexistente son indistinguibles desde afuera (`undefined`).
   - `confirmacion-operaciones-store.ts`: `crearConfirmacionOperacionesStore()` → `{ paraEmpleado(empleadoId): ConfirmacionOperacionPort }`. **Corrección real, no cosmética, sobre el ADR 167 §6 pt 3**: ese punto cerraba `ConfirmacionOperacionPort` sobre UN `let confirmacionPendiente` — correcto para la TUI (un usuario interactivo por proceso), **incorrecto** para HTTP (N empleados concurrentes compartirían una sola ranura y podrían pisarse la confirmación entre sí). El store nuevo es `Map<empleadoId, ConfirmacionPendiente>`: cada `empleadoId` tiene su propia ranura. La lógica de `coincideCancelacionConversacional` (`origenCasoId !== casoIdActual`, ADR 166) se reusa **sin cambios** — solo cambia dónde vive el estado mutable.
5. **Wiring de `main.ts`** (molde exacto del bloque 5b/`onSoporte` — construir una vez, compartir):

   ```ts
   const credenciales: CredencialesEmpleadoPort = {
     buscarCredencial: (id) => buscarCredencialEmpleado(db, id),
   };
   const sesionStore = crearSesionEmpleadoStore();
   const confirmacionOperacionesStore = crearConfirmacionOperacionesStore();
   const onLogin = buildOnLoginHttp({ credenciales, verificarPassword, dummyPasswordHash, authConfig, sesionStore });
   const onOperacionesEmpleado = buildOnOperacionesEmpleado({
     db, memory, hooks, ventasConfig, notifier, baseUrlPublica: webConfig.publicUrl,
     ...(riesgoCredito !== undefined ? { riesgoCredito } : {}),
   });
   // pasan a `startWebServer({ ...ventaHandlers, onSoporte, onLogin, onOperacionesEmpleado, confirmacionOperacionesStore, ... })`
   // `buildOnComandoEmpleado({ ..., credenciales })` — MISMA instancia, ya no la construye internamente por default.
   ```

   `credenciales` se construye UNA vez y se pasa explícito a `buildOnComandoEmpleado` (que ya acepta `credenciales?: CredencialesEmpleadoPort` como override — cero cambio de tipo en ese archivo) y a `buildOnLoginHttp` — mismo criterio de "cero duplicación" que `notifier`/`riesgoCredito`.
6. **`src/build-on-login-http.ts` ★ NUEVO**, molde de tamaño/forma `build-on-soporte.ts`: envuelve `resolverLogin` (síncrona) en una función `Promise`-friendly para calzar con el resto de `WebServerDeps`, y llama a `sesionStore.crear(sesion)` solo en el camino `exitosa`.
7. **`src/build-on-operaciones-empleado.ts` (ADR 167) — SIN CAMBIOS.** Su firma `(input: { consulta, sesion, confirmacion }) => Promise<{ casoId, respuesta }>` ya era agnóstica de quién la invoca — la corrección de este ADR confirma que esa decisión de ADR 167 fue correcta y solo cambia el *caller* (HTTP en vez de TUI).

**Alternativas consideradas**:

- *Cookies de sesión en vez de bearer token*: rechazada — el resto del repo (venta, confirmación, `/ventas`) usa exclusivamente headers `Authorization: Bearer` para auth HTTP; una cookie introduciría CSRF como preocupación nueva sin necesidad, para un consumidor (la web de empleados) que ya puede guardar y reenviar un token en el header.
- *`timingSafeEqual` también para la búsqueda de sesión*: no se descarta como mejora futura, pero no es necesaria con la misma justificación que ya acepta este repo para `token-confirmacion.ts` — el token es de alta entropía y la búsqueda es por clave de `Map` (no comparación secuencial observable), no un secreto único de bajo volumen como `VENTAS_API_TOKEN`.
- *Persistir la sesión HTTP en la base de datos (`db`)*: rechazada por ahora — no hay requisito de sobrevivir un reinicio del proceso, y agregar una tabla nueva para esto excede "corrección dirigida"; si aparece ese requisito, es un change aparte (mismo criterio que el ADR 171 pto 3 aplicó a `vendedorNombre`).

---

## 5. ADR 166 (RD-71, ★ el más difícil): el doble paso confirmar/ejecutar reusa el **mismo mecanismo de una sola ranura** que ya usan `manejarEscalacion`/`manejarResolucionSolicitud** — nunca un campo `confirmado` en el schema del modelo

**Contexto, verificado línea por línea contra `manejarEscalacion` (`:1035-1115`)**: el "doble paso" de la TUI **no es** que el humano escriba una palabra de confirmación — es que el **mismo comando, con los mismos argumentos**, se reciba **dos veces** desde la **misma sesión**, dentro de un TTL (`CONFIRMACION_TTL_MINUTOS = 2`), comparado contra una ranura mutable (`confirmacionPendiente`) del closure del dispatcher. La primera vez, `confirmado: false` fijo — nunca lo decide el humano ni el modelo, lo decide el dispatcher por no encontrar coincidencia. La segunda, si "coincide" (mismo `dominio`+`accion`+id+`empleadoId`, sin vencer), `confirmado: true` — y la ranura se consume antes de ejecutar.

**El problema nuevo que la conversación introduce, y que el molde de la TUI no resuelve solo**: en la TUI, cada línea que el humano tipea es **una** invocación del dispatcher — hay una barrera estructural entre "primera vez" y "segunda vez" (dos líneas de texto separadas). En una conversación, el modelo podría —por diseño de agente, no por malicia— invocar la tool **dos veces dentro del mismo turno** (p. ej. para "autocorregirse"), y si la única condición para confirmar fuera "coincide con lo pendiente", el modelo **podría autoconfirmar sin que el humano haya dicho una palabra nueva**. Esto es precisamente lo que el ADR 147 pto 3 prohíbe.

**Decisión**:

1. **El schema de la tool NO tiene, y no va a tener, un campo `confirmado`.** Es inexpresable por el modelo, en cualquier operación — mismo criterio "inexpresable, no testeado" que `definicion-skills` ADR 108 y `autorizacion-empleado` ADR 159 ya aplicaron cada uno a su propio invariante. `confirmado` lo decide **exclusivamente** el composition root, nunca un argumento de la tool.
2. **Se reusa la ranura `confirmacionPendiente` existente** (`build-on-comando-empleado.ts:252-279`), **sin duplicarla**: la rama `dominio: "solicitud"` ya tiene la forma exacta que `cancelar_solicitud_interna` necesita (`accion`, `solicitudId`, `casoId`, `empleadoId`, `expiraEn`). Gana **un campo opcional nuevo**, `origenCasoId?: string`, que **solo** escribe el camino conversacional — los tres comandos de comando (`/aprobar-solicitud`, `/rechazar-solicitud`; `/cancelar-solicitud` ya no existe como comando, ADR 148 pto 2) siguen sin tocarlo, con valor `undefined`.

   ```ts
   | {
       readonly dominio: "solicitud";
       readonly accion: AccionSolicitud;
       readonly solicitudId: string;
       readonly casoId: string;
       readonly empleadoId: string;
       readonly expiraEn: string;
       /** SOLO la escribe el camino conversacional (ADR 166). `undefined` = la creó un comando de TUI. */
       readonly origenCasoId?: string;
     }
   ```

3. **La barrera "dos invocaciones distintas" se reconstruye con el `casoId` del turno, no con el reloj.** Cada turno conversacional (cada mensaje del empleado) crea un `casoId` nuevo — mismo patrón exacto que `buildOnSoporte` ya usa (`newId()` por turno, `build-on-soporte.ts:95`). La función que decide "coincide" exige, ADEMÁS de lo que ya exigía `manejarEscalacion`, que **el `casoId` del turno actual sea distinto al que creó la ranura**:

   ```ts
   function coincideCancelacionConversacional(
     pendiente: ConfirmacionPendiente | undefined,
     solicitudId: string,
     empleadoId: string,
     casoIdActual: string,
   ): boolean {
     return (
       pendiente !== undefined &&
       pendiente.dominio === "solicitud" &&
       pendiente.accion === ACCION_CANCELAR_SOLICITUD &&
       pendiente.solicitudId === solicitudId &&
       pendiente.empleadoId === empleadoId &&
       pendiente.origenCasoId !== undefined &&
       pendiente.origenCasoId !== casoIdActual // ★ nunca el mismo turno que la creó
     );
   }
   ```

   Esto hace **estructuralmente imposible** que dos invocaciones de la tool dentro del **mismo** `handleTurn` (mismo `casoId`) se autoconfirmen: la primera crea la ranura con `origenCasoId = casoIdActual`; una segunda invocación en el MISMO turno comparte ese mismo `casoIdActual`, así que `pendiente.origenCasoId !== casoIdActual` es `false` y no coincide. Solo un turno **posterior** (mensaje nuevo del empleado, `casoId` nuevo) puede confirmar — y ese mensaje nuevo solo existe si el humano efectivamente volvió a escribir.
4. **Secuencia completa de `cancelar_solicitud_interna` dentro de `ejecutar-operacion.ts` + el wrapper del composition root** (molde exacto de `manejarEscalacion`, adaptado):
   - Sin `solicitudId` ⇒ listado (`resolverSolicitudInterna({accion:"cancelar", confirmado:false, sesion})`, sin tocar la ranura) — texto con los ids reales, resolviendo de paso la mitad técnica de R7/RD-74 que **sí** aplica a esta operación: el empleado dice "cancelá la de ayer" y el modelo responde con el listado y pide el id real antes de seguir, nunca inventa uno.
   - Con `solicitudId`, sin coincidencia ⇒ `confirmado:false` ⇒ `requiere_confirmacion` ⇒ se fija `confirmacionPendiente = { dominio:"solicitud", accion:"cancelar", solicitudId, casoId: <de la solicitud>, empleadoId, expiraEn, origenCasoId: casoIdActual }` ⇒ el texto que vuelve al modelo repite el `detalle` completo de la solicitud y dice explícitamente *"pedímelo de nuevo, en un mensaje aparte, para confirmar"*.
   - Con `solicitudId`, **con** coincidencia (turno posterior) ⇒ se consume la ranura, `confirmado:true`, se ejecuta.
5. **Alcance real de este ADR, y por qué es más chico de lo que la propuesta temía**: de las seis funciones originales, la Enmienda 2 ya sacó `resolverEscalacionReembolso` entera (bloqueada, RD-74) y dejó de `resolverSolicitudInterna` **solo** `cancelar`. **Este mecanismo resuelve UNA sola operación de doble paso en este change**, no cinco — el mismo hallazgo que ya bajó R7 de "Alta" a "Media" en la propuesta. Se diseña igual con generalidad (parámetro `origenCasoId`, función `coincide*` aislada) porque el change de ejecución del ADR 151 (detrás de `autorizacion-empleado`) va a necesitar exactamente este mecanismo para sus cinco operaciones HITL — se deja el molde listo, no se implementa de más.

**Alternativas consideradas**:

- *Un token de confirmación opaco que el modelo debe repetir* (molde `token-confirmacion.ts`): rechazada. Agregaría un campo al schema que el modelo tendría que leer del resultado anterior y **retransmitir** — funcionalmente posible, pero (a) es más frágil que comparar estado del lado del servidor (el modelo podría truncar o alucinar el token al citarlo) y (b) no resuelve el problema real (una sola invocación puede "leer" su propio token y reinvocar en el mismo turno) sin el mismo guard de `origenCasoId` — así que no ahorra nada y agrega superficie.
- *Confiar en que el prompt le pida al modelo "esperá el próximo mensaje"*: rechazada, es exactamente la instrucción-como-control-de-seguridad que ADR 146 alternativa 1 ya rechazó para autorización — acá se aplica el mismo criterio a confirmación. La instrucción del §3 punto 1 (`INSTRUCCION_OPERACIONES_EMPLEADO`) se agrega igual, como **capa adicional de UX**, no como el control real.
- *Un TTL más corto o más largo que los `CONFIRMACION_TTL_MINUTOS` existentes*: no se cambia — 2 minutos ya es el presupuesto de UX fijado por ADR 36, y no hay motivo de dominio para que la conversación necesite uno distinto.

---

## 6. ADR 167: cableado de `deps` — el adaptador se construye **por turno**, dentro de `buildOnOperacionesEmpleado`, nunca en `main.ts` en frío

**Contexto**. La tool de conocimiento (`createKnowledgeAdapter`) se construye una vez por `casoId`, dentro de `manejarSoporte`/`buildOnSoporte`, porque necesita un recorder fresco por turno. La tool de operaciones tiene una necesidad más fuerte: necesita la `sesion` **vigente en ese instante** y acceso a la ranura de confirmación — ninguna de las dos existe en `main.ts` al momento del arranque.

**Decisión**:

```ts
// src/build-on-operaciones-empleado.ts — molde build-on-soporte.ts
export interface ConfirmacionOperacionPort {
  /** `true` si hay una cancelación pendiente que ESTE turno puede confirmar (ADR 166). */
  estaConfirmada(solicitudId: string, empleadoId: string, casoIdActual: string): boolean;
  marcarPendiente(input: { solicitudId: string; casoId: string; empleadoId: string; origenCasoId: string }): void;
  consumir(): void;
}

export interface BuildOnOperacionesEmpleadoDeps {
  readonly db: Database.Database;
  readonly memory: MemoryPort;
  readonly hooks: ReturnType<typeof bootstrapHarness>["hooks"];
  readonly ventasConfig: VentasConfig;
  /** ★ ADR 171: REINSTAURADO. `registrarVenta` lo exige por tipo (`RegistrarVentaDeps.notifier`, `registrar-venta.ts:60`) — reusa la MISMA instancia que `main.ts` ya construye para `buildOnVenta` (`:334-336`), no una segunda. */
  readonly notifier: VentaNotifierPort;
  /** ★ ADR 171: nuevo. `registrarVenta` lo exige por tipo — reusa `webConfig.publicUrl`, la misma instancia que ya recibe `buildOnVenta` (`main.ts:376`). */
  readonly baseUrlPublica: string;
  /** ★ ADR 171: nuevo, opcional — mismo toggle A2A (`HARNESS_A2A_SALIENTE`) que ya cablea `main.ts` para `buildOnVenta` (`:363-370`). Ausente ⇒ `registrarVenta` se comporta como si A2A estuviera apagado, idéntico al camino HTTP. */
  readonly riesgoCredito?: ConsultaRiesgoCreditoPort;
  /** ★ ADR 174 (Enmienda 5): nuevo, opcional. `consultarReporteComisiones` lo exige por tipo (`EjecutarOperacionDeps.reporteStore: ReporteStorePort`, análogo a `store`). A diferencia de `notifier`/`riesgoCredito`/`baseUrlPublica` (que `main.ts` YA construía para `buildOnVenta` y este change solo reusa), `main.ts` HOY no construye ninguna instancia de `ReporteStorePort` — el default vive inline dentro de `build-on-comando-empleado.ts:860-865`. Ausente ⇒ cae a un default inline IDÉNTICO (mismos closures sobre `db`) dentro de este archivo — funcionalmente correcto pero no compartido; la wiring recomendada (§2, ADR 174) construye UNA instancia en `main.ts` y la pasa explícita a los dos composition roots. */
  readonly reporteStore?: ReporteStorePort;
  readonly despacharDeps: DespacharDelegacionDeps; // reusado tal cual de build-on-comando-empleado (crearSolicitudInterna)
  readonly newId?: () => string;
  /** ★ ADR 171: nuevo, opcional — mismo default `randomUUID` que `buildOnVenta.newToken` (`build-on-venta.ts:379`), lo exige `registrarVenta`. */
  readonly newToken?: () => string;
  readonly now?: () => string;
  readonly logDeps?: LogTurnEventDeps;
}

export function buildOnOperacionesEmpleado(
  deps: BuildOnOperacionesEmpleadoDeps,
): (input: { consulta: string; sesion: SesionEmpleado; confirmacion: ConfirmacionOperacionPort }) => Promise<{ casoId: string; respuesta: string }>;
```

1. **Las `deps` de las cinco funciones (`store`, `config`, `now`, `newId`, `logEvent`, `despacharDeps`) son las MISMAS instancias que `buildOnComandoEmpleado` ya construye** (`store: createVentaStore(db)`, `solicitudStore`, etc. — `:848-869`) — se pasan por parámetro desde `main.ts`, **no se duplican**. ★ **ADR 171 — excepción puntual para `registrarVenta`**: `notifier`, `baseUrlPublica` y `riesgoCredito?` NO vienen de `buildOnComandoEmpleado` (que nunca los tuvo) sino de las MISMAS instancias que `main.ts` ya construye para `buildOnVenta` (`notifier` `:334-336`, `webConfig.publicUrl` `:376`, `riesgoCredito` `:363-370`) — dos consumidores (HTTP y ahora conversación) de las mismas tres instancias, cero duplicación. `main.ts` arma `buildOnOperacionesEmpleado({ ...deps compartidas con buildOnComandoEmpleado, notifier, baseUrlPublica: webConfig.publicUrl, riesgoCredito })` **antes** de armar `buildOnComandoEmpleado`, y el resultado entra como `BuildOnComandoEmpleadoDeps.onOperacionesEmpleado`. Es el mismo criterio con el que hoy `onSoporte` se arma una vez en `main.ts` y se comparte (comentario de `:284-285`) — la diferencia es que ACÁ el handler no se comparte con HTTP, solo se comparten las instancias de `store`/`notifier`/`baseUrlPublica`/`riesgoCredito`.
2. **`sesion` y `confirmacion` viajan como argumento de la función devuelta, no del closure de construcción** — a diferencia de `createKnowledgeAdapter` (que sí cierra sobre `casoId` en el momento de construcción porque un `casoId` no cambia durante su vida), acá `sesion` cambia con cada `/login`/`/logout` y `confirmacion` necesita leer/escribir la ranura viva de `build-on-comando-empleado.ts`. El molde correcto es el de `onDevolucion`/`onSoporte`: una función `(input) => Promise<...>` construida una vez, invocada muchas veces con datos frescos.
3. **`confirmacion: ConfirmacionOperacionPort` se construye INLINE dentro de `build-on-comando-empleado.ts`**, cerrando sobre la MISMA variable `let confirmacionPendiente` que ya existe (`:919`) — nunca un store nuevo, nunca persistencia nueva:

   ```ts
   const confirmacionOperaciones: ConfirmacionOperacionPort = {
     estaConfirmada: (solicitudId, empleadoId, casoIdActual) =>
       confirmacionPendiente !== undefined &&
       confirmacionPendiente.dominio === "solicitud" &&
       confirmacionPendiente.accion === ACCION_CANCELAR_SOLICITUD &&
       confirmacionPendiente.solicitudId === solicitudId &&
       confirmacionPendiente.empleadoId === empleadoId &&
       confirmacionPendiente.origenCasoId !== undefined &&
       confirmacionPendiente.origenCasoId !== casoIdActual,
     marcarPendiente: (input) => {
       confirmacionPendiente = {
         dominio: "solicitud",
         accion: ACCION_CANCELAR_SOLICITUD,
         ...input,
         expiraEn: new Date(Date.parse(now()) + CONFIRMACION_TTL_MINUTOS * 60_000).toISOString(),
       };
     },
     consumir: () => { confirmacionPendiente = undefined; },
   };
   ```

4. **`ejecutar-operacion.ts` NUNCA importa `node:*` ni el SDK** — recibe sus cuatro dependencias de dominio (`store`s, `config`, `now`, `newId`, `logEvent`, `despacharDeps`) tal como cualquier caso de uso existente, y `confirmacion`/`sesion` como parte de su propio `input`/`deps`, sin saber que existe una TUI detrás. El **adaptador** (`src/adapters/operaciones/index.ts`) es la única pieza que sabe de `createSdkMcpServer`/`zod`, exactamente igual que `adapters/knowledge/index.ts`.
5. **Corrección de nota (1), ACTUALIZADA por ADR 171**: el hallazgo original sigue siendo cierto para las cuatro operaciones que no son `registrar_venta` — `resolverDecisionVenta`/`procesarDevolucion` no necesitan `notifier` ni `riesgoCredito` (`ConfirmarVentaDeps`/`ProcesarDevolucionDeps` verificados: `store`, `config`, `now`/`newId`, `logEvent` — sin notificador). **Pero `registrarVenta` (quinta operación, ADR 171) SÍ los exige por tipo** (`RegistrarVentaDeps`: `notifier`, `baseUrlPublica`, `newToken`, `riesgoCredito?` — verificado `registrar-venta.ts:58-78`), así que el campo que este punto proponía eliminar **se reinstaura** — no como sobra especulativa, sino porque hay una operación real del contrato que lo consume. La disciplina "no pasar una dependencia que ninguna operación usa" sigue vigente; simplemente la premisa cambió.
6. **★ ADR 174 (Enmienda 5) — `reporteStore: ReporteStorePort` para la sexta operación**: a diferencia de las cinco anteriores, esta dependencia NO tiene hoy una instancia compartida armada en `main.ts` (verificado: `main.ts` no construye ningún `ReporteStorePort` ni `createVentaStore` explícito — cada composition root arma sus defaults inline al vuelo). El wiring correcto (§2, consecuencias del ADR 174) es que `main.ts` construya `reporteStore` **una sola vez**, con el mismo molde de closures que ya usa `build-on-comando-empleado.ts:860-865`, y lo pase explícito a ambos `buildOn*` — mismo criterio de "una instancia, dos consumidores" que el pto 1 ya aplica a `store`/`notifier`/`riesgoCredito`/`baseUrlPublica`. `EjecutarOperacionDeps.reporteStore` es **requerido** (nunca `undefined`) en `ejecutar-operacion.ts` — la opcionalidad (`reporteStore?`) vive únicamente en `BuildOnOperacionesEmpleadoDeps`, resuelta a una instancia concreta antes de despachar, igual que `store`.

---

## 7. ADR 168: bifurcación exacta de `soporte-prompt.ts` / `build-on-soporte.ts` / `build-on-comando-empleado.ts`

**Contexto verificado**: `build-on-comando-empleado.ts:284-285` documenta, literal, que `onSoporte` es *"el MISMO `buildOnSoporte(...)` que sirve a `POST /soporte` — armado UNA vez en `main.ts` y compartido"*. Ese es el punto exacto de bifurcación.

**Decisión**:

1. **`soporte-prompt.ts` gana una función hermana, `buildOperacionesEmpleadoPrompt(consulta: string): string`**, misma firma pura, mismo truncado (`MAX_SOPORTE_CONSULTA_CHARS`, reusado tal cual — no hay motivo de dominio para un tope distinto). Estructura: rol de empleado con acceso a la herramienta (sin las dos líneas de restricción `:65`/`:69`, que son exactamente lo que este cambio revierte para el empleado) + la consulta + la instrucción de esperar confirmación explícita en un mensaje nuevo (mismo texto que `INSTRUCCION_OPERACIONES_EMPLEADO`, o una referencia a él — se decide en `sdd-tasks` cuál de los dos lugares es la fuente única para no duplicar el texto).
   **`buildSoportePrompt` (la de cliente) no se edita ni una coma.** `git diff -- src/core/ventas/soporte-prompt.ts` debe mostrar solo líneas agregadas, cero líneas removidas de la función existente.
2. **`build-on-soporte.ts` no se toca.** Sigue sirviendo únicamente a `POST /soporte` (HTTP, cliente anónimo). `BuildOnSoporteDeps`, `buildOnSoporte`, `SoporteResult`: sin cambios.
3. > ⚠️ **SUPERSEDIDO POR EL ADR 172/173**: `build-on-comando-empleado.ts` **NO** es donde vive ninguna bifurcación de este change — ese archivo queda sin cambios. **Texto histórico**: ~~`build-on-comando-empleado.ts` es donde vive la bifurcación real, ya detallada en el ADR 165: `BuildOnComandoEmpleadoDeps` gana `onOperacionesEmpleado` (nuevo, del ADR 167); `onSoporte` (el de cliente) se conserva en la misma interfaz, sin renombrar, porque `manejarSoporte` todavía lo necesita para la rama sin sesión.`~~ La bifurcación real de este change vive en `src/adapters/web/server.ts` (`RUTA_OPERACIONES` vs. `RUTA_SOPORTE`, dos rutas HTTP separadas, no una rama dentro de un mismo dispatcher).
4. > ⚠️ **SUPERSEDIDO POR EL ADR 172/173**: `main.ts` gana el wiring de `buildOnOperacionesEmpleado({...})` y de `buildOnLoginHttp({...})`, y los pasa a `startWebServer` (`WebServerDeps.onOperacionesEmpleado`/`onLogin`) — **no** a `buildOnComandoEmpleado`. La construcción de `buildOnSoporte` sigue sin cambios: sigue haciendo falta para `POST /soporte` y para la rama de cliente de la TUI, exactamente igual que hoy, sin ninguna bifurcación nueva agregada encima.

---

## 8. ADR 169 (RD-73): contenido y frontmatter de las skills — escritas contra el schema de **5** operaciones del ADR 163/171

**Contexto**. ADR 149 fijó los límites (una por dominio, ninguna ejecuta ni decide, tool cero salvo lo que ya está en el turno). Con el schema cerrado (ADR 163, pto 1 re-decidido por ADR 171), se puede escribir contenido concreto en vez de un placeholder. ★ **Actualizado**: eran cuatro skills cuando `registrarVenta` estaba fuera del contrato; con el ADR 171 fueron cinco; con el **ADR 174** (Enmienda 5, sexta operación) son **seis**.

**Decisión — seis `SKILL.md`, cada uno enseña a conversar HACIA una `operacion` concreta, nunca a ejecutar nada por su cuenta**:

| Skill | `description` (frontmatter, dispara el modelo) | Enseña |
|---|---|---|
| `.claude/skills/venta-decision/SKILL.md` | "Cuando el empleado te diga que un cliente confirmó o rechazó una venta por otro medio (teléfono, en persona) y tengas o puedas pedir el token de confirmación de esa venta." | Cómo pedir el token si falta, cómo mapear "confirmó"/"aceptó" → `decision: "confirmar"` y "rechazó"/"canceló" → `"rechazar"`, y cómo explicar el resultado (`confirmada`/`rechazada`/`no_aplicable`) sin inventar el monto de la venta — ese dato, si aparece, viene SOLO del texto que devuelve la herramienta |
| `.claude/skills/devolucion-conversacional/SKILL.md` | "Cuando el empleado te pida procesar la devolución de una venta y tengas o puedas pedir el token de confirmación." | Reemplaza `/devolucion <token> [motivo]`: cómo pedir el token si el empleado solo describe la venta en palabras, y cómo explicar `reembolsada`/`escalada`/`no_aplicable` |
| `.claude/skills/solicitud-interna/SKILL.md` | "Cuando el empleado quiera crear una solicitud interna (vacaciones, gasto, reclamo de comisión u otro trámite propio)." | Cómo distinguir `tipo` de `detalle` en lenguaje libre, qué hacer si el tipo no es reconocido (`tipo_desconocido`), y que la solicitud queda pendiente de dictamen/aprobación — esta skill NO cubre cancelar (es la siguiente). ★ **Enmienda 4 (`proposal.md`)**: `reclamo_comision` es un `tipo` más (`SOLICITUD_TIPOS`, `solicitudes-contract.ts:28-31`) — para reunir el `detalle` la skill pregunta qué venta, qué esperaba cobrar y qué pasó, en prosa libre; **nunca** calcula ni muestra un monto de comisión, ni intenta resolver a qué venta corresponde por sistema — eso lo hace, si corresponde, el dictamen humano que ya recibe la solicitud, no la herramienta ni la skill |
| `.claude/skills/cancelar-solicitud/SKILL.md` | "Cuando el empleado quiera retirar o cancelar una solicitud interna propia que ya envió." | El flujo de listado sin id → pedir confirmación explícita repitiendo el detalle → esperar un mensaje NUEVO del empleado antes de reinvocar con el mismo id (la instrucción textual del doble paso, ADR 166) |
| `.claude/skills/registrar-venta-conversacional/SKILL.md` ★ (ADR 171) | "Cuando el empleado te pida dar de alta una venta nueva (cliente, plan, monto ya pactado con el cliente)." | Cómo pedir los datos mínimos (`clienteId`/quién es el cliente, `clienteEmail`, `planNuevo`, `monto`) — **invariante explícito, ADR 170 pto 1**: el `monto` es SIEMPRE el que el empleado declara como ya pactado; la skill **nunca** instruye a estimar, calcular ni sugerir un monto — si el empleado no lo tiene, se lo pide, nunca se lo inventa. `vendedorId` no se pide nunca: lo pone la sesión |
| `.claude/skills/reporte-comisiones-conversacional/SKILL.md` ★ (ADR 174, Enmienda 5) | "Cuando el empleado pida el reporte de comisiones o de ventas de un periodo (propio o de la empresa) por texto." | Cómo entender/pedir el `periodo` (formato `YYYY-MM`, o dejarlo vacío para el mes corriente — igual que `/reporte-comisiones`) y cómo **relayar el texto que la herramienta devuelve tal cual**, sin resumir ni recalcular ningún total. Aclara al empleado, si pregunta, que el reporte es el de toda la empresa para el periodo (mismo alcance que `/reporte-comisiones`), no uno filtrado a sus propias ventas — hallazgo de acceso ya nombrado por la Enmienda 5, sin solución distinta disponible en este repo |

1. **Límite 1 (ADR 106) verificado por skill**: ninguna calcula un monto, ninguna emite un veredicto — las seis únicamente instruyen QUÉ preguntar y CÓMO leer el texto que la herramienta ya devolvió. `registrar-venta-conversacional` transcribe un monto declarado, no lo calcula; `reporte-comisiones-conversacional` transmite un reporte ya agregado, no lo recalcula — el mismo test del ADR 170 pto 2 aplicado a ambas skills, no solo al código.
2. **Límite 2**: las seis requieren `${OPERACIONES_TOOL_QUALIFIED_NAME}` y `${KNOWLEDGE_TOOL_QUALIFIED_NAME}` como máximo, ambas ya concedidas a `construirAgenteEmpleadoOperaciones()` — ninguna pide `Read`/`Bash`/`Write`. A diferencia de `citar-conocimiento` (tool cero), estas SÍ dependen de una tool — es aceptable porque, a diferencia de `citar-conocimiento`, estas seis skills **no** se listan para el turno de cliente ni para los subagentes de PR (su `description` solo dispara en contexto de empleado con sesión, y aunque `Options.skills` es global al proceso — ADR 113/`definicion-skills` —, el turno de cliente jamás tiene la tool concedida, así que aunque el modelo "eligiera" la skill, invocar la tool fallaría en runtime exactamente igual que R3 ya documenta para ese caso general).
3. **Límite 3**: cero secretos, cero rutas de datos — las seis son texto de negociación conversacional o de lectura de reporte.
4. **`sdd-tasks` decide el orden de creación**; no hay dependencia entre ellas.
5. **★ ADR 174**: `reporte-comisiones-conversacional` es la única de las seis sin doble paso (ADR 166 no aplica — no hay estado que mutar ni confirmar) y la única cuya RESPUESTA (no el input) ya trae montos/nombres — la skill instruye a leerla y transmitirla tal cual, nunca a resumirla con un número nuevo. Se decidió como skill propia y no plegada dentro de `venta-decision`/`solicitud-interna` porque su dominio (reporte agregado, de solo lectura) no comparte ninguna de las reglas de negocio de esas dos (ni token, ni doble paso, ni tipo/detalle libre) — mismo criterio "una por dominio" del ADR 106/149 que ya separó las otras cinco entre sí.

---

## 9. Componentes — mapa capability → módulos

| Capability | Módulos | ¿1:1? |
|---|---|---|
| `herramienta-operaciones-negocio` | `core/operaciones/{operaciones-contract,validar-operacion,ejecutar-operacion}.ts` + `adapters/operaciones/index.ts` + los 6 `SKILL.md` (ADR 171/174) | 1:N — con I/O de red (MCP) y seis operaciones a traducir |
| `turno-empleado-autenticado` | `core/agents/definitions.ts` (`construirAgenteEmpleadoOperaciones`) + `core/ventas/soporte-prompt.ts` (`buildOperacionesEmpleadoPrompt`) + `build-on-operaciones-empleado.ts` (ADR 167, sin cambios) + `adapters/web/server.ts` (rutas `/login`,`/operaciones`) + `adapters/web/sesion-empleado-store.ts` + `adapters/web/confirmacion-operaciones-store.ts` + `build-on-login-http.ts` (ADR 172/173 — `build-on-comando-empleado.ts` **NO** forma parte de esta capability en este change) | 1:N — es cableado de composición + identidad, se verifica distinto de la anterior (mismo criterio que separó `registro-skills` de `habilitacion-skills-turno`) |

---

## 10. Archivos — resumen

| Archivo | Acción | Resumen |
|---|---|---|
| `src/core/operaciones/operaciones-contract.ts` | Crear | Constantes + `OperacionNegocio` (6 miembros, ADR 163/171/174) |
| `src/core/operaciones/validar-operacion.ts` | Crear | Whitelist estricta por operación (ADR 163/171/174) |
| `src/core/operaciones/ejecutar-operacion.ts` | Crear | Dispatch a las 6 funciones/pipelines + traducción a texto (ADR 167/171/174) |
| `src/adapters/operaciones/index.ts` | Crear | `createSdkMcpServer`/`tool()`, molde `adapters/knowledge/index.ts` |
| `src/build-on-operaciones-empleado.ts` | Crear | Wiring por turno, molde `build-on-soporte.ts` (ADR 167) |
| `src/core/agents/definitions.ts` | Modificar | +`construirAgenteEmpleadoOperaciones()`. `CONVERSATIONAL_AGENT`/`AGENT_REGISTRY` sin cambios (ADR 164) |
| `src/core/ventas/soporte-prompt.ts` | Modificar | +`buildOperacionesEmpleadoPrompt`. `buildSoportePrompt` byte-idéntica (ADR 168) |
| `src/build-on-soporte.ts` | **Sin cambios** | Verificado — ADR 168 pto 2 |
| `src/build-on-comando-empleado.ts` | **Sin cambios** ★ (ADR 172, revierte ADR 165/166/167 histórico) | `/soporte` (TUI) queda byte a byte como hoy — cero involucramiento de la TUI en el turno de operaciones |
| `src/core/commands/comando-empleado.ts` | Modificar | Bajan 3 descriptores (ADR 148 pto 2, sin cambios respecto de la propuesta). `/soporte` **NO se edita** (ADR 165/172) |
| `src/adapters/web/server.ts` | Modificar ★ (ADR 172/173) | +`RUTA_LOGIN`/`RUTA_OPERACIONES`, `handleLogin`/`handleOperaciones` (molde `handleSoporte`), `WebServerDeps` += `onLogin`, `onOperacionesEmpleado` |
| `src/adapters/web/config.ts` | Modificar ★ (ADR 173) | +`RUTA_LOGIN = "/login"`, `RUTA_OPERACIONES = "/operaciones"`, `OPERACIONES_TIMEOUT_MS` (independiente de `SOPORTE_TIMEOUT_MS`) |
| `src/adapters/web/payloads.ts` | Modificar ★ (ADR 173) | +`parseLoginPayload`, `parseOperacionesPayload` (moldes `parseSoportePayload`) |
| `src/adapters/web/sesion-empleado-store.ts` | Crear ★ (ADR 173) | `Map<token, SesionEmpleado>` en memoria, `crear`/`buscar` (checkea `sesionVigente` reusada) |
| `src/adapters/web/confirmacion-operaciones-store.ts` | Crear ★ (ADR 173) | `Map<empleadoId, ConfirmacionPendiente>` — un slot por empleado, molde del `ConfirmacionOperacionPort` del ADR 167 |
| `src/build-on-login-http.ts` | Crear ★ (ADR 173) | Envuelve `resolverLogin` (núcleo, sin cambios) + `sesionStore.crear`, molde `build-on-soporte.ts` |
| `src/build-on-operaciones-empleado.ts` | **Sin cambios** ★ (ADR 172 pto 7) | La firma del ADR 167 ya era agnóstica del caller — solo cambia quién la invoca |
| `src/core/ventas/reporte.ts`, `reporte-contract.ts` | **Sin cambios** (ADR 174, Enmienda 5) | Reuso verbatim de `resolverPeriodoReporte`/`agruparReporteMensual`/`formatearReporteMensual`/`ReporteStorePort` para la sexta operación. Verificable con `git diff` |
| `src/main.ts` | Modificar | Wiring de `buildOnOperacionesEmpleado`, `buildOnLoginHttp`, `sesionStore`, `confirmacionOperacionesStore` hacia `startWebServer` (ADR 173 pto 5) — **no** hacia `buildOnComandoEmpleado`. ★ **ADR 174**: además construye `reporteStore` UNA vez (mismo molde inline de `build-on-comando-empleado.ts:860-865`) y lo pasa explícito a `buildOnComandoEmpleado` Y `buildOnOperacionesEmpleado` |
| `.claude/skills/{venta-decision,devolucion-conversacional,solicitud-interna,cancelar-solicitud,registrar-venta-conversacional,reporte-comisiones-conversacional}/SKILL.md` | Crear | ADR 169 (5ª skill agregada por ADR 171; 6ª por ADR 174/Enmienda 5) |
| `docs/ARC42_Harness_Empresarial.md`, `README.md` | Modificar | Documentan las 6 operaciones reales del contrato (ADR 163/171/174), la superficie HTTP (ADR 172/173, no TUI) y R10/R12 heredadas tal cual las dejó la propuesta (R12: reporte sin escopear, alcanzable por dos canales, aceptado por checkpoint sin restricción nueva) |

---

## 11. Testing (TDD estricto)

| Archivo | Qué se agrega |
|---|---|
| `validar-operacion.test.ts` | Cero imports (molde `*-contract.test.ts`). Cada una de las 6 operaciones acepta su forma mínima; clave extra (`porcentaje`, `veredicto`, `empleadoId`, `vendedorId`) en cualquier operación ⇒ rechazo; **`monto` como clave extra en las operaciones que NO son `registrar_venta`** ⇒ rechazo (ADR 163 pto 2 sigue vigente para ellas — ADR 170/171 no las toca); **`periodo` como clave extra en cualquier operación que NO sea `consultar_reporte_comisiones`** ⇒ rechazo (ADR 174); `consultar_reporte_comisiones` acepta `{}` y `{ periodo }`, `periodo` es el ÚNICO campo permitido; `operacion` fuera del enum ⇒ rechazo |
| `ejecutar-operacion.test.ts` | Las 6 operaciones con dobles de `store`/`reporteStore`. **`cancelar_solicitud_interna`**: sin `confirmacion.estaConfirmada` ⇒ pide confirmación y llama `marcarPendiente`; con ella ⇒ ejecuta y llama `consumir`. **`registrar_venta`** (ADR 171): `vendedorId` que recibe `registrarVenta` viene de `sesion.empleadoId` inyectado por el wrapper, NUNCA del `input` simulado (regresión del cierre del ADR 147 pto 1 aplicado acá) — **test dedicado del ADR 170 pto 5**: entre la recepción de `input.monto` en el wrapper y la llamada a `registrarVenta`, el valor no sufre ninguna operación aritmética (`===` estricto contra el valor de entrada). **`consultar_reporte_comisiones`** (ADR 174): ver fila dedicada abajo. Nunca lanza (contrato, molde `handleKnowledgeQuery`) |
| `ejecutar-operacion.test.ts` (extendido, `consultar_reporte_comisiones`) ★ NUEVO (ADR 174) | Dobles de `reporteStore`. `periodo` ausente ⇒ mes corriente (`resolverPeriodoReporte(undefined, ahora)`); `periodo` inválido ⇒ mensaje de uso, **cero llamadas a `reporteStore`** (mismo corte "SIN fila" que `manejarReporteComisiones`); `periodo` válido ⇒ `reporteStore.listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente` + `agruparReporteMensual` + `formatearReporteMensual`, texto devuelto **literal** (regresión de igualdad byte a byte, mismo invariante ADR 124). **Sin test de doble paso ni de `confirmacion`** — a diferencia de las otras cinco, esta operación no muta estado: un solo `await`, sin ranura de confirmación, sin `origenCasoId`. Test de regresión: `empleadoId`/`vendedorId`/rol NUNCA entran en la llamada a `reporteStore` (sin gate de rol, ADR 174 pto 2). Nunca lanza |
| `build-on-operaciones-empleado.test.ts` | Molde `build-on-soporte.test.ts` — crea `caso`, arma prompt vía `candidateAgents` de un solo elemento, propaga `TurnFailedError`. **Sin cambios respecto de un consumidor TUI** — el test no sabe ni le importa si lo invoca HTTP o TUI (ADR 172 pto 7) |
| `build-on-comando-empleado.test.ts` | **Sin cambios por este change** ★ (ADR 172) — ningún test nuevo de bifurcación por sesión en la TUI; regresión explícita: `git diff` de este archivo debe quedar vacío |
| `sesion-empleado-store.test.ts` ★ NUEVO (ADR 173) | `crear` devuelve un token; `buscar` devuelve la `SesionEmpleado` mientras esté vigente; `undefined` si el token no existe O si `sesionVigente` da `false` — ambos casos indistinguibles desde afuera |
| `confirmacion-operaciones-store.test.ts` ★ NUEVO (ADR 173) | Dos `empleadoId` distintos con confirmaciones pendientes simultáneas no se pisan (aislamiento real que el slot único de la TUI no necesitaba); reusa el invariante `origenCasoId !== casoIdActual` (ADR 166) sin duplicar la lógica |
| `build-on-login-http.test.ts` ★ NUEVO (ADR 173) | Con credenciales válidas: llama `resolverLogin`, en éxito registra el token en `sesionStore`; con credenciales inválidas: NO crea sesión, responde el mismo genérico indistinguible (regresión del invariante ADR 30 verificado también por HTTP) |
| `definitions.test.ts` (extendido) | `construirAgenteEmpleadoOperaciones()` devuelve `allowedTools` de 3 entradas; `CONVERSATIONAL_AGENT.allowedTools` sigue siendo las 2 de siempre (regresión); `AGENT_REGISTRY`/`listAgentDefinitions()` sin cambios (regresión, ADR 164) |
| `soporte-prompt.test.ts` (extendido) | `buildSoportePrompt` sin cambios en sus fixtures existentes (regresión de las líneas `:65`/`:69`); `buildOperacionesEmpleadoPrompt` nueva, pura |
| `server.test.ts` (extendido) ★ NUEVO — Integración, ADR 173 | **`POST /operaciones` sin header, o con token inexistente/vencido ⇒ `401`, NUNCA invoca `onOperacionesEmpleado`** (mismo criterio ya exigido para `/ventas` — invariante de seguridad de esta corrección, no opcional). Con token válido (emitido por `/login`) ⇒ invoca el turno con la `sesion` correcta; `empleadoId` SIEMPRE sale de la sesión resuelta por el store, nunca del body. `POST /login` con credenciales inválidas ⇒ `401` genérico. **Regresión explícita ya requerida por la propuesta**: el turno de `POST /soporte` (cliente, anónimo) sigue SIN tener la tool de operaciones en su `allowedTools` efectivo — se reconfirma con la ruta hermana nueva a la vista, para que no se confundan |

---

## 12. Migración / Rollout

Sin pasos nuevos respecto de `proposal.md`. La reversión de la pieza cara (`allowedTools`) sigue siendo la ya descrita: como `construirAgenteEmpleadoOperaciones()` es una función pura sin efecto en el registro, "apagar" la herramienta es dejar de invocarla desde `main.ts`/`build-on-comando-empleado.ts` — no requiere revertir `definitions.ts`. **Sin migración de base de datos.**

## 13. Open Questions

- [ ] **No bloqueante, para `sdd-tasks`**: el texto exacto de `INSTRUCCION_OPERACIONES_EMPLEADO` puede vivir en `definitions.ts` o en `soporte-prompt.ts` — ambos lugares son válidos, se decide por conveniencia de import, no por arquitectura.
- [ ] **No bloqueante, cross-change**: el orden de merge entre este change y `autorizacion-empleado` (proposal, *Qué necesita el checkpoint* pto 8) determina si `ResolverSolicitudDeps.rolPort` ya es un campo requerido cuando se implemente el wiring del ADR 167 — si `autorizacion-empleado` mergea primero, el objeto de deps de `cancelar_solicitud_interna` debe incluir `rolPort` (con el mismo default inline documentado en ese diseño). **No cambia ninguna decisión de este documento**, solo el orden de una línea en `sdd-tasks`.
- [ ] **RD-74 sigue BLOQUEADA** (ADR 151) — no es una pregunta abierta de este change, es explícitamente terreno del change de ejecución del ADR 151, detrás de `autorizacion-empleado`. Se nombra acá solo para que `sdd-tasks` no la confunda con una tarea pendiente de este documento.
- [ ] **No bloqueante, gap preexistente nombrado por ADR 171**: no existe en este repo ningún puerto que resuelva `empleadoId → nombre` para poblar `vendedorNombre` con integridad (verificado: ni `credenciales-contract.ts` ni `sesion.ts` tienen campo `nombre`). Se acepta `vendedorNombre` transcripto por el modelo — mismo nivel de confianza que ya tiene hoy por HTTP, sin sesión de por medio — porque no gatea autorización, solo puebla un dato de reporte. Si el checkpoint quiere cerrar el gap con un directorio real de empleados, es un change aparte, no de esta corrección.
- [ ] **No bloqueante, cosmético (ADR 172/173)**: el docstring de cabecera de `sesion.ts:1-9` afirma que `SesionEmpleado` "vive en la ranura del closure de `build-on-comando-empleado.ts` — NUNCA se persiste". Sigue siendo cierto para la TUI, pero deja de ser la ÚNICA ranura que existe: el store HTTP (`sesion-empleado-store.ts`) es una segunda, también en memoria (no persistida a disco/DB, el invariante de fondo del ADR 31 pto 4 se mantiene). Actualizar el comentario para no inducir a un lector futuro a pensar que la TUI es el único productor de dónde vive una sesión — `resolverLogin` sigue siendo el único PRODUCTOR (ADR 37, sin cambios), solo cambian los lugares donde el resultado se guarda. Se deja para `sdd-tasks`/`sdd-apply`, no cambia ninguna decisión de este documento.
- [x] **R12 (Enmienda 5, `proposal.md`) — RESUELTO por el checkpoint, no queda abierto para `sdd-tasks`**: el reporte de comisiones sin escopear, ya alcanzable hoy por `/reporte-comisiones` (TUI, cualquier sesión `privilegiado: true`), se vuelve alcanzable también por `POST /operaciones` (`consultar_reporte_comisiones`, ADR 174). El checkpoint aceptó la exposición sin agregar ninguna restricción nueva (sin gate de rol) — misma paridad que la TUI. Se nombra acá solo para que `sdd-tasks` no lo trate como pendiente.
- [ ] **Riesgo a confirmar por el checkpoint humano, no técnico**: el ADR 172 corrige un ADR 165 escrito sobre una premisa fáctica incorrecta (el requerimiento original del tutor SÍ nombraba la web como consumidor). El requerimiento de fondo (empleados por web, TUI para el administrador) no es nuevo — ya estaba dicho antes del ADR 165 — pero la superficie que un usuario real toca SÍ cambia de forma material (de "nada nuevo, TUI existente" a "una ruta HTTP nueva y autenticada, con su propio mecanismo de sesión"). Es una decisión arquitectónica de las que este repo trata como load-bearing (ADR 4: conceder una superficie es una decisión de autorización, no un trámite). **Se recomienda una confirmación rápida del checkpoint antes de `sdd-tasks`**, no porque la corrección esté en duda, sino porque cambia qué construye el resto del pipeline.

---

**Nota de proceso**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), misma limitación ya documentada por `proposal.md` y por `autorizacion-empleado/design.md`. Se compensó con lectura directa e íntegra o por rango de: `src/adapters/web/server.ts` (572 líneas, entero — `esAutorizado` `:113-132`, `onSoporte`/`handleSoporte` `:60-90,385-449`), `src/core/ventas/soporte-prompt.ts` (73 líneas, entero), `src/core/agents/definitions.ts` (347 líneas, entero), `src/build-on-soporte.ts` (123 líneas, entero), `src/core/turn-selector/resolve-turn.ts` (103 líneas, entero) y `handle-turn.ts:39-235` (`candidateAgents` como parámetro, no lectura directa del registro), `src/build-on-comando-empleado.ts:194-290,840-1270,1690-1740` (deps, `manejarDevolucion`/`manejarEscalacion`/`manejarSolicitud`, la ranura `confirmacionPendiente`, el guard de privilegio y el switch de ruteo), `src/core/auth/sesion.ts` (60 líneas, entero), `src/core/ventas/token-confirmacion.ts` (77 líneas, entero), `src/core/solicitudes/resolver-solicitud-interna.ts` (219 líneas, entero), `src/core/solicitudes/crear-solicitud-interna.ts:58-104`, `src/core/ventas/registrar-venta.ts:1-57` (el hallazgo de `input.monto`, ADR 163), `src/core/ventas/confirmar-venta.ts:33-90`, `src/core/ventas/procesar-devolucion.ts:28-37`, `src/core/solicitudes/solicitudes-contract.ts:31-135`, `src/adapters/knowledge/knowledge-tool.ts` (98 líneas, entero) y `src/adapters/knowledge/index.ts` (151 líneas, entero, el molde de `tool()`/zod), `src/core/knowledge/knowledge-contract.ts` (57 líneas, entero), `src/core/commands/comando-empleado.ts` (grep de `DESCRIPTORES`/`privilegiado`, líneas 46-340,418-462), y los dos `design.md` de referencia (`definicion-skills`, `autorizacion-empleado`, este último **completo**, 484 líneas, para la verificación cruzada de §0). Toda cita de línea corresponde a los archivos tal como existían al momento de esta lectura. Se recomienda correr `graphify update .` una vez persistido este archivo.

**Actualización (corrección post ADR 170, Enmienda 3 de `proposal.md`)**: pasada posterior, **misma limitación de shell** (sin `graphify`, solo `Read`/`Grep`/`Glob`/`Edit`). Re-decide el pto 1 del ADR 163 vía el nuevo **ADR 171** (dentro de la §2, no renumerado — se preservan intactos los §-refs cruzados `§3`/`§7` del resto del documento). Leído para esta pasada: `proposal.md` completo del ADR 170 (líneas 331-369), `registrar-venta.ts` (entero, 194 líneas — el hallazgo real de campos de `RegistrarVentaInput` más allá de `monto`), `src/core/auth/sesion.ts` y `src/core/auth/credenciales-contract.ts` (enteros — confirmar que no hay campo `nombre` en ningún lado, hallazgo nuevo documentado en ADR 171 pto 3), `src/main.ts:320-390` (wiring real de `notifier`/`riesgoCredito`/`baseUrlPublica` para `buildOnVenta`, hallazgo del ADR 167 §6 corregido), `src/build-on-venta.ts` (grep de `newToken`/`newId`/`randomUUID`), `src/adapters/web/server.ts` (grep de auth de `/ventas`, confirmando que hoy es token estático de servicio, no sesión de empleado), y `openspec/changes/autorizacion-empleado/design.md` (grep de convención de supersesión, sin hallazgo de un patrón distinto al ya usado). Todas las citas de línea corresponden a los archivos tal como existían al momento de esta lectura.

**Actualización (corrección de contexto sobre el ADR 165, ADR 172/173)**: pasada posterior, **misma limitación de shell ya documentada dos veces arriba** (sin `graphify`, solo `Read`/`Grep`/`Glob`/`Edit`/`Write`). Corrige un error de traspaso de contexto (no un hallazgo técnico): el requerimiento original del stakeholder, que ya nombraba la web como consumidor del turno de empleado, no llegó a la fase que escribió el ADR 165. Se agrega el **ADR 172** (supersede el ADR 165 íntegro, dentro de la §4, misma convención de no-renumerar) y el **ADR 173** (mecanismo concreto). Leído para esta pasada: `design.md` y `proposal.md` completos (`Read` íntegro, sin `offset` salvo por el límite de longitud de la herramienta — dos llamadas por archivo), `src/adapters/web/server.ts:1-260` y `:385-500` (auth de `/ventas`, molde `handleSoporte`, tabla de ruteo, `WebServerDeps`), `src/adapters/web/config.ts` (grep de `RUTA_*`/`WebConfig`), `src/core/auth/sesion.ts` (entero — el docstring que documenta la ranura de la TUI como único lugar donde vive una sesión, la premisa que este ADR corrige), `src/core/auth/login.ts` y `credenciales-contract.ts` (enteros — firma exacta de `resolverLogin`/`LoginDeps`/`LoginResult`, confirma que es pura, síncrona, y no persiste nada), `src/core/ventas/token-confirmacion.ts` (entero — el molde de token opaco por igualdad de clave que este ADR reusa para la búsqueda de sesión, en vez de `timingSafeEqual`), `src/main.ts:320-475` (wiring real de `onSoporte`/`buildOnComandoEmpleado`, confirma que `credenciales` es hoy un default interno opcional, no una instancia explícita compartida), `src/build-on-comando-empleado.ts` (grep de `CredencialesEmpleadoPort`/`resolverLogin`/`authConfig`/`dummyPasswordHash`, confirma que `credenciales?` ya es un override aceptado sin cambio de tipo), y `src/adapters/memory/repository.ts` (grep, confirma `buscarCredencialEmpleado(db, empleadoId)` como función libre, no un factory). No se ejecutó `graphify update .` — pendiente para después de persistir este archivo, igual que las dos pasadas anteriores.

**Actualización (Enmienda 5, `proposal.md` — sexta operación `consultar_reporte_comisiones`)**: pasada posterior, **misma limitación de shell ya documentada tres veces arriba** (sin `graphify`, solo `Read`/`Grep`/`Glob`/`Edit`). Agrega el **ADR 174** (nueva subsección dentro de §2, sin renumerar el resto del documento — misma convención de no-renumerar ya aplicada por ADR 171/172/173) resolviendo el schema y el cableado que la Enmienda 5 dejó pendientes para esta fase, y actualiza en consecuencia §1, §6 (ADR 167), §8 (ADR 169), §9, §10 y §11. Leído para esta pasada: `proposal.md` (`Grep` de "Enmienda 5" con contexto, confirmando el riesgo **R12** y el hallazgo de acceso "dame MI reporte" ya nombrado ahí), `src/core/ventas/reporte.ts` (entero, 290 líneas — firmas reales de `resolverPeriodoReporte`/`agruparReporteMensual`/`formatearReporteMensual`), `src/core/ventas/reporte-contract.ts` (entero, 21 líneas — `ReporteStorePort`), `src/build-on-comando-empleado.ts:840-870` (default inline de `reporteStore`, confirma que NO hay instancia compartida en `main.ts` hoy) y `:1640-1685` (`manejarReporteComisiones`, el pipeline exacto que la sexta operación reusa), `src/core/commands/comando-empleado.ts:265-305` (`privilegiado: true` de `/reporte-comisiones`, confirma que el descriptor gatea por sesión, nunca por rol), y un `Grep` de `src/main.ts` completo por `createVentaStore`/`reporteStore`/`buildOnOperacionesEmpleado` (cero resultados de construcción explícita — confirma que cada composition root arma sus defaults inline hoy, y que `buildOnOperacionesEmpleado`/`build-on-operaciones-empleado.ts` todavía no existen en el código, consistente con que este change sigue en fase de diseño). Todas las citas de línea corresponden a los archivos tal como existían al momento de esta lectura.

---

## Enmienda 1 (post-implementación, hallazgo de Reviewer): auditoría de acciones conversacionales

> **Qué se corrige, y qué NO.** El Reviewer encontró que un requisito **no negociable** de `proposal.md` —**ADR 147 pto 4** y el riesgo **R5**, con su Success Criterion sin marcar (`proposal.md:492`)— **se perdió en el pase de propuesta a diseño**. No fue un descope consciente: verificado por `Grep`, ni `design.md` ni `tasks.md` mencionan `registro_acciones_empleado`, `RegistroAccionesEmpleadoPort` ni "auditoría" en ninguna línea. Esta enmienda **no reabre ninguna decisión ya aprobada del checkpoint** (R1, ADR 145/147/163/170/171/172/173/174 quedan intactos, y **ningún ADR anterior se reescribe** — misma convención de enmendar-sin-borrar que ya aplicaron el ADR 103 sobre el ADR 8 y el ADR 171 sobre el ADR 163 pto 1). Agrega **una** decisión nueva: **ADR 188** (techo real verificado por `Grep` sobre todo `openspec/changes/*`: **ADR 187**, en `consultas-negocio-a2a-entrante/design.md:27` — no 174, que es sólo el techo de este archivo) y **RD-87** (techo real **RD-86**, ídem `consultas-negocio-a2a-entrante`).

### ADR 188 (RD-87): la fila de `registro_acciones_empleado` la escribe **el dispatcher del núcleo** (`ejecutar-operacion.ts`), con el **mismo literal de `comando`** que escribía el comando retirado — el canal cambia, la fila no

**Contexto**. `RegistroAccionesEmpleadoPort` (`src/core/commands/registro-acciones-contract.ts:85-87`, un único método `registrarAccion(accion: AccionEmpleado): void`) tiene hoy **un solo consumidor**: `build-on-comando-empleado.ts`, que arma la instancia inline (`:868-869`, `deps.registro ?? { registrarAccion: (a) => insertAccionEmpleado(db, a) }`) y la llama a través del helper local `registrar(...)` (`:945-962`). El turno conversacional **nunca la llama**: ni `EjecutarOperacionDeps` (`ejecutar-operacion.ts:49-82`) ni `BuildOnOperacionesEmpleadoDeps` (`build-on-operaciones-empleado.ts:70-88`) tienen un campo para ese puerto. Consecuencia exacta y medible del estado actual: `/devolucion` y `/solicitar` **dejaron de existir como comandos** (tarea 14) y sus efectos **ya no dejan fila** — que es literalmente la degradación que R5 nombra.

Dos hallazgos de esta pasada cambian la forma de la solución respecto de lo que una lectura ingenua haría:

1. **`cancelar_solicitud_interna` ya está auditada, y auditarla otra vez la DUPLICARÍA.** La fila del camino feliz **viaja DENTRO de la transacción del CAS**: `cancelarSolicitudInterna` (`repository.ts:2257-2268`) delega en `resolverSolicitudTransaccional`, que hace `insertAccionEmpleado` en la misma `db.transaction` (`:2213`), con `comando: "/cancelar-solicitud"` y `resultado: "cancelada"` **hard-codeados del lado del store**. Ese camino es **agnóstico del canal por construcción** — funciona igual disparado por TUI o por conversación, sin tocar una línea. Es el molde que el ADR 27 fijó: *"no existe una transición exitosa sin su fila, ni una fila sin su transición"*.
2. **`resolver_decision_venta` no puede correlacionarse con su venta, y no por descuido.** `DecisionVentaResult` (`confirmar-venta.ts:45-49`) **no expone `ventaId` ni `casoId` en ninguna de sus tres ramas** — es la garantía R6 de indistinguibilidad, deliberada. Y el `token` **no puede** ir en la fila: `AccionEmpleado` documenta como garantía **estructural** que no tiene dónde meter `token_confirmacion` (`registro-acciones-contract.ts:47-51`). Como el ADR 145 pto 5 prohíbe modificar las seis funciones deterministas, la fila de esa operación queda **sin columnas de correlación** — igual que las de `/login` y `/reporte-comisiones` hoy. Es el máximo alcanzable, y se declara, no se disimula.

**Decisión**:

1. **El campo vive en `EjecutarOperacionDeps` (núcleo), no en el root.** `EjecutarOperacionDeps` gana `readonly registro: RegistroAccionesEmpleadoPort` (**requerido**, no opcional — mismo criterio que `reporteStore`, ADR 174 pto 6: la opcionalidad vive sólo en el root). **`ejecutarOperacion` devuelve `Promise<string>`**: el root ve prosa, no un `Result`. Sólo el dispatcher del núcleo tiene a la vez la identidad de la operación y el `Result` discriminado del que salen `ventaId`/`casoId`/`resultado`. Auditar desde `build-on-operaciones-empleado.ts` exigiría **parsear texto** (inaceptable) o **cambiar el tipo de retorno a un envelope estructurado**, que propaga a `adapters/operaciones/index.ts` y al root — un refactor más grande y más riesgoso que el defecto que esta enmienda corrige. **Límite hexagonal en verde**: el puerto está definido en `src/core/commands/registro-acciones-contract.ts`, sin un solo import (ni de adaptadores, ni del SDK, ni de Node) — el núcleo puede consumirlo sin romper la regla no negociable de `AGENTS.md`.
2. **La instancia se arma en el composition root, molde exacto de `reporteStore`.** `BuildOnOperacionesEmpleadoDeps` gana `readonly registro?: RegistroAccionesEmpleadoPort`, con default inline **byte-idéntico** al de `build-on-comando-empleado.ts:868-869` (closure sobre `db`, ya disponible en `:71`). Y por la misma consecuencia que el ADR 174 dejó escrita para `reporteStore`: **`main.ts` construye `registro` UNA vez** y lo pasa explícito a **ambos** roots. `build-on-comando-empleado.ts` **no cambia de tipo** (`deps.registro?` ya es opcional, `:316`) — sólo pasa a recibir un valor explícito en vez de caer al default. Un único escritor, una única tabla, dos canales: es lo que *"la trazabilidad no se degrada por cambiar de canal"* significa a nivel de cableado.
3. **El helper `registrar(...)` local, con su PROPIO `try`/`catch` — nunca el `catch` global de `ejecutarOperacion`.** Contrato asimétrico del ADR 40, citado en el puerto (`registro-acciones-contract.ts:70-76`): este puerto **sí** puede lanzar y es el **llamador** quien degrada. El `catch` global de `ejecutarOperacion` (`:328-334`) devuelve *"Contá con que no se aplicó nada"* — que sería **mentira** si el efecto de negocio ya commiteó y lo único que falló fue el `INSERT` de auditoría. Textual del propio puerto: *"El efecto de negocio ya ocurrió; perder la fila es R10, mentir sobre el efecto no lo es."* Éxito ⇒ `logEvent(casoIdActual, "accion-empleado-registrada", { comando, resultado, canal: "conversacional" })`; falla ⇒ `logEvent(casoIdActual, "accion-empleado-registro-fallido", { comando, message })`. **Mejora real sobre la TUI**: ésta correlaciona con la constante `COMANDO_LOG_CORRELATION_ID`; acá se usa el `casoIdActual` real del turno — que es **exactamente lo que el ADR 147 pto 4 pidió** (*"registra que el disparo fue conversacional, con su `casoId`"*).
4. **La marca de canal vive en el `logEvent`, NO en la fila.** `AccionEmpleado` no tiene columna `canal` y no puede tenerla sin migración, y el ADR 27 declara que la ausencia de campos es garantía estructural. Coherente con el ADR 147 pto 4, que habla del `logEvent`, no de la tabla.
5. **`comando`: se reusa el literal del comando retirado. Regla, no caso por caso** — *el valor de `comando` nombra el canal histórico de registro de ese efecto; donde hubo un comando, conserva su nombre; donde nunca existió ninguno, la fila dice `operacion:<nombre>` para que nadie salga a buscar un comando fantasma.* Reusar el literal es la **única** opción compatible con R5: las consultas forenses ya escritas (`repository.ts:1283,1292`, `WHERE r.comando = '/rechazar-reembolso'`) siguen funcionando y un reporte histórico no se parte en dos en el merge. Además está **forzado por el hallazgo 1**: el store hard-codea `"/cancelar-solicitud"` dentro de la transacción y este change no puede tocarlo — inventar literales nuevos produciría una tabla incoherente consigo misma.
6. **Matriz exacta, operación por operación** (paridad verificada contra el handler retirado, no razonada de memoria):

   | Operación | ¿Fila? | `comando` | Correlación | `resultado` | Quién escribe |
   |---|---|---|---|---|---|
   | `procesar_devolucion` | **SÍ**, en las 3 ramas | `COMANDO_DEVOLUCION` | `ventaId`/`casoId`, cada uno con spread condicional sólo si `!== undefined` (molde `manejarDevolucion`, `:1034-1035`) | `reembolsada`→`RESULTADO_REEMBOLSADA` · `escalada`→`RESULTADO_ESCALADA` · `no_aplicable`→`RESULTADO_NO_APLICABLE` (helper `resultadoDevolucion`, `:425-429`) | `ejecutar-operacion.ts` |
   | `crear_solicitud_interna` | **SÍ**, salvo `tipo_desconocido` ⇒ **cero filas** (mismo criterio "cero escrituras" que `crearSolicitudInterna` ya declara, `:1164-1168`) | `COMANDO_SOLICITAR` | `casoId: solicitud.casoId` (sin `ventaId`) | `RESULTADO_CREADA`, con o sin dictamen (molde `:1188`) | `ejecutar-operacion.ts` |
   | `cancelar_solicitud_interna` | **NO en el camino feliz** (ya viaja dentro de la transacción, hallazgo 1 — escribirla sería DUPLICARLA). **SÍ** sólo para `no_aplicable` + `motivo === MOTIVO_CAS` + `casoId !== undefined` | `COMANDO_CANCELAR_SOLICITUD` | `casoId: resultado.casoId` | `RESULTADO_NO_APLICABLE` | store (feliz) / `ejecutar-operacion.ts` (CAS perdido) |
   | ↳ mismos **cero filas** que `manejarResolucionSolicitud` para: modo `listado` (sin `solicitudId`), `requiere_confirmacion` (primer paso del doble paso, ADR 166), `no_es_dueno` y `no_aplicable` + `MOTIVO_NO_ENCONTRADA` | | | | | |
   | `consultar_reporte_comisiones` | **SÍ**, y **sólo** si `resolverPeriodoReporte` resolvió OK. Período inválido ⇒ **SIN fila** (ADR 123 pto 4, corte antes de cualquier lectura, `:1709-1711`) | `COMANDO_REPORTE_COMISIONES` | ninguna (igual que hoy) | `RESULTADO_ATENDIDA` | `ejecutar-operacion.ts` |
   | `registrar_venta` | **SÍ** (sin ancestro de comando — ver pto 7) | `COMANDO_REGISTRAR_VENTA = "operacion:registrar_venta"` ★ nuevo | `ventaId`, `casoId` del `RegistrarVentaResult` | `RESULTADO_CREADA` (se **reusa** el literal, no se inventa: `comando` ya desambigua) | `ejecutar-operacion.ts` |
   | `resolver_decision_venta` | **SÍ** (sin ancestro de comando — ver pto 7) | `COMANDO_RESOLVER_DECISION_VENTA = "operacion:resolver_decision_venta"` ★ nuevo | **ninguna posible** (hallazgo 2: R6 + ADR 27) | `confirmada`→`RESULTADO_CONFIRMADA` ★ nuevo · `rechazada`→`RESULTADO_RECHAZADA` (existente) · `no_aplicable`→`RESULTADO_NO_APLICABLE` | `ejecutar-operacion.ts` |

7. **Sí, `consultar_reporte_comisiones` lleva fila — de solo lectura y todo, y con DOS razones independientes.** (a) **Paridad literal**: su gemelo `/reporte-comisiones` **ya escribe una** (`:1717`), así que no escribirla sería la degradación exacta que R5 prohíbe. (b) **Precedente propio del repo sobre divulgación**: `/ver-solicitudes-a2a` escribe filas justamente *"para que la auditoría distinga una divulgación de contenido de un id mal tipeado"* (ADR 138 pto 2, `:1399-1405`) — o sea que **este repo ya decidió que una lectura que divulga se audita**. Y acá pesa más que en la TUI: **R12** (aceptado por el checkpoint sin restricción nueva, §13) admite que el reporte sin escopear de toda la empresa pasa a ser alcanzable por un canal **más ancho** (`POST /operaciones`, cualquier sesión autenticada). Si se ensancha el canal de una divulgación aceptada a conciencia, la fila que dice **quién** la pidió y **cuándo** es lo mínimo. Y las dos operaciones sin ancestro (`registrar_venta`, `resolver_decision_venta`) también llevan fila: **R5 es un piso, no un techo**. `registrar_venta` es la única operación que transporta un `monto` (la excepción que el ADR 170 tuvo que argumentar más duro) — dejarla sin rastro a nivel de empleado sería incoherente; `ventas.vendedor_id` registra al **beneficiario de la comisión**, no el **acto** de dispararla. Y `resolver_decision_venta` es el caso más filoso de los seis: hoy una venta la confirma o rechaza **el cliente** por token (`GET/POST /confirmar/:token`), sin ningún empleado involucrado; este change permite que **un empleado la resuelva en nombre del cliente**. Eso es un **actor nuevo sobre una transición de dinero preexistente**, con cero rastro actual. No auditarlo no preservaría un punto ciego viejo: **crearía uno nuevo**.
8. **Vocabulario nuevo: aditivo puro, cero migración — verificado, no supuesto.** `registro_acciones_empleado.comando` y `.resultado` son `TEXT NOT NULL` **sin `CHECK`** (migración `0005_registro_acciones_empleado.ts:45-53`, leída íntegra) — mismo criterio y mismo razonamiento que la Enmienda 4 de `proposal.md` aplicó a `solicitudes_internas.tipo`. Se agregan **tres constantes** a `registro-acciones-contract.ts` (`COMANDO_REGISTRAR_VENTA`, `COMANDO_RESOLVER_DECISION_VENTA`, `RESULTADO_CONFIRMADA`) y nada más. **El ADR 145 pto 5 sigue intacto**: ninguna de las seis funciones deterministas se toca — `git diff` en verde sobre las seis.
9. **NO se duplica el chequeo de `sesionVigente`, y la ausencia es decisión, no olvido.** En la TUI, `registrar(...)` no-opea si la sesión venció porque ahí la sesión es una **ranura mutable de closure** que puede vencer entre comandos. Acá `EjecutarOperacionInput.sesion` es **requerida por tipo** y el turno entero ya está gateado en `POST /operaciones` (401 sin token vigente, ADR 173; `sesion-empleado-store.ts` reusa `sesionVigente`). Re-chequear en el núcleo duplicaría una decisión de autorización que la herramienta tiene **explícitamente prohibido inventar** (ADR 151 pto 5, Success Criterion `proposal.md:488`). **Consecuencia a nombrar para que el Reviewer no la lea como omisión: acá NO existe la rama `accion-empleado-sin-sesion` de la TUI — es estructuralmente inalcanzable.**

**Alternativas consideradas**:

- *Llamar `registrarAccion` desde `build-on-operaciones-empleado.ts` (root/wiring), dejando el núcleo sin el campo*: **rechazada, y es la alternativa que parece más limpia hexagonalmente hasta que se mira el tipo.** El root recibe un `string`. Auditar desde ahí obliga a parsear prosa —frágil y absurdo— o a cambiar el retorno de `ejecutarOperacion` a un envelope estructurado, refactor que propaga al adaptador MCP y a los tests de las seis operaciones. Y el argumento hexagonal ni siquiera aplica: el puerto **es del núcleo** (`core/commands/`, sin imports), así que consumirlo desde `core/operaciones/` no cruza ninguna frontera.
- *Literales de `comando` nuevos para las cuatro operaciones que sí tuvieron comando* (p. ej. `operacion:procesar_devolucion` en vez de `/devolucion`): **rechazada.** Distinguiría el canal en la fila, pero **parte en dos toda serie histórica** justo en el merge — la degradación literal que R5 prohíbe — y sería **incoherente con el propio store**, que hard-codea `"/cancelar-solicitud"` dentro de una transacción que este change no puede tocar.
- *Literales `/registrar-venta` y `/resolver-decision-venta` para las dos operaciones sin ancestro*, por uniformidad de formato: **rechazada.** Uniformidad cosmética a cambio de **fabricar historia**: un auditor leyendo `/registrar-venta` saldría a buscar un comando que nunca existió (ADR 148 pto 4 verificó que la venta **nunca** tuvo comando de TUI). El prefijo `operacion:` dice la verdad y es autodescriptivo sin cambiar el schema.
- *Agregar una columna `canal` a `registro_acciones_empleado`*: **rechazada.** Exige migración, y el ADR 27 trata la lista de columnas de `AccionEmpleado` como **garantía estructural** cerrada. El `logEvent` ya transporta el dato, que es donde el ADR 147 pto 4 lo puso.
- *Escribir también la fila del camino feliz de `cancelar_solicitud_interna` desde el dispatcher, "por simetría con las otras cinco"*: **rechazada — sería un bug, no simetría.** Duplicaría cada cancelación exitosa en la tabla (hallazgo 1). La simetría verdadera es con `manejarResolucionSolicitud`, que por la misma razón sólo escribe el `no_aplicable` del CAS perdido.
- *Dejar `consultar_reporte_comisiones` sin fila por ser de solo lectura*: **rechazada** por las dos razones del pto 7 — rompe paridad con su gemelo y contradice el precedente que el propio repo fijó en el ADR 138 pto 2.
- *Difierir la auditoría a un change posterior, "porque las tareas 1-14 ya están implementadas"*: **rechazada.** Es un requisito **no negociable** de la propuesta aprobada con Success Criterion propio (`proposal.md:492`), no un extra. Cerrar el hito con ese criterio sin marcar violaría el checklist de `AGENTS.md`, y el costo real es un campo de `deps`, un helper de ~15 líneas y tres constantes.

**Consecuencias**:

| Archivo | Acción | Resumen |
|---|---|---|
| `src/core/commands/registro-acciones-contract.ts` | Modificar | +3 constantes (`COMANDO_REGISTRAR_VENTA`, `COMANDO_RESOLVER_DECISION_VENTA`, `RESULTADO_CONFIRMADA`). Aditivo puro, cero migración (pto 8) |
| `src/core/operaciones/ejecutar-operacion.ts` | Modificar | +`registro` en `EjecutarOperacionDeps`; helper local `registrar(...)` con `try`/`catch` propio (pto 3); duplicado local de las 4 líneas de `resultadoDevolucion` (`src/core/` **no puede** importar de un archivo raíz — mismo criterio de duplicación deliberada que `CASO_ESTADO_ACTIVO`, `build-on-operaciones-empleado.ts:67`); `ejecutarCancelarSolicitud` pasa a **branchear** `no_aplicable`/`MOTIVO_CAS` (hoy colapsa todo en un texto genérico, `:199-202`) |
| `src/build-on-operaciones-empleado.ts` | Modificar | +`registro?: RegistroAccionesEmpleadoPort` en `BuildOnOperacionesEmpleadoDeps`, default inline idéntico a `build-on-comando-empleado.ts:868-869` |
| `src/main.ts` | Modificar | Construye `registro` UNA vez y lo pasa explícito a **ambos** roots — mismo molde que el ADR 174 ya fijó para `reporteStore` |
| `src/build-on-comando-empleado.ts` | **Sin cambios de tipo** | `deps.registro?` ya era opcional (`:316`); sólo pasa a recibir valor explícito. El ★ "sin cambios" del ADR 172 se conserva en espíritu: cero cambio de comportamiento en la TUI |
| Las **seis** funciones deterministas + `repository.ts` | **Sin cambios** | ADR 145 pto 5 intacto, verificable con `git diff` |

**Testing (TDD estricto, red→green→refactor)** — el test va **primero**, y son todos sobre `ejecutar-operacion.test.ts` con un doble de `RegistroAccionesEmpleadoPort` que captura las llamadas:

- Las **cinco** operaciones que escriben desde el dispatcher llaman `registrarAccion` **exactamente una vez** por camino, con el `comando`/`resultado`/correlación **exactos de la tabla del pto 6** — un caso por rama del `Result`, no un smoke test.
- `empleadoId` de **toda** fila sale de `input.sesion.empleadoId` y **nunca** del `input` del modelo (regresión del ADR 147 pto 1 aplicada a la auditoría).
- **`cancelar_solicitud_interna` camino feliz ⇒ CERO llamadas a `registrarAccion`** (la fila la escribe el store dentro de la transacción). CAS perdido ⇒ **exactamente una**, con `RESULTADO_NO_APLICABLE`. `listado`/`requiere_confirmacion`/`no_es_dueno`/`MOTIVO_NO_ENCONTRADA` ⇒ **cero**.
- **`consultar_reporte_comisiones`**: período válido ⇒ **una** fila `RESULTADO_ATENDIDA`; período **inválido ⇒ CERO filas y cero lecturas de `reporteStore`** (mismo corte que ADR 123 pto 4).
- `crear_solicitud_interna` con `tipo_desconocido` ⇒ **cero filas**.
- **`registrarAccion` que LANZA**: el texto de negocio devuelto al modelo es **idéntico** al del camino feliz (no aparece el genérico *"no se aplicó nada"* del `catch` global) y se emite `accion-empleado-registro-fallido`. Es el test que prueba el pto 3 y el invariante del ADR 40 (*"perder la fila es R10, mentir sobre el efecto no lo es"*).
- Regresión en `build-on-comando-empleado.test.ts`: **sin cambios** — la TUI sigue escribiendo exactamente lo mismo que hoy.

**Deuda que esta enmienda declara y NO resuelve** (para que no se lea como hallazgo nuevo del Reviewer siguiente): la fila de `resolver_decision_venta` **no tiene columnas de correlación** (hallazgo 2 — consecuencia de R6 + ADR 27, dos invariantes previos y deliberados). Cerrarla exigiría exponer `ventaId`/`casoId` en `DecisionVentaResult`, o sea **modificar una de las seis funciones deterministas**, que el ADR 145 pto 5 prohíbe. Correlación disponible mientras tanto: el `logEvent` que `resolverDecisionVenta` ya emite internamente con su `casoId` real, más el `casoIdActual` del turno en el evento `accion-empleado-registrada`. **Si el checkpoint quiere la columna, es un change aparte** — mismo criterio con que el ADR 171 pto 3 dejó afuera el directorio de empleados para `vendedorNombre`.

**Nota de proceso**: pasada posterior, **misma limitación de shell ya documentada cuatro veces arriba** — ejecutor sin herramienta de shell (sólo `Read`/`Grep`/`Glob`/`Edit`/`Write`), así que **no se pudo correr `graphify query`/`explain`/`path`** como pide el hook del repo; se compensó con lectura directa. Leído para esta pasada: `src/core/commands/registro-acciones-contract.ts` (entero, 87 líneas — vocabulario y contrato de fallas del ADR 40), `src/build-on-comando-empleado.ts` (`Grep` de `registrarAccion`/`registrar(` con contexto sobre todo el archivo, + `:1016-1065` `manejarDevolucion` y `:1694-1720` `manejarReporteComisiones` íntegros, + `:425-429` `resultadoDevolucion`), `src/core/operaciones/ejecutar-operacion.ts` (entero, 336 líneas), `src/build-on-operaciones-empleado.ts` (`Grep` de deps/firma), `src/adapters/memory/repository.ts` (`Grep` de `registro_acciones_empleado`/`insertAccionEmpleado` con contexto: `:1369-1403` el `INSERT`, `:1452` y `:2213` las escrituras dentro de transacción, `:2256-2268` `cancelarSolicitudInterna`, `:1278-1293` las consultas forenses por literal de `comando`), `src/adapters/memory/migrations/0005_registro_acciones_empleado.ts:45-55` (confirma `TEXT NOT NULL` **sin `CHECK`**), `src/core/ventas/confirmar-venta.ts:40-55` (`DecisionVentaResult`, el hallazgo 2), `src/core/solicitudes/resolver-solicitud-interna.ts` (`Grep` de `MOTIVO_CAS`/`no_aplicable`/`no_es_dueno` con contexto), y `proposal.md` (`:219-234` ADR 147, `:432` R5, `:474-497` Success Criteria). Techos de numeración **reverificados por `Grep` sobre todo `openspec/changes/*`, no heredados** de este archivo: ADR **187** y RD **86**. Se recomienda correr `graphify update .` una vez aplicadas las tareas de esta enmienda.
