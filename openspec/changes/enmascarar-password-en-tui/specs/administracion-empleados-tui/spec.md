> Nota de proceso: sin shell ni `graphify query`. Delta escrito contra `openspec/changes/comandos-administracion-empleados/specs/administracion-empleados-tui/spec.md:84-91` (no hay spec principal archivada). Se **MODIFICA** (no se renombra, para que el archivo case por título) el requirement de la contraseña de alta: hoy exige lo contrario de este change. El punto de rotación es `[SUPUESTO — pendiente de checkpoint]` (punto 5 de la propuesta: recomendado bajarlo de *obligatorio* a *recomendado*). ADR 300 = número tentativo, a confirmar en `design.md`.

# Delta for Administración Empleados TUI

## MODIFIED Requirements

### Requirement: La contraseña de alta es un residual documentado, no un defecto

`/crear-empleado` SHALL mostrar la contraseña tipeada **enmascarada** en la TUI (borrador, eco del turno e historial de flechas), según los requisitos de `comando-empleado-tui` (función de enmascarado) y `autenticacion-empleado-tui` (superficies de la TUI). Los residuales que subsisten SHALL quedar documentados en el arc42 como decisión aceptada, no reportados como hallazgo de seguridad nuevo: (1) el `administrador` que tipea conoce la contraseña inicial de **otro** empleado (R9 de la propuesta); (2) un comando mal tipeado no se enmascara; (3) el eco de terminal del CLI `empleados:crear` queda fuera de alcance (ADR 33). El arc42 SHOULD tratar el procedimiento de rotación de la clave inicial como **recomendado**, no obligatorio `[SUPUESTO — pendiente de checkpoint]`. El sistema SHALL preservar íntegro el invariante de no persistencia en claro: la contraseña tipeada nunca llega a `credenciales_empleado` sin hashear, nunca a una fila de `registro_acciones_empleado`, nunca a un evento de log (ver `autenticacion-empleado-tui`).

(Previously: "El comando `/crear-empleado` SHALL tipear la contraseña como argumento de la TUI (no enmascarado, ADR 21 sin tocar). Este residual — la contraseña de **otro** empleado visible en el transcripto — SHALL quedar documentado en el arc42 como decisión aceptada (ADR 174 pto 2, R1 salida (a)), no reportado como hallazgo de seguridad nuevo. El sistema SHALL preservar íntegro el invariante de no persistencia en claro: …". Ahora la clave NO es visible en el transcripto; ADR 300 reemplaza a ADR 21 en ese punto.)

#### Scenario: Los residuales vigentes quedan documentados, no ocultos
- GIVEN el arc42 tras este change
- WHEN se busca el tratamiento de la contraseña de `/crear-empleado`
- THEN aparecen nombrados como decisión aceptada, con su ADR: el administrador conoce la clave inicial, el comando mal tipeado no se enmascara y el eco del CLI
- AND ya no aparece "contraseña visible en el transcripto" como residual aceptado

#### Scenario: La contraseña de alta no se ve en la TUI
- GIVEN un `administrador` con sesión vigente que tipea `/crear-empleado bob abc`
- WHEN la TUI dibuja el borrador y luego el eco del turno
- THEN se ve `/crear-empleado bob ***` en ambos y `abc` no aparece en ningún frame
- AND el comando recibe `abc` intacto y da de alta a `bob`
