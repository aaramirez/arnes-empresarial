# Propuesta: Hito 4 — Confirmación de venta y comisiones (v1.3.0)

**Origen**: [Plan de Implementación, Hito 4](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-4-confirmación-de-venta-y-comisiones) · [arc42](../../../docs/ARC42_Harness_Empresarial.md): Caja Blanca bloques 3 (Registro de Comandos) y 5 (Registro de Skills), Riesgo 2 (concurrencia SQLite), Escenario de calidad 4 (operabilidad local) · [exploration.md](exploration.md).

## Intent

Los tres hitos anteriores construyeron un arnés donde **todo turno pasa por el modelo**: la TUI (Hito 1), la consulta de conocimiento (Hito 2) y la revisión de PRs (Hito 3) comparten el mismo molde — un evento entra, `handleTurn` decide, un veredicto en texto libre dispara la transición de estado (`src/core/activity/run-activity-turn.ts`, `transicion-estado.ts:71`). Este hito entrega lo que el plan pide textualmente — *"El cliente confirma la compra por la página web; el agente actualiza estadísticas y calcula comisiones; a fin de mes genera el reporte comparativo por vendedor"* — y al hacerlo obliga a reconocer que **ese molde no sirve para todo**: `monto × porcentaje` y `monto < umbral` son reglas deterministas que el propio plan describe como tales, y hacerlas pasar por un LLM sería meter no-determinismo en el camino del dinero a cambio de nada.

Además es el primer hito que toca tres brechas abiertas del proyecto: no existe ningún adaptador de salida hacia una persona (email), no existe ninguna escalación humana implementada (el plan la atribuye al Hito 5, que todavía no se construyó — inconsistencia cronológica que la exploración documentó), y `src/core/skills/` y `src/core/commands/` llevan tres hitos documentados en el arc42 con cero archivos adentro. Esta propuesta cierra las tres, en la forma **más chica que cumple el entregable**, y deja escrito por qué.

## Scope

### In Scope

- **Adaptador Web entrante** en `src/adapters/web/`: listener `node:http` propio, molde `createRequestListener`/`startServer` de `src/adapters/webhooks/server.ts:139,254`. Rutas: `POST /ventas` (alta de venta, autenticada por token estático), `GET /confirmar/:token` (formulario HTML), `POST /confirmar/:token` (confirma o rechaza), `POST /soporte`, `POST /devolucion`.
- **HTML mínimo renderizado por función pura** en el adaptador (`renderConfirmacionHtml(...)`, `renderResultadoHtml(...)`): sin motor de plantillas, sin assets estáticos, sin framework. La presentación es detalle del adaptador, nunca del núcleo.
- **Adaptador de Notificaciones saliente** en `src/adapters/notificaciones/`: cliente de email transaccional sobre `fetch` nativo con `fetchFn` inyectable, calcado de `src/adapters/board/github-client.ts:108`, más `resolveNotificacionesConfig(env)` puro. Degrada a logger del link cuando falta la API key (ver *Dependencias nuevas*).
- **Núcleo de ventas** en `src/core/ventas/`: `ventas-contract.ts` (sin imports — constantes de `ventas.estado` y puertos `VentaStorePort` / `VentaNotifierPort`, molde `activity-contract.ts:25-45`) más las funciones **puras** `calcularComision`, `evaluarReembolso`, `validarTokenConfirmacion` y `agruparReporteMensual`.
- **Migración `0004_vendedores_ventas_comisiones.ts`**: las tres tablas del plan, estilo `0003` (`TEXT` abierto, sin `CHECK`, `IF NOT EXISTS`), **más la columna `expires_at TEXT` en `ventas`** (ADR 10 — desviación explícita del SQL del plan).
- **CRUD en `repository.ts`**: `upsertVendedor` (análogo a `upsertProyecto`/`upsertResponsable`, `repository.ts:339,384`), `createVentaConCaso` (transaccional, molde `createCasoConActividad`, `repository.ts:568`), `findVentaByToken`, `confirmarVentaConComision` (transacción única: estado + fila de `comisiones`), `escalarReembolso`, y las lecturas de agregación del reporte.
- **Comando de reporte mensual**: script CLI `npm run reporte:mensual` (entrypoint separado de `main.ts`) sobre agregación pura, incluyendo una sección de **reembolsos pendientes de aprobación** (ADR 9 y ADR 11).
- **Configuración por env**: `WEB_PORT`, `WEB_PUBLIC_URL`, `VENTAS_API_TOKEN`, `COMISION_PORCENTAJE`, `REEMBOLSO_UMBRAL`, `VENTA_TOKEN_TTL_HORAS`, `EMAIL_API_KEY`, `EMAIL_FROM`, vía `resolveVentasConfig(env)` / `resolveNotificacionesConfig(env)` puros, molde `resolveWebhookConfig` / `resolveBoardConfig`.
- **Composition root ampliado**: módulos hermanos de `build-on-activity.ts` en `src/` raíz — un manejador determinista (confirmación/devolución, **sin `handleTurn`**) y un constructor de turno para soporte (**con `handleTurn`**), ver ADR 7.
- **Eventos nuevos de `logTurnEvent`** (`venta-creada`, `token-invalido`, `venta-confirmada`, `comision-calculada`, `reembolso-aprobado`, `reembolso-escalado`, `email-enviado`/`email-omitido`), sin cambiar el contrato del logger — mismo criterio que Hitos 2 y 3.

