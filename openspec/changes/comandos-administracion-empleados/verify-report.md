# Reporte de verificacion -- comandos-administracion-empleados

Rol: Reviewer (AGENTS.md) -- Skills: sdd-verify + code-review
Alcance: tareas 1-11 (commits eec7ecb..9462ffa). Tarea 12 fuera de alcance (parcial, sin commitear, verificacion manual pendiente del humano).
Fecha: 2026-09-13 -- Rama: hito/v3.7-comandos-administracion-empleados

## Veredicto: APROBADO

Sin hallazgos bloqueantes. Dos desviaciones documentadas evaluadas (ninguna requiere volver al Spec Author) y una observacion menor nueva, no bloqueante.

---

## 1. Evidencia de ejecucion

| Comando | Resultado |
|---|---|
| npm run typecheck (tsc --noEmit) | Verde, sin errores |
| npm test (vitest run, dist limpiado antes de correr) | Verde -- 128 test files passed, 1 skipped (129); 2266 tests passed, 3 skipped (2269) |
| git diff --stat main -- src/core/auth/sesion.ts | Vacio -- confirma invariante ADR 154 pto 2 |
| git diff --stat main -- src/core/auth/rol-contract.ts | 11 insertions(+), 0 deletions -- solo interfaz nueva, RolEmpleadoPort intacto |
| git diff --stat main -- src/adapters/memory/migrations/ | Vacio -- cero migraciones nuevas |
| git diff --stat main -- src/adapters/webhooks/ src/adapters/board/ src/core/config/env.ts | Vacio -- diferido ADR 178 respetado |
| git diff --stat main -- src/main.ts | Vacio -- confirma hallazgo de design.md parrafo 1 (composition root no se toca) |
| git diff --stat main -- package.json | Vacio -- sin dependencias nuevas |
| git diff --stat main..HEAD (total) | 17 archivos, 1646(+)/34(-) -- consistente con el forecast de tasks.md (~790 lineas de producto+test) |

## 2. Puntos de atencion explicitos -- verificados contra codigo real

1. Orden del gate de rol (src/build-on-comando-empleado.ts:1884-1909): paso 6 (guarda de sesion, sin cambios) corre primero; paso "6.5" (requiereAdministrador + esAdministrador) corre despues y antes del switch (paso 7, :1912). Confirmado por lectura directa y por comentario en el propio codigo que documenta el orden. Cumple.
2. Prohibicion de auto-degradacion (manejarAsignarRol, :1814): if (comando.empleadoId === empleadoIdActor && rol !== ROL_ADMINISTRADOR). Chequeo directo, sin ningun SELECT COUNT ni operacion de conteo. Cumple ADR 182.
3. Invariante de contrasena en /crear-empleado: AccionEmpleado (registro-acciones-contract.ts:56-72) no tiene estructuralmente ningun campo donde podria filtrarse la contrasena (comentario explicito en el propio archivo: "LO QUE ESTE TIPO NO TIENE... password..."). manejarCrearEmpleado solo pasa {comando, resultado} a registrar() (:1842), nunca comando.password. Test dedicado (build-on-comando-empleado.test.ts:3202) verifica ausencia completa/prefijo en filas de auditoria y eventos de log, con dos caminos de codigo (alta + duplicado). Cumple.
4. case nuevo en el mismo commit que el brazo de tipo: verificado con git show <hash> --stat de tareas 3 (fbd70ca), 7 (f15f818), 8 (99ce203) -- cada una toca comando-empleado.ts y build-on-comando-empleado.ts en el mismo commit. El switch (comando.tipo) (:1912-1955) es exhaustivo y compila (npm run typecheck verde). Cumple.
5. DESCRIPTORES en dieciocho entradas: confirmado por grep (nombre: x18, excluyendo la declaracion de interfaz) y por el test expect(COMANDOS).toHaveLength(18) (comando-empleado.test.ts:481,597,747). Los tres nuevos (/estado-bot-prs, /asignar-rol, /crear-empleado) estan inmediatamente antes de /ayuda, que sigue ultimo. Cumple.
6. src/core/auth/sesion.ts intacto: git diff vacio (tabla arriba). Sin migraciones nuevas, sin CREATE TABLE. ROLES_EMPLEADO sigue con exactamente dos miembros (rol-contract.ts:7). Cumple.
7. /estado-bot-prs nunca revela secretos: manejarEstadoBotPrs() (:1777-1784) solo emite booleans/puerto/path via isWebhookEnabled/isBoardEnabled, nunca webhook.secret ni el valor de GITHUB_TOKEN. Cubierto por test dedicado en la suite de la tarea 3. Cumple.

## 3. TDD estricto -- cobertura roja-verde por tarea

Verificado el conjunto final de tests contra lo prometido por tasks.md para cada tarea (no se reconstruyo el historial commit a commit, segun alcance dado):

