# Propuesta: Canal TUI para empleados — soporte, devolución y cierre de R3 (v1.4.0)

**Origen**: R3 de Hito 4 (`hito-1.3-ventas-comisiones/proposal.md:192`, aceptado en el checkpoint como limitación conocida) · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Interfase I1 (Núcleo ↔ Adaptador TUI), Caja Blanca bloque 3 (Registro de Comandos), Escenario de calidad 4 (operabilidad local) · [Plan de Implementación, Hito 4](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-4-confirmación-de-venta-y-comisiones) · [exploration.md](exploration.md).

**Revisión 3 (2026-09-05)** — incorpora la **tercera decisión del checkpoint humano**, ya tomada y no reabierta acá:

3. **R1 deja de ser un riesgo aceptado sin mitigar.** El checkpoint rechazó tanto dejar `EMPLEADO_ID` como estaba (una variable de entorno = atestación, no credencial) como la salida barata de una contraseña única compartida por toda la empresa (atestación con un paso extra). Pidió **autenticación por empleado, con contraseña propia**, verificada con `node:crypto` (scrypt, sin dependencias nuevas — mismo criterio de minimalismo que el HMAC de Hito 3), un comando `/login` que abre una **sesión en memoria** de la TUI, y los **tres comandos privilegiados** exigiendo esa sesión. Resuelto por los **ADR 30, 31, 32 y 33**.

Esa decisión **reemplaza el modelo de identidad de los ADR 25 y 28**, que asumían `EMPLEADO_ID` como única fuente. Los ADR 25, 26, 27, 28 y 29 conservan su texto con un bloque **Enmienda (revisión 3)** al pie, mismo criterio que la revisión 2 usó con los ADR 23-26.

**Revisión 2 (2026-09-05)** — incorporó las **dos decisiones previas** del checkpoint:

1. **El registro de auditoría se amplía a todas las acciones de la TUI**, no solo a la resolución de la escalación. Resuelto por el **ADR 27** (tabla dedicada `registro_acciones_empleado`, que **reemplaza** las dos columnas sueltas del ADR 25) y el **ADR 28** (qué comandos exigen identidad y qué pasa sin ella).
2. **Un `reembolso_rechazado` se puede reabrir**, con el comando `/reabrir-reembolso`. Resuelto por el **ADR 29**, que enmienda los ADR 23 y 24.

**Rama / tag propuestos**: `hito/v1.4-tui-canal-empleado` → `v1.4.0`, con `docs/progreso/v1.4-tui-canal-empleado/`. Sigue siendo `v1.x` (MVP lineal, AGENTS.md): no introduce subagentes ni A2A. **El nombre y la numeración son decisión del checkpoint** — este change cierra una deuda de Hito 4 pero no es un hito del plan.

## Intent

El Hito 4 shippeó una escalación de reembolso que **nadie puede cerrar desde el producto**. El propio reporte mensual lo dice en voz alta: *"este hito no ofrece ninguna vía de producto (endpoint, pantalla o notificación) para aprobar o rechazar estas escalaciones. La resolución es fuera de banda (SQL manual)"* (`reporte.ts:158`). Eso se aceptó a ojos abiertos como R3, con dueño declarado (Hito 5). Pero un arnés empresarial que exige `SQL manual` sobre la tabla de dinero para completar su propio flujo no es un MVP incompleto: es un MVP con un agujero operativo, y cada día que vive así aumenta la chance de que alguien escriba ese `UPDATE` a mano en producción.

Al mismo tiempo, la TUI —el canal del **empleado**, el bloque más viejo del proyecto (Hito 1)— sigue siendo un único cuadro de texto que solo sabe hacer una cosa: pasarle un string a `handleTurn`. Todo lo que Hito 4 construyó para el cliente final (`POST /soporte`, `POST /devolucion`) es inalcanzable desde adentro de la empresa. `buildOnSoporte` y `procesarDevolucion` existen, están testeados y aprobados, y **hoy solo los llama `startWebServer`** (`main.ts:317-323`); `startTui` recibe únicamente `onSubmit` (`main.ts:341`).

Este change hace las dos cosas con una sola pieza: le da a la TUI un **dispatcher de comandos**, y con él cablea soporte y devolución (reuso puro) y construye el cierre de R3 (lo único genuinamente nuevo). No hay alternativa "sin tocar la TUI": el empleado es el actor de estos tres casos de uso, y la TUI es su única interfaz — agregar un endpoint HTTP más sería resolver el problema del cliente por segunda vez y dejar al empleado exactamente donde está.

La revisión 2 agregó una tercera cosa que las dos primeras hacían inevitable: si la TUI pasa a ser el canal donde un empleado toca soporte, devoluciones y dinero, **la pregunta "quién hizo qué" deja de ser una nota al pie de un solo comando y pasa a ser una propiedad del canal**. De ahí el registro dedicado (ADR 27).

La revisión 3 cierra el círculo, y es la parte que este documento no podía seguir esquivando. El registro del ADR 27 responde *qué pasó*; hasta la revisión 2, la columna `empleado_id` de ese registro no respondía *quién* — respondía "qué decía una variable de entorno en la máquina de quien corrió el comando". Un registro de auditoría cuya columna de actor es autodeclarada no es un registro de auditoría: es un formulario. **Autenticar al empleado no es una feature más de este change: es la condición para que las dos decisiones anteriores signifiquen algo.** Con `/login`, la fila que dice `empleado_id = 'ana'` pasa a significar "alguien que conocía la contraseña de Ana", que es un hecho verificable contra un hash persistido, no una afirmación del propio actor. Y la historia completa que el ADR 29 hizo posible (escalada → rechazada por X → reabierta por Y → aprobada por Z) recién ahora tiene nombres propios en vez de etiquetas.

## Scope

### In Scope

- **Registro de Comandos mínimo** en `src/core/commands/` (carpeta documentada en el arc42, vacía desde Hito 1): `parsearComando(texto)` **puro**, sin I/O, que devuelve una unión discriminada (`ComandoEmpleado | undefined`), más un descriptor por comando (nombre, argumentos, ayuda de una línea) que alimenta `/ayuda`. Ver ADR 21.
- **Dispatcher en el composition root**: `src/build-on-comando-empleado.ts`, hermano de `build-on-submit.ts`/`build-on-venta.ts`/`build-on-soporte.ts`. Envuelve el `onSubmit` existente: si `parsearComando` reconoce el texto, resuelve el comando; si no, delega **tal cual** al `SubmitPromptHandler` de `buildOnSubmit`. `main.ts` pasa el envoltorio a `startTui`.
- **Siete comandos**, todos invocables desde la TUI real:
  - `/login <empleadoId> <password>` → **nuevo (ADR 30, 31)**: verifica la contraseña contra `credenciales_empleado` y abre la sesión en memoria del dispatcher.
  - `/logout` → **nuevo (ADR 31)**: cierra la sesión y limpia cualquier confirmación pendiente.
  - `/soporte <consulta>` → invoca `buildOnSoporte` **sin modificarlo** (único camino de este change que llama al modelo).
  - `/devolucion <token> [motivo]` → invoca `procesarDevolucion`; el `token_confirmacion` sigue siendo la credencial (ADR 19 de Hito 4, intacto — ver ADR 22). Único cambio en ese módulo: **el retorno se ensancha** con `ventaId`/`casoId` para poder auditar sin loguear el token (ADR 27).
  - `/aprobar-reembolso [ventaId]` → sin argumento **lista** los reembolsos pendientes; con `ventaId` pide confirmación y, en el segundo paso, aprueba. **Exige sesión activa** (ADR 32).
  - `/rechazar-reembolso [ventaId]` → mismo flujo de dos pasos, desenlace opuesto. **Exige sesión activa**.
  - `/reabrir-reembolso [ventaId]` → **(ADR 29)**: sin argumento lista los reembolsos rechazados; con `ventaId`, mismo flujo de dos pasos, devuelve la venta a `reembolso_pendiente` y el `caso` a `pendiente_aprobacion_humana`. **Exige sesión activa**.
  - `/ayuda` sale gratis del registro.
- **Caso de uso puro nuevo** `src/core/ventas/resolver-escalacion-reembolso.ts`, hermano de `procesar-devolucion.ts`: síncrono, sin `await`, sin modelo, sin SDK, con `accion: "aprobar" | "rechazar" | "reabrir"` y `confirmado: boolean` explícitos; molde de test `procesar-devolucion.test.ts` (`makeStore` con `vi.fn()`, `now` fijo, `undefined` del CAS → `no_aplicable`).
- **Caso de uso puro nuevo `src/core/auth/login.ts`**: `resolverLogin({ empleadoId, password }, deps)`, **puro y síncrono**, con `verificarPassword: (password, hash) => boolean` **inyectado** como dependencia — mismo patrón que `newId`/`now` en `ConfirmarVentaDeps` (`confirmar-venta.ts:33-36`) y `registrar-venta.ts:57`. Ver ADR 30.
- **`src/core/auth/sesion.ts`**: tipo `SesionEmpleado` y predicado puro `sesionVigente(sesion, ahora)`. **`src/core/auth/auth-config.ts`**: `resolveAuthConfig(env)` para `SESION_TTL_MINUTOS`, molde exacto de `resolveVentasConfig` (función de un diccionario a un valor, sin `import "../config/env.js"`, sin default `process.env`, no lanza). Ver ADR 31.
- **Puerto nuevo `CredencialesEmpleadoPort`** (`src/core/auth/credenciales-contract.ts`) con una sola operación de lectura, `buscarCredencial(empleadoId)`. Ver ADR 30.
- **Adaptador de criptografía nuevo `src/adapters/crypto/password.ts`**: `hashPassword` y `verificarPassword` reales, con `scryptSync` + `randomBytes` + `timingSafeEqual` de `node:crypto`. Hermano de `adapters/webhooks/signature.ts`, que ya resuelve el HMAC de Hito 3 con el mismo criterio. **Cero dependencias nuevas.** Ver ADR 30.
- **Cinco métodos nuevos en `VentaStorePort`**: `aprobarEscalacionReembolso`, `rechazarEscalacionReembolso`, `reabrirEscalacionReembolso` (los tres: CAS + transición del `caso` + **fila de registro**, en **una** transacción), `listarReembolsosPendientes` y `listarReembolsosRechazados`. `aprobarReembolso`/`escalarReembolso` **no se tocan**.
- **Puerto nuevo `RegistroAccionesEmpleadoPort`** (`src/core/commands/registro-acciones-contract.ts`) con una sola operación, `registrarAccion`, para las acciones que **no** ocurren dentro de una transacción de venta (`/login` exitoso, `/soporte`, `/devolucion`, y los intentos `no_aplicable`). Ver ADR 27.
- **Sexto estado** `VENTA_ESTADO_REEMBOLSO_RECHAZADO = "reembolso_rechazado"` y **`CASO_ESTADO_RESUELTO = "resuelto"`** en `ventas-contract.ts`. Ver ADR 23, 24 y 29. **No hace falta un séptimo estado**: la reapertura reusa `reembolso_pendiente`.
- **Migración `0005_registro_acciones_empleado.ts`**: `CREATE TABLE registro_acciones_empleado` + un índice por `venta_id`. Ver ADR 27.
- **Migración `0006_credenciales_empleado.ts`**: `CREATE TABLE credenciales_empleado (empleado_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`. **Sin columna de salt**: el formato del hash lo embebe (ADR 30). `migrations/` en el repo llega hoy hasta `0004` (verificado), así que `0005` y `0006` están libres. Ver ADR 30.
- **Entrypoint CLI de provisioning `src/empleados.ts`** + script `empleados:crear` en `package.json`, molde exacto de `src/reporte-mensual.ts` (parte pura testeada + `openDatabase("data/harness.db")` + `db.close()` en `finally` + guard `isMainModule`). Dos modos: alta (`INSERT`, falla si el id ya existe) y rotación (`--rotar`, `UPDATE`, falla si no existe). **La contraseña entra por `stdin`, nunca por `argv`.** Ver ADR 33.
- **Confirmación en dos pasos con eco del monto** para las **tres** resoluciones. La decisión es pura (`confirmado: boolean` explícito en el caso de uso); la memoria del paso previo vive en el closure del dispatcher, **atada a la sesión** que la abrió (ADR 31), nunca en `src/core/` ni en el adaptador TUI. Ver ADR 25, 29 y 31.
- **Eliminación de `EMPLEADO_ID`** como fuente de identidad. Nunca shippeó: solo existió en las revisiones 1 y 2 de este documento, así que no hay nada que migrar ni compatibilidad que romper. La identidad la da **exclusivamente** la sesión abierta por `/login`. Ver ADR 32.
- **Actualización de `NOTA_ESCALACION_FUERA_DE_BANDA`** (`reporte.ts:158-159`) y de su test. Ver ADR 26.
- **Eventos nuevos de `logTurnEvent`** (`comando-empleado-recibido`, `comando-desconocido`, `login-exitoso`, `login-fallido`, `logout`, `comando-privilegiado-sin-sesion`, `sesion-expirada`, `reembolso-resolucion-solicitada`, `reembolso-escalacion-aprobada`, `reembolso-escalacion-rechazada`, `reembolso-escalacion-reabierta`, `accion-empleado-registrada`, `accion-empleado-sin-sesion`), sin cambiar el contrato del logger — mismo criterio que Hitos 2, 3 y 4.

### Out of Scope

- **Modificar el contrato I1 (`tui-port.ts`), `App.tsx` o `start-tui.tsx`.** Ver ADR 21: el Approach B de la exploración se rechaza. **Consecuencia incómoda de la revisión 3**: la TUI no puede enmascarar lo que se tipea, así que la contraseña de `/login` queda visible en el transcripto. Ver **R14** — es el punto donde este límite duele, y el checkpoint puede decidir levantarlo.
- **Vista dedicada / modo lista navegable en la TUI** (Approach C de la exploración). Ver ADR 21 y la tabla de diferidos.
- **Roles y permisos.** Todo empleado con sesión activa puede ejecutar los tres comandos privilegiados. No hay "quién puede aprobar qué"; eso es el modelo de autorización de Hito 5 (HITL generalizado). `/login` responde *quién sos*, no *qué podés*. Ver ADR 30 y la tabla de diferidos.
- **Desactivación de un empleado** (columna `activo`, revocación), **límite de intentos de login / rate limiting**, **política de fortaleza de contraseña** y **recuperación de contraseña** ("olvidé mi contraseña"). Ver ADR 33, R13 y R15.
- **Sesión persistente entre reinicios de la TUI** o compartida entre procesos. La sesión muere con el proceso, por diseño (ADR 31, R8).
- **Autenticación del adaptador web por empleado.** `POST /soporte` y `POST /devolucion` siguen públicos (su actor es el cliente final) y `/ventas` sigue detrás de su `Bearer` de Hito 4. El adaptador web **no se toca**.
- **Deshacer una aprobación**: `reembolsada` sigue siendo **terminal, sin excepciones**. La reapertura del ADR 29 cubre **solo** `reembolso_rechazado`. La asimetría es deliberada y está justificada en ese ADR.
- **Política de cuántas veces se puede reabrir un mismo caso** (tope duro, segundo aprobador, cooldown). Ver ADR 29 y R11.
- **Lectura/exportación del registro desde la TUI o el reporte** (`/auditoria`, columna nueva en el reporte mensual). La tabla se escribe y se lee **solo** para armar el listado de `/reabrir-reembolso` y el eco de confirmación.
- **Endpoint HTTP de aprobación/rechazo/reapertura.** El actor es interno; duplicar el flujo en el adaptador web sería resolver dos veces el mismo problema en el transporte equivocado.
- **Notificación al cliente cuando su reembolso se aprueba, se rechaza o se reabre.** `VentaNotifierPort` tiene **una sola operación** por ADR 18 de Hito 4; agregar una segunda es una decisión de producto propia.
- **Auditoría de las acciones que llegan por HTTP** (`POST /soporte`, `POST /devolucion`). El adaptador web no se toca y no tiene noción de empleado. Ver ADR 28.
- **Reversión de la comisión al reembolsar** (R5 de Hito 4) y **reembolso parcial**. Siguen diferidos, sin cambios.
- **Generalización del HITL** (tabla `aprobaciones`, validador, delegación). Sigue siendo de Hito 5. Ver ADR 24.
- **Dependencias nuevas en `package.json`.** El archivo **sí se modifica** en esta revisión, pero **solo** para agregar el script `empleados:crear`: `dependencies` y `devDependencies` quedan idénticas. Es una corrección explícita a la revisión 2, que prometía no tocar el archivo.