### Out of Scope

- **`src/core/skills/` como Registro de Skills genérico.** Ver ADR 8. La brecha del arc42 se documenta, no se codifica.
- **`src/core/commands/` como Registro de Comandos genérico, y cualquier scheduler.** Ver ADR 9.
- **El cierre de la escalación de reembolso** (endpoint de aprobación, pantalla en la TUI, notificación al aprobador). Este hito construye la **detección y la persistencia** de la escalación, no su resolución. Ver ADR 11 y R3.
- **Tabla `clientes`, adaptador de CRM o resolución de identidad de cliente.** `cliente_id` es un identificador **opaco** que llega en el payload de quien da de alta la venta y se guarda tal cual. Ver *Fuera de alcance / diferido*.
- **Tabla de reglas de comisión por producto/vendedor/tramo.** El MVP usa un porcentaje fijo por configuración, tal como el plan lo autoriza explícitamente ("una tabla de reglas queda como posible deuda técnica futura").
- **Reembolso parcial.** `ventas.estado = 'reembolsada'` es todo-o-nada sobre `monto`; no hay columna de monto reembolsado y no se agrega.
- **Reversión de la comisión al reembolsar.** Requiere una fila de ajuste negativo o un campo de anulación en `comisiones` que el esquema del plan no contempla; se difiere con nota explícita (R5).
- **Portal autenticado del vendedor, login, sesiones o cookies.** El alta de venta es máquina-a-máquina con token estático; la página de confirmación es pública y su única credencial es el token del link.
- **Modo headless / demonio.** Igual que en el ADR 5 del Hito 3: la TUI sigue siendo dueña del ciclo de vida del proceso.
- **HTTPS, certificados, dominio público.** La demo se expone con la misma herramienta de forwarding que ya usa Hito 3.
- **Segundo `AgentDefinition` para soporte.** Se reusa `CONVERSATIONAL_AGENT` con prompt sintético, igual que hizo Hito 3.
- **Dependencias nuevas en `package.json`.**

## Capabilities

### New Capabilities

- `venta-confirmacion`: alta de una venta en `pendiente_confirmacion`, notificación del link único al cliente, página de confirmación, validación del token (estado + expiración) y transición determinista a `confirmada` o `rechazada`.
- `comision-calculo`: al confirmar, cálculo determinista `monto × porcentaje` y persistencia de la fila de `comisiones` con su `periodo`, en la misma transacción que la transición de estado.
- `reembolso-evaluacion`: evaluación determinista contra el umbral — auto-aprobación por debajo (`reembolsada`), escalación humana por encima, sin transición automática.
- `soporte-web-turno`: `POST /soporte` crea un `caso` tipo `'soporte'` y resuelve un turno conversacional real con `handleTurn`.
- `reporte-comisiones-mensual`: comando CLI que agrupa `ventas` + `comisiones` por `vendedor_id`/`periodo` y lista los reembolsos pendientes de aprobación.

### Modified Capabilities

**Ninguna.** Las capacidades de Hitos 1-3 (`knowledge-query`, `activity-webhook-turn`, `activity-board-mirror`) no cambian de contrato ni de comportamiento: este hito agrega un adaptador y un módulo de núcleo al lado, sin tocar el camino del webhook ni el del tablero.

## Decisiones de arquitectura fijadas por esta propuesta

La exploración dejó tres preguntas estructurales abiertas y señaló cuatro decisiones de alcance sin resolver. Esta propuesta las cierra todas acá, para que el checkpoint humano apruebe la dirección **antes** del diseño. La numeración continúa la del arc42 (ADR 1-2), Hito 2 (ADR 3, 3.1, 4) e Hito 3 (ADR 5, 6).

### ADR 7: El camino del dinero es determinista — ruteo asimétrico, `handleTurn` solo para soporte

**Contexto**. Toda entrada al arnés hasta hoy produce exactamente un turno de LLM. El plan describe la confirmación y el reembolso como reglas cerradas ("monto × porcentaje fijo", "por debajo aprueba sola"), sin ningún paso de razonamiento: el cliente hace click, listo.

**Decisión**. Se adopta la opción B de la exploración (punto 1) — **ruteo asimétrico por endpoint**:

