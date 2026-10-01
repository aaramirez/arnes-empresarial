# Guía de instalación y prueba — Tutor Empresarial

Esta guía te permite instalar el arnés y probarlo de punta a punta usando únicamente sus dos interfaces humanas: la **TUI** (terminal) y el **chat web** (navegador). No hace falta escribir ningún comando `curl` ni tocar la API por HTTP directo — todo lo que se prueba acá se hace conversando, como lo haría un empleado real.

## 1. Requisitos previos

- **Node.js** 20 o superior instalado.
- **Git** para clonar el repositorio.
- Una **API key de Anthropic** válida (la necesitás para que el arnés pueda invocar al modelo real — no hay modo de prueba sin ella).

## 2. Instalación

```bash
git clone <url-del-repositorio>
cd arnes-empresarial
npm install
```

No hace falta correr ningún build ni migración a mano: el arranque (`npm run dev`) transpila el código al vuelo y crea/actualiza la base de datos SQLite (`data/harness.db`) sola, la primera vez que corre.

## 3. Configuración completa (`.env`)

Copiá el archivo de ejemplo y completalo:

```bash
cp .env.example .env
```

El `.env.example` trae **muchas más variables de las que esta guía necesita**, porque el arnés tiene features fuera del alcance de esta prueba (bot de revisión de PRs en GitHub, webhooks, notificaciones por email, el listener de salud operativa `ops`, worktrees de escritura delegada). Ninguna de ellas hace falla al arranque si queda sin tocar — cada adaptador queda simplemente **deshabilitado** cuando falta su variable de encendido. A continuación están **todas** agrupadas por feature, en el mismo orden que el archivo, con su valor por defecto y si hace falta tocarlas para esta guía.

### 3.1. Núcleo — obligatoria

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | (sin default) | **Sí, siempre** | Sin ella, el arnés no arranca — el SDK la necesita para invocar al modelo real. Se carga una única vez al arrancar, antes de importarse el SDK (`src/core/config/env.ts`). |

### 3.2. Adaptador web — chat conversacional

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `WEB_PORT` | `0` (deshabilitado) | **Sí**, para el chat web (sección 7) | Puerto donde se levanta el chat. `0` o ausente = no se abre ningún puerto y sólo tenés la TUI. |
| `WEB_PUBLIC_URL` | `http://localhost:8080` | No, el default alcanza si usás el puerto por defecto | URL pública base para armar links (por ejemplo, el link de confirmación de una venta). |
| `VENTAS_API_TOKEN` | (vacío → esa ruta responde 401 siempre) | No — fuera de alcance | Gatea una ruta HTTP directa (`POST /ventas`) que esta guía nunca usa: todo acá pasa por el chat conversacional, no por HTTP crudo. |
| `WEB_MAX_BODY_BYTES` | `65536` (64 KiB) | No | Tope de tamaño del body HTTP. |
| `WEB_HOST` | ausente (todas las interfaces) | No | Restringe el chat web a una IP puntual (ej. `127.0.0.1`). No cambia el puerto ni el interruptor. |

### 3.3. Reglas de negocio de ventas (`src/core/ventas/ventas-config.ts`)

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `COMISION_PORCENTAJE` | `0.1` | No | Porcentaje de comisión sobre cada venta, en `(0, 1]`. |
| `REEMBOLSO_UMBRAL` | `500` | No | `monto < umbral` auto-aprueba un reembolso; `>=` lo escala a un administrador. |
| `VENTA_TOKEN_TTL_HORAS` | `72` | No | Horas de vigencia del token de confirmación de una venta. `0` = sin vencimiento. |
| `VENTA_GRANDE_UMBRAL` | `5000` | **Opcional** — sólo si querés probar el ejemplo de la sección 9.3 | `monto >= umbral` dispara, sin intervención del empleado, una consulta A2A saliente no bloqueante al destino "riesgo-credito". Ver 7.1 y 9.3. |