## Capabilities

### New Capabilities

- `autenticacion-empleado-tui` *(nueva en la revisión 3)*: alta y rotación de credenciales por CLI, verificación de contraseña contra un hash derivado con scrypt, apertura y cierre de sesión en el canal TUI, vigencia y expiración de esa sesión, y la regla de qué comandos la exigen. Incluye los invariantes negativos: la contraseña **nunca** se persiste en claro, **nunca** aparece en una fila de auditoría y **nunca** aparece en un evento del log de turnos.
- `comando-empleado-tui`: reconocimiento de comandos con prefijo `/` en el canal de la TUI, ruteo al manejador correspondiente, degradación a turno conversacional normal para cualquier texto que no sea un comando, y respuesta de ayuda/uso ante comando desconocido o argumentos faltantes.
- `reembolso-resolucion-escalacion` *(renombrada respecto de la revisión 1, donde se llamaba `reembolso-cierre-escalacion`)*: listado de escalaciones pendientes **y rechazadas**, confirmación en dos pasos con eco del monto, y **tres** transiciones — aprobar (`reembolso_pendiente → reembolsada`), rechazar (`reembolso_pendiente → reembolso_rechazado`) y reabrir (`reembolso_rechazado → reembolso_pendiente`) — cada una con la transición correspondiente del `caso` y su fila de registro, todo en una transacción. **El rename es gratis**: es una capability nueva, no existe `openspec/specs/reembolso-cierre-escalacion/spec.md` que migrar (verificado: `openspec/specs/` todavía no existe), y "cierre" dejó de describir lo que hace (ADR 29).
- `registro-acciones-empleado`: qué acción de empleado deja rastro, con qué datos, con qué garantía de atomicidad, y qué **nunca** se guarda (`token_confirmacion`, contraseña, texto de la consulta, motivo del cliente). Incluye el comportamiento sin sesión activa. Es capability propia y no un requisito suelto de las otras porque **cruza todos los comandos** y tiene invariantes propias (ADR 27, 28 y 32).

### Modified Capabilities

- `reembolso-evaluacion`: su requisito *"Cierre de la escalación fuera de alcance"* deja de ser cierto. Pasa a: la escalación **tiene** un camino de producto para cerrarse **y para reabrirse**, y `reembolso_pendiente` deja de ser un estado terminal. Se agrega el sexto estado al vocabulario canónico. Además, `DevolucionResult` **se ensancha** con `ventaId`/`casoId` en las ramas donde la venta se conoce — sin cambiar la secuencia, las guardas ni los efectos de `procesarDevolucion` (ADR 27).
- `reporte-comisiones-mensual`: la nota literal de la sección de reembolsos pendientes cambia (ADR 26 y su enmienda de la revisión 3), y `ventasConReembolso` gana un caso borde definido (una venta `reembolso_rechazado` **no** se cuenta — ver ADR 23). Una venta reabierta vuelve a aparecer en el listado de pendientes del reporte, que es el comportamiento correcto y no requiere cambio de código.
- `soporte-web-turno`: **sin cambio de contrato ni de comportamiento.** Gana un segundo invocador (la TUI) sobre el mismo handler ya construido; lo único nuevo es que ese invocador escribe una fila de registro —cuando hay sesión activa— con el `casoId` que el handler ya devuelve. Se lista acá solo para que `sdd-spec` verifique que el requisito sigue redactado en términos del caso de uso y no del transporte HTTP.

## Decisiones de arquitectura fijadas por esta propuesta

La numeración continúa: arc42 fijó ADR 1-2, Hito 2 fijó ADR 3 / 3.1 / 4, Hito 3 fijó ADR 5-10, la propuesta de Hito 4 fijó ADR 7-11 en su propia secuencia y su diseño fijó ADR 12-20. **La revisión 1 de este documento fijó ADR 21-26; la revisión 2 agregó ADR 27-29; la revisión 3 agrega ADR 30-33.**

### ADR 21: El dispatcher es un prefijo de texto resuelto por un parser puro en `src/core/commands/` — el contrato I1 no se toca, y el disparador que el ADR 9 definió ya sonó

**Contexto**. La TUI no tiene ningún sistema de comandos. `SubmitPromptHandler` (`tui-port.ts:39-42`) es `(prompt: string, onAgentResolved?) => Promise<TuiTurnResult>`; `App.tsx` expone ese único handler y `start-tui.tsx:143-150` monta `<App onSubmit={onSubmit} />` con un solo parámetro de wiring. La exploración comparó tres approaches.

**Decisión**. Se adopta el **Approach A**, con una precisión que la exploración no tenía:

1. El texto entra por `onSubmit` como siempre. Un **envoltorio** en el composition root (`build-on-comando-empleado.ts`) llama a `parsearComando(texto)` antes de nada.
2. `parsearComando` es **pura y vive en `src/core/commands/`** — devuelve una unión discriminada tipada (`{ tipo: "login", empleadoId, password } | { tipo: "soporte", consulta } | { tipo: "devolucion", token, motivo? } | { tipo: "aprobar_reembolso", ventaId? } | { tipo: "reabrir_reembolso", ventaId? } | ...`) o `undefined` si el texto no empieza con `/`.
3. Si es `undefined`, el envoltorio delega **el string original, sin tocar**, al `SubmitPromptHandler` que `buildOnSubmit` ya devuelve. El camino conversacional de Hito 1 queda byte por byte idéntico.
4. La respuesta de un comando se devuelve como un `TuiTurnResult` normal, con `agentLabel: "sistema"` (o `"soporte"` para `/soporte`). **Cero cambios en `tui-port.ts`, `App.tsx` y `start-tui.tsx`.**
5. `onAgentResolved` **no** se invoca para comandos deterministas: no hay agente que anunciar. Es opcional en el contrato, así que omitirlo es uso legítimo, no una omisión.

**Por qué el parser va en `src/core/commands/` y no en el adaptador.** El ADR 9 de Hito 4 rechazó construir el Registro de Comandos y dejó el disparador **escrito**: *"un segundo comando y alguien que resuelva comandos por nombre (p. ej. comandos slash en la TUI)"*. Este change trae **siete** comandos y exactamente ese resolvedor. El disparador sonó; construirlo ahora no es YAGNI incumplido, es el criterio del propio ADR 9 aplicándose. Y el argumento que hundió al Registro de Skills (ADR 8: "una skill implica una tool-call del LLM, y eso mete el modelo en el camino del dinero") **no aplica acá**: un comando de empleado es determinista por construcción; el registro no invita al modelo a nada.

**Alternativas consideradas**:

- *Approach B — extender `SubmitPromptHandler`/`TuiTurnResult` con un tipo de acción*: **rechazada**. Rompe el contrato I1 documentado en el arc42 y en el module doc de `tui-port.ts`, y obliga a tocar `App.tsx`, cuyo minimalismo está deliberadamente documentado. Lo que compra —una unión discriminada en vez de un string— **lo conseguimos igual** con el Approach A: la unión existe, solo vive un milímetro más adentro, detrás del borde de transporte. Es exactamente lo que hace el adaptador web al parsear un body JSON a una forma tipada. Un `prompt: string` que entra por un cuadro de texto **es** un borde de transporte; parsear en el borde es el patrón, no la excepción.
- *Approach C — vista dedicada con lista navegable*: **rechazada para este change, diferida como mejora de UX**. Es la mejor experiencia para elegir entre N escalaciones pendientes, pero: (a) no resuelve `/soporte` ni `/devolucion` con el mismo mecanismo, así que igual haría falta un dispatcher; (b) sería el primer modo con estado de navegación de la TUI, la superficie de UI más grande del proyecto hasta hoy; (c) el listado que necesita ya se lo damos con `/aprobar-reembolso` y `/reabrir-reembolso` sin argumento. Construirla después es aditivo sobre lo que este change deja.

**Consecuencias**:

- **Impacto en I1: ninguno a nivel de tipos.** Sí hay un **ensanche semántico** de `agentLabel`: el module doc de `tui-port.ts` lo define como "cuál agente produjo `responseText`", y `"sistema"` no es un agente. Se documenta en `tui-port.ts` (solo comentario) y en el cierre del hito, para que no parezca un descuido. El arc42 describe la salida de I1 como *"respuesta renderizada con estado del agente"*; para un comando determinista el estado honesto es "ninguno", y `"sistema"` es su rendering.
- El parsing de texto libre es frágil (typos, argumentos con espacios). Se acota: los argumentos son **posicionales y de forma conocida** (un `ventaId`/`token` opaco sin espacios, y a lo sumo un resto de línea libre como `motivo`/`consulta`), y un comando mal escrito nunca cae en un camino destructivo — cae en `/ayuda`.
- Un texto conversacional que empiece con `/` se interpreta como comando. Se acepta: es la convención universal, y un comando desconocido responde con la ayuda, no con un efecto.
- `src/core/commands/` deja de estar vacío. Con el ADR 27 pasa a alojar además el contrato del registro de acciones, que es transversal a los comandos y no pertenece al dominio `ventas`. `src/core/skills/` **sigue vacía**, y su disparador (ADR 8) sigue sin sonar — se reafirma explícitamente para que el cierre no lo confunda.

**Enmienda (revisión 3)**. `parsearComando` incorpora `/login` y `/logout`. Eso trae un requisito nuevo y **negativo** que el ADR 21 original no contemplaba: **el texto crudo de un `/login` no puede terminar en ningún lado que se persista**. La regla concreta para `sdd-spec`: `logTurnEvent` recibe el `empleadoId` tipeado y **nunca** el segundo argumento posicional; el evento genérico `comando-empleado-recibido` **no** incluye el texto original cuando el comando es `/login`; y el registro de comandos desconocidos tampoco. Es la primera vez que un argumento de comando es un secreto y no un identificador opaco, y el parser tiene que tratarlo como tal desde el primer test. Lo que **no** cambia: cero modificaciones de tipos en I1, y el eco visible en pantalla sigue fuera de nuestro control (R14).

### ADR 22: `/devolucion` sigue autenticado por `token_confirmacion`; `/aprobar-reembolso` opera por `ventaId`. La asimetría es deliberada

**Contexto**. `procesarDevolucion` busca la venta por `token` (ADR 19 de Hito 4: el token de confirmación **es** la credencial de ese camino). Desde la TUI sería más cómodo escribir un `ventaId`, que es lo que el reporte mensual imprime.

**Decisión**. **No se agrega ningún camino de devolución por `ventaId`.** `/devolucion` toma el token, tal cual, y llama a `procesarDevolucion` sin cambiar su búsqueda ni sus guardas.

**Por qué**. Agregar `buscarVentaPorId` al camino de devolución **elimina la única credencial que ese camino tiene**: cualquier venta `confirmada` pasaría a ser reembolsable por cualquiera que abra la TUI, sin que el cliente presente nada. Sería revertir el ADR 19 por comodidad de tipeo. El empleado que procesa una devolución la procesa *porque un cliente se la pidió*, y ese cliente tiene el link.

En cambio `/aprobar-reembolso` **sí** opera por `ventaId`, y eso no es incoherente: cerrar una escalación es por definición una decisión **interna** sobre un caso que el sistema ya marcó como pendiente. No hay contraparte externa que presente credencial; el `ventaId` es un selector, no una autorización. La autorización de ese camino es otra cosa, y la trata el ADR 25 (revisión 1), corregida por los ADR 30-32.

**Enmienda (revisión 2)**. El ADR 27 obliga a conocer el `ventaId` **después** de procesar una devolución, para poder auditarla sin loguear el token. Eso **no** reintroduce un camino de lectura por id: el `ventaId` sale del retorno ensanchado de `procesarDevolucion`, que lo obtuvo **de la búsqueda por token que ya hacía**. No hay `buscarVentaPorId` en ninguna parte de este change, y `/reabrir-reembolso` tampoco lo necesita (ADR 29 usa un listado filtrado por estado, no un lector por id).

### ADR 23: Un reembolso escalado y rechazado va a un **sexto** estado, `reembolso_rechazado` — ni `rechazada` ni vuelta a `confirmada`

**Contexto**. `VENTA_ESTADO_RECHAZADA` (`ventas-contract.ts:25`) hoy significa exactamente una cosa: **el cliente declinó la compra antes de confirmarla** (`pendiente_confirmacion → rechazada`, `rechazarVenta`, sin comisión). No existe ningún estado para "la venta está confirmada, se pidió reembolso, un humano lo denegó".

**Decisión**. Sexto valor canónico: `VENTA_ESTADO_REEMBOLSO_RECHAZADO = "reembolso_rechazado"`. Legal sin tocar el esquema, porque `ventas.estado` es `TEXT` abierto sin `CHECK` (migración 0004) y la lista canónica vive en el núcleo.

**Alternativas consideradas**:

- *Reusar `rechazada`*: **rechazada**. Conflaría dos hechos financieros opuestos bajo el mismo valor: una venta que **nunca fue** (sin comisión, sin plata) y una venta **vigente** (con comisión pagada, con plata cobrada) cuyo reembolso se denegó. Cualquier lectura futura que cuente "ventas rechazadas" mezclaría las dos, y el reporte mensual —que hoy imprime `ventaEstado` junto a la comisión precisamente para hacer visible R5— pasaría a mentir.
- *Volver a `confirmada`*: **rechazada, y es la alternativa seria**. Es cierto que tras un rechazo la venta *está* vigente, con su comisión intacta — semánticamente `confirmada` es casi correcto. Se descarta por dos consecuencias concretas: (a) **se pierde el hecho**: no queda rastro en el estado de que hubo una escalación resuelta, y el único registro sería el log; (b) **reabre el camino**: el CAS de `procesarDevolucion` es `WHERE estado = 'confirmada'`, así que la venta volvería a ser devolvible, y el mismo cliente podría re-escalar el mismo reembolso indefinidamente — un rechazo que no rechaza nada. Con `reembolso_rechazado`, ese CAS no matchea y el resultado es `no_aplicable` con `motivo: "estado"`, que es el comportamiento correcto y **ya está implementado y testeado**: no hay una línea nueva en `procesarDevolucion` por este motivo.
- *Columna `resultado_escalacion` sobre `confirmada`*: **rechazada**. Es un segundo eje de estado para una máquina que ya tiene uno; la propia venta es la entidad y `estado` es su máquina.

**Consecuencias**:

- **`ventasConReembolso` del reporte NO cuenta `reembolso_rechazado`**, y es correcto: esa columna existe para hacer medible R5 (comisión viva sobre plata devuelta), y en un rechazo **no se devolvió plata**. Es un caso borde que el spec debe fijar explícitamente, no dejar que caiga por omisión del `if`.
- Un reembolso rechazado es terminal **para el cliente**: ningún camino que arranque afuera (`POST /devolucion`, el link del token) lo mueve.

**Enmienda (revisión 2 — pedido del checkpoint)**. `reembolso_rechazado` **deja de ser terminal en términos absolutos**. Pasa a ser *terminal salvo reapertura explícita por un empleado identificado*: la única transición que sale de ese estado es `/reabrir-reembolso` (ADR 29), que lo devuelve a `reembolso_pendiente`. Lo que **no** cambia:

- El CAS de `procesarDevolucion` sigue siendo `WHERE estado = 'confirmada'`, así que el cliente sigue sin poder re-escalar por su cuenta: la reapertura es un acto interno, no un camino que se le abre al cliente. El argumento (b) contra *volver a `confirmada`* sigue intacto.
- `ventasConReembolso` sigue sin contar `reembolso_rechazado`. Una venta reabierta vuelve a estar en `reembolso_pendiente` y el reporte la muestra como pendiente otra vez, sin código nuevo.
- El hecho no se pierde: la historia completa (escalada → rechazada por X → reabierta por Y → aprobada por Z) vive en `registro_acciones_empleado` (ADR 27), que es append-only. **Esta es la razón por la que las dos decisiones del checkpoint van juntas**: sin el registro, una reapertura pisaría el rastro del rechazo anterior y el estado quedaría contando una historia parcial.

