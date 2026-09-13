> Nota de proceso: sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), mismo criterio documentado en `proposal.md` de este change. Delta sobre `openspec/changes/tui-canal-empleado/specs/autenticacion-empleado-tui/spec.md` — versión vigente única de esta capability, no hay revisión posterior. El único bloque afectado es el párrafo de `Fuera de alcance` en `## Purpose`, no un `### Requirement`: se copia completo y se edita, mismo criterio de rigor que el workflow de MODIFIED Requirements, porque el archivo no tiene una sección `## MODIFIED Purpose` precedente en este repo pero la corrección es real y necesaria — la línea vigente apunta a una capability que ya no es la dueña del modelo de roles.

# Delta for Autenticación Empleado TUI

## MODIFIED Purpose

Capability nueva (revisión 3, ADR 30-33). Cubre: alta y rotación de credenciales de empleado por CLI (`empleados:crear`), verificación de contraseña contra un hash scrypt en `/login`, apertura/cierre/vigencia de la sesión en memoria de la TUI, y la regla de qué comandos exigen esa sesión. Incluye los invariantes negativos de la contraseña: **nunca** se persiste en claro, **nunca** aparece en una fila de `registro_acciones_empleado`, **nunca** aparece en un evento de `logTurnEvent`.

**Fuera de alcance de este spec**: roles y permisos sobre qué puede hacer un empleado logueado (capability `autorizacion-empleado`), desactivación de empleado, límite de intentos de login / rate limiting, recuperación de contraseña, enmascarado de la entrada en la TUI, sesión persistente entre reinicios o compartida entre procesos, autenticación del adaptador web.

(Previously: la línea de `Fuera de alcance` apuntaba a `reembolso-resolucion-escalacion` como la capability dueña de "roles y permisos sobre qué puede hacer un empleado logueado". Esa referencia queda falsa con este change: `reembolso-resolucion-escalacion` gana un requisito de autorización, pero el modelo de rol en sí — vocabulario, persistencia, puerto, gate, prohibición de autoaprobación — vive en la capability nueva `autorizacion-empleado`. El resto del párrafo, y el resto del spec, no cambian: `/login` sigue respondiendo *quién sos*, nunca *qué podés*, y esta capability sigue sin conocer roles.)

Ningún `### Requirement` de esta capability cambia — la autenticación en sí (alta, rotación, `/login`, TTL de sesión, `/logout`) es exactamente la misma antes y después de este change.
