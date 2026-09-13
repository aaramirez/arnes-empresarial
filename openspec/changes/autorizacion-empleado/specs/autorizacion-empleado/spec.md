> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md` de este change y por los specs de `venta-confirmacion` y `autenticacion-empleado-tui`. Este spec se apoya íntegramente en `proposal.md` (Aclaraciones 1-3, ADR 152-156) y usa `openspec/changes/tui-canal-empleado/specs/reembolso-resolucion-escalacion/spec.md` como plantilla de formato — capability nueva, no hay `openspec/specs/autorizacion-empleado/` que migrar.

# Autorización Empleado Specification

## Purpose

Capability nueva (ADR 152-156). Cubre el modelo mínimo de rol de empleado — dos valores enumerados, `empleado` (base) y `administrador` (elevado) —, dónde se persiste, el puerto por el que se lee, el gate de autorización que ese rol habilita sobre "resolver lo ajeno" (escalación de reembolso y solicitud interna), la prohibición de autoaprobación (independiente del rol), el provisioning exclusivo por CLI, y los invariantes negativos de superficie que impiden que el rol se filtre o se falsifique.

**Fuera de alcance de este spec**: RBAC, tabla de permisos, ACL, permisos por acción, límites por monto, segundo aprobador, flujo de aprobación multinivel (ADR 152, diferido por `tui-canal-empleado/proposal.md:572`); desactivación de empleado, rate limiting de login, política de contraseña, recuperación de contraseña (empaquetado de `0006:11-16`, tomado sólo en su rebanada de autorización); mover los comandos privilegiados a conversación (ADR 151 de `operaciones-negocio-conversacionales`); comandos administrativos de TUI para gestionar roles; unificar `vendedores` con `empleado_id`; FK del dominio hacia la tabla/columna de rol. **La autoaprobación de reembolso por el propio vendedor (R7) queda fuera de alcance como deuda declarada**: `vendedores` y `credenciales_empleado` no están ligadas por ninguna FK ni columna (Aclaración 2 pto 2), y cerrarlo exige primero unificar esas dos identidades — es otro change.

## Requirements

### Requirement: Rol de empleado como valor enumerado de dos miembros, vocabulario en el núcleo

El sistema SHALL definir el rol de empleado como una unión de literales en el núcleo, sin imports, con exactamente dos valores: `"empleado"` (base) y `"administrador"` (elevado). El sistema SHALL NOT introducir una tabla de permisos, una tabla de roles-permisos, ni un chequeo genérico `puede(empleado, accion, recurso)`. El SQL SHALL NOT imponer un `CHECK` sobre el valor del rol.

#### Scenario: El tipo de rol tiene exactamente dos valores
- GIVEN el tipo de rol de empleado en el núcleo
- WHEN se inspeccionan sus valores posibles
- THEN son exactamente `"empleado"` y `"administrador"`, sin un tercer valor ni una estructura de permisos

#### Scenario: No existe evaluador genérico de permisos
- GIVEN el código de autorización de este change
- WHEN se busca una función `puede(empleado, accion, recurso)` o una tabla de permisos
- THEN no existe ninguna de las dos

### Requirement: Persistencia aditiva del rol, con las filas existentes en rol base (default deny)

El sistema SHALL persistir el rol mediante una migración aditiva (`0013`), agregada al final de `migrations/index.ts` sin editar ni reordenar ninguna entrada previa, con `IF NOT EXISTS` y sin `CHECK` sobre el valor. Toda fila de empleado existente al aplicar la migración SHALL quedar en el rol **base** (`"empleado"`); el sistema SHALL NOT asignar el rol elevado a ninguna fila existente por default.

#### Scenario: La migración es aditiva y no toca migraciones previas
- GIVEN las doce migraciones existentes (`0001`-`0012`)
- WHEN se aplica `0013`
- THEN ninguna de las doce migraciones previas cambia su definición
- AND `0013` es la última entrada del array de migraciones

#### Scenario: Todo empleado existente queda en rol base tras migrar
- GIVEN empleados con credenciales creadas antes de esta migración
- WHEN se aplica `0013`
- THEN cada uno de ellos tiene rol `"empleado"` (base), ninguno queda en `"administrador"`

### Requirement: Puerto de lectura de rol, de una sola operación síncrona

El sistema SHALL exponer un puerto de lectura de rol con una única operación síncrona, molde de `CredencialesEmpleadoPort`. El núcleo determinista SHALL NOT conocer SQL ni el adaptador concreto que resuelve esa lectura.

#### Scenario: El puerto expone una sola operación de lectura
- GIVEN el contrato del puerto de rol
- WHEN se inspeccionan sus operaciones
- THEN expone únicamente una operación de lectura, síncrona, sin escritura

### Requirement: Gate de autorización sobre "resolver lo ajeno" en el núcleo determinista

El sistema SHALL exigir rol `"administrador"` para `aprobar`, `rechazar` y `reabrir` una escalación de reembolso, y para `aprobar`/`rechazar` una solicitud interna ajena, evaluado dentro de `resolverEscalacionReembolso` y `resolverSolicitudInterna` (no en el handler ni en la guarda del dispatcher). Un empleado con rol base que intente cualquiera de esas cinco acciones SHALL recibir una variante de rechazo tipada, sin escritura en `ventas`, `casos`, `solicitudes_internas` ni `registro_acciones_empleado` salvo la fila de auditoría del intento (ver requirement de trazabilidad). El rechazo SHALL NOT filtrar datos del ítem ajeno (molde `no_es_dueno`).

#### Scenario: Rol base no puede aprobar una escalación de reembolso ajena
- GIVEN un empleado con rol base y una venta en `reembolso_pendiente`
- WHEN confirma `/aprobar-reembolso <ventaId>`
- THEN la acción se rechaza con la variante tipada de "no autorizado", sin cambiar `ventas.estado` ni `casos.estado`

#### Scenario: Rol elevado sí puede resolver lo ajeno
- GIVEN un empleado con rol `"administrador"` y una solicitud interna ajena pendiente
- WHEN confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona con normalidad, igual que antes de este change

#### Scenario: El rechazo por autorización no expone el detalle del ítem ajeno
- GIVEN un empleado con rol base intentando resolver una solicitud ajena
- WHEN recibe el rechazo
- THEN la respuesta no contiene el `detalle` ni datos internos de la solicitud, mismo criterio que `no_es_dueno`

### Requirement: El rol se lee en el momento de la decisión; revocarlo tiene efecto sin re-login

El sistema SHALL leer el rol por el puerto en el momento de evaluar el gate, y SHALL NOT cachearlo en `SesionEmpleado` ni en ninguna estructura que sobreviva más allá de esa evaluación. Quitarle el rol elevado a un empleado SHALL tener efecto en su próximo intento de resolver lo ajeno, sin exigir un nuevo `/login`, incluso con una sesión sin `expiraEn`.

#### Scenario: Revocar el rol surte efecto sin re-login
- GIVEN un empleado con rol elevado y una sesión activa sin `expiraEn` (TTL en 0)
- WHEN se le quita el rol elevado y, con la misma sesión, intenta resolver una solicitud ajena
- THEN la acción se rechaza por autorización, sin que haya mediado un nuevo `/login`

### Requirement: Un `empleado_id` sin fila de rol cae al rol base, nunca al elevado

Ante la ausencia de fila de rol para un `empleado_id` (por ejemplo, porque el histórico sobrevive a la baja de una credencial), el sistema SHALL tratarlo como rol base. El sistema SHALL NOT escalar por ausencia de dato.

#### Scenario: Ausencia de fila de rol nunca autoriza
- GIVEN un `empleado_id` sin ninguna fila de rol asociada
- WHEN se evalúa el gate para una acción sobre lo ajeno
- THEN el resultado es el mismo que si tuviera rol base explícito — la acción se rechaza

### Requirement: El gate de rol convive con el chequeo de autoservicio existente, sin reemplazarlo

El gate de autorización SHALL evaluarse como una pregunta distinta de `esAccionAutoservicio`: un empleado con rol base SHALL seguir pudiendo ejecutar acciones sobre lo propio (por ejemplo, `/cancelar-solicitud` de su propia solicitud) exactamente igual que antes de este change. El sistema SHALL NOT modificar ni subsumir `esAccionAutoservicio`.

#### Scenario: Rol base sigue pudiendo cancelar su propia solicitud
- GIVEN un empleado con rol base y una solicitud propia `pendiente_aprobacion_humana`
- WHEN ejecuta `/cancelar-solicitud <id>` con confirmación
- THEN la solicitud transiciona a `cancelada` con normalidad, sin que el gate de rol la bloquee

### Requirement: Prohibición de autoaprobación de solicitud interna, independiente del rol

`aprobar`/`rechazar` una solicitud interna con `solicitante_id === sesion.empleadoId` SHALL rechazarse **incluso si el empleado tiene rol elevado**. Esta prohibición SHALL evaluarse con independencia del resultado del gate de rol. SHALL NOT aplicarse a la escalación de reembolso, donde `sesion.empleadoId` se usa sólo para atribución.

#### Scenario: Rol elevado no habilita la autoaprobación
- GIVEN un empleado con rol `"administrador"` que es el `solicitante_id` de una solicitud propia pendiente
- WHEN intenta confirmar `/aprobar-solicitud` sobre esa misma solicitud
- THEN la acción se rechaza, con rol o sin rol

#### Scenario: Un administrador sí puede aprobar la solicitud de otro
- GIVEN un empleado con rol `"administrador"` y una solicitud ajena pendiente
- WHEN confirma `/aprobar-solicitud <id>`
- THEN la solicitud transiciona con normalidad

### Requirement: Provisioning del rol exclusivamente por CLI

`src/empleados.ts` SHALL seguir siendo el único escritor de rol, igual que ya es el único escritor de `credenciales_empleado`. La TUI SHALL NOT poder asignar ni cambiar el rol de ningún empleado.

#### Scenario: La TUI no expone ninguna forma de cambiar rol
- GIVEN cualquier comando de la TUI, incluidos los privilegiados
- WHEN se revisan sus efectos posibles
- THEN ninguno escribe ni modifica el rol de un empleado

### Requirement: Invariantes negativos de superficie — el rol no viaja como parámetro, `SesionEmpleado` y `privilegiado` no cambian

El rol SHALL NOT ser parámetro de ningún comando de la TUI ni de ningún schema de herramienta. `SesionEmpleado` (`src/core/auth/sesion.ts`) SHALL NOT ganar un campo de rol ni ninguna otra modificación — sigue respondiendo *quién sos*. El campo `privilegiado` de los descriptores de comando SHALL NOT resignificarse para requerir rol elevado; sigue significando únicamente "exige sesión vigente".

#### Scenario: El rol no aparece en el parser de comandos ni en ningún schema
- GIVEN el parser de comandos y el schema de herramienta del canal conversacional (cuando exista)
- WHEN se inspeccionan sus parámetros aceptados
- THEN ninguno acepta un valor de rol como entrada

#### Scenario: `git diff` confirma que `sesion.ts` no cambió y que `privilegiado` no se resignificó
- GIVEN el diff de este change
- WHEN se inspecciona `src/core/auth/sesion.ts` y los quince comandos `privilegiado: true` de sólo lectura o de otra naturaleza
- THEN `sesion.ts` no aparece modificado, y esos comandos siguen respondiendo con la misma sesión vigente que antes, sin nueva condición de rol

### Requirement: Un intento rechazado por autorización o por autoaprobación deja fila distinguible

Todo intento de resolver lo ajeno rechazado por el gate de rol, y todo intento de autoaprobación rechazado, SHALL dejar una fila en `registro_acciones_empleado` con un resultado distinguible de "no encontrada" y de "sin sesión".

#### Scenario: El intento no autorizado queda auditado
- GIVEN un empleado con rol base que intenta aprobar un reembolso ajeno
- WHEN el gate lo rechaza
- THEN se crea una fila en `registro_acciones_empleado` cuyo resultado distingue este caso de una solicitud inexistente y de una sesión ausente