### ADR 24: El `caso` va a `resuelto` en **ambos** desenlaces — el resultado vive en la venta, no en el caso

**Contexto**. Nada saca hoy un `caso` de `pendiente_aprobacion_humana`. El ADR 11 punto 2 de Hito 4 lo puso ahí en la misma transacción que la escalación, vía el `caso_id` que la venta ya tiene.

**Decisión**. `CASO_ESTADO_RESUELTO = "resuelto"`, un solo valor para aprobación **y** rechazo, aplicado con `updateCaso` (`repository.ts:131`) dentro de la misma transacción que el CAS de la venta. Vive en `ventas-contract.ts`, junto a `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`, con el mismo comentario de mudanza: cuando Hito 5 generalice el HITL y aparezca un segundo dueño semántico, se muda.

**Por qué un solo valor y no `resuelto_aprobado`/`resuelto_rechazado`**. El `caso` es el **handle de correlación** de todo lo que le pasa a esa venta (ADR 11 punto 2), no una segunda máquina de estados. Duplicar el desenlace en los dos lados abre la puerta a que diverjan, y la fuente de verdad del desenlace ya es `ventas.estado`. El `caso` solo necesita responder una pregunta: *¿sigue esperando a un humano?* `resuelto` la responde.

**Consecuencia**: `pendiente_aprobacion_humana` deja de ser un estado sin salida. Hito 5 hereda un ciclo `activo → pendiente_aprobacion_humana → resuelto` ya cerrado y probado, en vez de tener que inventarlo.

**Enmienda (revisión 2 — pedido del checkpoint)**. Con `/reabrir-reembolso`, el ciclo del `caso` deja de ser lineal y pasa a ser **cíclico**: `activo → pendiente_aprobacion_humana → resuelto → pendiente_aprobacion_humana → resuelto → …`. La reapertura **reusa el mismo `caso`** (ver ADR 29); no se crea uno nuevo. El criterio del ADR 24 no solo sobrevive: es **el que fuerza esa decisión**. Si el `caso` es el handle de correlación de la venta, entonces la venta tiene exactamente uno, para siempre; crear un segundo caso obligaría a pisar `ventas.caso_id`, dejaría el caso viejo huérfano y **partiría en dos el hilo de log correlacionado** de una misma venta — que es justamente lo que el ADR 11 punto 2 existe para evitar. Y la pregunta que el `caso` responde sigue siendo la misma y sigue siendo suficiente: *¿sigue esperando a un humano?* Tras una reapertura, la respuesta vuelve a ser sí.

### ADR 25: Auditoría persistente + confirmación en dos pasos con eco del monto; la identidad es **atestada, no autenticada** — riesgo aceptado, no mitigado

> **Estado en la revisión 3: el punto 2 de este ADR está DEROGADO.** Ver la enmienda al pie. Se conserva el texto original porque es el razonamiento que el checkpoint leyó y rechazó, y borrarlo dejaría la decisión 3 sin contexto.

**Contexto**. Es el punto más incómodo de este change y hay que decirlo entero. `/ventas` está detrás de `Authorization: Bearer` con comparación en tiempo constante (`web/server.ts:106-132`), y el argumento que lo justificó fue explícito: *"el vendedor no corre nada en la máquina del arnés"* (proposal.md de Hito 4, línea 149). La TUI **no tiene ninguna capa de autenticación** — hasta hoy era aceptable porque lo único que expone es conversación. `/aprobar-reembolso` cambia ese perfil: mueve estado financiero, es irreversible, y ningún campo del esquema captura quién lo hizo.

**Decisión**. Tres piezas, y ninguna pretende ser autenticación:

1. **Auditoría persistente.** Escrita en la misma transacción que el CAS. Es la primera vez que el esquema captura identidad de actor. *(La forma concreta de esa auditoría la fija el **ADR 27**, que reemplaza la propuesta original de dos columnas en `ventas` por una tabla dedicada — ver la enmienda al pie.)*
2. **Identidad por configuración.** `EMPLEADO_ID` (env, resuelta por función pura, molde `resolveVentasConfig`). **Sin `EMPLEADO_ID`, los comandos de resolución no están disponibles** y responden diciendo qué falta. No hay default y no hay resolución anónima: preferimos un comando indisponible a una fila de auditoría que diga `"desconocido"`. La TUI arranca igual y el resto de los comandos funciona — clase "degrada" del ADR 17, no "aborta". *(Qué comandos exactamente exigen `EMPLEADO_ID` lo fija el **ADR 28**.)*
3. **Confirmación en dos pasos con eco del monto.** `/aprobar-reembolso v-123` **no ejecuta**: responde con `venta v-123 · cliente · monto 4500.00 · caso c-9` y pide repetir el comando para confirmar. El segundo comando idéntico, dentro de una ventana corta, ejecuta. La decisión es **pura**: `resolverEscalacionReembolso` recibe `confirmado: boolean` y, si es `false`, devuelve `{ resultado: "requiere_confirmacion", ... }` **sin tocar el store**. La memoria del paso previo (`{ ventaId, accion, expiraEn }`, una sola ranura) vive en el closure del dispatcher — ni en `src/core/`, que sigue puro y síncrono, ni en el adaptador TUI, que sigue sin saber que existen los comandos.

**Por qué el eco del monto y no un `--confirmar` en la misma línea.** Un flag en la misma línea protege contra el Enter accidental, pero no contra el error real de este flujo: **aprobar la venta equivocada**. El eco obliga a que el operador *lea el monto y el cliente* antes de comprometerse. Cuesta un `if` y un campo en un closure.

**Lo que esto NO es**. `EMPLEADO_ID` es una variable de entorno en la máquina del empleado: quien tenga acceso al proceso puede ponerle cualquier valor. **Es una atestación, no una credencial**, y la fila de auditoría vale exactamente lo que valga la confianza en esa máquina. Autenticación real (login, roles, permisos) está fuera de alcance y no se disfraza: **este es un riesgo ACEPTADO (R1), no mitigado**, y el checkpoint humano tiene que aceptarlo explícitamente o exigir autenticación antes de `sdd-spec`.

**Enmienda (revisión 2 — pedido del checkpoint)**. El punto 1 queda **reemplazado por el ADR 27**: la auditoría deja de ser `ventas.resuelto_por`/`resuelto_at` y pasa a ser la tabla `registro_acciones_empleado`, que cubre todos los comandos y no solo la resolución. El punto 2 se **precisa** con el ADR 28. El punto 3 se **extiende** a `/reabrir-reembolso` (ADR 29). **Lo que NO cambia: ampliar el registro NO resuelve R1.** Un registro más completo mejora la **trazabilidad** y no toca en absoluto la **autenticidad** de la atribución.

**Enmienda (revisión 3 — decisión 3 del checkpoint)**. El checkpoint eligió la salida (b) que este ADR dejaba abierta: **exigir autenticación**. En consecuencia:

- **El punto 2 queda DEROGADO por completo.** `EMPLEADO_ID` desaparece del change (ADR 32). La identidad ya no se configura: se **prueba**, con una contraseña por empleado verificada contra un hash scrypt persistido (ADR 30), y vive en una **sesión** abierta por `/login` (ADR 31).
- **El punto 1 sobrevive intacto** en su forma del ADR 27, pero su valor cambia de naturaleza. La columna `empleado_id` de cada fila deja de significar *"lo que decía una variable de entorno"* y pasa a significar *"alguien que conocía la contraseña de ese empleado"*. Es la diferencia entre un formulario y un registro de auditoría.
- **El punto 3 sobrevive y se refuerza con una regla nueva**: la ranura de confirmación pendiente queda **atada a la sesión** que la creó (ADR 31). Sin esa atadura, la confirmación de dos pasos sería un bypass: el empleado A prepara y el empleado B confirma, o la sesión expira entre paso y paso y el segundo paso ejecuta igual. El paso 1 no es una autorización almacenada; la autorización se re-verifica en el paso 2.
- **La frase final del ADR original ("autenticación real está fuera de alcance y no se disfraza") deja de aplicar.** La autenticación entra al alcance. Lo que **sigue** siendo cierto, y hay que decirlo con la misma franqueza con la que se dijo lo anterior: la contraseña se verifica contra un hash que vive en el **mismo archivo SQLite** que el proceso de la TUI puede escribir. Quien tenga escritura sobre `data/harness.db` puede darse de alta a sí mismo como empleado nuevo y loguearse. **R1 baja de severidad, no desaparece** — ver R1 y R16.

### ADR 26: `NOTA_ESCALACION_FUERA_DE_BANDA` se actualiza **en este mismo change**, no se difiere

**Contexto**. `reporte.ts:158-159` afirma textualmente que no existe vía de producto para cerrar las escalaciones y que la resolución es SQL manual hasta Hito 5. Está testeada en `reporte.test.ts` y se imprime **siempre**, incluso sin reembolsos pendientes.

**Decisión**. Se actualiza acá, junto con su test. **No se difiere.**

**Por qué**. En el instante en que `/aprobar-reembolso` mergea, ese párrafo pasa a ser **falso**, y no es un comentario de código: es texto shippeado dentro del reporte financiero que un humano lee para decidir sobre plata. Un reporte que le dice a su lector "no hay forma de cerrar esto" cuando sí la hay, lo empuja de vuelta al `UPDATE` manual — el comportamiento exacto que este change existe para eliminar. El costo de arreglarlo es una constante y un test; el costo de no hacerlo es documentación activa que induce al error.

El texto nuevo dice qué comando cierra estas escalaciones y **arrastra la salvedad del canal**. Sustituir una nota honesta sobre una limitación por un silencio optimista sería el peor de los dos mundos.

**Enmienda (revisión 2)**. La nota nueva **no debe describir el rechazo como irreversible**, porque con el ADR 29 dejó de serlo. Menciona los tres comandos de resolución y mantiene la salvedad del canal. Sigue **sin** mencionar el registro de acciones: el reporte no lo lee (fuera de alcance), y anunciar en un reporte financiero una auditoría que ese mismo reporte no muestra sería exactamente el tipo de promesa vacía que este ADR existe para evitar.

**Enmienda (revisión 3)**. La salvedad del canal **cambia de contenido, y este ADR obliga a cambiarla**: la redacción que la revisión 1 pedía —*"la identidad del resolvedor se toma de la configuración"*— pasa a ser **falsa** con el ADR 32, exactamente igual que el párrafo original pasó a ser falso con `/aprobar-reembolso`. Es el mismo criterio aplicándose a sí mismo, y por eso no se difiere. La nota nueva debe decir que el canal es la **TUI local con login por empleado**, y **no** debe insinuar que eso equivale a un portal autenticado: la salvedad honesta es que la contraseña se verifica localmente contra la misma base que el proceso escribe (R16). Lo que este ADR sigue prohibiendo: mencionar la tabla de auditoría, que el reporte no lee, y mencionar roles o permisos, que no existen.

### ADR 27: La auditoría es una **tabla dedicada y append-only** que cubre todos los comandos — las columnas `resuelto_por`/`resuelto_at` en `ventas` se descartan, no se conservan como atajo

**Contexto**. La revisión 1 auditaba **una sola** de las acciones que la TUI habilita (la resolución de la escalación) y lo hacía con dos columnas en `ventas`. El checkpoint pidió ampliarlo a todos los comandos. Hoy `/soporte` y `/devolucion` no capturan identidad de empleado en ningún lado — de hecho el concepto "empleado" solo existe en comentarios (`main.ts:244,300`).

**Decisión**. Una tabla nueva, y **solo** la tabla. Migración `0005_registro_acciones_empleado.ts`:

```sql
CREATE TABLE IF NOT EXISTS registro_acciones_empleado (
  id TEXT PRIMARY KEY,
  empleado_id TEXT NOT NULL,
  comando TEXT NOT NULL,
  venta_id TEXT REFERENCES ventas(id),
  caso_id TEXT REFERENCES casos(id),
  resultado TEXT NOT NULL,
  ocurrido_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registro_acciones_venta ON registro_acciones_empleado(venta_id);
```

`venta_id` y `caso_id` son **nullable** (una consulta de soporte no tiene venta; una devolución con token inválido no tiene ninguna de las dos). `empleado_id` es **`NOT NULL`**: por construcción no existe la fila anónima (ADR 28). Timestamps ISO-8601 UTC, como todo el resto del esquema (0004). Un solo índice, por `venta_id`, porque hay **un** patrón de lectura real (la historia de una venta, que alimenta el listado y el eco de `/reabrir-reembolso`); índices por `empleado_id` u `ocurrido_at` se agregan cuando exista una lectura que los pida — mismo criterio que 0004 aplicó.

**Qué guarda cada comando** *(tabla actualizada en la revisión 3)*:

| Comando | `venta_id` | `caso_id` | `resultado` posible |
|---|---|---|---|
| `/login` (**solo el exitoso**) | `NULL` | `NULL` | `exitosa` |
| `/logout` | — | — | **no deja fila** (no es una acción sobre el dominio) |
| `/soporte` | `NULL` | el `casoId` del caso `soporte` creado | `atendida` · `fallida` |
| `/devolucion` | el `ventaId` resuelto (`NULL` si el token no matcheó ninguna venta) | el `casoId` de esa venta (`NULL` idem) | `reembolsada` · `escalada` · `no_aplicable` |
| `/aprobar-reembolso` | `ventaId` | `casoId` | `aprobada` · `no_aplicable` |
| `/rechazar-reembolso` | `ventaId` | `casoId` | `rechazada` · `no_aplicable` |
| `/reabrir-reembolso` | `ventaId` | `casoId` | `reabierta` · `no_aplicable` |

**Qué NO se guarda, nunca**:

- **La contraseña de `/login`** *(revisión 3)*, ni en claro, ni hasheada, ni truncada, ni su longitud. La fila de un login exitoso dice *quién entró y cuándo*; el secreto no es parte de ese hecho. El hash vive en `credenciales_empleado` y en ningún otro lado (ADR 30).
- **El `token_confirmacion`.** Es la credencial del cliente (ADR 19, ADR 22); persistirlo en un registro de auditoría sería crear una segunda copia de la credencial en una tabla cuyo propósito es *ser leída por humanos*. Por eso la fila de `/devolucion` se identifica por `ventaId`, resuelto **después** de que `procesarDevolucion` ya usó el token. Cuando el token no matchea ninguna venta, la fila queda con `venta_id NULL` y `resultado no_aplicable`: dice "este empleado intentó una devolución que no aplicó" sin revelar qué se intentó.
- **El texto de la consulta de `/soporte` ni el `motivo` de `/devolucion`.** Son contenido del cliente. El `caso_id` correlaciona con el turno, que ya está donde tiene que estar; duplicar el payload en la tabla de auditoría sería inventar una segunda copia sin dueño. Mismo criterio que el ADR 18 de Hito 4 aplicó al email del cliente.
- **El primer paso de una confirmación en dos pasos.** El eco no tiene efecto; el registro es la lista de acciones **ejecutadas**, no el log de tecleo. Ese paso ya deja su evento `reembolso-resolucion-solicitada` en `logTurnEvent`. `/ayuda` y los comandos desconocidos tampoco dejan fila, por la misma razón.
- **Los intentos de login fallidos** *(revisión 3)*. Ver ADR 33: van al log de turnos, no a esta tabla, porque no hay empleado identificado que atribuirles y `empleado_id NOT NULL` no admite un "alguien dijo llamarse así".

**Por qué una tabla y no las dos columnas, y por qué no las dos cosas**:

1. **Las columnas no pueden expresar el alcance pedido.** `resuelto_por`/`resuelto_at` viven en `ventas`; `/soporte` no tiene venta y `/login` no tiene ninguna de las dos. La forma "una fila por acción" es la única que cubre el pedido.
2. **Con reapertura (ADR 29), las columnas pasan a mentir.** Una venta puede ser rechazada por Ana, reabierta por Beto y aprobada por Carla. Dos columnas guardan **la última** resolución y borran las anteriores: `resuelto_por = 'carla'` sería técnicamente cierto y narrativamente falso. Una estructura *last-write-wins* para un hecho que ahora puede repetirse es una pérdida de datos silenciosa, que es la peor clase.
3. **Conservarlas "como acceso rápido" sería duplicar la fuente de verdad sin necesidad.** Sería un caché denormalizado con un invariante nuevo que mantener en cada transacción, para servir a **cero lectores**. Se descarta por YAGNI, no por dogma.
4. **La numeración queda limpia.** `src/adapters/memory/migrations/` llega hoy hasta `0004` — verificado. `0005` lo ocupa esta tabla y `0006` la de credenciales (ADR 30).

