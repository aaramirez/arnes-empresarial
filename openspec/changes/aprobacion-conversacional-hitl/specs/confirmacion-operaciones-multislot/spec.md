> Nota de proceso: mismo hook de graphify sin shell disponible. Capability nueva (proposal.md, ADR 209; design.md, ADR 212-214). El invariante estructural de turno posterior y distinto NO se relaja — se generaliza la llave, no el predicado. La `accion` se compara como condición adicional de coincidencia: un pedido con `accion` distinta sobre el mismo ítem NO confirma el pedido anterior — es el hallazgo de seguridad de esta fase (design ADR 213).

# Confirmación Operaciones Multislot Specification

## Purpose

Capability nueva. Generaliza la ranura de confirmación en dos pasos del canal conversacional de empleado —hasta este change, una por `empleadoId`— para que `cancelar_solicitud_interna`, `resolver_reembolso` y `resolver_solicitud` convivan sin pisarse. Conserva, sin relajarlo, el invariante de que una confirmación exige un turno posterior y distinto (`origenCasoId !== casoIdActual`).

**Fuera de alcance de este spec**: el mecanismo de memoria conversacional que resuelve el `casoId` de cada turno (capability `memoria-conversacional-empleado`), y el gate de rol de las operaciones que consumen esta ranura (capabilities `resolucion-hitl-conversacional` y `autorizacion-empleado`).

## Requirements

### Requirement: Una confirmación pendiente por empleado, dominio e ítem, sin cruce entre ellos

El sistema SHALL mantener una confirmación pendiente independiente por cada combinación de `empleadoId`, `dominio` (`"reembolso"` | `"solicitud"`) e ítem. Pedir confirmación sobre un ítem SHALL NOT afectar ni consumir una confirmación pendiente de otro ítem, de otro dominio, o de otro empleado.

#### Scenario: Una confirmación de reembolso no pisa una de solicitud
- GIVEN un empleado con una confirmación pendiente sobre la solicitud S1
- WHEN el mismo empleado pide confirmación de un reembolso sobre la venta V1
- THEN ambas confirmaciones quedan pendientes de forma independiente, y confirmar una no afecta el estado de la otra

#### Scenario: Dos empleados concurrentes nunca se pisan
- GIVEN los empleados E1 y E2 con confirmaciones pendientes sobre el mismo dominio e ítem
- WHEN E1 confirma la suya
- THEN la confirmación pendiente de E2 sobre ese mismo ítem sigue intacta

### Requirement: Confirmar exige la MISMA acción que fue propuesta, no sólo el mismo ítem

Una confirmación pendiente SHALL quedar asociada a la acción (`aprobar`/`rechazar`/`reabrir`/`cancelar`) con la que se propuso. Un pedido posterior sobre el mismo empleado, dominio e ítem con una acción distinta SHALL NOT coincidir con la confirmación pendiente existente: SHALL tratarse como un pedido nuevo, que reemplaza a la ranura anterior y exige su propia confirmación en un turno posterior.

#### Scenario: Confirmar con otra acción no ejecuta la acción original
- GIVEN un empleado pidió rechazar el reembolso de V1 y esa confirmación quedó pendiente
- WHEN, en un turno posterior, pide aprobar (no rechazar) el reembolso de V1
- THEN el sistema NO ejecuta ni el rechazo original ni una aprobación inmediata: trata el pedido como una intención nueva, la deja pendiente con la acción "aprobar", y exige que el empleado la confirme en un turno todavía posterior

#### Scenario: La confirmación original queda reemplazada, no acumulada
- GIVEN la secuencia del escenario anterior ya ocurrió
- WHEN se inspecciona la confirmación pendiente del empleado sobre esa venta
- THEN contiene únicamente la intención de "aprobar", y no hay una segunda intención de "rechazar" que un turno futuro pueda confirmar por error

### Requirement: El predicado de un turno posterior y distinto se conserva sin relajarse

Una confirmación pendiente SHALL exigir que el turno que la confirma tenga un `casoId` distinto del turno que la originó, sea cual sea el dominio, el ítem o la acción involucrados. El sistema SHALL NOT permitir que una misma invocación quede confirmada y aplicada en el mismo turno.

#### Scenario: El mismo turno no puede autoconfirmarse
- GIVEN un pedido de `resolver_reembolso` sin confirmación previa, en el turno de `casoId` C
- WHEN la función determinista devuelve pedido de confirmación y, en el mismo turno C, se reconsulta la ranura
- THEN la ranura no se considera confirmada — el CAS no se ejecuta

### Requirement: El logout limpia todas las ranuras pendientes del empleado

Al cerrar sesión, el sistema SHALL eliminar todas las confirmaciones pendientes del empleado, en las tres operaciones que usan esta ranura — no sólo la del último dominio invocado.

#### Scenario: Logout limpia confirmaciones de dos dominios distintos
- GIVEN un empleado con una confirmación pendiente de reembolso y otra de solicitud
- WHEN cierra sesión
- THEN ninguna de las dos sigue pendiente para ese empleado tras un nuevo login
