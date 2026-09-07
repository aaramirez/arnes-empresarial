> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `despacho-delegacion/spec.md`. Este spec se apoya en `proposal.md` (ADR 42, 46) y en `src/core/ventas/ventas-contract.ts` (líneas 44-68) y `src/core/ventas/resolver-escalacion-reembolso.ts` como código real verificado. No hay spec previa de este módulo (`hitl-contract.ts` no existe todavía) — es un spec completo, no una delta.

# HITL Genérico Specification

## Purpose

Capability nueva. Cubre ADR 42: el vocabulario compartido y la forma genérica del resultado de una resolución con humano-en-el-loop (HITL), que hasta este hito vivía exclusivamente en `src/core/ventas/ventas-contract.ts` con un único dueño semántico (ventas). Este hito le da un segundo dueño (solicitud interna, capability `solicitud-interna-hitl`) y mueve **solo** lo que efectivamente pasó a tener dos dueños: las dos constantes de estado de `caso` y la forma genérica del desenlace de una resolución.

**Fuera de alcance de este spec**: generalizar `resolverEscalacionReembolso` a un resolvedor de aprobaciones genérico — el reembolso conserva su `VentaStorePort` y sus tres acciones (aprobar/rechazar/reabrir) sin cambios de comportamiento; cualquier lógica de negocio de solicitud interna (capability `solicitud-interna-hitl`); reembolsos/R3/ADR 11 (cerrado por `v1.4.0`, no es parte de este hito).

## Requirements

### Requirement: `hitl-contract.ts` es un módulo de núcleo sin imports

`src/core/hitl/hitl-contract.ts` SHALL declarar `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`, `CASO_ESTADO_RESUELTO`, y el tipo genérico parametrizado del desenlace de una resolución HITL (la unión `listado | requiere_confirmacion | aplicada | no_aplicable`). Este módulo SHALL NOT importar ningún otro módulo de `src/core/`, de `src/adapters/*`, del SDK ni de Node — mismo criterio que `knowledge-contract.ts`, `activity-contract.ts` y `ventas-contract.ts`.

#### Scenario: `hitl-contract.ts` no tiene imports
- GIVEN el archivo `src/core/hitl/hitl-contract.ts`
- WHEN se inspeccionan sus declaraciones `import`
- THEN no existe ninguna

### Requirement: `ventas-contract.ts` re-exporta sin duplicar ni romper call sites

`ventas-contract.ts` SHALL re-exportar `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` y `CASO_ESTADO_RESUELTO` desde `hitl-contract.ts` (`export ... from`), sin volver a declarar sus valores literales. Ningún call site existente que importe estas constantes desde `ventas-contract.ts` SHALL requerir cambios.

#### Scenario: Los call sites de v1.4 siguen compilando sin tocarse
- GIVEN código existente que importa `CASO_ESTADO_RESUELTO` desde `src/core/ventas/ventas-contract.ts`
- WHEN se compila el proyecto tras este hito
- THEN ese import sigue resolviendo al mismo valor de string (`"resuelto"`)
- AND ningún test de `v1.4.0` requirió modificación para lograrlo

#### Scenario: No hay dos declaraciones del mismo valor
- GIVEN `hitl-contract.ts` declara `CASO_ESTADO_RESUELTO`
- WHEN se inspecciona `ventas-contract.ts`
- THEN no existe una segunda declaración literal de `"resuelto"` — solo un re-export

### Requirement: El comentario de `ventas-contract.ts` se actualiza para decir que la mudanza ya ocurrió

El comentario que prometía "cuando Hito 5 generalice el HITL, se muda" SHALL reescribirse para indicar dónde viven ahora las constantes y por qué se re-exportan, sin dejar una promesa pendiente sin resolver (ADR 46).

#### Scenario: El comentario ya no promete una mudanza futura
- GIVEN el bloque de comentario sobre `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA` en `ventas-contract.ts`
- WHEN se lee tras este hito
- THEN el texto describe la mudanza ya realizada hacia `hitl-contract.ts`, no una mudanza futura

### Requirement: `resolverEscalacionReembolso` no se generaliza

El caso de uso de resolución de escalación de reembolso SHALL conservar su acoplamiento a `VentaStorePort`, `EscalacionListada` y `VentaEstado` sin cambios de comportamiento. El sistema SHALL NOT introducir un puerto o resolvedor genérico que unifique reembolso y solicitud interna en este hito.

#### Scenario: `resolver-escalacion-reembolso.ts` no cambia de firma
- GIVEN la función `resolverEscalacionReembolso` tal como existe en `v1.4.0`
- WHEN se revisa tras este hito
- THEN su firma y su dependencia de `VentaStorePort` son idénticas
