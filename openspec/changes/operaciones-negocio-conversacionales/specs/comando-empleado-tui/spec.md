> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin shell disponible). Delta escrito contra `openspec/changes/comando-reporte-comisiones/specs/comando-empleado-tui/spec.md` — versión vigente. **Esa versión ya estaba desactualizada**: decía "dieciséis" y su lista nombraba solo dieciséis comandos, omitiendo `/cancelar-solicitud` y `/ver-solicitudes-a2a` (sumados por `comando-cancelar-solicitud` y `comando-visibilidad-a2a-entrante` sin delta sobre esta capability — mismo patrón de drift que `comando-reporte-comisiones` documentó sobre la versión anterior). Verificado contra `proposal.md` (Affected Areas: "dieciocho comandos hoy... quince tras este change"). Se corrige la lista a los dieciocho reales antes de este change y se aplican las tres bajas de ADR 148 pto 2, quedando en quince.

# Delta for Comando Empleado TUI

## MODIFIED Requirements

### Requirement: Reconocimiento y ruteo de todos los comandos del Registro

`parsearComando` SHALL reconocer cada comando declarado en `DESCRIPTORES` (el Registro de Comandos, quince tras este change: `/login`, `/logout`, `/soporte`, `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`, `/ver-solicitudes-a2a`, `/consultar-kpi`, `/reporte-comisiones`, `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta` y `/ayuda`), devolviendo una unión discriminada tipada con sus argumentos posicionales. El dispatcher SHALL rutear cada resultado reconocido al manejador correspondiente. El número de comandos reconocidos SHALL corresponder siempre al largo real de `DESCRIPTORES`, no a una cifra fija en la prosa de este requirement.

(Previously: "dieciséis" comandos, y la lista ya estaba desactualizada — omitía `/cancelar-solicitud` y `/ver-solicitudes-a2a`, sumados por changes posteriores sin delta sobre esta capability. Esta versión corrige la lista a los dieciocho vigentes antes de este change y aplica las tres bajas de autoservicio de ADR 148 pto 2 [`/devolucion`, `/solicitar`, `/cancelar-solicitud`], quedando en quince. Los cinco `/aprobar-*`/`/rechazar-*`/`/reabrir-*` se conservan — ADR 151 BLOQUEADO.)

#### Scenario: Cada prefijo reconocido rutea a su manejador
- GIVEN un texto que empieza con uno de los prefijos declarados en `DESCRIPTORES`
- WHEN `parsearComando` lo procesa
- THEN devuelve el tipo discriminado correspondiente con sus argumentos
- AND el dispatcher invoca el manejador de ese comando, no el conversacional

#### Scenario: Los tres comandos de autoservicio ya no se reconocen
- GIVEN los textos `/devolucion`, `/solicitar` o `/cancelar-solicitud`
- WHEN `parsearComando` los procesa tras este change
- THEN ninguno matchea un comando conocido — la operación equivalente sólo existe vía la herramienta conversacional (capability `herramienta-operaciones-negocio`)

### Requirement: Comando desconocido o con argumentos faltantes responde con ayuda, sin efecto

Un texto que empieza con `/` pero no matchea ningún comando conocido, o que matchea un comando sin los argumentos requeridos, SHALL responder con el texto de ayuda/uso y SHALL NOT producir ningún efecto de dominio ni fila de registro.

(Previously: sin cambio de cuerpo; el escenario de `/ayuda` decía "dieciséis" — se corrige a quince por la misma razón del requirement anterior.)

#### Scenario: Comando desconocido no tiene efecto
- GIVEN el texto `/noexiste algo`
- WHEN se procesa en la TUI
- THEN la respuesta es el texto de ayuda
- AND no se modifica `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: `/ayuda` lista los comandos disponibles
- GIVEN cualquier estado de sesión
- WHEN se ejecuta `/ayuda`
- THEN se listan todos los comandos declarados en `DESCRIPTORES` (quince tras este change), cada uno con su descripción de una línea
- AND no se escribe ninguna fila de registro