### 3.4. Sesión de empleado (`src/core/auth/auth-config.ts`)

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `SESION_TTL_MINUTOS` | `480` (8 h) | No | Tope ABSOLUTO desde el login, nunca se renueva. `0` = sin expiración. |
| `SESION_INACTIVIDAD_MINUTOS` | `30` | No | Vencimiento por inactividad, se renueva con cada uso. `0` = sin expiración. Es independiente del anterior. |

### 3.5. Base de datos (`src/adapters/memory/config.ts`)

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_DB_PATH` | `data/harness.db` | No | Ruta de la base SQLite, relativa al directorio desde donde corrés. `main` y los dos CLIs (`empleados`, `reporte-mensual`) usan siempre el mismo valor. |

### 3.6. Delegación entre sub-agentes — activa por defecto (`src/build-on-activity.ts`)

**Importante**: estas dos variables **no hay que tocarlas para nada de esta guía** — pero a diferencia de casi todo lo demás en esta sección, no están "apagadas por defecto": están **encendidas**. Ausente = activa; hace falta el valor literal `"off"` para apagarlas. Verificado directamente en el código (`src/build-on-activity.ts:344` y `:394`, `process.env.HARNESS_DELEGACION_ROLES !== "off"` / `process.env.HARNESS_ESCRITURA_DELEGADA !== "off"`).

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_DELEGACION_ROLES` | **ACTIVA** (ausente o cualquier valor ≠ `"off"`) | No — ya está funcionando sin que toques nada | Cadena de delegación Planner → Developer → Reviewer entre sub-agentes, en vez del `handleTurn` único de versiones viejas. |
| `HARNESS_ESCRITURA_DELEGADA` | **ACTIVA** (ausente o cualquier valor ≠ `"off"`) | No | Habilita que el Developer escriba código real en un worktree Git aislado, como parte de esa misma cadena. |

**Alcance real de esta delegación**: la cadena Planner → Developer → Reviewer **solo se dispara con eventos de webhook de GitHub** (revisión de PRs), no con mensajes de la TUI ni del chat web — por eso no hace falta tocar estas variables para esta guía. El sub-agente que sí se puede ver trabajando desde una conversación es `validador-solicitudes`: se invoca solo, de forma determinista, cuando se crea una solicitud interna por el chat web (sección 7.2).

### 3.7. Cliente A2A saliente (Hito 6, `src/adapters/a2a/config.ts`) — opt-in

Estas sí son necesarias si querés seguir la sección 9 (A2A saliente) — con el interruptor apagado, el comportamiento es idéntico a no tener A2A.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_A2A_SALIENTE` | apagado (vacío) | Sí, para la sección 9 | Interruptor opt-in: sólo el valor `"on"` (tras `trim` + minúscula) activa el mecanismo. |
| `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` | sin default (ausente = destino no disponible) | Sí, para `/consultar-kpi` (9.1) | URL base (Agent Card) del destino "kpi-incidente". |
| `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` | sin default | Opcional, para el ejemplo de venta grande (9.3) | URL base (Agent Card) del destino "riesgo-credito". |
| `HARNESS_A2A_TOKEN_KPI_INCIDENTE` | sin default (opcional) | No, el mock de esta guía no lo exige | Bearer token opcional. Nunca aparece en un log ni en un mensaje. |
| `HARNESS_A2A_TOKEN_RIESGO_CREDITO` | sin default (opcional) | No | Ídem, para "riesgo-credito". |
| `HARNESS_A2A_REQUEST_TIMEOUT_MS` | `30000` | No | Timeout por request JSON-RPC individual. |
| `HARNESS_A2A_POLL_INTERVAL_MS` | `1500` | No | Intervalo entre consultas del loop de polling de `GetTask`. |
| `HARNESS_A2A_TASK_TIMEOUT_MS` | `120000` | No | Timeout total del polling antes de `CancelTask` con reason `"timeout"`. |

### 3.8. Servidor A2A entrante (Hito 7, `src/adapters/a2a/server-config.ts`) — fuera de alcance

Ver la limitación honesta de la sección 9.2: aunque las configures, esta guía no tiene forma de generar una consulta entrante nueva sólo desde la TUI o el chat.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_A2A_ENTRANTE_TOKEN` | apagado (vacío) | No | Único gate: token no vacío (tras `trim`) habilita el servidor. Vacío = cero puertos abiertos, igual que v2.2.0. |
| `HARNESS_A2A_ENTRANTE_PORT` | `8888` | No | Puerto de escucha. |
| `HARNESS_A2A_ENTRANTE_PUBLIC_URL` | `http://localhost:8888` | No | URL pública usada en el Agent Card. |
| `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES` | `65536` (64 KiB) | No | Tope de tamaño del body HTTP. |
| `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | `4` | No | Tope de turnos en vuelo simultáneos. |
| `HARNESS_A2A_ENTRANTE_HOST` | ausente (todas las interfaces) | No | Restringe el listener a una IP puntual. |

### 3.9. Board / bot de GitHub (`src/adapters/board/config.ts`) — fuera de alcance

Adaptador deshabilitado si el token está vacío — sin este valor, nunca se abren PRs de bot.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `GITHUB_TOKEN` | (vacío = deshabilitado) | No | Bearer token de la app/bot de GitHub. Nunca aparece en un log ni en un comentario. |
| `GITHUB_API_BASE_URL` | `https://api.github.com` | No | Base URL de la API de GitHub. |
| `BOARD_TIMEOUT_MS` | `10000` | No | Timeout por request a la API de GitHub. |