**Dónde se escribe la fila — la asimetría de atomicidad, dicha de frente**:

- **Los tres comandos de resolución** escriben su fila **dentro de la misma transacción** que el CAS de la venta y el `updateCaso`. Invariante: *no existe una transición de resolución exitosa sin su fila, ni una fila sin su transición*. Por eso los métodos del puerto reciben `empleadoId` y escriben la fila ellos mismos: el núcleo es puro y síncrono y **no tiene primitiva de transacción** — mismo motivo por el que `escalarReembolso` ya empaqueta venta + caso en un solo método (ADR 11 punto 2).
- **`/login`, `/soporte`, `/devolucion` y los intentos `no_aplicable`** escriben su fila **después**, con `RegistroAccionesEmpleadoPort.registrarAccion`, fuera de cualquier transacción de negocio. Si el proceso muere entre el efecto y la fila, hay efecto sin fila. **Se acepta**, y queda como **R10**.
- Las dos rutas terminan en **una sola función de escritura** en `repository.ts` (`insertAccionEmpleado`). Un solo lugar que sepa el layout de la fila.

**Consecuencias**:

- Primera tabla del proyecto **que no está en el SQL del plan**. Es una desviación y se declara como tal — ver la sección del checkpoint y R12.
- `procesarDevolucion` necesita devolver `ventaId`/`casoId`. Se ensancha `DevolucionResult` agregando esos campos a las ramas donde la venta se conoce; **no cambian la secuencia, las guardas, los efectos ni el logging** del módulo, y el adaptador web —que solo lee `resultado`— sigue compilando sin tocarse.
- El registro **fortalece la trazabilidad y no resuelve R1** *(cierto en la revisión 2; ver la enmienda de la revisión 3)*.

**Enmienda (revisión 3 — punto 8 del pedido del checkpoint)**. Con `/login`, el origen de `empleado_id` cambia y con él el **significado del invariante**:

- **Los tres comandos privilegiados toman `empleado_id` de la sesión activa**, no de una variable de entorno. El dispatcher lee `sesion.empleadoId` y lo pasa a `store.aprobarEscalacionReembolso(...)` igual que antes pasaba el valor de la env var. **Ni el esquema, ni la firma de los métodos del puerto, ni el layout de la fila cambian**: cambia de dónde sale el string. Ese es exactamente el resultado que se quería — la mejora de seguridad no cuesta una migración.
- **El invariante se fortalece**: de *"nunca una atribución anónima"* (`empleado_id NOT NULL`) a *"nunca una atribución no autenticada"*. La primera la garantiza el esquema; la segunda la garantiza el dispatcher, porque **el único camino por el que un `empleadoId` llega a `insertAccionEmpleado` es una sesión vigente**. `sdd-design` debe fijarlo como invariante estructural: no hay ninguna función que acepte un `empleadoId` provisto por el usuario.
- **`/login` exitoso deja fila y el fallido no.** Ver ADR 33 punto 4.
- **`registro_acciones_empleado.empleado_id` NO recibe una FK a `credenciales_empleado`.** Es deliberado y es la decisión menos obvia de esta enmienda: una FK ataría la vida del registro de auditoría a la vida de la credencial, y como la única forma de "dar de baja" a un empleado hoy es borrar su fila de credenciales (ADR 33), esa baja o fallaría por la FK o arrastraría el historial. **Las filas de auditoría tienen que sobrevivir al empleado que las produjo**; un registro append-only que se puede podar borrando una credencial no es append-only. Mismo criterio que `ventas.cliente_id`, que es opaco y sin FK a propósito (0004).

### ADR 28: La identidad gatea lo **privilegiado**, no lo público — `/soporte` y `/devolucion` siguen funcionando sin identidad, y en ese caso **no dejan fila**

**Contexto**. Si el registro cubre todos los comandos, hay que decidir qué pasa cuando un empleado corre `/soporte` o `/devolucion` sin identidad. Hoy esos dos caminos son **públicos por diseño**: `POST /soporte` y `POST /devolucion` no están detrás del `Bearer` que gatea `/ventas` (`web/server.ts:106-132`), porque el actor legítimo es el **cliente final**. No tienen ninguna noción de empleado.

**Decisión**. Dos clases de comando, con dos reglas distintas:

| Clase | Comandos | Sin identidad |
|---|---|---|
| **Público** (existe un camino equivalente sin identidad) | `/soporte`, `/devolucion`, `/ayuda` | **Funcionan igual**, y **no se escribe fila** |
| **Privilegiado** (no hay equivalente público; mueven estado que nadie más puede mover) | `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` | **No están disponibles**: responden qué falta y **no escriben nada** |

**Por qué `/soporte` y `/devolucion` no pasan a exigir identidad**:

1. **Exigirlo no agregaría ninguna garantía, solo fricción.** Cualquiera puede ejecutar hoy esas dos acciones con un `curl` sin identidad alguna. Bloquear en la TUI lo que la red deja pasar sin credencial no protege nada: pone una tranquera al lado de un campo abierto.
2. **Romper la paridad rompería el argumento del ADR 21.** El valor de `/soporte` y `/devolucion` en la TUI es que son **el mismo caso de uso por otro transporte**, sin comportamiento nuevo. Un gate de identidad que existe en un transporte y no en el otro es comportamiento nuevo, y de la clase peor: divergencia silenciosa entre dos invocadores del mismo handler.
3. **El registro anónimo sería peor que la ausencia de registro.** Una fila con `empleado_id = 'desconocido'` es exactamente lo que el ADR 25 punto 2 ya rechazó. `empleado_id NOT NULL` lo hace imposible por esquema: **sin identidad no hay fila, y el registro nunca contiene una atribución falsa**. Se prefiere un registro con huecos honestos a uno completo y mentiroso.
4. **La asimetría tiene una regla, no es una excepción.** *La identidad gatea lo privilegiado, no lo público.*

**Consecuencias, incluyendo la incómoda**:

- **El registro de `/soporte` y `/devolucion` tiene cobertura parcial por diseño**, y un empleado puede **evadirlo**. Queda como **R10**.
- La identidad se resuelve una sola vez y el dispatcher decide con ese valor. Sin ella, la TUI arranca idéntica.

**Enmienda (revisión 3 — punto 6 del pedido del checkpoint)**. Con `/login` existe por primera vez un concepto real de *empleado logueado*, así que hay que releer este ADR entero. El resultado es: **la clasificación se sostiene tal cual, y la regla se amplía**.

- **`/soporte` y `/devolucion` NO pasan a exigir sesión.** Los cuatro argumentos de arriba siguen en pie sin una coma que cambiar, porque ninguno dependía de *qué tan buena* fuera la identidad: dependían de que los mismos dos casos de uso corren hoy por HTTP sin ninguna credencial. Que ahora la identidad de la TUI sea buena no vuelve público lo privilegiado ni al revés. Exigir login para escribirle a soporte sería ponerle llave a la puerta de al lado del ventanal abierto — con la llave nueva y todo.
- **Pero sí cambia lo que hacen CON una sesión activa.** Donde antes la regla era *"`EMPLEADO_ID` presente → fila; ausente → sin fila"*, ahora es *"sesión vigente → fila con el `empleado_id` de la sesión; sin sesión → sin fila"*. La diferencia no es de forma sino de **valor de la fila**: en la revisión 2 esas filas eran atestaciones (podía escribirlas cualquiera con una env var); ahora son autenticadas. **La cobertura del R10 mejora de verdad, no en el papel.**
- **La regla completa pasa a ser: la identidad gatea lo privilegiado y ENRIQUECE lo público.** Un comando privilegiado sin sesión no puede existir, porque su fila es parte de su definición. Un comando público sin sesión existe y funciona; con sesión, además, deja rastro atribuible.
- **La evasión sigue existiendo, y cambia de forma.** Antes se evadía *por omisión* (nunca configurar la variable era el estado por defecto, y bastaba con no tocar nada). Ahora se evade *por acción deliberada*: hay que abstenerse de loguearse, o hacer `/logout` antes. No es una defensa —sigue siendo trivial— pero sí un cambio real de la lectura del riesgo: el hueco pasa de ser el camino de menor resistencia a ser una elección. **R10 se reescribe con esa redacción y se mantiene en Media** por la parte que no cambió: la escritura no transaccional (efecto sin fila si el proceso muere en el medio).
- **`EMPLEADO_ID` desaparece de este ADR** y de todo el change. Ver ADR 32.

### ADR 29: `/reabrir-reembolso` devuelve un `reembolso_rechazado` a `reembolso_pendiente` y reusa **el mismo `caso`**; `reembolsada` sigue terminal, y no hay tope de reaperturas

**Contexto**. El ADR 23 declaraba el rechazo terminal y dejaba la reapertura como "decisión de producto que hoy no existe". El checkpoint la tomó: el caso real es **el empleado que se equivocó al rechazar** — eligió el `ventaId` de al lado, o rechazó antes de leer un mail que cambiaba el criterio. Hoy la única salida sería el `UPDATE` manual, es decir, el agujero exacto que este change existe para tapar. Un producto que puede cerrar mal y no puede corregirse empuja al SQL a mano con más fuerza que uno que no puede cerrar.

**Decisión**. Comando `/reabrir-reembolso [ventaId]`, con **exactamente el mismo molde** que los otros dos comandos de resolución — no se inventa un patrón nuevo:

1. **Sin argumento**: lista los reembolsos rechazados, vía `store.listarReembolsosRechazados({ limite })`. A diferencia de los pendientes, los rechazados **se acumulan para siempre**, así que el listado está acotado (default 20) y ordenado por **fecha del rechazo, la más reciente primero**. Esa fecha sale de `registro_acciones_empleado` (join por `venta_id`, filas de `/rechazar-reembolso`), lo cual es la primera lectura real de la tabla del ADR 27 y la prueba de que la tabla se ganó su lugar.
2. **Con `ventaId`, primer llamado**: **no ejecuta**. Devuelve el eco con `venta · cliente · monto · caso`, más **quién rechazó y cuándo** y **cuántas veces se reabrió antes** (ambos del registro), y pide repetir el comando. Misma ventana corta, misma ranura única en el closure del dispatcher (ADR 25 punto 3).
3. **Con `ventaId`, segundo llamado**: `store.reabrirEscalacionReembolso({ ventaId, casoId, empleadoId, ahora })` — **una transacción**: CAS `UPDATE ventas SET estado='reembolso_pendiente' WHERE id=@id AND estado='reembolso_rechazado' RETURNING …`, `updateCaso(casoId, { estado: 'pendiente_aprobacion_humana' })` y la fila de registro. `undefined` del CAS → `no_aplicable`, sin excepción, igual que todos los CAS del proyecto.
4. Exige identidad — es un comando privilegiado (ADR 28).

**El `caso` es el mismo, y vuelve a `pendiente_aprobacion_humana`.** No se crea un caso nuevo. Es la aplicación directa del criterio que el ADR 24 ya sentó: *el caso es el handle de correlación de la venta*. Una venta tiene un `caso_id` en su fila, y crear un segundo caso obligaría a pisar esa columna, dejaría el primero huérfano y partiría en dos el hilo de log de una misma venta — rompiendo el ADR 11 punto 2. Además, el estado `pendiente_aprobacion_humana` significa literalmente "espera a un humano", y tras una reapertura eso vuelve a ser cierto: no se está reinterpretando el vocabulario, se está usando.

**Por qué no hay estado nuevo.** Una venta reabierta es indistinguible de una escalada por primera vez *desde el punto de vista de la decisión pendiente*: alguien tiene que aprobar o rechazar. Un séptimo estado `reembolso_reabierto` duplicaría `reembolso_pendiente` en todos los CAS y en el reporte, para expresar una diferencia que el registro ya expresa mejor y con más detalle.

**`reembolsada` sigue siendo terminal, sin excepción.** La asimetría es deliberada: deshacer un **rechazo** devuelve la venta a la cola de decisión y no mueve un centavo; deshacer una **aprobación** sería "des-reembolsar" — un hecho financiero consumado, con contraparte externa y probablemente con plata ya movida fuera del sistema. Queda fuera de alcance, y R7 se reescribe para que el riesgo remanente quede a la vista.

**Sin tope de reaperturas — y sí, es una decisión, no un olvido.** Se decide **no** poner un límite duro, por tres razones: (a) **cada vuelta cuesta dos comandos confirmados de un empleado identificado y deja dos filas en un registro append-only** — no es un bucle automático, es una persona haciendo lo mismo a mano repetidamente, y eso se detecta mirando la tabla; (b) **un tope sería un número sin dueño** y su efecto sería dejar una venta en un estado que **nadie puede mover**, recreando el callejón sin salida que este ADR elimina; (c) la política real es un **modelo de autorización**, y ese es Hito 5. La mitigación que sí se aplica ahora es de **visibilidad, no de bloqueo**. Queda documentado como **R11**, severidad Baja.

**Enmienda (revisión 3)**. El punto 4 pasa a leerse: **exige una sesión vigente** (ADR 31, 32), no una variable de entorno. Además, el argumento (a) del "sin tope" **se fortalece**: la frase *"cada vuelta cuesta dos comandos confirmados de un empleado identificado"* era, en la revisión 2, una identificación autodeclarada; ahora es autenticada. El control por visibilidad en lugar de por bloqueo depende enteramente de que la tabla diga quién dio cada vuelta — y recién con `/login` eso es verificable. La decisión no cambia; su justificación deja de tener el pie flojo.

### ADR 30: Contraseña por empleado, verificada con scrypt en un **adaptador**, inyectada como dependencia en un caso de uso **puro**

**Contexto**. El checkpoint rechazó `EMPLEADO_ID` (atestación) **y** rechazó la contraseña única compartida por toda la empresa. El motivo de rechazar la segunda es el correcto y conviene dejarlo escrito: una contraseña compartida autentica *a la empresa*, no *al empleado*, y la columna `empleado_id` del registro volvería a ser autodeclarada — el mismo agujero de R1 con un paso más de teatro. Si la fila de auditoría dice "Ana", el sistema tiene que haber verificado algo que solo Ana sabe.

**Primero, una corrección de premisa, porque el resto se apoya en ella.** El brief de esta revisión afirmaba que `src/core/` no puede importar `node:crypto`. **Eso no es lo que dice el repo.** `AGENTS.md` fija una sola regla de import: *"`src/core/` nunca importa nada de `src/adapters/*`"* — nada sobre built-ins de Node. Y el precedente existe, es explícito y pasó por el Reviewer: `src/core/turn-selector/close-turn.ts:77` importa `randomUUID` de `node:crypto`, y su module doc (líneas 45-61) argumenta el punto de frente: *"que no es un import de `src/adapters/*` de este repo, así que sigue sin violar la regla de import — mismo razonamiento que permitió importar el SDK de Anthropic directo en `invoke-model.ts`"*. Corregir esto importa porque una regla inventada produce un diseño que nadie puede defender después: si el motivo de inyectar `verificarPassword` fuera una regla que no existe, el primer Reviewer que abra `close-turn.ts` tiraría el argumento abajo y con él la decisión.

**Decisión**. Se inyecta igual, por **tres razones propias** que sí se sostienen:

