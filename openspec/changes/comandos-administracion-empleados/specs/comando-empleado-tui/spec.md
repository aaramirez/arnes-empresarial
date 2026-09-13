> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/operaciones-negocio-conversacionales/specs/comando-empleado-tui/spec.md` — versión vigente más reciente de esta capability en esta sesión (bajó tres comandos de autoservicio, dejó quince). Este change agrega tres comandos (`/crear-empleado`, `/asignar-rol`, `/estado-bot-prs` — el tercero por resolución de checkpoint, ver `specs/administracion-empleados-tui/spec.md`), quedando en **dieciocho**, no diecisiete. Se copian completos los dos requirements MODIFIED de esa versión y se editan, por el workflow de MODIFIED Requirements.

# Delta for Comando Empleado TUI

## MODIFIED Requirements

### Requirement: Reconocimiento y ruteo de todos los comandos del Registro

`parsearComando` SHALL reconocer cada comando declarado en `DESCRIPTORES` (el Registro de Comandos, dieciocho tras este change: los quince heredados — `/login`, `/logout`, `/soporte`, `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`, `/ver-solicitudes-a2a`, `/consultar-kpi`, `/reporte-comisiones`, `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta` — más `/crear-empleado`, `/asignar-rol` y `/estado-bot-prs`, y `/ayuda` último), devolviendo una unión discriminada tipada con sus argumentos posicionales. El dispatcher SHALL rutear cada resultado reconocido al manejador correspondiente. El número de comandos reconocidos SHALL corresponder siempre al largo real de `DESCRIPTORES`, no a una cifra fija en la prosa de este requirement. Ningún descriptor existente SHALL cambiar de orden ni de forma; la tanda nueva SHALL insertarse inmediatamente antes de `/ayuda`.

(Previously: quince comandos tras las tres bajas de autoservicio de `operaciones-negocio-conversacionales`. Esta versión suma `/crear-empleado`, `/asignar-rol` y `/estado-bot-prs`, dejando dieciocho, y hace explícita la regla de orden ya escrita en `comando-empleado.ts:134-136` — los descriptores existentes no se reordenan.)

#### Scenario: Cada prefijo reconocido rutea a su manejador
- GIVEN un texto que empieza con uno de los prefijos declarados en `DESCRIPTORES`
- WHEN `parsearComando` lo procesa
- THEN devuelve el tipo discriminado correspondiente con sus argumentos
- AND el dispatcher invoca el manejador de ese comando, no el conversacional

#### Scenario: Los tres comandos de autoservicio siguen sin reconocerse
- GIVEN los textos `/devolucion`, `/solicitar` o `/cancelar-solicitud`
- WHEN `parsearComando` los procesa tras este change
- THEN ninguno matchea un comando conocido — sin cambio respecto de la versión anterior

#### Scenario: Los tres comandos nuevos se insertan antes de `/ayuda` sin reordenar el resto
- GIVEN `DESCRIPTORES` antes y después de este change
- WHEN se compara el orden de los quince descriptores heredados
- THEN ninguno cambió de posición ni de forma, y `/crear-empleado`, `/asignar-rol` y `/estado-bot-prs` aparecen inmediatamente antes de `/ayuda`

### Requirement: Comando desconocido o con argumentos faltantes responde con ayuda, sin efecto

Un texto que empieza con `/` pero no matchea ningún comando conocido, o que matchea un comando sin los argumentos requeridos, SHALL responder con el texto de ayuda/uso y SHALL NOT producir ningún efecto de dominio ni fila de registro.

(Previously: sin cambio de cuerpo; el escenario de `/ayuda` decía "quince" — se corrige a dieciocho por la suma de esta tanda.)

#### Scenario: Comando desconocido no tiene efecto
- GIVEN el texto `/noexiste algo`
- WHEN se procesa en la TUI
- THEN la respuesta es el texto de ayuda
- AND no se modifica `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: `/ayuda` lista los comandos disponibles, filtrados por lo que el empleado puede usar
- GIVEN cualquier estado de sesión
- WHEN se ejecuta `/ayuda`
- THEN se listan todos los comandos declarados en `DESCRIPTORES` (dieciocho tras este change) que el empleado autenticado puede ejecutar, cada uno con su descripción de una línea
- AND no se escribe ninguna fila de registro

## ADDED Requirements

### Requirement: El dispatcher evalúa un segundo eje de gateo — rol `administrador` — además de la sesión vigente

Para `/crear-empleado` y `/asignar-rol`, el dispatcher SHALL evaluar dos chequeos en orden: primero sesión vigente (`privilegiado: true`, guarda existente, sin cambios), después rol `administrador` (gate nuevo, ADR 175). El sistema SHALL NOT evaluar el gate de rol antes que la guarda de sesión, y SHALL NOT saltear la guarda de sesión existente para estos dos comandos. El campo `privilegiado` SHALL NOT ganar un tercer significado: sigue siendo únicamente el chequeo de sesión.

#### Scenario: Sin sesión, ni siquiera se evalúa el rol
- GIVEN la TUI sin ningún `/login` previo
- WHEN se ejecuta `/crear-empleado ana <password>`
- THEN el rechazo es por falta de sesión (mismo mecanismo que los comandos `privilegiado: true` existentes), no por rol

#### Scenario: Con sesión pero sin rol administrador, el segundo eje rechaza
- GIVEN un empleado con sesión vigente y rol base
- WHEN ejecuta `/asignar-rol ana administrador`
- THEN la sesión pasa el primer chequeo y el rechazo ocurre en el segundo eje, el de rol
