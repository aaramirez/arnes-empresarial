# Hito v3.20 — `enmascarar-password-en-tui`: la clave de `/login` y `/crear-empleado` deja de verse en la TUI

> **ESTADO: verificación manual (tarea 5.2) realizada el 2026-09-24.** El desarrollador ejecutó los cuatro pasos en Windows Terminal y reportó el comportamiento esperado en todos. No es hito completo hasta el Reviewer, el tag y el cierre (Fase 7).

Rama: `hito/v3.20-enmascarar-password-en-tui`. Verificación manual: 2026-09-24.

## Qué cambia

Antes, la clave tipeada en `/login` y `/crear-empleado` se veía tal cual en el borrador, el eco del turno y el historial de flechas (↑/↓) de la TUI. Ahora, `enmascararSecreto`/`contieneSecreto` (núcleo, ADR 300) tapan con `*` todo lo posterior al id en esas tres superficies; `onSubmit` sigue recibiendo el texto real. Ver [`mutaciones.md`](mutaciones.md) para la evidencia automatizada de que la máscara y la guarda del historial realmente hacen su trabajo (checks de mutación M1-M5, tarea 5.1).

## Verificación manual (tarea 5.2)

Prerrequisito: TUI real (`npm run dev`) sobre una base de datos con al menos un empleado `administrador`. Ejecutada por el desarrollador en Windows Terminal; los resultados observados son los que él reportó.

| # | Paso | Resultado esperado | Resultado observado | Captura/log |
|---|---|---|---|---|
| 1 | Tipear `/login`, borrar con backspace, enviar y apretar ↑ | El borrador se ve enmascarado mientras se tipea y al borrar; tras enviar, ↑ **no** recupera la línea con la clave (queda fuera del historial) | Como se esperaba. El eco del turno muestra `Vos: /login jimmy ****` y el sistema responde `Sesión abierta como jimmy`: el login funciona igual que antes | [`captura-login-enmascarado.png`](captura-login-enmascarado.png) |
| 2 | Repetir con `/crear-empleado`, logueado como `administrador` | Mismo comportamiento que el paso 1: borrador enmascarado, clave fuera del historial de flechas | Como se esperaba. En la captura, `> /crear-empleado 1234` se ve sin `*` porque `1234` ocupa la posición de `<empleadoId>` (uso: `/crear-empleado <empleadoId> <password>`); sólo la clave, que va después del id, se enmascara | [`captura-login-enmascarado.png`](captura-login-enmascarado.png) (borrador con el id); resto reportado por el desarrollador |
| 3 | Tipear `/logni ana secreto` (typo deliberado) | La clave se ve **visible**, sin enmascarar — residual **R2** aceptado: el typo no matchea el nombre exacto del comando, igual que hace `parsearComando` | Como se esperaba (residual R2 confirmado) | Reportado por el desarrollador |
| 4 | **R10 / H1**, fuera de alcance — tipear una clave mientras un turno está `pending` (`"Pensando..."` en pantalla) | Documentar únicamente qué eco hace la tty: con el turno pendiente, `useInput` corre con `isActive: false` e Ink apaga el raw mode (`App.tsx:709`), así que lo tipeado en ese lapso lo ecoa la terminal **por fuera de Ink**, sin máscara. No se corrige en este change | Como se esperaba (residual R10 confirmado, sigue fuera de alcance) | Reportado por el desarrollador |

*Aceptación de 5.2 (tasks.md)*: los cuatro pasos documentados con evidencia; el login funciona igual que antes.

## Residuales declarados (design.md §8)

| # | Residual | Estado |
|---|---|---|
| **R2** | Un typo (`/logni`, `/Login`) o un tab como separador deja la clave visible. Es la misma normalización que usa el parser, que tampoco lo trata como `/login`. Cubierto por los tests U3/T7 (nacen verdes, declarado) | Aceptado |
| **R7** | El CLI `empleados.ts` hace eco de la clave (fuera de alcance de este change, ADR 33) | Aceptado, fuera de alcance |
| **R9** | El administrador conoce la clave inicial que tipeó al crear el empleado. Por eso la rotación por CLI pasa de **obligatoria** a **recomendada** (ver nota de reemplazo en `openspec/changes/comandos-administracion-empleados/design.md`, tarea 5.3) | Aceptado |
| **R10** | Durante un turno pendiente, el raw mode está apagado y la tty hace eco de lo que se tipea (H1). Cerrarlo exige cambiar una decisión documentada del módulo (`isActive` siempre en `true`) y el comportamiento del tecleo anticipado; queda fuera de alcance de este change. Se verifica a mano en el paso 4 de la tabla de arriba | Aceptado, fuera de alcance |

## Evidencia automatizada ya disponible

- Unitarios del helper: `src/core/commands/comando-empleado.test.ts`, `describe("enmascararSecreto y contieneSecreto (ADR 300, spec comando-empleado-tui)")` (U1-U7).
- UI: `src/adapters/tui/App.test.tsx`, `describe("secret masking (ADR 300)")` (T1-T8, T5b).
- Mutación (tarea 5.1): [`mutaciones.md`](mutaciones.md) — M1-M5, con salida roja y verde de cada una.

## Enlaces

- Propuesta: [`../../../openspec/changes/enmascarar-password-en-tui/proposal.md`](../../../openspec/changes/enmascarar-password-en-tui/proposal.md)
- Diseño (ADR 300, residuales R1-R14): [`../../../openspec/changes/enmascarar-password-en-tui/design.md`](../../../openspec/changes/enmascarar-password-en-tui/design.md)
- Tareas: [`../../../openspec/changes/enmascarar-password-en-tui/tasks.md`](../../../openspec/changes/enmascarar-password-en-tui/tasks.md)
- Specs: [`comando-empleado-tui`](../../../openspec/changes/enmascarar-password-en-tui/specs/comando-empleado-tui/spec.md), [`autenticacion-empleado-tui`](../../../openspec/changes/enmascarar-password-en-tui/specs/autenticacion-empleado-tui/spec.md), [`administracion-empleados-tui`](../../../openspec/changes/enmascarar-password-en-tui/specs/administracion-empleados-tui/spec.md)
- Mutación: [`mutaciones.md`](mutaciones.md)