1. `GET/POST /confirmar/:token` y `POST /devolucion` llaman **directo** a funciones puras de `src/core/ventas/`. Cero llamadas al modelo, cero `handleTurn`, cero SDK.
2. `POST /soporte` **sí** pasa por `handleTurn`, creando un `caso` tipo `'soporte'` — es el único caso de uso del hito con valor conversacional real, y el propio plan lo emparenta con la consulta gerencial de Hito 2 ("reutiliza casos, igual que...").
3. `POST /ventas` es alta determinista: escribe la venta y dispara la notificación best-effort, sin turno.
4. El composition root gana módulos hermanos de `build-on-activity.ts:204` — pero el determinista **no es un constructor de turno**: es un manejador que compone repositorio + núcleo puro y devuelve un resultado, sin `HandleTurnDeps`.

**Alternativas consideradas**:

- *Todo por `handleTurn` (uniformidad con Hito 3)*: rechazada. Paga costo, latencia y no-determinismo para que un modelo estadístico rubrique una multiplicación. En un cálculo financiero eso no es un problema de estilo, es un problema de corrección: un LLM puede equivocarse en la aritmética o en el formato del veredicto, y el fallback seguro de Hito 3 (`parseVeredicto` degradando a `observado`) no tiene análogo acá — no existe un "monto de comisión seguro por defecto".
- *Todo determinista, incluido soporte*: rechazada. Convierte una consulta de soporte abierta en una plantilla, y tira a la basura la única parte del hito donde el agente conversacional aporta valor real.

**Consecuencias**:

- Aparecen **dos formas de wiring** en el mismo adaptador. Es superficie conceptual extra, y se acepta a conciencia: la alternativa es una uniformidad que miente sobre la naturaleza de cada flujo.
- El grueso de este hito es testeable **sin ningún fixture de LLM** — encaja con TDD estricto mejor que cualquier hito anterior.
- Queda establecido el precedente que el arnés necesitaba: *no todo evento de negocio es un turno de agente*. Hitos futuros pueden apoyarse en él sin volver a discutirlo.

### ADR 8: La "Skill de reglas de negocio de ventas" es un módulo puro del núcleo, no el Registro de Skills

**Contexto**. El plan nombra una "nueva Skill de reglas de negocio de ventas... (Registro de Skills)"; el arc42 ubica ese registro en `src/core/skills/` y define una skill como un paquete de capacidad **"que el agente invoca durante el turno"**. Ese archivo no existe y este es el primer hito que necesitaría el concepto.

**Decisión**. La "Skill de ventas" **es** `src/core/ventas/` — un módulo puro del núcleo (`ventas-contract.ts` sin imports + funciones puras), invocado directamente por el composition root. **No se crea `src/core/skills/`.**

**Alternativas consideradas**:

- *Construir el Registro de Skills*: rechazada por dos razones, no una. Primero, YAGNI: un registro genérico con **un** paquete registrado y **un** consumidor es ceremonia, no arquitectura. Segundo, y más grave: la semántica documentada de una skill ("el agente la invoca durante el turno") **implica una tool-call del LLM**, o sea que construir el registro "bien" arrastraría de vuelta la Opción A del ADR 7, que acabamos de rechazar por razones de corrección.
- *Exponer el cálculo como MCP tool, molde `knowledge-tool.ts`*: rechazada. Reusa un patrón probado, pero solo tiene sentido si hay un paso de razonamiento decidiendo cuándo disparar el cálculo — y no lo hay.

**Consecuencias**:

- La brecha `src/core/skills/` **sigue abierta**, ahora con un motivo escrito. Se documenta en el cierre del hito (progreso + arc42) para que no parezca un olvido.
- El disparador para construirla queda definido: **una segunda capacidad que el agente deba elegir invocar durante un turno**. La verificación de riesgo/crédito del Hito 6 (que el plan ya vincula a este flujo de ventas) es la candidata natural. Con dos casos reales, el registro se justifica; con uno, no.

### ADR 9: El "comando" del reporte mensual es un script CLI, no un Registro de Comandos ni un scheduler

**Contexto**. Simétrico al anterior: el plan pide "un comando del Registro de Comandos que corre a fin de mes"; `src/core/commands/` está documentado en el arc42 y vacío en el disco; no hay ningún scheduler en el repo.

**Decisión**. `npm run reporte:mensual` — un entrypoint separado que abre la DB, invoca funciones **puras** de agregación de `src/core/ventas/reporte.ts`, imprime el reporte y cierra. **No se crea `src/core/commands/` ni se agrega un scheduler.** El script es solo I/O y wiring; toda la lógica de agrupación, comparación entre vendedores y formato del reporte vive en funciones puras testeables sin base de datos.

**Alternativas consideradas**:

- *Scheduler in-process (`node-cron` o `setInterval`)*: rechazada. El proceso vive mientras la TUI está montada; un temporizador de un mes dentro de un proceso de vida corta no dispara nunca. Sería infraestructura nueva **y** rota. El plan dice "corre a fin de mes", no "se dispara solo".
- *Registro de Comandos con un comando registrado*: rechazada, mismo argumento del ADR 8. Un `Map` de una entrada envuelto en ceremonia. El disparador para construirlo: un **segundo** comando *y* alguien que resuelva comandos por nombre (p. ej. comandos slash en la TUI).

**Consecuencias**:

- Operabilidad local intacta (Escenario de calidad 4): el reporte se corre a mano, sin daemon, sin cron del SO, sin dependencias.
- La brecha `src/core/commands/` sigue abierta y documentada, igual que la de skills.

### ADR 10: El link se protege con token + chequeo de estado + expiración — se agrega `expires_at` al esquema del plan

**Contexto**. No hay un tercero que firme la request (a diferencia del HMAC de GitHub en Hito 3): la única credencial del cliente es el token del link. El SQL del plan tiene `token_confirmacion TEXT NOT NULL UNIQUE` y **ninguna noción de vencimiento**.

**Decisión**. Tres guardas, no una:

1. **Token opaco de alta entropía** (`randomUUID()` o `randomBytes`, `node:crypto` — cero dependencias), `UNIQUE` como en el plan.
2. **Chequeo de estado antes de aplicar la transición**: si `ventas.estado !== 'pendiente_confirmacion'`, el handler responde sin efecto. Cubre reuso y doble click; es efectivamente gratis.
3. **`expires_at TEXT` (nullable), nueva columna**, con TTL configurable (`VENTA_TOKEN_TTL_HORAS`) calculado al crear la venta. `NULL` = sin vencimiento, para que el checkpoint pueda desactivar la guarda por configuración sin migrar nada.

**Por qué se rompe el esquema literal del plan**. Las guardas 2 y 3 cubren fallas **distintas**: el chequeo de estado cubre el replay, la expiración cubre el link viejo-pero-válido. Ninguna sustituye a la otra — una venta puede quedar `pendiente_confirmacion` durante semanas, y en ese lapso el link vive en la bandeja de entrada de un cliente, reenviable a cualquiera. El costo de cerrar esa ventana es **una columna nullable y una comparación de fechas dentro de una función pura ya existente** (`validarTokenConfirmacion(venta, ahora)`). El costo de no cerrarla es un agujero de autorización en el único endpoint público del sistema. Además la desviación es barata en el sentido más literal: la tabla se crea **por primera vez en este hito**, no hay datos que migrar ni consumidores que reconciliar; el SQL del plan es un punto de partida, no un contrato firmado (Hito 2 ya sentó el precedente de corregir el plan cuando el diseño lo justifica, ADR 3.1).

**Esto requiere aprobación explícita del checkpoint humano** como desviación documentada del plan de implementación.

### ADR 11: La escalación humana del reembolso vive sobre la venta y su caso — sin entidad nueva; el cierre queda fuera de alcance

**Contexto**. El plan dice que el reembolso sobre el umbral "crea un caso para que un humano lo apruebe (mismo patrón HITL del Hito 5)", pero el Hito 5 **todavía no existe**: no hay una sola línea de código de escalación humana en el repo. Este hito es el primero, y el Hito 5 va a reusar lo que se defina acá, no al revés.

**Decisión**. Cero tablas nuevas, cero columnas nuevas:

1. **Entidad**: la propia fila de `ventas`. `estado` pasa a `'reembolso_pendiente'` — un quinto valor. Es legal sin tocar la migración porque la columna es `TEXT` abierto sin `CHECK`, criterio que el repo ya documenta ("`estado` is intentionally an open string, not an enum", `repository.ts:5-6`) y que `0003` repitió para `actividades`. La lista canónica de valores vive en `ventas-contract.ts`, no en el SQL.
2. **Correlación**: el `caso` que la venta **ya tiene** (`ventas.caso_id`) transiciona a `estado = 'pendiente_aprobacion_humana'` vía `updateCaso` (`repository.ts:131`), en la misma transacción. Es el handle de correlación de todo lo que le pasa a esa venta; no hace falta un segundo caso.
3. **Sin transición automática**: la venta **no** pasa a `reembolsada`. Nadie la mueve sin un humano.
4. **Visibilidad**: el reporte mensual (ADR 9) lista los reembolsos pendientes, así que el estado escalado es observable con una herramienta que este hito igual construye.
5. **Cierre — explícitamente fuera de alcance**: **este hito no construye ningún camino para aprobar o rechazar la escalación.** No hay endpoint de aprobación, no hay pantalla de TUI, no hay notificación al aprobador. La resolución se hace fuera de banda (SQL manual) hasta el Hito 5, que es el dueño declarado del HITL. Esto se dice acá para que `sdd-tasks` no lo invente y para que el checkpoint humano lo apruebe o lo rechace a ojos abiertos (R3).