1. **Determinismo y costo del test — el mismo motivo por el que `newId` y `now` ya se inyectan.** `ConfirmarVentaDeps` (`confirmar-venta.ts:33-36`) y `RegistrarVentaDeps` (`registrar-venta.ts:57`) reciben `newId: () => string` y `now: () => string` **no** porque `node:crypto` esté prohibido —`close-turn.ts` prueba que no lo está— sino porque un caso de uso que fabrica su propia aleatoriedad y su propio reloj no se puede testear. `verificarPassword` es idéntico: un test de `resolverLogin` quiere afirmar *"si la verificación da `false`, no se abre sesión"*, y eso se afirma con `vi.fn(() => false)`, no derivando una clave real.
2. **scrypt es caro A PROPÓSITO, y el núcleo de este proyecto es síncrono.** `resolverDecisionVenta` y `procesarDevolucion` son síncronas por decisión documentada. Un `scryptSync` con parámetros serios bloquea el hilo del orden de ~100 ms — eso es *la feature*, es lo que hace cara la fuerza bruta. Meterlo adentro de una función pura del núcleo significaría que **cada test unitario de login paga esos 100 ms**, y que el núcleo pasa a contener una decisión de costo computacional que no es una regla de negocio.
3. **Los parámetros de scrypt (N, r, p, longitud de clave y de salt) son configuración operativa, no negocio.** Es exactamente la taxonomía del ADR 17a de Hito 4: `resolveVentasConfig` vive en el núcleo porque el porcentaje de comisión **es** el negocio; `resolveWebConfig` vive en el adaptador porque el puerto HTTP no lo es. "Cuánta CPU cuesta derivar una clave" está del lado del adaptador, sin ninguna duda.

**Forma concreta**:

- `src/core/auth/login.ts` — `resolverLogin({ empleadoId, password }, deps)`, **pura y síncrona**. `LoginDeps = { store: CredencialesEmpleadoPort; verificarPassword: (password: string, hash: string) => boolean; now: () => string; ttlMinutos: number; logEvent }`. Devuelve `{ resultado: "exitosa"; sesion: SesionEmpleado }` o `{ resultado: "invalida" }`.
- `src/core/auth/credenciales-contract.ts` — `CredencialesEmpleadoPort.buscarCredencial(empleadoId): { empleadoId, passwordHash } | undefined`. Síncrono, como todo el puerto de ventas (`better-sqlite3` lo es).
- `src/adapters/crypto/password.ts` — la implementación real: `hashPassword(password): string` con `randomBytes(16)` de salt y `scryptSync`, y `verificarPassword(password, hash): boolean` que re-deriva con los parámetros embebidos y compara con `timingSafeEqual`. **Hermano exacto de `adapters/webhooks/signature.ts`**, que ya hace `createHmac` + `timingSafeEqual` con el mismo criterio (Hito 3), incluido el chequeo de longitud previo que ese archivo documenta como obligatorio (`timingSafeEqual` lanza `RangeError` con buffers de distinto largo).
- **Formato del hash, en una sola columna**: `scrypt$<N>$<r>$<p>$<salt-base64>$<clave-base64>`. La sal y los parámetros viajan **dentro** del string, estilo PHC. Por eso la migración **no tiene columna `salt`**: agregarla obligaría a versionar el esquema cada vez que cambie un parámetro, y este formato permite que dos filas convivan con costos distintos. Salt de 16 bytes aleatorios **por fila** — dos empleados con la misma contraseña tienen hashes distintos, y eso es testeable.
- **Ninguna dependencia nueva.** `node:crypto` cubre todo, `engines.node` es `>=20` (verificado en `package.json`), y `scryptSync`/`randomBytes`/`timingSafeEqual` están disponibles muy por debajo de ese mínimo. Es el mismo criterio de minimalismo que evitó `bcrypt`/`argon2` antes de que nadie los propusiera: una dependencia nativa que compila es exactamente lo que este proyecto no necesita para tres comandos.

**Sobre el mensaje de error y el timing, sin vender humo**. `/login` responde lo mismo ante id inexistente y ante contraseña incorrecta (*"credenciales inválidas"*), porque cuesta cero. Lo que **no** se hace es derivar una clave contra un hash señuelo para igualar los tiempos: en este modelo de amenaza el atacante corre en la misma máquina y puede leer `credenciales_empleado` con cualquier cliente SQLite, así que defender la enumeración de usuarios por timing sería teatro. `timingSafeEqual` **sí** se usa en la comparación de la clave derivada, por dos motivos honestos: es gratis y es la convención ya establecida del proyecto (`signature.ts`, `web/server.ts:131`) — apartarse de ella necesitaría su propia justificación, y no la hay.

**Consecuencias**:

- **Aparece `src/core/auth/`**, una carpeta que el arc42 no lista. Es una desviación estructural menor y se declara: identidad no es `commands` (no es el ruteo) ni `ventas` (no es el dominio del dinero), y meterla en cualquiera de las dos la archivaría mal. Va a la lista del checkpoint.
- **Los parámetros de scrypt quedan congelados en cada fila.** Cambiarlos no re-hashea nada: las filas viejas siguen validando con sus parámetros viejos hasta que se rotan. Es una consecuencia del formato, no un bug, y el remedio es una rotación (ADR 33), no una migración.
- **`/login` no dice nada sobre permisos.** Autentica, no autoriza. Todo empleado con sesión puede correr los tres privilegiados; el modelo de roles es Hito 5.

### ADR 31: La sesión es **una sola ranura en el closure del dispatcher**, expira, tiene `/logout`, y **ata la confirmación pendiente**

**Contexto**. `/login` tiene que dejar algo en algún lado. Las opciones son tres: una tabla `sesiones`, un archivo, o memoria del proceso. Y la TUI ya tiene un precedente exacto de estado efímero de interacción: la ranura de confirmación pendiente del ADR 25 punto 3.

**Decisión**. Memoria del proceso, en el closure de `build-on-comando-empleado.ts` — **ni en `src/core/`** (que sigue puro y síncrono; `sesionVigente(sesion, ahora)` es un predicado puro, pero *guardar* la sesión no lo es) **ni en el adaptador TUI** (que sigue sin saber que existen los comandos). Cinco reglas:

1. **Una sola ranura, un solo empleado a la vez.** La TUI es un proceso con un operador. Un `/login` con sesión ya abierta **reemplaza** la anterior (y limpia la confirmación pendiente, ver punto 5): cambiar de usuario es un caso legítimo en una terminal compartida y no merece un error. Una tabla de sesiones concurrentes no tendría segundo usuario.
2. **Expira, con TTL absoluto desde el login.** `SESION_TTL_MINUTOS`, default **30**, resuelto por `resolveAuthConfig(env)` — molde exacto de `resolveVentasConfig` (pura, de un diccionario a un valor, acumula errores, no lanza). **`0` = sin expiración**, opt-out explícito: es literalmente el mismo interruptor que `VENTA_TOKEN_TTL_HORAS=0` del ADR 10 de Hito 4, y usar el patrón que el proyecto ya tiene vale más que inventar uno.
   *Absoluto y no deslizante*, a propósito: un TTL por inactividad obliga a decidir qué comando cuenta como actividad (¿`/ayuda` renueva la sesión?), y esa pregunta no tiene una respuesta buena. Un TTL absoluto es **una comparación de strings ISO-8601** contra el `now()` inyectado, testeable con un reloj fijo, sin ninguna pregunta abierta. El costo es que a un empleado con sesión activa se le puede vencer en el medio de algo; el remedio es `/login` de nuevo, que son dos segundos.
3. **`/logout` existe.** Cuesta una asignación a `undefined` y es la única forma de cerrar la sesión sin matar el proceso. Sin él, el empleado que se levanta de una terminal compartida deja los tres comandos privilegiados abiertos a quien pase — que es exactamente el problema que la decisión 3 vino a resolver, reintroducido por la puerta de atrás.
4. **Se pierde al reiniciar la TUI, y eso se acepta explícitamente.** Mismo criterio y mismo párrafo que R8 aplicó a la confirmación pendiente: es estado de interacción, no de negocio; perderlo obliga a repetir `/login`, nada más. Persistir una sesión en la base sería inventar estado durable —con su propia expiración, su propia invalidación y su propia superficie de robo— para una interacción de minutos, y encima en la **misma base** que el atacante local ya puede leer. La sesión efímera es aquí la opción *más* segura, no solo la más barata.
5. **La confirmación pendiente queda ATADA a la sesión, y este es el punto que no puede fallar.** La ranura pasa de `{ ventaId, accion, expiraEn }` a `{ ventaId, accion, expiraEn, empleadoId }`, y el segundo paso **re-verifica** que haya sesión vigente **y** que sea del mismo `empleadoId`. Se limpia en `/logout`, al expirar la sesión y en cualquier `/login`. Sin esta regla, el flujo de dos pasos sería un bypass de autorización de manual: A prepara la aprobación, se va, B la confirma; o la sesión vence entre el paso 1 y el paso 2 y el paso 2 ejecuta igual porque "ya estaba autorizado". **El paso 1 no almacena una autorización: la autorización se verifica de nuevo en el paso 2.**

**Consecuencias**:

- Dos TUIs contra la misma base tienen **sesiones independientes**, y está bien: el CAS sigue siendo el árbitro de quién llegó primero (ADR 15 de Hito 4), y las dos filas de auditoría dicen la verdad sobre quién intentó qué.
- El dispatcher gana estado mutable. Se acota a **dos ranuras** (`sesion`, `confirmacionPendiente`), ambas privadas del closure, ambas verificables con dobles en test.
- `sesionVigente` es puro y vive en el núcleo, así que la regla de expiración se testea con un `now` fijo sin montar nada.

### ADR 32: `EMPLEADO_ID` **desaparece**; la sesión es la única fuente de identidad — y la identidad ahora **enriquece lo público** además de gatear lo privilegiado

**Contexto**. La pregunta que el checkpoint dejó abierta es si `EMPLEADO_ID` sobrevive para algo: como identidad de arranque, como el id con el que se crea la cuenta, o como fallback.

**Decisión**. **Se elimina por completo del change.** No queda ni como fallback, ni como default, ni como semilla de provisioning.

**Por qué las tres supervivencias posibles son peores que borrarla**:

1. **Como fallback de la sesión** (*"si no hay `/login`, usá `EMPLEADO_ID`"*): es la peor de todas. Dejaría los tres comandos privilegiados alcanzables **sin contraseña**, es decir, R1 exactamente igual que en la revisión 2, pero ahora con una pantalla de login encima que le sugiere al lector que el sistema está autenticado. Un candado decorativo es peor que ningún candado, porque cambia el comportamiento de quien lo ve.
2. **Como identidad por defecto para lo público** (*"`/soporte` sin sesión usa `EMPLEADO_ID` para la fila"*): reintroduce la atestación exactamente en la columna que el ADR 27 acaba de volver confiable. La tabla pasaría a tener dos clases de fila indistinguibles entre sí —unas autenticadas, otras autodeclaradas— y **ninguna forma de saber cuál es cuál**. Un registro donde no se puede distinguir el dato bueno del malo vale lo que el peor de los dos.
3. **Como semilla del provisioning** (*"el id con el que se crea la cuenta"*): no tiene sentido mecánico. El alta corre en **otro proceso** (`empleados:crear`, ADR 33), que recibe el id como argumento explícito. No hay ningún momento en que la TUI necesite saber un id antes de que alguien se loguee.

Y hay una razón de fondo que las cubre a las tres: **es exactamente el criterio del ADR 27 punto 3** —"conservarlas como acceso rápido sería duplicar la fuente de verdad sin necesidad"— aplicado a la identidad en vez de a las columnas. Dos fuentes de verdad para el mismo `empleado_id` es la clase de convivencia que después nadie sabe explicar.

**El costo de borrarla es cero.** `EMPLEADO_ID` **nunca shippeó**: solo existió en las revisiones 1 y 2 de este documento. No hay `.env` desplegado que la tenga, no hay código que la lea, no hay dato que migrar, no hay compatibilidad que romper. Se está descartando una propuesta, no una feature — igual que la revisión 2 descartó las columnas `resuelto_por`/`resuelto_at` antes de que existieran.

**Regla final de identidad, para que `sdd-spec` la copie literal**:

| Comando | Sin sesión vigente | Con sesión vigente |
|---|---|---|
| `/login`, `/ayuda` | Funciona | Funciona (`/login` reemplaza la sesión) |
| `/logout` | Responde que no hay sesión, sin efecto | Cierra la sesión y limpia la confirmación pendiente |
| `/soporte`, `/devolucion` | **Funcionan igual**, sin fila de registro (evento `accion-empleado-sin-sesion`) | Funcionan igual **y dejan fila** con el `empleado_id` de la sesión |
| `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso` | **No disponibles**: responden que hace falta `/login`, sin ningún efecto y sin ninguna fila (evento `comando-privilegiado-sin-sesion`) | Funcionan, con fila **dentro de la transacción** |

**Consecuencia**: la degradación sigue siendo de clase "degrada" y no "aborta" (ADR 17 de Hito 4). La TUI arranca sin nadie logueado, el camino conversacional de Hito 1 funciona idéntico, y los dos comandos públicos también. Nada del arranque depende de que exista una sola credencial en la base.

### ADR 33: Provisioning por CLI con la contraseña por `stdin`; **con rotación**, sin desactivación, sin límite de intentos, y los logins fallidos van al **log de turnos**, no al registro

**Contexto**. No hay UI de administración, ni la va a haber en este change. Alguien tiene que poder crear la primera credencial, y ese alguien no puede ser un `INSERT` a mano — sería el mismo `SQL manual` que esta propuesta existe para eliminar, mudado de tabla.

**Decisión**. Cuatro partes, en orden de cuánto cuesta discutirlas.

**1. Un entrypoint CLI, molde exacto de `src/reporte-mensual.ts`.** `src/empleados.ts` + script `empleados:crear` en `package.json`. Ese archivo ya resolvió este problema y su module doc explica cada pieza: la parte pura (`parsePeriodo`) se testea directo desde el test sin extraer un `build-*.ts`, `openDatabase("data/harness.db")` es la misma función y el mismo path que `main.ts` y corre las migraciones si faltan, `db.close()` va en un `finally`, y el guard `isMainModule` evita que `main()` se dispare por la sola importación en vitest. Acá se copia entero: `parseArgsEmpleado(argv)` es la parte pura y testeable, y el resto es I/O. Dos modos:

- `npm run empleados:crear -- <empleadoId>` → **alta**. `INSERT`. Si el id ya existe, **falla y no pisa nada** (`process.exit(1)` con mensaje). Un alta que sobrescribe silenciosamente un hash existente es un reseteo de contraseña disfrazado de alta.
- `npm run empleados:crear -- <empleadoId> --rotar` → **rotación**. `UPDATE` de `password_hash` y `updated_at`. Si el id no existe, falla.

**2. La contraseña entra por `stdin`, NUNCA por `argv`.** El brief sugería `-- <id> <password>`; se descarta a propósito. Una contraseña en `argv` queda en `~/.bash_history` (o el equivalente de PowerShell) y en la tabla de procesos, visible para cualquier `ps` mientras el proceso viva. Son dos almacenamientos persistentes que nadie pidió, para una credencial que la propia migración se toma el trabajo de no guardar en claro. Con `stdin` (una línea, `node:readline`, cero dependencias) no queda en ninguno de los dos, y además habilita `echo "$PASS" | npm run empleados:crear -- ana` para provisioning scripteado. **Residual honesto**: sin `--rotar`, la línea tipeada se ve en la terminal (apagar el eco pide modo raw y no vale la pena acá) — R14, misma familia que el eco de `/login` en la TUI.

**3. Alcance mínimo viable: rotación SÍ, desactivación NO.** Es la parte que hay que justificar, porque la tentación era diferir las dos.

- **La rotación NO se difiere**, aunque parezca lo más fácil de recortar. Sin ella, una contraseña comprometida no tiene ningún remedio dentro del producto: el alta falla porque la fila existe, y la única salida sería un `DELETE` a mano. Es **literalmente el argumento del ADR 29** —*"un producto que puede cerrar mal y no puede corregirse empuja al SQL a mano con más fuerza que uno que no puede cerrar"*— aplicado a credenciales en vez de a reembolsos. Diferirla contradiría una decisión que este mismo documento ya tomó. Y cuesta un `if` y un `UPDATE`: el modo de rotación comparte el 90% del código con el de alta.
- **La desactivación SÍ se difiere.** Una columna `activo` parece igual de barata, pero arrastra una política que nadie definió: qué pasa con la sesión abierta de un empleado que se desactiva mientras la usa, si sus filas de auditoría siguen siendo válidas, si un id desactivado se puede reusar. Todo eso es el modelo de autorización de Hito 5. Mientras tanto hay un paliativo que cuesta cero: **rotar la contraseña a un valor aleatorio que nadie conoce** desactiva funcionalmente al empleado. Es un workaround, no una feature, y se dice así — pero es un workaround que existe, a diferencia de la ausencia total de remedio que sí habría motivado construir la columna. **R15.**
- Tampoco hay listado, ni borrado, ni política de fortaleza de contraseña, ni recuperación ("olvidé mi contraseña" pediría un canal de email que este change no toca).