### 3.10. Webhooks de GitHub (`src/adapters/webhooks/config.ts`) — fuera de alcance

Adaptador deshabilitado si el secreto está vacío.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | (vacío = deshabilitado) | No | Secreto compartido para validar la firma HMAC del webhook. |
| `WEBHOOK_PORT` | `8787` | No | Puerto de escucha del servidor de webhooks. |
| `WEBHOOK_PATH` | `/webhooks/github` | No | Path de la ruta que recibe el webhook. |
| `WEBHOOK_MAX_BODY_BYTES` | `1048576` (1 MiB) | No | Tope de tamaño del body HTTP. |
| `WEBHOOK_HOST` | ausente (todas las interfaces) | No | Restringe el listener a una IP puntual. |

### 3.11. Notificaciones por email (`src/adapters/notificaciones/config.ts`) — fuera de alcance

Adaptador deshabilitado si la API key está vacía — se comporta como un no-op que sólo loguea el link.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `EMAIL_API_KEY` | (vacío = deshabilitado) | No | API key del proveedor de email (Resend). Nunca aparece en un log ni en un mensaje. |
| `EMAIL_FROM` | `arnes@localhost` | No | Remitente del email. |
| `EMAIL_API_URL` | `https://api.resend.com/emails` | No | URL de la API del proveedor. |
| `EMAIL_TIMEOUT_MS` | `10000` | No | Timeout por request al proveedor. |

### 3.12. Git CLI y worktrees de escritura delegada (`src/adapters/git/config.ts`, Hito 5.1) — fuera de alcance

