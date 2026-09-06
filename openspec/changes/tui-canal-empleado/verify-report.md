# Verification Report - tui-canal-empleado (v1.4.0)

Verificacion holistica de las 17 tareas de tasks.md (Work Unit 1: tareas 1-12; Work Unit 2: tareas 13-17), corrida sobre hito/v1.4-tui-canal-empleado con el arbol de trabajo tal como esta committeado (commits b48709f..f7b7229). Se contrasto linea por linea proposal.md (ADR 21-33), design.md (ADR 34-41 + secciones 3-11) y los 7 archivos de specs/ contra la implementacion real en src/, y se ejecutaron los comandos de verificacion en esta sesion (no se confia en el reporte de tasks.md sin repetir la evidencia).

## Comandos ejecutados en esta sesion

    rm -rf dist && npx tsc --noEmit

-> PASS, sin salida (0 errores de tipos).

    npx vitest run

-> PASS - 72 archivos de test, 954 tests, 0 fallos. (Se limpio dist/ antes de correr para evitar el doble conteo de Vitest documentado en memoria del proyecto: build-then-test sin limpiar infla el conteo reportado.)

Ambos numeros coinciden exactamente con lo que tasks.md reporta al cierre de la Fase 7 (0 errores / 954 tests verdes, 72 archivos): confirmado por ejecucion real, no por confianza en el reporte.

## Completitud de tareas (tasks.md)

Las 17 tareas estan marcadas [x]. Se verifico que cada una tiene commit propio en el historial (b48709f migraciones 1-2, a98deb8 tarea 3, 30316f0 tarea 4, e1b3267 tarea 5, f2de36b tarea 6, 4f45036 tarea 7, 5ca9229 tarea 8, 84b0ace tarea 9, 1c9b923 tarea 10, 606184b tarea 11, de63d0e tarea 12, 2328196 tarea 13, 5b622cd tarea 14, 2daac38 tarea 15, 36e09d1 tarea 16, 82c9c7c tarea 17) y que el codigo de cada tarea existe y compila. 17/17 completas, coincidencia codigo-checklist confirmada.

## Matriz de cumplimiento de specs

### autenticacion-empleado-tui (7 requisitos)
| Requisito | Evidencia | Estado |
|---|---|---|
| Alta de credencial por CLI, stdin, sal aleatoria | src/empleados.ts (leerPasswordDeStdin sobre stderr/stdin, nunca argv) + insertCredencialEmpleado (repository.ts:1549) | PASS, test repository.test.ts:1827 |
| Rotacion por CLI | updateCredencialEmpleado (repository.ts:1578), created_at intacto | PASS, test repository.test.ts:1875 |
| Verificacion en /login, respuesta indistinguible | resolverLogin (login.ts:54-82): mismo resultado invalida para inexistente y password incorrecta | PASS, test login.test.ts (9 casos) + build-on-comando-empleado.test.ts:250 |
| resolverLogin puro/sincrono, password no sale de verificarPassword | Confirmado leyendo el cuerpo: password solo aparece como argumento de verificarPassword | PASS, test login.test.ts:120,133 |
| Password/texto crudo nunca persiste ni loguea | manejarLogin solo registra comando+resultado, nunca password ni segundo argumento | PASS, test build-on-comando-empleado.test.ts:268 (fuga de secretos) |
| Vigencia/expiracion por TTL absoluto | sesionVigente/calcularExpiraEn (sesion.ts:31-51), resolveAuthConfig (auth-config.ts:28-46) | PASS, tests sesion.test.ts, auth-config.test.ts |
| /logout sin efecto de dominio, privilegiados exigen sesion | manejarLogout (dispatcher:246-255) sin registrar(); preambulo paso 6 (dispatcher:423-426) | PASS, test build-on-comando-empleado.test.ts:196,338 |

### comando-empleado-tui (3 requisitos)
| Requisito | Evidencia | Estado |
|---|---|---|
| Texto sin / delega intacto | parsearComando retorna undefined; dispatcher linea 415-417 delega onSubmit(texto, onAgentResolved) sin tocar | PASS, test build-on-comando-empleado.test.ts:136 |
| Reconocimiento y ruteo de los comandos | parsearComando (comando-empleado.ts) + switch del dispatcher (lineas 429-446) cubre los 8 tipos | PASS, test comando-empleado.test.ts |
| Desconocido/argumentos faltantes -> ayuda, sin efecto | ayudaDesconocido/ayudaArgumentos -> manejarAyuda (dispatcher:384-395), cero llamadas a store/registro | PASS, test build-on-comando-empleado.test.ts:152,169,182 |