**4. Los intentos fallidos van al log de turnos, no a `registro_acciones_empleado`.** El evento `login-fallido` lleva el `empleadoId` **tipeado** y el timestamp, y **nunca** la contraseña ni ningún derivado suyo. La fila de auditoría **no se escribe**. Tres razones:

- **`registro_acciones_empleado` es el registro de acciones de un empleado identificado.** Un login fallido, por definición, no tiene uno. Escribir el id tipeado en esa columna la sobrecargaría: el mismo valor significaría a veces *"este empleado hizo X"* y a veces *"alguien dijo llamarse así"*. Es el peligro de atribución falsa del ADR 28 con otra ropa.
- **El `NOT NULL` es el que sostiene el invariante.** Debilitarlo, o llenarlo con un string tipeado, cambiaría la garantía más fuerte de la tabla por un caso de uso sin ningún lector.
- **El login exitoso SÍ deja fila** (`comando='/login'`, `resultado='exitosa'`, `venta_id`/`caso_id` en `NULL`). Ahí el empleado está identificado y es la fila que **abre** la sesión de la que dependen todas las filas privilegiadas siguientes: sin ella, la historia empieza a la mitad.

**Sin límite de intentos, y es una decisión.** Un rate limiter que sirva tiene que ser **durable** —contador por empleado y por ventana, persistido— porque uno en memoria se evade reiniciando la TUI, que es lo primero que haría cualquiera. Y persistirlo significa una tabla más, un criterio de ventana, y una decisión sobre qué hacer con un empleado bloqueado que **no tiene forma de desbloquearse** (sin desactivación, sin admin, sin recuperación): otra vez el callejón sin salida del ADR 29, en el peor lugar posible. Contra eso, lo que ya hay: **scrypt cuesta ~100 ms por intento por diseño**, en un proceso de un solo hilo donde cada intento pasa por una persona tipeando en un cuadro de texto. Eso acota el ataque online a un puñado de intentos por segundo, y el ataque **offline** —que es el real— no se defiende con un contador sino con el costo del KDF, que es exactamente lo que se eligió. **R13**, severidad Baja. Si el checkpoint lo quiere, hay que decidir la ventana **y** cómo se desbloquea.

## Approach

**Flujo del envoltorio.** `main.ts` sigue armando `onSubmit = buildOnSubmit(...)` igual que hoy, pero le pasa a `startTui` el resultado de `buildOnComandoEmpleado({ onSubmit, onSoporte, store, credenciales, registro, config, authConfig, verificarPassword, now, logEvent })`. Ese módulo devuelve un `SubmitPromptHandler` — mismo tipo, misma firma — que: (1) llama `parsearComando(texto)`; (2) si es `undefined`, `return onSubmit(texto, onAgentResolved)`; (3) si no, aplica la regla de identidad del ADR 32, rutea al manejador del comando, escribe la fila de registro cuando corresponde (ADR 27/28) y arma un `TuiTurnResult`. `onSoporte` es el **mismo** `buildOnSoporte(...)` que ya se construye para el adaptador web: se arma una vez y se comparte, sin duplicar `createKnowledge`.

**Wiring de la autenticación.** `main.ts` importa `verificarPassword` de `src/adapters/crypto/password.ts` y se lo pasa al dispatcher, que se lo pasa a `resolverLogin` como dependencia — mismo movimiento con el que hoy inyecta `randomUUID` como `newId` en `buildOnVenta` (`build-on-venta.ts:36`). El núcleo no importa el adaptador; el composition root los une. `resolveAuthConfig(process.env)` se resuelve junto a `resolveVentasConfig`, con el mismo manejo de errores acumulados.

**Camino de `/login`, secuencia exacta.** `parsearComando` devuelve `{ tipo: "login", empleadoId, password }` → el dispatcher llama `resolverLogin({ empleadoId, password }, deps)` → el caso de uso hace `store.buscarCredencial(empleadoId)` y, si hay fila, `verificarPassword(password, fila.passwordHash)` → si da `true`, devuelve `{ resultado: "exitosa", sesion: { empleadoId, iniciadaEn: now(), expiraEn } }` → el dispatcher guarda la sesión en su ranura, limpia cualquier confirmación pendiente y escribe la fila `resultado='exitosa'`. Si la fila no existe o la verificación da `false`: mismo mensaje genérico, sin sesión, sin fila, evento `login-fallido`. **La contraseña no sale nunca de la llamada a `verificarPassword`.**

**Wiring: qué necesita el modelo y qué no.** `/soporte` es el único camino asíncrono y el único que toca el SDK. Los otros seis son deterministas: cierran sobre `store`/`credenciales`/`registro`/`config`/`now`/`logEvent` y **no reciben `createKnowledge`** — molde `buildOnVenta`, no molde `buildOnSoporte`.

**Cierre de R3, secuencia exacta.** `/aprobar-reembolso` sin argumento → `store.listarReembolsosPendientes()` → texto con una línea por venta (mismo formato de línea que el reporte). Con `ventaId` y sin confirmación pendiente que matchee → se busca la venta en ese mismo listado (sin método nuevo de lectura por id), se devuelve el eco y se guarda la confirmación pendiente **con el `empleadoId` de la sesión**. Con `ventaId` que matchea una confirmación pendiente vigente **y de la misma sesión vigente** (ADR 31 punto 5) → `store.aprobarEscalacionReembolso({ ventaId, casoId, empleadoId, ahora })`: **una transacción** con `UPDATE ventas SET estado='reembolsada' WHERE id=@id AND estado='reembolso_pendiente' RETURNING ...`, `updateCaso(casoId, { estado: 'resuelto' })` y el `INSERT` en `registro_acciones_empleado`. `undefined` del CAS → `no_aplicable` sin excepción, más una fila `no_aplicable` escrita fuera de la transacción. `/rechazar-reembolso` es idéntico con `estado='reembolso_rechazado'`.

**Reapertura, secuencia exacta.** `/reabrir-reembolso` sin argumento → `store.listarReembolsosRechazados({ limite: 20 })`, ordenado por la fecha del rechazo tomada del registro. Con `ventaId` → eco enriquecido (monto, cliente, quién rechazó, cuándo, cuántas reaperturas previas) y confirmación pendiente. Segundo llamado → `store.reabrirEscalacionReembolso(...)`, misma transacción triple, CAS `WHERE estado='reembolso_rechazado'`. Una venta `reembolsada` no matchea nunca ese CAS: intentar reabrirla devuelve `no_aplicable` **sin código especial**.

**Por qué métodos nuevos y no ensanchar `aprobarReembolso`.** `aprobarReembolso` es CAS `confirmada → reembolsada` y su `WHERE estado='confirmada'` es lo que hace que un replay de devolución muera por construcción (ADR 19 punto 3). Ensancharlo a `IN ('confirmada','reembolso_pendiente')` haría que `procesarDevolucion` —que lo llama— pudiera saltarse la escalación sin que nadie apruebe nada. Sería romper una garantía testeada para ahorrar un método.

**Concurrencia.** Mismo argumento del ADR 15 de Hito 4: el camino de resolución no tiene ningún `await` entre lectura y escritura, así que el CAS dentro de una `db.transaction` da la garantía completa. No hace falta `createKeyedQueue()`. Dos TUIs sobre la misma base aprobando la misma venta: la segunda no matchea y devuelve `no_aplicable`.

**Provisioning, secuencia exacta.** `npm run empleados:crear -- ana` → `parseArgsEmpleado(argv)` (puro) resuelve id y modo → se lee una línea de `stdin` → `hashPassword(password)` del adaptador → `openDatabase("data/harness.db")` (corre las migraciones, incluida `0006`) → `insertCredencialEmpleado` o `updateCredencialEmpleado` → `db.close()` en `finally`. Sin TUI montada, así que `stdout` es legítimo acá, igual que en `reporte-mensual.ts`.

**Testing (TDD estricto).** `parsearComando`, `resolverLogin`, `sesionVigente`, `resolveAuthConfig` y `resolverEscalacionReembolso` son puros: se testean sin base, sin red, sin modelo y **sin scrypt real** (molde de `procesar-devolucion.test.ts`: `makeStore` con `vi.fn()` completo, `now` fijo, test explícito de sincronía). `verificarPassword`/`hashPassword` se testean aparte, contra scrypt real, con los casos que importan: ida y vuelta correcta, contraseña equivocada, hash corrupto, y **dos hashes de la misma contraseña son distintos**. El dispatcher se testea con dobles, verificando: **texto sin `/` llega a `onSubmit` sin modificar**, **ninguna fila ni evento contiene la contraseña ni el token**, **sin sesión los privilegiados no corren y los públicos corren sin fila**, y **la confirmación pendiente no sobrevive a un `/logout`, a un `/login` ajeno ni a la expiración**. Los CAS y la atomicidad `venta + caso + fila` se testean contra SQLite en memoria. Ningún test llama al modelo.

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | New | `parsearComando` puro + descriptores de los siete comandos + `/ayuda`. `/login` tratado como argumento **secreto**, no opaco (ADR 21, enmienda rev. 3) |
| `src/core/commands/registro-acciones-contract.ts` | New | `AccionEmpleado`, vocabulario de `comando`/`resultado` y `RegistroAccionesEmpleadoPort.registrarAccion` (ADR 27) |
| `src/core/auth/login.ts` | **New (rev. 3)** | `resolverLogin` puro y síncrono; `LoginDeps` con `verificarPassword` **inyectado** (ADR 30) |
| `src/core/auth/credenciales-contract.ts` | **New (rev. 3)** | `CredencialesEmpleadoPort.buscarCredencial` — una sola operación, de lectura (ADR 30) |
| `src/core/auth/sesion.ts` | **New (rev. 3)** | `SesionEmpleado` + predicado puro `sesionVigente(sesion, ahora)` (ADR 31) |
| `src/core/auth/auth-config.ts` | **New (rev. 3)** | `resolveAuthConfig(env)` para `SESION_TTL_MINUTOS` (default 30, `0` = sin expiración). Molde `resolveVentasConfig` (ADR 31) |
| `src/adapters/crypto/password.ts` | **New (rev. 3)** | `hashPassword`/`verificarPassword` con `scryptSync` + `randomBytes` + `timingSafeEqual`. Formato `scrypt$N$r$p$salt$clave`. Hermano de `webhooks/signature.ts` (ADR 30) |
| `src/core/ventas/resolver-escalacion-reembolso.ts` | New | Caso de uso puro y síncrono para las **tres** resoluciones; `accion` y `confirmado: boolean` explícitos (ADR 25, 29) |
| `src/core/ventas/ventas-contract.ts` | Modified | `VENTA_ESTADO_REEMBOLSO_RECHAZADO`, `CASO_ESTADO_RESUELTO`, cinco métodos nuevos en `VentaStorePort` |
| `src/core/ventas/procesar-devolucion.ts` + test | Modified | **Solo el retorno**: `DevolucionResult` gana `ventaId`/`casoId` donde la venta se conoce. Sin cambio de secuencia, guardas, efectos ni logging (ADR 27) |
| `src/core/ventas/reporte.ts` + `reporte.test.ts` | Modified | `NOTA_ESCALACION_FUERA_DE_BANDA` reescrita — sin "SQL manual", sin "rechazo irreversible" y **sin "identidad tomada de la configuración"** (ADR 26, enmienda rev. 3); caso borde de `ventasConReembolso` (ADR 23) |
| `src/core/config/env.ts` | Modified | Solo el module doc: `SESION_TTL_MINUTOS` se suma a la lista de variables que otros resolvedores leen. **`EMPLEADO_ID` no aparece** (ADR 32) |
| `src/adapters/memory/migrations/0005_registro_acciones_empleado.ts` | New | `CREATE TABLE registro_acciones_empleado` + índice por `venta_id` (ADR 27) |
| `src/adapters/memory/migrations/0006_credenciales_empleado.ts` | **New (rev. 3)** | `credenciales_empleado(empleado_id PK, password_hash NOT NULL, created_at, updated_at)`. **Sin columna de salt** (embebida en el hash), **sin columna `activo`** (diferida), **sin FK desde el registro** (ADR 27 enmienda, ADR 30) |
| `src/adapters/memory/repository.ts` | Modified | `aprobarEscalacionReembolso`, `rechazarEscalacionReembolso`, `reabrirEscalacionReembolso` (CAS + `updateCaso` + fila, una transacción), `listarReembolsosRechazados`, `insertAccionEmpleado` como **única** función de escritura del registro, y `buscarCredencialEmpleado` / `insertCredencialEmpleado` / `updateCredencialEmpleado` |
| `src/build-on-comando-empleado.ts` | New | Dispatcher: envuelve `onSubmit`, rutea los siete comandos, guarda **sesión y confirmación pendiente** en su closure (atadas entre sí), escribe las filas no transaccionales |
| `src/empleados.ts` | **New (rev. 3)** | Entrypoint CLI de provisioning. `parseArgsEmpleado` puro + `stdin` + `openDatabase`/`db.close()` en `finally` + guard `isMainModule`. Molde `reporte-mensual.ts` (ADR 33) |
| `src/main.ts` | Modified | `buildOnSoporte` compartido web+TUI; `startTui` recibe el envoltorio; `resolveAuthConfig` y `verificarPassword` cableados al dispatcher. **`EMPLEADO_ID` no se lee en ningún lado** |
| `src/adapters/tui/tui-port.ts` | **Solo comentario** | Nota del ensanche semántico de `agentLabel` (ADR 21). **Cero cambios de tipos** |
| `src/core/logging/turn-logger.ts` | Modified | Eventos nuevos, incluidos `login-exitoso` / `login-fallido` / `logout` / `sesion-expirada` — datos, sin cambio de contrato. **Ningún evento lleva la contraseña** |
| `src/adapters/web/*` | **No se toca** | `/soporte` y `/devolucion` HTTP siguen intactos y públicos; solo leen `resultado`, así que el ensanche de `DevolucionResult` no los afecta |
| `ventas.resuelto_por` / `resuelto_at` | **Descartadas** | Reemplazadas por la tabla del ADR 27. `ventas` **no cambia de esquema** en este change |
| `EMPLEADO_ID` (env var) | **Descartada (rev. 3)** | Nunca shippeó — solo existió en las revisiones 1 y 2 de este documento. Sin migración, sin compatibilidad (ADR 32) |
| `package.json` | **Modified (rev. 3)** | **Corrección a la revisión 2, que prometía no tocarlo**: se agrega el script `empleados:crear`. `dependencies` y `devDependencies` quedan **idénticas** — sigue sin haber dependencias nuevas |

## Risks

