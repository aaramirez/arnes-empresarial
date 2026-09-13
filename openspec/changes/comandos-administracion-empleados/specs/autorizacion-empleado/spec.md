> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/autorizacion-empleado/spec.md` — versión vigente única, sin revisión posterior de esta capability. **Este change LLAMA al modelo de rol, no lo redefine** (ADR 176): no se toca `RolEmpleadoPort` (lectura), no se agrega un tercer valor a `ROLES_EMPLEADO`, no se crea migración ni tabla. Dos requirements de esa versión están redactados sobre el **canal** (CLI) y quedan falsos con este change — se copian completos y se editan, acotando la excepción a `/asignar-rol` bajo gate de `administrador`, exactamente el criterio que `Modified Capabilities` de `proposal.md` pedía verificar.

# Delta for Autorización Empleado

## MODIFIED Requirements

### Requirement: Provisioning del rol por CLI o por `/asignar-rol` bajo gate de administrador — ningún otro camino escribe rol

`src/empleados.ts` SHALL seguir siendo un escritor válido de rol, y sigue siendo el único camino de **bootstrap** (el primer `administrador`, cuando `roles_empleado` no tiene ninguna fila con ese valor). La TUI SHALL poder asignar o cambiar el rol de un empleado únicamente a través de `/asignar-rol`, y únicamente cuando quien lo ejecuta tiene sesión vigente y rol `administrador` (capability `administracion-empleados-tui`). Ningún otro comando de la TUI, ningún camino conversacional y ninguna herramienta MCP SHALL poder escribir rol. Los dos escritores (CLI y `/asignar-rol`) SHALL llamar a la misma función `upsertRolEmpleado`; el sistema SHALL NOT introducir una segunda función ni un segundo camino de escritura SQL para el rol.

(Previously: "`src/empleados.ts` SHALL seguir siendo el único escritor de rol, igual que ya es el único escritor de `credenciales_empleado`. La TUI SHALL NOT poder asignar ni cambiar el rol de ningún empleado." — redactado sobre el canal, sin excepción. Este change revierte esa exclusividad a pedido del stakeholder (ADR 174/175), preservando el **efecto** que el requirement original protegía: sigue sin haber un tercer escritor no gateado, y el bootstrap del primer administrador sigue siendo CLI-only porque antes del bootstrap no existe ningún `administrador` que pueda ejecutar `/asignar-rol`.)

#### Scenario: El bootstrap del primer administrador sigue siendo CLI-only
- GIVEN `roles_empleado` sin ninguna fila `administrador`
- WHEN se intenta usar `/asignar-rol` para crear el primer `administrador`
- THEN no hay ningún empleado con rol `administrador` que pueda ejecutar el comando — el único camino que produce el primer `administrador` es `empleados:crear -- <id> --rol administrador`

#### Scenario: Un administrador existente sí puede asignar rol desde la TUI
- GIVEN un empleado con rol `administrador` y sesión vigente
- WHEN ejecuta `/asignar-rol ana administrador`
- THEN `ana` queda con rol `administrador`, escrito por `upsertRolEmpleado` — el mismo camino de escritura que usa el CLI

#### Scenario: Ningún comando fuera de `/asignar-rol` escribe rol
- GIVEN cualquier otro comando de la TUI, incluidos los privilegiados de sólo lectura y `/crear-empleado`
- WHEN se revisan sus efectos posibles
- THEN ninguno modifica `roles_empleado`

### Requirement: Invariantes negativos de superficie — el rol no viaja como parámetro salvo en `/asignar-rol` bajo gate de administrador; `SesionEmpleado` y `privilegiado` no cambian

El rol SHALL NOT ser parámetro de ningún comando de la TUI ni de ningún schema de herramienta, **con la única excepción de `/asignar-rol`**, cuyo segundo argumento posicional es el rol destino, validado contra `ROLES_EMPLEADO` y evaluado únicamente cuando quien ejecuta el comando ya tiene rol `administrador` confirmado por el gate. Ningún schema de herramienta conversacional o MCP SHALL aceptar un valor de rol como entrada — la excepción es exclusiva de la TUI (`/asignar-rol`), consistente con el Out of Scope de este change ("no exponer por conversación ni por MCP"). `SesionEmpleado` (`src/core/auth/sesion.ts`) SHALL NOT ganar un campo de rol ni ninguna otra modificación. El campo `privilegiado` de los descriptores de comando SHALL NOT resignificarse para requerir rol elevado; sigue significando únicamente "exige sesión vigente".

(Previously: "El rol SHALL NOT ser parámetro de ningún comando de la TUI ni de ningún schema de herramienta." sin excepción, y sin mención de `/asignar-rol` porque ese comando no existía. El resto del requirement — `sesion.ts` sin cambios, `privilegiado` sin resignificar — no cambia.)

#### Scenario: El rol sigue sin ser parámetro de ningún comando salvo `/asignar-rol`
- GIVEN el parser de comandos de la TUI
- WHEN se inspeccionan los parámetros aceptados por cada comando salvo `/asignar-rol`
- THEN ninguno acepta un valor de rol como entrada

#### Scenario: Ningún schema conversacional o MCP acepta rol como parámetro
- GIVEN el schema de la herramienta conversacional de `operaciones-negocio-conversacionales`
- WHEN se inspeccionan sus parámetros aceptados
- THEN ninguno acepta un valor de rol — la excepción de `/asignar-rol` es exclusiva de la TUI

#### Scenario: `git diff` confirma que `sesion.ts` no cambió y que `privilegiado` no se resignificó
- GIVEN el diff de este change
- WHEN se inspecciona `src/core/auth/sesion.ts` y los descriptores `privilegiado: true` de sólo lectura
- THEN `sesion.ts` no aparece modificado, y esos comandos siguen respondiendo con la misma sesión vigente que antes, sin nueva condición de rol
