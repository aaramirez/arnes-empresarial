> **DELTA — corrige drift preexistente, no crea comportamiento nuevo.** El requirement *"Reconocimiento y ruteo de los ocho comandos"* (`tui-canal-empleado/specs/comando-empleado-tui/spec.md:23`) está desactualizado desde hace **tres** changes: Hito 5 (ADR 56) sumó tres comandos, Hito 5.1 (ADR 69) otros tres, Hito 6 (ADR 85) uno más, y ninguno escribió un delta sobre esta capability (cada uno documentó su comando en la spec de su propia capability dueña, precedente válido y que este change también sigue para `comando-reporte-comisiones`). Este change agrega el **decimosexto** descriptor y vuelve la cifra "ocho" más falsa todavía — se corrige acá en vez de repetir el precedente una cuarta vez, siguiendo el mismo patrón de copia-completa-y-edición que `openspec/changes/hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md` usó sobre `hito-2.0-delegacion-subagentes`.
>
> Se copiaron COMPLETOS los dos bloques de requirement que mencionan la cifra "ocho" (`### Requirement:` + TODOS sus escenarios cada uno), verificados línea por línea contra `tui-canal-empleado/specs/comando-empleado-tui/spec.md` (líneas 23-48). El primer requirement de esa spec (*"Texto sin prefijo `/` se delega intacto al turno conversacional"*) no menciona una cifra y no cambia — no se repite acá.
>
> **Para evitar que este mismo drift se repita en el próximo comando agregado**: en vez de reemplazar "ocho" por "dieciséis" en prosa (que volvería a mentir en el próximo change), el requirement ata el conteo a `DESCRIPTORES.length` — la fuente de verdad real — y solo usa "dieciséis" como cifra vigente hoy, no como techo fijo.

# Delta for Comando Empleado TUI

## MODIFIED Requirements

### Requirement: Reconocimiento y ruteo de todos los comandos del Registro

`parsearComando` SHALL reconocer cada comando declarado en `DESCRIPTORES` (el Registro de Comandos, hoy dieciséis: `/login`, `/logout`, `/soporte`, `/devolucion`, `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/solicitar`, `/aprobar-solicitud`, `/rechazar-solicitud`, `/ver-propuesta`, `/aplicar-propuesta`, `/descartar-propuesta`, `/consultar-kpi`, `/reporte-comisiones` y `/ayuda`), devolviendo una unión discriminada tipada con sus argumentos posicionales. El dispatcher SHALL rutear cada resultado reconocido al manejador correspondiente. El número de comandos reconocidos SHALL corresponder siempre al largo real de `DESCRIPTORES`, no a una cifra fija en la prosa de este requirement.

(Previously: "Reconocimiento y ruteo de los ocho comandos" — enumeraba ocho comandos por nombre y quedó desactualizado tres changes seguidos (Hito 5/ADR 56, Hito 5.1/ADR 69, Hito 6/ADR 85) sin que ninguno lo corrigiera. Esta versión enumera los dieciséis vigentes tras este change y ata el conteo a `DESCRIPTORES.length` en vez de a un número en prosa.)

#### Scenario: Cada prefijo reconocido rutea a su manejador
- GIVEN un texto que empieza con uno de los prefijos declarados en `DESCRIPTORES`
- WHEN `parsearComando` lo procesa
- THEN devuelve el tipo discriminado correspondiente con sus argumentos
- AND el dispatcher invoca el manejador de ese comando, no el conversacional

### Requirement: Comando desconocido o con argumentos faltantes responde con ayuda, sin efecto

Un texto que empieza con `/` pero no matchea ningún comando conocido, o que matchea un comando sin los argumentos requeridos, SHALL responder con el texto de ayuda/uso y SHALL NOT producir ningún efecto de dominio ni fila de registro.

(Previously: cuerpo del requirement sin cambios; el segundo escenario decía "se listan los ocho comandos" — desactualizado por el mismo drift que el requirement anterior.)

#### Scenario: Comando desconocido no tiene efecto
- GIVEN el texto `/noexiste algo`
- WHEN se procesa en la TUI
- THEN la respuesta es el texto de ayuda
- AND no se modifica `ventas`, `casos` ni `registro_acciones_empleado`

#### Scenario: `/ayuda` lista los comandos disponibles
- GIVEN cualquier estado de sesión
- WHEN se ejecuta `/ayuda`
- THEN se listan todos los comandos declarados en `DESCRIPTORES` (dieciséis tras este change), cada uno con su descripción de una línea
- AND no se escribe ninguna fila de registro