Numeración propia de este change. El riesgo heredado se referencia como **«R3 de Hito 4»** y este change existe para cerrarlo.

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R1 | **Acción financiera irreversible ejecutable desde una TUI local.** La identidad ya no es atestada, pero la frontera de confianza sigue siendo la máquina | **Media** *(bajó de Alta en la rev. 3)* | **PARCIALMENTE MITIGADO (ADR 30-32).** Contraseña por empleado verificada contra un hash scrypt, sesión con TTL, `/logout`, confirmación en dos pasos re-verificada contra la sesión, y toda fila de auditoría con `empleado_id` **autenticado**. **No baja a Baja** y hay que decir por qué: (a) quien tenga escritura sobre `data/harness.db` puede darse de alta a sí mismo y loguearse — **R16**; (b) no hay rate limiting — **R13**; (c) no hay política de fortaleza ni de expiración de contraseña; (d) no hay roles: cualquier empleado logueado puede aprobar cualquier monto. Lo que **sí** cambió de verdad: impersonar a un empleado **existente** ya requiere su contraseña, y rotarla deja huella en `updated_at` |
| R2 | Ensanchar `aprobarReembolso` por error (en vez de agregar métodos) rompe la garantía de replay del ADR 19 | Alta | Prohibido explícitamente en *Approach*; `sdd-design` lo fija como invariante y el test existente de `procesarDevolucion` sobre venta no confirmada queda como canario |
| R3 | Un texto conversacional legítimo que empiece con `/` se come como comando | Baja | Comando desconocido → `/ayuda`, nunca un efecto ni una fila de registro. Documentado en la ayuda |
| R4 | El parsing posicional de texto libre falla con argumentos raros (espacios, comillas) | Med | Argumentos posicionales de forma conocida; argumentos faltantes → uso, no efecto. Testeado con casos borde. **Nuevo en la rev. 3**: una contraseña con espacios no se puede tipear en `/login` — el parser toma el resto de línea como contraseña, y eso se testea explícitamente |
| R5 | `agentLabel: "sistema"` desvía del significado documentado de I1 sin ser un cambio de tipos | Med | Documentado en `tui-port.ts` y en el cierre del hito (ADR 21) |
| R6 | El sexto estado rompe consumidores existentes de `ventas.estado` que asumían cinco | Med | Solo hay dos consumidores (`reporte.ts` y los CAS del repositorio); ambos se revisan en `sdd-design` y el caso borde de `ventasConReembolso` queda fijado en el spec (ADR 23) |
| R7 | **Una aprobación por error es irreversible.** La reapertura del ADR 29 cubre solo el rechazo | Med | Asimetría deliberada y justificada (ADR 29). El eco del monto ataca la causa raíz antes de que ocurra. "Des-reembolsar" es una decisión de producto propia, diferida |
| R8 | **La confirmación pendiente Y la sesión viven en memoria del proceso: se pierden al reiniciar la TUI** | Baja | Deliberado, mismo criterio para las dos (ADR 25 punto 3, ADR 31 punto 4): son estado de interacción, no de negocio; perderlos obliga a repetir el comando o el `/login`. Persistir la sesión sería inventar estado durable —con su expiración, su invalidación y su superficie de robo— en la **misma base** que el atacante local ya lee. Acá lo efímero es lo seguro |
| R9 | El change no es un hito del plan: naming, rama, tag y carpeta de progreso quedan ambiguos | Baja | Propuesto `v1.4.0` / `hito/v1.4-tui-canal-empleado`; **decisión del checkpoint** |
| R10 | **Cobertura parcial del registro**: sin sesión, `/soporte` y `/devolucion` corren sin dejar fila, y sus filas se escriben **fuera** de la transacción (efecto sin fila si el proceso muere en el medio) | Med | *(Reescrito en la rev. 3.)* La evasión pasa de ser **el default** (no configurar una env var) a ser un **acto deliberado** (no loguearse, o `/logout` antes) — sigue siendo trivial, pero deja de ser el camino de menor resistencia. Y las filas que **sí** se escriben ahora valen más: son autenticadas (ADR 28 enmienda). El evento `accion-empleado-sin-sesion` deja rastro en el log cuando la fila no se escribe, así que el hueco es **detectable**. La parte no transaccional no cambió, y por eso sigue en Media |
| R11 | **Bucle rechazar → reabrir → rechazar** sobre el mismo caso, sin tope | Baja | Aceptado con visibilidad en vez de bloqueo (ADR 29). Reforzado en la rev. 3: las vueltas ahora se atribuyen a un empleado **autenticado**, así que la visibilidad es un control real y no una lista de etiquetas |
| R12 | `registro_acciones_empleado` y `credenciales_empleado` son **las primeras tablas fuera del SQL del plan** — desviación mayor que `expires_at` (ADR 10 de Hito 4), que era una columna | Med | *(Ampliado en la rev. 3: ahora son dos tablas.)* Ambas aditivas: no tocan ninguna tabla existente, no migran datos, no tienen lectores previos. `ventas` queda **sin cambios de esquema**. Requiere aceptación explícita del checkpoint |
| R13 | **Sin límite de intentos de login**: fuerza bruta local contra `/login` o directamente contra el hash | Baja | *(Nuevo, rev. 3.)* Decisión explícita del ADR 33: un contador en memoria se evade reiniciando el proceso, y uno durable exige tabla, ventana y un camino de desbloqueo que hoy no existe (sin admin, sin recuperación) — el callejón sin salida del ADR 29 en el peor lugar. El freno real es el costo de scrypt (~100 ms/intento), que es la defensa correcta contra el ataque **offline**, que es el que importa cuando el atacante ya tiene el archivo |
| R14 | **La contraseña se ve en pantalla**: la TUI no puede enmascarar la entrada sin tocar `App.tsx` (fuera de alcance, ADR 21), así que `/login ana secreto` queda en el transcripto visible; el provisioning por `stdin` también hace eco | Med | *(Nuevo, rev. 3.)* Se acota lo que se puede: la contraseña **no** se persiste, **no** entra en ninguna fila de auditoría, **no** aparece en ningún evento del log y **no** viaja por `argv` (ADR 33 punto 2), así que el eco es efímero y local. Lo que **no** se acota sin abrir el ADR 21: el enmascarado real. **Es un punto de decisión del checkpoint** — la alternativa es autorizar una desviación acotada de I1 para un modo de entrada enmascarada |
| R15 | **No hay desactivación de empleado**: dar de baja a alguien exige rotarle la contraseña a un valor aleatorio o borrar la fila a mano | Baja | *(Nuevo, rev. 3.)* La rotación **sí** está en alcance (ADR 33 punto 3), así que el paliativo existe y cuesta un comando. Una columna `activo` arrastra una política (sesión abierta, validez del historial, reuso del id) que es el modelo de autorización de Hito 5. Las filas de auditoría **sobreviven** a la baja por diseño: no hay FK del registro a las credenciales |
| R16 | **Auto-provisioning por acceso al archivo**: quien pueda escribir `data/harness.db` (o correr `empleados:crear`) se da de alta como empleado nuevo y se loguea | Med | *(Nuevo, rev. 3 — es el residual más filoso de R1 y por eso tiene línea propia.)* No se mitiga en este change y no se disfraza: la frontera de confianza sigue siendo la **máquina**, no la aplicación. Lo que sí cambia respecto de la revisión 2 es el **rastro**: el alta deja una fila con `created_at`, la impersonación de un empleado existente exige rotarle la contraseña y eso mueve `updated_at`, y todo lo que ese actor haga después queda atribuido a un id que no estaba antes. Detectable a posteriori, no prevenible. La prevención real es permisos del sistema de archivos sobre `data/`, que es infraestructura, no producto |

## Rollback Plan

El cambio es aditivo en el esquema y envolvente en el wiring.

- **En caliente**: `main.ts` vuelve a pasarle `onSubmit` directo a `startTui` (una línea). Sin el envoltorio, ningún comando existe —tampoco `/login`— y la TUI se comporta exactamente como en `v1.3.0`; `buildOnSubmit`, `App.tsx`, `start-tui.tsx` y `tui-port.ts` nunca se modificaron en su lógica.
- **Parcial**: no hay forma de desactivar solo la autenticación dejando los comandos privilegiados vivos, **y es a propósito** (ADR 32: no hay fallback). El rollback parcial disponible es el inverso: sin credenciales dadas de alta, nadie puede loguearse, así que los tres privilegiados quedan inalcanzables y `/soporte`/`/devolucion` siguen funcionando sin fila. Un despliegue con la base vacía de credenciales es, efectivamente, el estado `v1.3.0` más dos comandos públicos.
- **Esquema**: `0005` y `0006` solo **crean tablas nuevas**, sin tocar ninguna existente y sin FK entrantes desde tablas viejas. Revertir el código las deja sin escritores ni lectores; no hay pérdida de datos en `ventas`/`casos`/`comisiones` y no hace falta migración inversa. `0004` no se toca. Si se decide borrar `credenciales_empleado` a mano tras un rollback, **el registro de auditoría sobrevive intacto** — no hay FK, por la razón que el ADR 27 (enmienda rev. 3) explica.
- **Límite honesto**: una venta que ya pasó a `reembolsada` **no vuelve atrás con un rollback de código** (ni con este producto: ver R7). Una que pasó a `reembolso_rechazado` sí tiene camino de vuelta, pero **solo mientras el código esté desplegado**. Son transiciones de negocio ejecutadas por una persona, no efectos colaterales del deploy.
- **Límite honesto de la autenticación**: revertir el change **no invalida las contraseñas ya creadas** — quedan hasheadas en una tabla sin lectores. Si el motivo del rollback fuera una filtración, el remedio es borrar la tabla, no revertir el código.
- **Git**: revertir los commits de `hito/v1.4-tui-canal-empleado` antes del merge a `main`.

## Dependencies

- Hito 4 cerrado (`v1.3.0`) — ya lo está.
- **Ninguna dependencia nueva en `package.json`.** `node:crypto` (`scryptSync`, `randomBytes`, `timingSafeEqual`) cubre toda la autenticación; `engines.node` es `>=20`, muy por encima del mínimo que esas funciones necesitan. Sin cuentas externas, sin servicios: todo corre local contra SQLite.
- **Para la demo**: al menos un empleado dado de alta con `npm run empleados:crear -- <id>` (la migración `0006` corre sola al abrir la base), y una venta en `reembolso_pendiente` (se produce con el flujo de Hito 4: alta → confirmación → `POST /devolucion` sobre el umbral). Para demostrar la reapertura hace falta además rechazarla primero — el propio `/rechazar-reembolso` la produce. Para demostrar el ciclo completo con nombres distintos, **dos** empleados dados de alta.
- **Checkpoint humano de `AGENTS.md` aprobando esta revisión antes de `sdd-spec`/`sdd-design`** — ver la sección siguiente.

## Success Criteria

**Autenticación y sesión (revisión 3)**

- [ ] `npm run empleados:crear -- ana` con una contraseña por `stdin` crea la fila en `credenciales_empleado`, con `password_hash` **no vacío y distinto de la contraseña en claro**, y `created_at` = `updated_at`.
- [ ] Repetir el alta con el **mismo** `empleadoId` **falla** con `exit(1)` y **no pisa** el `password_hash` existente.
- [ ] `npm run empleados:crear -- ana --rotar` cambia `password_hash` y `updated_at`, deja `created_at` intacto, y **la contraseña vieja deja de validar**. Con un id inexistente, falla.
- [ ] Dar de alta dos empleados con **la misma contraseña** produce **hashes distintos** (salt aleatorio por fila).
- [ ] La contraseña **nunca** viaja por `argv` en ningún script de `package.json`.
- [ ] `/login ana <password correcta>` abre sesión, responde confirmando quién está logueado y deja **una fila** con `comando='/login'`, `resultado='exitosa'`, `venta_id`/`caso_id` en `NULL`.
- [ ] `/login ana <password incorrecta>` y `/login inexistente <cualquiera>` responden **el mismo mensaje genérico**, **no** abren sesión, **no** dejan fila, y emiten `login-fallido` con el id tipeado.
- [ ] **Ningún** valor persistido ni logueado contiene la contraseña, ni un prefijo, ni su longitud: test explícito sobre las filas de `registro_acciones_empleado` **y** sobre todos los eventos emitidos durante un `/login` exitoso y uno fallido.
- [ ] `resolverLogin` es **puro y síncrono**: su test corre con un `verificarPassword` falso (`vi.fn()`), sin derivar ninguna clave real y sin tocar la base.
- [ ] Con `SESION_TTL_MINUTOS=30` y un reloj inyectado, una sesión abierta a `T` es vigente a `T+29m` y **no** lo es a `T+31m`; con `SESION_TTL_MINUTOS=0` sigue vigente indefinidamente. `resolveAuthConfig` con un valor inválido devuelve error acumulado sin lanzar.
- [ ] `/logout` cierra la sesión; un comando privilegiado inmediatamente posterior responde que hace falta `/login` y **no escribe nada**.
- [ ] **La confirmación pendiente no sobrevive** a: un `/logout`, un `/login` de otro empleado, ni la expiración de la sesión. En los tres casos el segundo paso de la confirmación **no ejecuta** y no escribe nada.
- [ ] Sin sesión: los **tres** comandos privilegiados no están disponibles y **no escriben nada** (evento `comando-privilegiado-sin-sesion`); `/soporte` y `/devolucion` funcionan igual y **no dejan fila** (evento `accion-empleado-sin-sesion`); la TUI arranca idéntica y el camino conversacional no cambia.
- [ ] Con sesión: `/soporte` y `/devolucion` **sí dejan fila**, con el `empleado_id` de la sesión (ADR 28, enmienda rev. 3).
- [ ] **Ningún `empleadoId` provisto por el usuario llega a `insertAccionEmpleado`**: el único origen es la sesión vigente (invariante estructural, ADR 27 enmienda).
- [ ] `EMPLEADO_ID` no aparece en ningún archivo del change: ni en código, ni en `.env.example`, ni en documentación (ADR 32).

**Comandos y cierre de R3**

