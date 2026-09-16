> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/comandos-administracion-empleados/specs/comando-empleado-tui/spec.md` — versión vigente más reciente de esta capability (dieciocho descriptores). Este change retira los cinco comandos HITL (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`, ADR 210), quedando en trece. Se copian completos los dos requirements MODIFIED de esa versión y se editan, por el workflow de MODIFIED Requirements.

# Delta for Comando Empleado TUI

## MODIFIED Requirements

### Requirement: Reconocimiento y ruteo de todos los comandos del Registro

`parsearComando` SHALL reconocer cada comando declarado en `DESCRIPTORES` (el Registro de Comandos, trece tras este change: `/login`, `/logout`, `/soporte`, `/ver-solicitudes-a2a`, `/consultar-kpi`, `/reporte-comisiones`, `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta`, `/crear-empleado`, `/asignar-rol`, `/estado-bot-prs`, y `/ayuda` último), devolviendo una unión discriminada tipada con sus argumentos posicionales. El dispatcher SHALL rutear cada resultado reconocido al manejador correspondiente. El número de comandos reconocidos SHALL corresponder siempre al largo real de `DESCRIPTORES`, no a una cifra fija en la prosa de este requirement. El orden relativo de los descriptores que permanecen SHALL NOT cambiar tras quitar los cinco retirados.

(Previously: dieciocho descriptores, incluidos `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud` y `/rechazar-solicitud`. Este change los retira de la TUI en el mismo PR que agrega su equivalente conversacional (`resolver_reembolso`/`resolver_solicitud`, capability `resolucion-hitl-conversacional`), dejando trece.)

#### Scenario: Cada prefijo reconocido rutea a su manejador
- GIVEN un texto que empieza con uno de los prefijos declarados en `DESCRIPTORES`
- WHEN `parsearComando` lo procesa
- THEN devuelve el tipo discriminado correspondiente con sus argumentos
- AND el dispatcher invoca el manejador de ese comando, no el conversacional

#### Scenario: Los tres comandos de autoservicio siguen sin reconocerse
- GIVEN los textos `/devolucion`, `/solicitar` o `/cancelar-solicitud`
- WHEN `parsearComando` los procesa tras este change
- THEN ninguno matchea un comando conocido — sin cambio respecto de la versión anterior

#### Scenario: Los cinco comandos HITL retirados ya no matchean
- GIVEN los textos `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud` y `/rechazar-solicitud`
- WHEN `parsearComando` los procesa tras este change
- THEN ninguno matchea un comando conocido, y caen al mismo camino que un comando desconocido

#### Scenario: Los descriptores que quedan conservan su orden relativo
- GIVEN `DESCRIPTORES` antes y después de este change
- WHEN se compara el orden de los trece descriptores que permanecen
- THEN ninguno cambió de posición ni de forma respecto de la versión anterior a la baja

### Requirement: Comando desconocido o con argumentos faltantes responde con ayuda, sin efecto

Un texto que empieza con `/` pero no matchea ningún comando conocido, o que matchea un comando sin los argumentos requeridos, SHALL responder con el texto de ayuda/uso y SHALL NOT producir ningún efecto de dominio ni fila de registro.

(Previously: el escenario de `/ayuda` decía "dieciocho" — se corrige a trece por la baja de los cinco comandos HITL.)

#### Scenario: Comando desconocido no tiene efecto
- GIVEN el texto `/noexiste algo`
- WHEN se procesa en la TUI
- THEN la respuesta es el texto de ayuda
- AND no se modifica `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: `/ayuda` lista los comandos disponibles, filtrados por lo que el empleado puede usar
- GIVEN cualquier estado de sesión
- WHEN se ejecuta `/ayuda`
- THEN se listan todos los comandos declarados en `DESCRIPTORES` (trece tras este change) que el empleado autenticado puede ejecutar, cada uno con su descripción de una línea
- AND no se escribe ninguna fila de registro