### reembolso-evaluacion (delta: 2 modified + 2 added + 1 removed)
Todos verificados contra procesar-devolucion.ts: DevolucionResult ensanchado con ventaId y casoId opcionales sin tocar secuencia/guardas/efectos (diff es literalmente en los return), esquema de ventas sin cambios (solo un valor de texto adicional en columna abierta), invocador-agnostico confirmado estructuralmente (mismo procesarDevolucion para HTTP y TUI, sin branch sobre transporte). PASS, tests existentes ampliados en procesar-devolucion.test.ts siguen verdes.

### reembolso-resolucion-escalacion (8 requisitos)
Verificado contra resolver-escalacion-reembolso.ts + manejarEscalacion (dispatcher) + los 3 CAS transaccionales de repository.ts. Los puntos mas sensibles - atadura de la confirmacion a empleadoId de sesion (dispatcher:329, ConfirmacionPendiente.empleadoId), atomicidad fila+transicion (resolverEscalacionTransaccional, repository.ts:1395-1447), reembolsada terminal sin excepcion, sin tope de reaperturas - estan todos presentes y testeados: repository.test.ts:1718 (terminal), repository.test.ts:1783 (ciclo completo 4 filas), build-on-comando-empleado.test.ts:307-461 (confirmacion en dos pasos, 8 escenarios de borde incluida confirmacion cruzada y accion cruzada). PASS.

### registro-acciones-empleado (6 requisitos)
empleado_id NOT NULL y siempre de sesion.empleadoId: invariante estructural verificado en 3 firmas (registrar(), ResolucionEscalacionInput.empleadoId, AccionEmpleado.empleadoId): ninguna funcion del change acepta un empleadoId tipeado por el usuario. Vocabulario por comando, nullability de venta_id/caso_id, atomicidad transaccional vs. post-hoc, ausencia de token/password/consulta/motivo en toda fila, y el ciclo de 4 filas: todos verificados contra codigo y tests (repository.test.ts:1764 prueba explicita de ausencia de datos sensibles; repository.test.ts:1783 ciclo completo). PASS.

### reporte-comisiones-mensual (delta: 2 added)
NOTA_ESCALACION_FUERA_DE_BANDA (reporte.ts:170-171) actualizada: menciona los 3 comandos de resolucion, la salvedad de TUI local + login, NO dice SQL manual, NO dice irreversible, NO dice identidad-por-configuracion. ventasConReembolso cuenta solo REEMBOLSADA/REEMBOLSO_PENDIENTE (reporte.ts:126), excluyendo explicitamente REEMBOLSO_RECHAZADO. PASS, test dedicado reporte.test.ts:147.

### soporte-web-turno (delta: 1 added)
onSoporte se arma una sola vez en main.ts:344 y se comparte entre startWebServer y buildOnComandoEmpleado - createKnowledge no se duplica, buildOnSoporte no se modifica. PASS.

## Coherencia con design.md (ADR 34-41)

| ADR | Verificado contra | Estado |
|---|---|---|
| 34 (parser de 3 formas, ayuda como sumidero) | comando-empleado.ts - Forma = 3 valores, sin rama de error, motivo distingue solicitada/desconocido/argumentos | Coincide exacto |
| 35 (scrypt N=16384/r=8/p=1, guarda maxmem, chequeo de longitud antes de timingSafeEqual) | password.ts - constantes exactas, guarda 128*n*r > SCRYPT_MAX_MEM_BYTES, orden de checks identico al diseno | Coincide exacto |
| 36 (dos ranuras, orden fijo, TTL propio de confirmacion = 2 min) | build-on-comando-empleado.ts - sesion/confirmacionPendiente, CONFIRMACION_TTL_MINUTOS = 2, preambulo en el orden documentado | Coincide exacto |
| 37 (SesionEmpleado, no empleadoId string, en casos de uso privilegiados) | resolverEscalacionReembolso y registrar() reciben sesion y toman sesion.empleadoId adentro | Coincide exacto |
| 38 (listEscalacionesReembolso con filtro opcional por id, no buscarVentaPorId) | repository.ts:1252-1301 - un solo lector, estado obligatorio, filtro ventaId opcional | Coincide exacto, test del bug de la fila 21/25 presente |
| 39 (id de fila lo genera el nucleo, viaja como accionId) | resolver-escalacion-reembolso.ts:148 (accionId: newId()), nunca randomUUID() en repository.ts | Coincide exacto |
| 40 (fila no transaccional no tumba el comando; transaccional si propaga) | registrar() con try/catch -> evento accion-empleado-registro-fallido; los 3 CAS dejan que db.transaction revierta si updateCaso lanza | Coincide exacto, test build-on-comando-empleado.test.ts:463 |
| 41 (createVentaStore se amplia, dispatcher lo reusa) | build-on-venta.ts:159-238 - 5 closures nuevos agregados, buildOnVenta sin cambios | Coincide exacto |