| Tarea | Logica de negocio | Cobertura verificada |
|---|---|---|
| 1 | altaCredencialEmpleado | empleados.test.ts: alta exitosa, empleadoId invalido, password vacia, duplicado, no-regresion de main() |
| 2 | requiereAdministrador scaffolding | comando-empleado.test.ts:741-774: 15+1 descriptores false, tipo inexistente false |
| 3 | /estado-bot-prs + fix de ruteo | Suite dedicada :2126 -- incluye el test que blinda el bug de sin_argumentos ({tipo: descriptor.tipo} en vez de {tipo:"logout"} hardcodeado, comando-empleado.ts:501-508) |
| 5 | esAdministrador + gate | autorizacion-resolucion.test.ts:38-48 (tres casos) + gate probado con mock de requiereAdministrador sobre tipo existente (nota de ejecucion documentada y verificada) |
| 6 | RolEmpleadoEscritorPort + createRolEmpleadoEscritor | rol-contract.test.ts:46 (forma) + wiring exportado y testeado contra SQLite real |
| 7 | /asignar-rol | Suite :2865-3079: ascenso exitoso, sin credencial, rol base rechazado, auto-degradacion (unico admin), dos admins sin restriccion |
| 8 | /crear-empleado | Suite :3080-3223: alta exitosa, duplicado, rol base rechazado, invariante de contrasena extendido |
| 10 | Success Criteria de cierre | comandos-administracion-empleados-invariantes.integration.test.ts (commit fe05cdf, tarea 10 -- no confundir con el test de flujo E2E de la tarea 12, que es un archivo distinto y no esta commiteado) |

Todo el conjunto corre en verde (npm test).

## 4. Desviaciones documentadas -- juicio

(a) RolEmpleadoEscritorPort con createRolEmpleadoEscritor(db) exportada, en vez del literal inline que sugeria design.md.
Aceptable tal cual quedo, sin volver al Spec Author. El propio design.md seccion 2 (ADR 180) fija el contrato observable (RolEmpleadoEscritorPort, co-ubicado en rol-contract.ts, delegando en upsertRolEmpleado sin cambiar su firma) -- eso es lo que importa y esta intacto. La extraccion a funcion exportada es un detalle de implementacion motivado por una exigencia real (TDD estricto pide test contra db real antes de que exista consumidor en la tarea 6), sigue un molde ya establecido en el mismo archivo (createSolicitudStore), y el wiring (deps.rolEscritor ?? createRolEmpleadoEscritor(db)) es la misma costura opcional de un renglon que el diseno pedia. No hay superficie de contrato nueva ni cambio de comportamiento observable.

(b) Orden /asignar-rol antes que /crear-empleado en DESCRIPTORES, invertido respecto a la tabla de design.md seccion 6 / ADR-184.
Aceptable, con nota -- no bloqueante. El unico invariante de orden que la spec (comando-empleado-tui/spec.md, requirement MODIFIED) y el Success Criterion de proposal.md:303 exigen es: (i) los quince descriptores heredados no cambian de posicion, y (ii) la tanda nueva se inserta inmediatamente antes de /ayuda. Ninguno de los dos exige un orden relativo especifico entre los tres comandos nuevos entre si. Verificado: los 15 heredados estan intactos y los tres nuevos estan antes de /ayuda (seccion 2, punto 5, arriba). Es una divergencia cosmetica respecto de la tabla del diseno, sin efecto en comportamiento, tests ni auditoria -- no requiere volver al Spec Author, pero se deja registrada aca para que docs/progreso/ no la pierda de vista si algun test futuro asume el orden de la tabla original.

## 5. Hallazgos no bloqueantes

WARNING (menor, nuevo, no senalado por el proceso previo): design.md seccion 6 (ADR 184) afirma que ID_REGEX se aplica al empleadoId en los dos comandos (/asignar-rol y /crear-empleado). En el codigo, /crear-empleado si aplica ID_REGEX explicitamente (via altaCredencialEmpleado, empleados.ts:174). /asignar-rol no llama a ID_REGEX de forma explicita -- el rechazo de un empleadoId con formato invalido ocurre indirectamente porque buscarCredencial nunca encuentra una fila para un id mal formado (ninguna credencial real puede tener un id que no paso ID_REGEX al crearse), cayendo en el mensaje "No existe el empleado". El efecto observable converge (ambos casos se rechazan), pero el mensaje de error es distinto al que produciria una validacion de forma explicita, y el comentario del propio design.md queda tecnicamente impreciso. No afecta ningun Success Criterion ni ningun escenario de spec (ninguno especifica el mensaje exacto para un empleadoId malformado en /asignar-rol). No bloqueante -- sugerido para una futura pasada de pulido, no para esta ronda.

## 6. Conclusion

Las tareas 1-11 cumplen especificacion, diseno y tareas, con las dos desviaciones documentadas evaluadas como aceptables sin reapertura de sdd-design. npm test y npm run typecheck en verde sobre el estado actual de la rama. Los invariantes de seguridad mas criticos del change (gate de rol, prohibicion de auto-degradacion, no persistencia de contrasena en claro, no exposicion de secretos por /estado-bot-prs) estan verificados tanto por lectura de codigo como por test que pasa en runtime.

Aprobado para avanzar. La tarea 12 (verificacion manual del entregable end-to-end, captura de TUI interactiva, prueba de rollback real) queda pendiente del humano, fuera del alcance de esta ronda de verificacion, y es prerrequisito para el checklist de cierre de hito de AGENTS.md antes del commit final, el tag y docs/progreso/.
