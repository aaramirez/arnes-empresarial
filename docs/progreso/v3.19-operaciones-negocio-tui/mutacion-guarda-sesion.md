# Check de mutacion M1 — guarda `sesionVigente` del texto libre (tarea 6.1)

Excepcion TDD declarada en `tasks.md`: los tests de 1.2 (U1, U2-ruteo, U3-ruteo, U4, U9) y el de integracion 5.2 nacieron verdes, asi que su valor se prueba por mutacion. Fecha: 2026-09-23. Rama `hito/v3.19-operaciones-negocio-tui`. Invariante 7 (ADR 297): el texto libre llega a `onOperaciones` **solo** con `operacionesTui` inyectada **y** sesion vigente.

## Procedimiento

1. Copia de respaldo de `src/build-on-comando-empleado.ts` fuera del repo (sin `git checkout`/`restore`/`stash`: la tarea 2.2 estaba sin commitear y una restauracion con git la habria destruido). `sha256` del original: `ccb31b0188e67075a03dd8c02dff871f5021647c624aa40608d800f4375417df`.
2. Linea de base con el codigo original: `rm -rf dist && npm test` -> **162 archivos passed | 2 skipped (164); 3252 passed | 5 skipped**.
3. Mutacion (una sola linea, `build-on-comando-empleado.ts:1505`, paso 3-4 del handler):

```diff
-      if (operacionesTui !== undefined && sesionVigente(sesionTurno, ahora)) {
+      if (operacionesTui !== undefined) {
```

4. `npm test` con la mutacion aplicada (salida roja, abajo).
5. Restauracion copiando el respaldo sobre el archivo: `cmp` = identico, mismo `sha256`, `git diff --stat -- src/build-on-comando-empleado.ts` igual al de antes de mutar (26 inserciones, la tarea 2.2 sin commitear) y `npm test` en verde (salida verde, abajo).

## Salida roja (con la mutacion)

Comando: `npm test`

```
Test Files  2 failed | 160 passed | 2 skipped (164)
     Tests  7 failed | 3245 passed | 5 skipped (3257)

 × U1: sin sesión, onOperaciones no se llama y onSubmit recibe (texto, onAgentResolved) idénticos
 × U2 (ruteo): con la sesión vencida el texto cae a onSubmit intacto y onOperaciones no se llama
 × U3 (ruteo): tras /logout el texto cae a onSubmit intacto y onOperaciones no se llama
 × U2 (limpieza, L1): al vencer la sesión tras un turno se limpia la confirmación de ana y se elimina K1 ANTES de despachar, ...
 × U8 (H3): un /login fallido con sesión vigente limpia la sesión saliente ANTES de resolver el login y el texto siguiente va a onSubmit
 × it 1 — sin login, el texto libre va a onSubmit y la tool de operaciones NO se invoca            (integracion 5.1)
 × it 3 — tras /logout el texto libre vuelve a onSubmit y la tool NO se invoca (invariante 3)      (integracion 5.2)

TypeError: Cannot read properties of undefined (reading 'empleadoId')      <- en los 7 fallos
```

Los tres tests nombrados por la tarea **fallan**: U1, U3-ruteo y el `it` 3 de 5.2. Tambien fallan U2-ruteo, U2-limpieza, U8 y el `it` 1 de 5.1 (mas cobertura de la esperada, no menos).

Observacion: el fallo llega como `TypeError` y no como una asercion sobre `onOperaciones`. Sin la guarda, el dispatcher entra a `manejarTextoLibreAutenticado` con `sesionTurno === undefined` (el `as SesionEmpleado` de la llamada solo silencia el tipo) y revienta al leer `empleadoId`. Es una deteccion real (el test falla y `onOperaciones` no llega a ejecutarse con una identidad falsa), pero por un camino accidental; una mutacion que ademas fabricara una sesion no la detendria ese `TypeError`, y en ese caso las aserciones "`onOperaciones` no se llama" de U1/U2/U3 seguirian atrapandola.

## Salida verde (codigo restaurado)

Comando: `npm test`

```
Test Files  162 passed | 2 skipped (164)
     Tests  3252 passed | 5 skipped (3257)
```

Resultado: la mutacion es atrapada; sin ella la suite completa esta en verde y `src/build-on-comando-empleado.ts` quedo byte a byte igual a como estaba antes de mutar.