Wiring de main.ts (seccion 8, 5 cambios): los 5 puntos verificados literalmente contra el archivo - resolveAuthConfig junto a resolveVentasConfig, onSubmit intacto, onSoporte compartido, bloque buildOnComandoEmpleado, mount startTui(onComandoEmpleado). Coincide exacto.

## Desviaciones aceptadas (pre-investigadas, no relitigadas)

1. password.ts - comentario de diseno inexacto sobre hash truncado. design.md (ADR 35 punto 4) afirma que un hash truncado falla la comparacion; se verifico en password.test.ts:75-94 que el test real fue ajustado al invariante correcto (scryptSync es prefijo-consistente con PBKDF2 interno; no se lanza RangeError, y una contrasena incorrecta sigue dando false). El comentario del test documenta explicitamente por que no se afirma sobre la contrasena correcta. Confirmado tal como fue reportado, sin hallazgos nuevos.
2. /soporte - fila fallida nunca se escribe en el fallo. Confirmado por busqueda: RESULTADO_FALLIDA esta definido en registro-acciones-contract.ts:18 y testeado solo por su valor literal (registro-acciones-contract.test.ts:41), pero ningun camino de build-on-comando-empleado.ts lo escribe: el catch de manejarSoporte (lineas 269-275) solo emite el evento comando-soporte-fallido, nunca registrar(). Esto coincide con lo declarado: el onSoporte inyectado no expone un casoId en su rechazo, asi que el hueco de auditoria que design.md seccion 6.4-3 nota solo para el caso falla antes de createCaso se realiza en realidad en todo fallo de soporte. Confirmado tal como fue reportado, sin hallazgos nuevos, y sigue siendo un hueco de auditoria menor y ya reconocido por el propio diseno (R10), no una regresion de seguridad (no hay dinero ni PII involucrados en /soporte).

## Issues

### CRITICAL
Ninguno encontrado.

### WARNING
1. Inconsistencia de redaccion en specs/comando-empleado-tui/spec.md: el titulo Reconocimiento y ruteo de los siete comandos y el escenario /ayuda lista los siete comandos disponibles subcuentan por uno: el SHALL del mismo requisito lista los ocho prefijos (incluido /ayuda), design.md dice consistentemente ocho comandos en todo el documento, y el propio test de la implementacion lo deja explicito: comando-empleado.test.ts:147, lista los ocho descriptores (siete comandos + ayuda). La implementacion, el diseno y los tests estan alineados entre si (8 descriptores); es el artefacto de spec el que quedo con una cuenta vieja. No bloquea el archivo del change (no hay ambiguedad de comportamiento, solo un desprolijo de conteo en el texto), pero conviene corregir spec.md antes de archivar para que el artefacto de referencia futura no contradiga al codigo que dice verificar.

### SUGGESTION
1. tasks.md - el campo Chain strategy: pending de la tabla Review Workload Forecast quedo sin actualizar aunque el resto del documento (las dos notas de Estado, Work Unit 1 y 2) deja claro que se uso feature-branch-chain en la practica. Cosmetico, cero impacto funcional; se menciona porque es la unica fila de esa tabla que no se resolvio por escrito.
2. El hueco de auditoria de /soporte (desviacion 2 arriba) es candidato natural a cerrarse si SoporteResult o el tipo de rechazo de onSoporte alguna vez expone un casoId parcial. No se pide aca, solo se deja anotado para quien retome R10 en un hito futuro.

## Veredicto

PASS WITH WARNINGS - 0 CRITICAL, 1 WARNING (cosmetico, en un artefacto de spec, no en el codigo), 2 SUGGESTION. Implementacion, diseno y specs estan alineados; npm run typecheck y npx vitest run confirmados en verde por ejecucion real en esta sesion (954/954 tests, 0 errores de tipos). Las dos desviaciones previamente investigadas y aceptadas se re-verificaron y no presentan hallazgos nuevos. Recomendado: corregir la redaccion siete/ocho en specs/comando-empleado-tui/spec.md (trivial) y proceder a sdd-archive.