Estas variables afinan el mecanismo de escritura delegada (sección 3.6) pero no hace falta tocarlas: la escritura delegada ya funciona con sus defaults.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_GIT_BIN` | `git` | No | Binario de git a invocar. |
| `HARNESS_GIT_TIMEOUT_MS` | `30000` | No | Timeout por invocación de git. |
| `HARNESS_WORKTREE_ROOT` | `.harness/worktrees` | No | Directorio raíz donde se crean los worktrees aislados. |
| `HARNESS_WORKTREE_TTL_MS` | `7200000` (2 h) | No | TTL de un worktree ocioso antes de que el barrido lo reclame. |
| `HARNESS_WORKTREE_TEST_TIMEOUT_MS` | `300000` (5 min) | No | Timeout de una corrida completa de tests dentro de un worktree. |

### 3.13. Graphify CLI (`src/adapters/knowledge/config.ts`) — fuera de alcance

Herramienta interna de exploración de código que usa el propio arnés/Claude Code, no algo que el tutor empresarial opere.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `GRAPHIFY_BIN` | `graphify` | No | Binario de graphify a invocar. |
| `GRAPHIFY_GRAPH_PATH` | `graphify-out/graph.json` | No | Ruta al grafo ya extraído. |
| `GRAPHIFY_BUDGET` | `200` | No | Presupuesto de tokens por query/explain/path. |
| `GRAPHIFY_TIMEOUT_MS` | `15000` | No | Timeout por invocación de graphify. |

### 3.14. Modo headless y cierre ordenado (`src/proceso-cierre.ts`) — fuera de alcance

Esta guía siempre corre con una terminal real (TTY), así que el arnés arranca en modo TUI automáticamente — no hace falta declarar nada acá.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `HARNESS_HEADLESS` | TUI (autodetectado por TTY) | No | Ausente/`"0"`/vacío = TUI (lo que usa esta guía). `"1"` exacto = headless (sin Ink, espera señales). Cualquier otro valor aborta el arranque. |
| `HARNESS_SHUTDOWN_TIMEOUT_MS` | `70000` | No | Presupuesto total del apagado headless, en milisegundos — sólo aplica en modo headless. |

### 3.15. Salud operativa `ops` (`src/adapters/ops/config.ts`) — fuera de alcance

**Sin autenticación** — el propio código lo advierte explícitamente: no lo expongas sin atarlo a `loopback` si alguna vez lo publicás.

| Variable | Default | ¿Hace falta acá? | Para qué sirve |
|---|---|---|---|
| `OPS_PORT` | `0`/ausente = deshabilitado (sugerido: `8788`) | No | `GET /salud/vivo` y `GET /salud/listo`. A diferencia de webhooks, no hay secreto: el puerto ES la decisión de encendido. |
| `OPS_HOST` | ausente (todas las interfaces) | No | Restringe el listener a una IP puntual. |

Con eso ya podés arrancar: para el recorrido completo de esta guía sólo necesitás fijar `ANTHROPIC_API_KEY` y `WEB_PORT`, y opcionalmente las variables de A2A saliente (3.7) cuando llegues a la sección 9.

## 4. Crear tu usuario administrador

Antes de arrancar el arnés, necesitás un empleado con rol de **administrador** para poder loguearte (no hay usuarios de fábrica). Se hace en dos pasos, siempre desde la terminal:

```bash
npm run empleados:crear -- tutor
```

Te va a pedir la contraseña de forma interactiva (no la escribas como argumento — el propio comando no lo permite, por seguridad). Después, promovelo a administrador:

```bash
npm run empleados:crear -- tutor --rol administrador
```

Este será tu usuario principal. Más adelante (sección 6.2) vas a crear un **segundo empleado**, sin rol administrador, para poder demostrar flujos de aprobación de verdad — un administrador nunca puede aprobarse una solicitud o un reembolso a sí mismo.

## 5. Arrancar el arnés

```bash
npm run dev
```

Un único comando levanta **todo junto, en el mismo proceso**: la TUI en tu terminal, y si pusiste `WEB_PORT`, el chat web en paralelo. Vas a ver la interfaz de terminal (Ink) aparecer directamente en esa misma ventana.

## 6. Probar por la TUI

Con el arnés corriendo, en esa misma terminal. La TUI cubre **sesión, administración, conocimiento y los comandos de sólo lectura/A2A** — las operaciones de negocio transaccionales (registrar una venta, crear una solicitud, procesar una devolución) viven exclusivamente en el chat web (sección 7).

### 6.1. Sesión

```
/login tutor <tu contraseña>
```
Debería responder algo como `Sesión abierta como tutor. Vence <fecha>.`

Para cerrarla en cualquier momento: `/logout`.

### 6.2. Administración de empleados (rol administrador)

Con `tutor` logueado, tres comandos exigen específicamente el rol `administrador` (no alcanza con estar logueado):

1. **Ver el estado del bot de PRs**, de sólo lectura, sin revelar valores:
   ```
   /estado-bot-prs
   ```

2. **Crear tu segundo empleado**, sin rol administrador — lo vas a necesitar en la sección 7 para probar aprobaciones sin auto-aprobación:
   ```
   /crear-empleado empleado2 <una-contraseña>
   ```
   A diferencia de `npm run empleados:crear`, acá la contraseña va en la misma línea del comando (no hay prompt interactivo en la TUI) — se trata igual como el único otro campo secreto del núcleo, pero vas a verla en pantalla mientras la tipeás, así que usá algo simple sólo para esta prueba. Por defecto queda con rol `empleado` (no administrador) — es justo lo que necesitás para la sección 7.

3. **Asignar un rol** — probalo de forma inocua, reafirmando el rol que ya tiene `empleado2`, para no alterar el escenario de dos usuarios que armaste:
   ```
   /asignar-rol empleado2 empleado
   ```
   (El mismo comando sirve para promoverlo a `administrador` con `/asignar-rol empleado2 administrador` — no lo hagas si vas a seguir la sección 7 tal cual está escrita.)

### 6.3. Conocimiento y soporte

1. **Comando explícito**:
   ```
   /soporte ¿Qué convención de commits usa este proyecto?
   ```

2. **O, en lenguaje libre, sin `/` adelante** (el mismo camino conversacional):
   ```
   ¿Qué convención de commits usa este proyecto?
   ```
   En cualquiera de los dos casos, la respuesta debería citar el archivo real de donde sacó la información (ej. `AGENTS.md`), no una respuesta genérica sin fuente — es el formato de cita que exige la skill `citar-conocimiento` cuando la base de conocimiento interna devuelve resultados.

### 6.4. Reporte de comisiones

```
/reporte-comisiones
```
Mes corriente por defecto; con `/reporte-comisiones 2026-03` pedís un periodo puntual.

### 6.5. A2A desde la TUI

```
/consultar-kpi ¿cuáles son los KPIs de este mes?
/ver-solicitudes-a2a
```
Ver el detalle de ambos (incluida la limitación honesta de la segunda) en la sección 9. Un detalle no obvio del código: **la versión TUI de `/consultar-kpi` no exige rol administrador** (sólo sesión vigente) — a diferencia de la operación equivalente en el chat web, que sí lo exige (sección 7.5). Verificado en `src/build-on-comando-empleado.ts`, donde el propio comentario aclara que ese gate "llega en la PR2, bloqueada" — es una asimetría real entre los dos canales, no un error de esta guía.

### 6.6. Propuestas de cambio de código (avanzado, opcional)

Como la delegación de escritura está activa por defecto (sección 3.6), el Developer sub-agente a veces deja una **propuesta de cambio** (un patch) pendiente de revisión humana. Tres comandos la gestionan:

```
/ver-propuesta [propuestaId]
/aplicar-propuesta <propuestaId>
/descartar-propuesta <propuestaId> [motivo]
```

**Aclaración honesta**: generar una propuesta real requiere pedirle al arnés, por conversación, una tarea que dispare la cadena Planner → Developer → Reviewer con escritura de código (por ejemplo, a través de `/soporte` con un pedido de cambio concreto sobre el repo) — no encontramos, revisando el código, una forma determinística de generarla en un paso fijo para esta guía. Si en algún momento ves una propuesta pendiente (por ejemplo, mientras explorás la sección 8), estos son los tres comandos para revisarla, aplicarla o descartarla.

## 7. Probar por el chat web

Con `npm run dev` todavía corriendo (no hace falta reiniciar nada), abrí en tu navegador:

```
http://localhost:<el puerto que pusiste en WEB_PORT>/chat
```

Esta sección cubre las **operaciones de negocio** del arnés (son 13 en total; `consultar_kpi` y `ver_solicitudes_a2a` se prueban en la sección 9) (`src/core/operaciones/operaciones-contract.ts`), agrupadas por área, en un orden que respeta sus dependencias reales. Vas a necesitar iniciar sesión más de una vez, alternando entre `tutor` (administrador) y `empleado2` (el empleado normal que creaste en 6.2) — cerrá sesión con el botón de la página cada vez que el paso lo pida, o abrí una segunda pestaña si preferís tener las dos sesiones abiertas a la vez.

### 7.1. Ventas y comisiones

Iniciá sesión como **`empleado2`** para esta sección (cualquier empleado puede vender; no hace falta ser administrador).

1. **Registrar una venta** (`registrar-venta-conversacional`):
   > *"Quiero registrar una venta de $1500 al cliente Gómez (gomez@ejemplo.com), plan Básico, a mi nombre."*

   El arnés va a confirmar la venta con un `token` de confirmación — **guardalo**, lo vas a necesitar en el paso siguiente y en la sección 7.3.

2. **Transcribir la decisión del cliente** (`venta-decision`), usando el token del paso anterior:
   > *"El cliente Gómez confirmó la compra por teléfono, el token es `<el-token-que-te-dio>`."*

3. **Consultar el estado de esa venta** (`consultar-venta`):
   > *"¿Cómo quedó mi venta más reciente?"*

4. **Pedir el reporte de comisiones** (`reporte-comisiones-conversacional`):
   > *"Dame el reporte de comisiones de este mes."*

   Es el reporte de **toda la empresa** para ese periodo, no uno filtrado a tus propias ventas — así lo aclara la propia skill si preguntás.

5. **Ejemplo adicional de A2A saliente — venta grande**: si registrás una venta con `monto >= VENTA_GRANDE_UMBRAL` (5000 por defecto), se dispara sola, sin que hagas nada más, una consulta A2A no bloqueante al destino "riesgo-credito". Ver el detalle y el setup en la sección 9.3.

### 7.2. Solicitudes internas

Seguí logueado como **`empleado2`**. Vas a crear **dos** solicitudes distintas, para poder mostrar tanto cancelar una como que otro empleado resuelva la otra (no se puede hacer las dos cosas sobre la misma solicitud).

1. **Crear la primera solicitud** (`solicitud-interna`):
   > *"Quiero pedir vacaciones del 1 al 10 de octubre."*

2. **Crear la segunda** (mismo canal, otro trámite):
   > *"Quiero pedir el reembolso de un gasto: taxi de $25 del martes para visitar al cliente Gómez."*

   Usá un gasto y no un "reclamo de comisión": aunque la skill lo ofrece, el arnés solo acepta solicitudes de tipo `vacaciones` y `gasto` (`src/core/solicitudes/solicitudes-contract.ts`), y un reclamo termina rechazado como tipo desconocido.

3. **Consultar el estado de tus solicitudes** (`consultar-solicitud`):
   > *"¿Qué solicitudes tengo pendientes?"*

4. **Cancelar la primera** (`cancelar-solicitud`) — la skill va a listarlas, pedirte que identifiques cuál y confirmar en un mensaje aparte:
   > *"Quiero cancelar mi pedido de vacaciones."*
   > (esperá el eco, después escribí, en un mensaje nuevo) *"Sí, esa."*

5. **Cerrá sesión** y **logueate como `tutor`** (administrador) para resolver la segunda:
   > *"Aprobame la solicitud de gasto de empleado2."*
   > (esperá el eco con el detalle, después, en un mensaje nuevo) *"Sí, confirmo."*

   Si intentás este último paso todavía logueado como `empleado2`, la herramienta lo rechaza: sólo un `administrador` puede resolver una solicitud ajena, y además nunca puede resolver **la suya propia** — ambas reglas están verificadas en `src/core/solicitudes/resolver-solicitud-interna.ts`.

### 7.3. Reembolsos

Depende de una venta propia ya **confirmada** — usá la del paso 7.1 (empleado2, cliente Gómez, ya confirmada por el cliente).

1. **Logueate como `empleado2`** y pedí la devolución **sin** el token, aunque lo tengas — para mostrar el camino de escalación en dos pasos (`solicitar-devolucion`):
   > *"Quiero iniciar una devolución de mi venta a Gómez, motivo: el cliente se arrepintió."*
   > (esperá el eco con los datos de la venta, después, en un mensaje nuevo) *"Sí, confirmo."*

   Esta operación **nunca cierra sola** la devolución — sólo la escala, pendiente de que la apruebe un administrador distinto.

2. **Cerrá sesión, logueate como `tutor`** y resolvé la escalación (`resolver-reembolso`):
   > *"Aprobame el reembolso de la devolución que escaló empleado2."*
   > (esperá el eco, después, en un mensaje nuevo) *"Sí, confirmo."*

   Mismas dos reglas que en solicitudes: exige rol `administrador` y prohíbe la auto-aprobación (verificado en `src/core/ventas/resolver-escalacion-reembolso.ts`) — acá la comparación es contra el `vendedorId` de la venta, no contra quién la creó.

3. **Camino alternativo, con token** (`devolucion-conversacional`): si en vez de escalar tenés a mano el token de confirmación de una venta, podés procesar la devolución directamente en un solo paso, sin pasar por la aprobación de un administrador. Para eso, registrá y confirmá **otra** venta de **menos de $500** (por ejemplo *"Quiero registrar una venta de $300 al cliente Pérez (perez@ejemplo.com), plan Básico, a mi nombre."*). Con token el monto decide: por debajo de `REEMBOLSO_UMBRAL` (500) se reembolsa al instante, y desde 500 se escala a un administrador igual que en el paso 1; por eso no sirve una venta de $1500. En cambio, **sin** token (paso 1) siempre escala, sea cual sea el monto:
   > *"Quiero procesar la devolución de la venta con token `<el-token>`, motivo: cambio de plan."*

   No la uses sobre la **misma** venta del paso 1: ya quedó escalada, y no podés además devolverla directo.

### 7.4. Consultas y conocimiento

El mismo camino conversacional de la sección 6.3 funciona igual por el chat web — preguntá en lenguaje libre y la respuesta va a citar su fuente real (skill `citar-conocimiento`) o decirte explícitamente que no encontró nada, sin inventar.

### 7.5. A2A desde el chat web

Logueado como **`tutor`** (administrador — acá sí hace falta, a diferencia de la TUI, ver 6.5):

> *"Preguntale al agente externo cuáles son los KPIs de este mes."*
> *"¿Qué nos preguntaron por A2A últimamente?"*

Ver el setup y la limitación honesta de cada una en la sección 9.

## 8. Extra — ver el arnés auditándose a sí mismo (opcional)

Si querés ver, en tiempo real, que el arnés deja rastro de cada turno que procesa (parte del control/observabilidad que exige la propuesta), abrí una segunda terminal mientras la primera sigue corriendo `npm run dev`:

```bash
Get-Content -Path "data\harness.log" -Wait -Tail 20
```

Cada vez que converses (por TUI o por el chat web), van a aparecer líneas nuevas como `turno-iniciado` y `post-turn-hook-ejecutado` — es el mecanismo de *hooks* del arnés funcionando en vivo, sin que vos tengas que hacer nada especial para activarlo. Al crear una solicitud interna por el chat web (sección 7.2) vas a ver además los eventos de la delegación al sub-agente `validador-solicitudes` (`delegacion-iniciada`, `delegacion-completada`, `solicitud-validada`).

## 9. A2A — comunicación entre agentes

El arnés puede hablar con sistemas externos (A2A **saliente**) y recibir consultas de otros agentes (A2A **entrante**). Las dos son opcionales y quedan apagadas por defecto — no hacen falta para nada de lo anterior.

### 9.1. A2A saliente — demostrable de punta a punta, sin curl

El comando `/consultar-kpi` hace que el arnés le pregunte a un sistema externo de KPIs/incidentes. Para probarlo sin depender de un sistema externo real, el propio repositorio trae un servidor de prueba (no es código de producción, es una ayuda de testing ya existente):

1. En una terminal aparte (con `npm run dev` corriendo en la primera), levantá el servidor de prueba:
   ```bash
   node "docs/progreso/v3.16-consulta-kpi-a2a-chat/mock-a2a-kpi.cjs"
   ```
   Por defecto escucha en el puerto `9001`.

2. Agregá a tu `.env` (y reiniciá `npm run dev`):
   ```
   HARNESS_A2A_SALIENTE=on
   HARNESS_A2A_ENDPOINT_KPI_INCIDENTE=http://localhost:9001
   ```

3. Desde la TUI, logueado, probá una de las cuatro consultas que el arnés entiende (KPIs del mes, incidentes abiertos, incidentes críticos, estado general):
   ```
   /consultar-kpi ¿cuáles son los KPIs de este mes?
   ```
   La respuesta tarda unos segundos (el mock simula latencia real) y vuelve con datos concretos — toda la ida y vuelta pasa por A2A de verdad, vos solo escribiste en la TUI.

Si no levantás el servidor de prueba y probás igual, el arnés no se rompe: responde con un mensaje controlado avisando que no pudo completar la consulta, en vez de un error crudo.

### 9.2. A2A entrante — con una limitación honesta

`/ver-solicitudes-a2a` te muestra las consultas que **otros agentes externos** le hicieron a este arnés. El problema: generar una consulta entrante nueva requiere que algo de afuera le hable por HTTP a este arnés — no hay, dentro del repo, una forma de generarla solo desde la TUI o el chat.

Así que para esta parte lo honesto es: corré el comando igual,
```
/ver-solicitudes-a2a
```
y si nadie externo te consultó todavía, vas a ver una lista vacía — que en sí misma es una prueba válida (el comando responde, el mecanismo está andando), solo que no vas a ver una fila con datos salvo que otro sistema real le haya preguntado algo al arnés antes.

### 9.3. A2A saliente disparado solo — venta grande → "riesgo-credito"

A diferencia de `/consultar-kpi` (el empleado la pide explícitamente), esta es una consulta A2A que el arnés dispara **por su cuenta**, como efecto colateral de registrar una venta. `registrarVenta` (`src/core/ventas/ventas-config.ts`, `src/build-on-venta.ts`) compara el `monto` declarado contra `VENTA_GRANDE_UMBRAL` (default `5000`, sección 3.3): si `monto >= umbral`, después de que la venta ya quedó dada de alta, dispara **sin bloquear** una consulta al destino "riesgo-credito" — un fallo de esa consulta nunca revierte ni retrasa la venta, sólo queda un evento `a2a-riesgo-credito-fallida` en el log si algo sale mal.

Para probarlo, reutilizá el mismo mock de 9.1, en un puerto distinto (ya está ocupando el `9001` si lo dejaste corriendo):

```bash
MOCK_PORT=9002 node "docs/progreso/v3.16-consulta-kpi-a2a-chat/mock-a2a-kpi.cjs"
```

Y en tu `.env` (con `HARNESS_A2A_SALIENTE=on` ya puesto):
```
HARNESS_A2A_ENDPOINT_RIESGO_CREDITO=http://localhost:9002
```

Después, desde el chat web (sección 7.1), registrá una venta con `monto` de `5000` o más. **Aclaración honesta**: el mock es el mismo script que ya usás para KPIs — no tiene contenido específico de riesgo crediticio, así que el texto que devuelva (si le apuntás esta consulta) va a leerse como un resumen de KPIs, no como un veredicto de crédito real. Sirve para probar que el *mecanismo* A2A se disparó solo, no para ver una respuesta de negocio realista. Como no bloquea la conversación, no vas a ver nada de esto en el chat — la forma de confirmarlo es mirar el log (sección 8) y buscar las líneas que mencionan "riesgo-credito".

## 10. Si algo no arranca

- **"No se pudo inicializar el arnés" o error de API key**: revisá que `ANTHROPIC_API_KEY` esté bien puesta en `.env` y que el archivo se llame exactamente `.env` (no `.env.example` sin copiar).
- **El chat web no responde en `/chat`**: confirmá que `WEB_PORT` tiene un número mayor a `0` en tu `.env`, y que reiniciaste `npm run dev` después de editar el archivo (las variables de entorno solo se leen al arrancar).
- **"Credenciales inválidas" en el login**: confirmá que corriste los dos comandos del paso 4 en orden, y que estás usando la misma contraseña que ingresaste la primera vez.
- **"Ese comando requiere rol administrador"**: te pasó con `/estado-bot-prs`, `/asignar-rol` o `/crear-empleado` estando logueado como `empleado2` en vez de `tutor` — cerrá sesión y volvé a loguearte como `tutor`.
- **"Ese comando requiere rol administrador" en el chat, con `/consultar-kpi` en la TUI andando bien**: no es un error — es la asimetría real entre canales que se explica en 6.5: la TUI no exige rol administrador para esa consulta puntual, el chat sí.