**Alternativas consideradas**:

- *Reusar `actividades` con `tipo: 'solicitud_interna'` y `createCasoConActividad`*: rechazada tras verificar el esquema. `actividades.proyecto_id` es `NOT NULL REFERENCES proyectos(id)` (`0003:32`): un reembolso no tiene proyecto, así que habría que inventar una fila fantasma en `proyectos` para satisfacer una FK — y encima arrastraría el espejo al tablero de GitHub (labels de un Issue) a un flujo de ventas que no tiene nada que ver con un repositorio. Reuso aparente, acoplamiento real.
- *Tabla `aprobaciones` nueva*: rechazada. Es probablemente la forma correcta para el Hito 5 con varios tipos de aprobación; construirla acá para un solo caso y sin consumidor que la lea es la misma sobre-ingeniería de los ADR 8 y 9.
- *Columna `ventas.caso_reembolso_id`*: rechazada. Segunda desviación del esquema para resolver algo que el `caso_id` existente ya resuelve.

## Approach

**Flujo completo del entregable.** `POST /ventas` (token estático) → `upsertVendedor` + `createVentaConCaso` (transacción: `caso` tipo `'venta'` + fila `ventas` en `pendiente_confirmacion` con token y `expires_at`) → notificación best-effort con el link `{WEB_PUBLIC_URL}/confirmar/{token}` → el cliente abre `GET /confirmar/:token` (HTML mínimo con el detalle y dos botones) → `POST /confirmar/:token` → `validarTokenConfirmacion` (pura: existe, estado correcto, no vencido) → si confirma: **una sola transacción** que escribe `estado = 'confirmada'`, `confirmed_at`, y la fila de `comisiones`. Si rechaza: `estado = 'rechazada'`, sin comisión.

**Alta de venta: por endpoint, no por CLI.** El vendedor no corre nada en la máquina del arnés, así que un script de alta no cumple el entregable. La autenticación es un **token estático en header** (`VENTAS_API_TOKEN`), no HMAC: no hay un tercero firmando, y un secreto compartido entre dos partes bajo nuestro control es la guarda proporcional. Sin `VENTAS_API_TOKEN` configurado, la ruta responde `401` siempre (nunca "abierta por defecto").

**Comisión: determinismo y redondeo explícitos.** `calcularComision(monto, porcentaje)` redondea a **2 decimales**, y el redondeo es parte del contrato testeado, no un efecto colateral de `REAL`. El `periodo` (`'YYYY-MM'`) se deriva de **`confirmed_at`, no de `created_at`**: una venta creada en enero y confirmada en febrero paga en el período de febrero, que es cuando el hecho comisionable ocurrió. `COMISION_PORCENTAJE` y `REEMBOLSO_UMBRAL` se validan al arrancar (porcentaje en `(0, 1]`, umbral `> 0`); configuración inválida es error de arranque, no un `NaN` silencioso en una fila de comisiones.

**Concurrencia — una precisión que corrige al plan.** El plan dice reusar "WAL + cola por recurso, acá por `vendedor_id`". WAL ya está activo (`db.ts:42`) y no se toca. Sobre la cola, la propuesta discrepa con argumento: la cola de Hito 3 existe para serializar el ciclo *leer → `await` del modelo → escribir*, que es el único lugar donde `better-sqlite3` (síncrono) puede interleavarse. **El camino determinista de este hito no tiene ningún `await` entre la lectura y la escritura**, así que una única `db.transaction(...)` da una garantía *más fuerte* que la cola, con menos maquinaria: dos POST simultáneos sobre el mismo token no pueden confirmar dos veces porque la transacción re-valida el estado adentro. `createKeyedQueue()` (`keyed-queue.ts:39`) se reusa **sin modificar y solo si** `sdd-design` encuentra un ciclo con `await` real (por ejemplo, si se decidiera notificar dentro de la ventana de confirmación). Agregar la cola "porque el plan la nombra", donde una transacción basta, es ceremonia que oculta la garantía verdadera. **Desviación a aprobar en el checkpoint.**

**Soporte y devolución.** `POST /soporte` arma un prompt sintético con la consulta del cliente y resuelve el turno reusando `CONVERSATIONAL_AGENT` (sin tocar `definitions.ts`, mismo criterio que Hito 3), crea `caso` tipo `'soporte'` y responde con la respuesta del agente. `POST /devolucion` identifica la venta, exige `estado = 'confirmada'`, evalúa `evaluarReembolso(monto, umbral)` y aplica el ADR 11.