- [ ] Un texto sin `/` escrito en la TUI resuelve un turno conversacional **byte por byte idéntico** a `v1.3.0` — mismo `casoId`, mismo `handleTurn`, mismo `agentLabel` real.
- [ ] `/soporte <consulta>` crea un `caso` tipo `soporte` y devuelve la respuesta del agente en la TUI, reusando el **mismo** `buildOnSoporte` que sirve a `POST /soporte`, sin duplicar `createKnowledge`.
- [ ] `/devolucion <token>` bajo el umbral deja la venta en `reembolsada`; sobre el umbral la deja en `reembolso_pendiente` con su `caso` en `pendiente_aprobacion_humana` — mismo comportamiento que `POST /devolucion`, **sin cambio de secuencia ni de guardas en `procesarDevolucion`**.
- [ ] `/aprobar-reembolso` sin argumento lista los reembolsos pendientes con `ventaId`, vendedor, cliente y monto.
- [ ] `/aprobar-reembolso <ventaId>` **no ejecuta nada** en el primer llamado: devuelve el eco con el monto y pide confirmación. Ni el store ni el registro reciben ninguna escritura (verificable con `vi.fn()`).
- [ ] El segundo `/aprobar-reembolso <ventaId>` deja, **en una transacción**, la venta en `reembolsada`, el `caso` en `resuelto` y **una fila** con el `empleado_id` **de la sesión**.
- [ ] `/rechazar-reembolso <ventaId>` confirmado deja la venta en `reembolso_rechazado`, el `caso` en `resuelto`, su fila, y **un `/devolucion` posterior sobre esa venta responde `no_aplicable`** sin efecto (ADR 23).
- [ ] `/reabrir-reembolso` sin argumento lista los reembolsos rechazados, el más recientemente rechazado primero, acotado por `limite`.
- [ ] `/reabrir-reembolso <ventaId>` **no ejecuta nada** en el primer llamado: el eco incluye monto, cliente, **quién rechazó, cuándo y cuántas reaperturas previas** hay.
- [ ] El segundo `/reabrir-reembolso <ventaId>` deja, **en una transacción**, la venta en `reembolso_pendiente`, el `caso` **de vuelta** en `pendiente_aprobacion_humana` con **el mismo `caso_id` de siempre** y su fila; la venta vuelve a aparecer en `/aprobar-reembolso` sin argumento y en el reporte mensual.
- [ ] `/reabrir-reembolso` sobre una venta `reembolsada` responde `no_aplicable` y **no escribe nada** — por el CAS, sin validación especial (ADR 29).
- [ ] Un ciclo completo `escalada → rechazada por ana → reabierta por beto → aprobada por ana` deja **cuatro filas legibles** que cuentan la historia en orden, con los `empleado_id` correctos **y autenticados** (cada uno precedido de su fila de `/login`), y el estado final de la venta es `reembolsada`.
- [ ] Aprobar dos veces la misma venta: el segundo intento responde `no_aplicable`, sin excepción, sin segunda escritura en `ventas` y con una fila `resultado='no_aplicable'`.
- [ ] **Ninguna fila del registro contiene un `token_confirmacion`, una contraseña, el texto de una consulta de soporte ni el motivo del cliente** — test explícito, no implícito.
- [ ] Un `/devolucion` con token inexistente deja fila con `venta_id`/`caso_id` en `NULL` y `resultado='no_aplicable'`, **sin rastro del token**.
- [ ] Un comando desconocido, `/ayuda`, o un comando con argumentos faltantes responden con la ayuda, **nunca con un efecto ni con una fila**.
- [ ] `npm run reporte:mensual` ya **no** afirma que no existe vía de producto para cerrar escalaciones, menciona los tres comandos, **no** describe el rechazo como irreversible, y **no** dice que la identidad del resolvedor se toma de la configuración (ADR 26, enmienda rev. 3).
- [ ] `npm test` y `npm run typecheck` en verde; ningún test nuevo llama al modelo ni abre un puerto; ningún test de caso de uso puro deriva una clave scrypt real.
- [ ] `src/adapters/tui/tui-port.ts`, `App.tsx` y `start-tui.tsx` no tienen **ningún cambio de tipos ni de lógica** en el diff (ADR 21); `ventas` no tiene ningún cambio de esquema (ADR 27); `package.json` cambia **solo** en `scripts`.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v1.4-tui-canal-empleado/` con evidencia del cierre de R3 end-to-end, **del ciclo con reapertura** y **del login/logout con dos empleados distintos**, tag semántico creado.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| **Roles y permisos** (quién puede aprobar qué, límites por monto, segundo aprobador) | Hito 5 (HITL generalizado), que ya necesita el modelo de autorización | `/login` responde *quién sos*; *qué podés* es otra pregunta y otro modelo. Todo empleado logueado puede resolver cualquier escalación, y eso queda declarado, no escondido (R1 punto d) |
| **Límite de intentos de login / rate limiting** | Hito 5, junto con el modelo de autorización | Un contador en memoria se evade reiniciando el proceso; uno durable exige tabla, ventana y un camino de desbloqueo que hoy no existe — el callejón sin salida del ADR 29 en el peor lugar. El freno es el costo de scrypt (ADR 33). **R13** |
| **Desactivación de empleado** (columna `activo`, revocación de sesiones vivas) | Hito 5 | Arrastra una política que nadie definió (sesión abierta, validez del historial, reuso del id). El paliativo existe y cuesta un comando: rotar la contraseña a un valor aleatorio. **R15** |
| **Recuperación de contraseña y política de fortaleza** | Cuando haya un canal de notificación al empleado y un dueño de la política | "Olvidé mi contraseña" exige un canal de email que este change no toca; una política de fortaleza sin recuperación produce empleados bloqueados sin salida. La rotación por CLI cubre el caso real (ADR 33) |
| **Enmascarado de la contraseña en la TUI** | Requiere abrir el límite del ADR 21 (`App.tsx`/`start-tui.tsx`) | Es el follow-up obvio de **R14** y está listado como punto de decisión del checkpoint: si lo pide, deja de ser diferido y se trata como desviación acotada de I1 |
| **Sesión persistente entre reinicios / compartida entre procesos** | Sin pedido | Sería estado durable —con expiración, invalidación y superficie de robo propias— para una interacción de minutos, guardado en la misma base que el atacante local ya lee. Lo efímero es lo seguro acá (ADR 31 punto 4, R8) |
| **Autenticación de empleado en el adaptador web** | Cuando exista un caso de uso de empleado por HTTP | Hoy no hay ninguno: `/soporte` y `/devolucion` son del cliente final y `/ventas` ya tiene su `Bearer`. El adaptador web no se toca (ADR 28) |
| **Deshacer una aprobación** (`reembolsada` → cualquier otra cosa) | Decisión de producto propia, sin pedido | Asimetría deliberada del ADR 29: deshacer un rechazo devuelve la venta a la cola de decisión; deshacer una aprobación es un hecho financiero consumado con contraparte externa. **R7** |
| **Tope o política de reaperturas** (máximo N, cooldown, segundo aprobador) | Hito 5, junto con el modelo de autorización | Un número sin dueño dejaría ventas en un estado que nadie puede mover. Se mitiga con visibilidad, que con `/login` pasa a ser un control real. **R11** |
| **Lectura/exportación del registro** (`/auditoria` en la TUI, columna en el reporte mensual) | Cuando haya un lector real que la pida | La tabla ya se lee para armar `/reabrir-reembolso` y su eco; una vista de auditoría completa es una superficie de UI propia, y el reporte no debe anunciar lo que no muestra (ADR 26) |
| **Auditoría de `POST /soporte` y `POST /devolucion` (camino HTTP)** | Cuando el adaptador web tenga noción de actor | Ese camino es del **cliente final**, no de un empleado; registrar "empleado desconocido" sería la fila mentirosa que el ADR 28 rechaza |
| **Vista/lista navegable en la TUI** (Approach C de la exploración) | Mejora de UX posterior, aditiva | No resuelve `/soporte` ni `/devolucion` (haría falta el dispatcher igual), y sería el primer modo con estado de navegación de la TUI. Los comandos sin argumento ya dan los dos listados (ADR 21) |
| **Notificación al cliente del desenlace del reembolso** | Decisión de producto propia | `VentaNotifierPort` tiene una sola operación por ADR 18 de Hito 4; agregar la segunda obliga a decidir plantilla, destinatario y qué pasa si falla en un camino que ya cerró la transacción |
| **Reversión de comisión al reembolsar (R5 de Hito 4) y reembolso parcial** | Sin cambios respecto de Hito 4 | Este change no toca `comisiones` en ningún camino. La inconsistencia sigue siendo **visible** en el reporte, no silenciosa |
| **Tabla `aprobaciones` / HITL generalizado** | Hito 5, dueño declarado por el plan | Los ADR 24 y 29 dejan el ciclo del `caso` cerrado, cíclico y probado, y los ADR 30-33 le entregan a Hito 5 un actor **autenticado** en vez de uno atestado — que es la pieza que un modelo de autorización necesita antes de poder existir |
| **`src/core/skills/` (Registro de Skills)** | Sin cambios: sigue esperando el disparador del ADR 8 | Este change dispara el ADR 9 (Registro de Comandos), **no** el ADR 8: un comando de empleado es determinista y no mete al modelo en ningún camino |
| **Comandos de la TUI para el resto del dominio** (alta de venta, consulta de conocimiento explícita, estado de un caso) | Cuando haya un caso de uso que los pida | El registro queda construido y agregar un comando pasa a ser un descriptor más. No se pre-construyen comandos sin usuario |

## Qué necesita el checkpoint humano antes de `sdd-spec` / `sdd-design`

**Las Decisiones 1, 2 y 3 no se re-preguntan**: el checkpoint ya las pidió y esta revisión las implementa (ADR 27-33). Lo que sigue son (a) las decisiones abiertas desde revisiones anteriores que siguen sin respuesta, y (b) **las decisiones de diseño nuevas que esta revisión tomó por dentro de la Decisión 3** y que el checkpoint tiene que confirmar, porque ninguna venía dada en el pedido.

**Bloqueantes — si el checkpoint las cambia, el diseño es otro:**

1. **R1 ya no se acepta: se reduce. Confirmar que el residual es aceptable.** La atribución pasa a ser autenticada (ADR 30-32), y R1 baja de **Alta** a **Media**. Lo que queda y hay que aceptar con nombre propio: **R16** — quien pueda escribir `data/harness.db` o correr `empleados:crear` se da de alta a sí mismo y se loguea; la frontera de confianza sigue siendo la **máquina**, no la aplicación, y la prevención real son permisos de filesystem sobre `data/`, que es infraestructura. Más: sin roles (cualquier empleado logueado aprueba cualquier monto) y sin rate limiting (**R13**). Si el checkpoint considera que ese residual no alcanza, la salida es un modelo de autorización, y eso **es** Hito 5.
2. **R14 — la contraseña se ve en pantalla, y este es el punto donde el ADR 21 duele.** `/login ana secreto` queda en el transcripto visible de la TUI, porque enmascarar la entrada exige tocar `App.tsx`/`start-tui.tsx`, que el ADR 21 dejó fuera de alcance. Dos salidas y hay que elegir una: **(a)** aceptar el eco (la contraseña no se persiste, no entra en ninguna fila, no entra en ningún evento, no viaja por `argv` — el eco es efímero y local), o **(b)** autorizar una **desviación acotada de I1** para agregar un modo de entrada enmascarada, lo cual agranda el change y reabre el ADR 21. Es la única decisión de esta revisión que puede cambiar el alcance de forma material.
3. **ADR 27 / R12 — dos tablas fuera del SQL del plan.** `registro_acciones_empleado` y ahora `credenciales_empleado` (`expires_at`, ADR 10 de Hito 4, era una columna). A cambio, `ventas` queda **sin cambios de esquema**. Confirmar que la desviación de esquema es aceptable, ahora en su versión ampliada.
4. **ADR 23 + 29 — el sexto estado y su reapertura.** `reembolso_rechazado` es *terminal salvo reapertura explícita*, y `reembolso_pendiente` deja de ser terminal. Es la decisión de modelo de dominio con mayor efecto de arrastre. *(Abierta desde la revisión 2, sin respuesta.)*
5. **ADR 21 — el Approach A y el ensanche semántico de `agentLabel`.** No hay cambio de tipos en I1, pero sí una lectura nueva de un campo documentado en el arc42. Corresponde además confirmar que **abrir `src/core/commands/` es legítimo** (disparador del ADR 9) y, nuevo en esta revisión, que **abrir `src/core/auth/` también lo es**: identidad no es ruteo de comandos ni dominio de ventas, y meterla en cualquiera de las dos carpetas la archivaría mal. *(Abierta desde la revisión 1.)*

**Decisiones nuevas tomadas dentro de la Decisión 3 — confirmar, no re-discutir desde cero:**

6. **Corrección de premisa del brief (ADR 30).** El pedido afirmaba que `src/core/` no puede importar `node:crypto`. **`AGENTS.md` no dice eso** —su única regla de import es *"`src/core/` nunca importa nada de `src/adapters/*`"*— y el repo tiene el precedente contrario, explícito y aprobado por el Reviewer: `src/core/turn-selector/close-turn.ts:77` importa `randomUUID` de `node:crypto` y su module doc argumenta por qué es legal. **La inyección de `verificarPassword` se adopta igual**, pero por tres razones propias: determinismo del test (idéntico a `newId`/`now` en `ConfirmarVentaDeps`), el costo deliberado de scrypt dentro de un núcleo síncrono, y que los parámetros del KDF son configuración operativa y no negocio (taxonomía del ADR 17a). Confirmar que la corrección se acepta: importa porque un diseño apoyado en una regla inexistente se cae en el primer code review.
7. **ADR 33 — la contraseña entra por `stdin`, no por `argv`.** El brief sugería `empleados:crear -- <id> <password>`; se descarta porque `argv` queda en el historial del shell y en la tabla de procesos. Confirmar el cambio de forma (habilita igual el uso scripteado con `echo "$PASS" | ...`).
8. **ADR 33 — la rotación de contraseña está EN alcance; la desactivación NO.** Es lo contrario de lo que el brief anticipaba ("probablemente NO para este change"). Motivo: sin rotación, una contraseña comprometida no tiene remedio dentro del producto y el único camino es un `DELETE` a mano — **exactamente el argumento del ADR 29** aplicado a credenciales. Y cuesta un `if` y un `UPDATE`. La desactivación sí se difiere, con el paliativo de rotar a un valor aleatorio (**R15**).
9. **ADR 33 — los logins fallidos NO dejan fila de auditoría.** Van solo a `logTurnEvent` (`login-fallido`, con el id tipeado, nunca la contraseña), porque `registro_acciones_empleado.empleado_id` es `NOT NULL` y significa *"este empleado hizo X"*; escribir ahí un id tipeado que quizás no existe lo convertiría en *"alguien dijo llamarse así"* — la atribución ambigua que el ADR 28 rechaza. El login **exitoso** sí deja fila. Y **sin límite de intentos** (**R13**): si el checkpoint lo quiere, hay que decidir la ventana **y** cómo se desbloquea a alguien, porque hoy no hay admin ni recuperación.
10. **ADR 31 — forma de la sesión: una ranura, TTL absoluto de 30 min (`0` = sin expiración), `/logout`, y confirmación pendiente ATADA a la sesión.** Las tres primeras son economía; **la cuarta es de seguridad y no es opcional**: sin ella, el flujo de dos pasos es un bypass (A prepara, B confirma; o la sesión vence entre paso y paso y el paso 2 ejecuta igual). Confirmar además que perder la sesión al reiniciar la TUI es aceptable (**R8**, mismo criterio que ya se aceptó para la confirmación pendiente).
11. **ADR 32 — `EMPLEADO_ID` desaparece por completo, sin fallback.** Ni como identidad de respaldo (dejaría los privilegiados alcanzables sin contraseña: R1 intacto con un candado decorativo encima), ni como identidad por defecto de lo público (mezclaría filas autenticadas y autodeclaradas **indistinguibles** en la misma columna), ni como semilla del provisioning (el alta corre en otro proceso y recibe el id por argumento). Costo de borrarla: **cero** — nunca shippeó.
12. **ADR 28, enmienda — `/soporte` y `/devolucion` siguen SIN exigir sesión, pero la aprovechan si existe.** La clasificación público/privilegiado se sostiene entera (los cuatro argumentos originales no dependían de la calidad de la identidad). Lo que cambia: **con** sesión activa esos dos comandos **sí** dejan fila, con un `empleado_id` autenticado — mejora real de la cobertura de **R10** sin agregar fricción. La evasión pasa de ser el default a ser un acto deliberado. Confirmar que se prefiere esto a exigir login para los dos públicos.
13. **`package.json` sí se modifica** — corrección explícita a la revisión 2, que prometía no tocarlo. **Solo** para agregar el script `empleados:crear`; `dependencies` y `devDependencies` quedan idénticas.

**No bloqueante:**

14. **R9 — naming, versión y rama.** Este change no es un hito del plan. Se propone `v1.4.0` / `hito/v1.4-tui-canal-empleado` / `docs/progreso/v1.4-tui-canal-empleado/`. Con la Decisión 3 adentro el alcance creció de forma apreciable (dos tablas, un entrypoint CLI, una carpeta de núcleo nueva y un adaptador nuevo), así que corresponde reconsiderar si sigue siendo un `v1.4.0` o si conviene partirlo en dos entregas — la autenticación primero, los comandos después. Si se parte, el orden es **autenticación primero**: los comandos privilegiados no pueden shippear sin ella.

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación ya documentada por las exploraciones y propuestas de Hitos 3 y 4 y por las revisiones 1 y 2 de este documento. Se compensó con lectura directa y verificación puntual de cada afirmación nueva de esta revisión: `AGENTS.md` (la **única** regla de import es `src/core/` ↛ `src/adapters/*`; **no** menciona built-ins de Node — base de la corrección del ADR 30), `src/core/turn-selector/close-turn.ts:45-77` (precedente aprobado de `node:crypto` **dentro** del núcleo, con su justificación escrita), `src/adapters/webhooks/signature.ts:1-52` (`createHmac` + `timingSafeEqual` con chequeo de longitud previo — molde del adaptador de password), `src/adapters/web/server.ts:106-131` (mismo patrón en el `Bearer` de `/ventas`), `src/core/ventas/confirmar-venta.ts:33-79` y `registrar-venta.ts:57-96` (`newId`/`now` inyectados: el patrón que se copia para `verificarPassword`), `src/core/ventas/ventas-config.ts` (molde exacto de `resolveAuthConfig`: pura, sin `import env.js`, sin default `process.env`, acumula errores, no lanza), `src/reporte-mensual.ts` (molde del entrypoint CLI: parte pura testeada, `openDatabase`/`db.close()` en `finally`, guard `isMainModule`, `stdout` legítimo por ser proceso sin TUI), `src/adapters/memory/migrations/` (contiene `0001`–`0004` + `index.ts` — **`0005` y `0006` están libres**), `0004_vendedores_ventas_comisiones.ts` (estilo de `CREATE TABLE`, ids `TEXT PRIMARY KEY`, timestamps `TEXT` ISO-8601, criterio de índices, `TEXT` abierto sin `CHECK`, `cliente_id` opaco sin FK), `package.json` (`engines.node >= 20`, scripts existentes, **sin dependencia de hashing** — de ahí el criterio de cero dependencias nuevas) y `openspec/specs/` (**no existe todavía**, así que el rename de capability de la revisión 2 sigue siendo gratis). Lo verificado en las revisiones 1 y 2 sigue vigente y no se re-listó. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` ejecute `graphify explain` sobre los conceptos nuevos (`resolverLogin`, `sesionVigente`, `verificarPassword`, `hashPassword`, `parseArgsEmpleado`, `buscarCredencialEmpleado`, `parsearComando`, `resolverEscalacionReembolso`, `aprobarEscalacionReembolso`, `reabrirEscalacionReembolso`, `registrarAccion`).