**Errores y degradación.** Sin `WEB_PORT` no se abre ningún listener y `npm run dev` arranca idéntico a `v1.2.0` (mismo criterio opt-in del ADR 5). Sin `EMAIL_API_KEY`, el notificador degrada a logger del link (mismo criterio que el tablero sin `GITHUB_TOKEN`). Toda falla del notificador se traga y se loguea: la venta ya está persistida y el link es recuperable desde la base. Toda falla del store propaga.

**Testing (TDD estricto).** Todo el núcleo de ventas es puro: comisión, umbral, validación de token (con `ahora` inyectado, nunca `Date.now()` adentro) y agregación del reporte se testean sin base ni red. El adaptador web se testea con el `createServer` inyectable de Hito 3; el notificador con `fetchFn` doble. Ningún test del suite por defecto abre un puerto real ni manda un email. La verificación manual del entregable usa la misma herramienta de forwarding que Hito 3.

## Nuevos componentes y cambios

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/ventas/ventas-contract.ts` | New | Constantes de `ventas.estado`, `VentaStorePort`, `VentaNotifierPort`. Sin imports. |
| `src/core/ventas/` (comisión, reembolso, token, reporte) | New | `calcularComision`, `evaluarReembolso`, `validarTokenConfirmacion`, `agruparReporteMensual` — puras, sin I/O ni SDK |
| `src/adapters/web/` | New | `config.ts`, listener `node:http`, ruteo, render HTML puro, parseo de formulario |
| `src/adapters/notificaciones/` | New | `config.ts`, cliente de email sobre `fetchFn` inyectable, no-op logger sin API key |
| `src/adapters/memory/migrations/0004_vendedores_ventas_comisiones.ts` | New | `vendedores`, `ventas` (+ `expires_at`, ADR 10), `comisiones` + los dos índices del plan |
| `src/adapters/memory/repository.ts` | Modified | `upsertVendedor`, `createVentaConCaso`, `findVentaByToken`, `confirmarVentaConComision`, `escalarReembolso`, lecturas de agregación |
| `src/` (hermanos de `build-on-activity.ts`) | New | Manejador determinista (confirmación/devolución) + constructor de turno de soporte (ADR 7) |
| `src/reporte-mensual.ts` (entrypoint CLI) | New | Wiring del comando: abre DB → agregación pura → imprime → cierra (ADR 9) |
| `src/main.ts` | Modified | Wiring del adaptador web, cierre ordenado (web → webhooks → db) |
| `src/core/config/env.ts` | Modified | Variables `WEB_*`, `VENTAS_*`, `COMISION_*`, `REEMBOLSO_*`, `EMAIL_*` |
| `src/core/logging/turn-logger.ts` | Modified | Eventos nuevos — datos, sin cambio de contrato |
| `package.json` | Modified | Script `reporte:mensual`. **Sin dependencias nuevas** |

## Dependencias nuevas

**Ninguna.** Se confirma la Opción A de la exploración (punto 2): **API HTTP de un proveedor transaccional (Resend/SendGrid) sobre `fetch` nativo**, con `fetchFn` inyectable — exactamente el molde de `github-client.ts:108`, que ya está escrito, testeado y aprobado en este repo.

`nodemailer` se **rechaza**: sería la primera dependencia nueva desde el baseline, y lo que compra es **SMTP**, un protocolo que no necesitamos — el proveedor que vamos a usar expone HTTP igual. Además empeora el testing: un doble de `fetchFn` es una función; un doble de transporte SMTP es infraestructura. Romper la racha de cero dependencias de los Hitos 2 y 3 tiene que comprar algo; acá no compra nada.

**Salvedad honesta**, en el mismo espíritu que el ADR 3.1 de Hito 2: la elección cambia una dependencia de **código** por una dependencia **operacional** (una cuenta y una API key de un proveedor). Se mitiga con la degradación a logger del link, que mantiene `npm run dev` y el suite completo funcionando con cero cuentas externas — pero el camino feliz de producción es el envío real, no el log, y el checkpoint humano debe confirmar que hay un proveedor disponible para la demo.

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | Dos formas de wiring en el mismo adaptador (ADR 7) confunden a quien lea el código después | Med | Module docs explícitos en ambos hermanos del composition root, citando el ADR 7; el criterio de corte ("¿hay razonamiento real?") queda escrito, no implícito |
| R2 | `expires_at` desvía del esquema literal del plan y el tutor lo lee como incumplimiento | Med | **El checkpoint humano debe aprobar el ADR 10 explícitamente**; la columna es nullable, así que la guarda se desactiva por configuración sin migrar |
| R3 | Se shippea una escalación de reembolso que **nadie puede cerrar** desde el producto | **Alta** | Declarado como fuera de alcance en el ADR 11, visible en el reporte mensual, y con dueño asignado (Hito 5). **Es la limitación más discutible de esta propuesta y el checkpoint humano debe aceptarla o exigir un endpoint de aprobación mínimo en este hito** |
| R4 | No usar la cola por `vendedor_id` que el plan nombra se lee como omisión | Med | Justificado en *Approach* con el mismo nivel de precisión que Hito 3 usó para explicar por qué la cola era necesaria allá; `sdd-design` valida con un test de doble POST simultáneo sobre el mismo token |
| R5 | Un reembolso deja viva la comisión ya pagada — inconsistencia contable visible en el reporte | Med | Fuera de alcance declarado; el reporte muestra `estado` de la venta junto a la comisión, así que la inconsistencia es **visible**, no silenciosa. La reversión formal es deuda documentada |
| R6 | La página pública es la primera superficie sin firma del proyecto (enumeración de tokens, POST masivo) | Med | Token opaco de alta entropía + `expires_at` + chequeo de estado (ADR 10); tope de tamaño de body y respuesta genérica ante token inválido (sin distinguir "no existe" de "vencido") |
| R7 | Dependencia operacional de un proveedor de email para la demo | Med | Degradación a logger del link; el suite y `npm run dev` no requieren cuenta. Se confirma proveedor en el checkpoint |
| R8 | Dinero en `REAL` (punto flotante) acumula error de redondeo | Baja | El esquema del plan fija `REAL` y no se desvía por esto; se acota con redondeo a 2 decimales dentro de la función pura, testeado con casos borde. Migrar a enteros de centavos es deuda documentada |
| R9 | El alcance del hito crece hacia gestión de clientes si `cliente_id` no queda acotado | Med | **Cerrado por alcance**: identificador opaco, sin tabla, sin adaptador, sin FK (ver *Fuera de alcance / diferido*) |
| R10 | `src/core/skills/` y `src/core/commands/` siguen vacíos tras el hito que "debía" llenarlos | Med | ADR 8 y 9 dejan el motivo y el **disparador concreto** para construirlos; se documenta en el cierre para que no parezca omisión |

## Rollback Plan

El cambio es aditivo. Revertir en caliente = quitar `WEB_PORT` del entorno: no se abre el listener de ventas, no se crean ventas ni comisiones, y la TUI + el adaptador de webhooks de Hito 3 se comportan exactamente como en `v1.2.0`. La migración `0004` solo crea tablas nuevas (`IF NOT EXISTS`) y no altera `casos`, `sesiones_agente`, `proyectos`, `responsables` ni `actividades`; las tablas nuevas quedan vacías y no las lee nadie más. El script `reporte:mensual` es un entrypoint independiente: no correrlo no afecta nada. `EMAIL_API_KEY` vacía degrada el notificador sin tocar el resto. A nivel git: revertir los commits de `hito/v1.3-ventas-comisiones` antes del merge a `main`.

## Dependencies

- Hito 3 cerrado (`v1.2.0`) — ya lo está.
- Para la demo: cuenta y API key de un proveedor de email transaccional, un `WEB_PUBLIC_URL` alcanzable (misma herramienta de forwarding que Hito 3) y un cliente HTTP para simular al vendedor en `POST /ventas`. Nada de esto es requerido en CI.
- Checkpoint humano de `AGENTS.md` aprobando esta propuesta — **en particular los ADR 7, 8, 9, 10 y 11, la desviación de concurrencia del *Approach*, y el alcance de R3** — antes de `sdd-spec`/`sdd-design`.

## Success Criteria

- [ ] Un `POST /ventas` autenticado crea `vendedor` (si no existía), `caso` y `venta` en `pendiente_confirmacion`, y el link único queda enviado (o logueado, sin API key) — sin ninguna llamada al modelo.
- [ ] El cliente abre el link, confirma, y en **una sola transacción** la venta pasa a `confirmada` con `confirmed_at` y aparece la fila de `comisiones` con `monto = venta.monto × porcentaje` redondeado a 2 decimales y `periodo` derivado de `confirmed_at`.
- [ ] Un segundo `POST` con el mismo token no crea una segunda comisión ni cambia el estado (chequeo de estado, ADR 10).
- [ ] Un token vencido (`expires_at` en el pasado) es rechazado sin efecto, con respuesta indistinguible de la de un token inexistente (ADR 10, R6).
- [ ] `POST /devolucion` bajo el umbral deja la venta en `reembolsada` sin intervención; sobre el umbral la deja en `reembolso_pendiente` con su `caso` en `pendiente_aprobacion_humana` y **sin** transición automática (ADR 11).
- [ ] `POST /soporte` crea un `caso` tipo `'soporte'` y devuelve una respuesta generada por el agente — único endpoint del hito que llama al modelo.
- [ ] `npm run reporte:mensual` imprime el comparativo por vendedor para un `periodo` dado y lista los reembolsos pendientes de aprobación.
- [ ] Sin `WEB_PORT`, `npm run dev` arranca la TUI y el adaptador de webhooks sin abrir el puerto web y sin fallar.
- [ ] Sin `EMAIL_API_KEY`, la venta se crea igual y el link queda logueado, sin excepción no capturada.
- [ ] `npm test` y `npm run typecheck` en verde; ningún test abre un puerto real, manda un email o llama al modelo en el camino determinista.
- [ ] Checklist de cierre de `AGENTS.md`: Reviewer aprueba, `docs/progreso/v1.3-ventas-comisiones/` con evidencia (incluyendo las desviaciones del plan aprobadas), tag `v1.3.0`.

## Fuera de alcance / diferido

| Diferido | A dónde | Por qué |
|---|---|---|
| Cierre de la escalación de reembolso (aprobar/rechazar desde el producto) | Hito 5 (HITL), dueño declarado por el plan | Construir un flujo de aprobación completo acá duplicaría el trabajo del Hito 5 y lo haría sin su contexto (validador, roles, delegación). Este hito entrega la **detección**; el estado escalado es persistente y visible en el reporte, no se pierde. **Riesgo R3 — requiere aceptación explícita del checkpoint.** |
| Tabla `clientes` / adaptador de CRM / resolución de identidad | Hito futuro con un caso de uso que lo pida | El esquema del plan deja `cliente_id` como `TEXT NOT NULL` **sin tabla y sin FK** — es la única columna del proyecto con ese tratamiento, y la señal es deliberada. Construir gestión de clientes multiplicaría el esfuerzo del hito sin acercarlo a su entregable declarado. |
| Tabla de reglas de comisión (por producto, tramo o vendedor) | Deuda técnica que el propio plan anticipa | El plan autoriza el porcentaje fijo textualmente. Una tabla de reglas sin un segundo esquema de comisión real que la justifique es el mismo YAGNI de los ADR 8 y 9. |
| Reversión de comisión al reembolsar | Junto con la tabla de reglas | Requiere decidir el modelo contable (fila de ajuste negativo vs. anulación) y una columna que el esquema no tiene. Hasta entonces, el reporte muestra la inconsistencia en vez de esconderla (R5). |
| Reembolso parcial | Ídem | `ventas.estado` es todo-o-nada por diseño del plan; el monto reembolsado necesitaría columna propia. |
| `src/core/skills/` (Registro de Skills) | Cuando exista una **segunda** capacidad que el agente deba **elegir invocar durante un turno** — candidata: verificación de riesgo/crédito del Hito 6 | ADR 8. Con un solo consumidor determinista, el registro es ceremonia; y su semántica documentada arrastraría el LLM de vuelta al camino del dinero. |
| `src/core/commands/` (Registro de Comandos) y scheduler | Cuando exista un **segundo** comando y alguien que resuelva comandos por nombre (p. ej. comandos slash en la TUI) | ADR 9. Un `Map` de una entrada no es un registro, y un temporizador de un mes en un proceso con vida de TUI no dispara nunca. |
| Portal del vendedor con login/sesiones | Hito futuro | El entregable nombra la confirmación **del cliente**. El alta de venta máquina-a-máquina con token estático la cubre sin construir autenticación de usuarios. |
| Montos en enteros de centavos en vez de `REAL` | Deuda documentada | Cambiar el tipo desvía del esquema del plan por segunda vez; con redondeo explícito y testeado, el error de punto flotante queda acotado para el MVP (R8). |

---

**Nota de proceso**: el hook de este repo exige correr `graphify query`/`explain`/`path` antes de leer código fuente. El ejecutor de esta fase corrió **sin herramienta de shell disponible** (solo Read/Grep/Glob/Write/Edit), así que no se pudo invocar el binario — misma limitación que ya documentaron las exploraciones de Hito 3 y Hito 4. Se compensó con lectura directa y verificación puntual de cada afirmación citada: `src/adapters/memory/repository.ts` (índice de exports + `Caso`/`CasoUpdate` y su comentario sobre `estado` abierto), `src/core/activity/activity-contract.ts` (constantes y `IncomingActivityEvent`), `src/adapters/memory/migrations/0003_proyectos_responsables_actividades.ts` (la FK `NOT NULL` a `proyectos` que descarta reusar `actividades` para el HITL), `src/build-on-activity.ts` y `src/main.ts` (índice de exports y `tipo: "conversacion"`), `src/adapters/webhooks/server.ts` y `src/core/concurrency/keyed-queue.ts` (índice de exports), `openspec/config.yaml` y `docs/Plan_Implementacion_Harness_Empresarial.md:222-283`. Se recomienda correr `graphify update .` una vez persistido este archivo, y que `sdd-design` sí ejecute `graphify explain` sobre los conceptos nuevos (`VentaStorePort`, `VentaNotifierPort`, adaptador web, comando de reporte).
