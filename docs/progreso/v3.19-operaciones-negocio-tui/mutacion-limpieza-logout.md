# Check de mutacion M2 — limpieza L2 en `/logout` (tarea 6.2)

Excepcion TDD declarada en `tasks.md`. Fecha: 2026-09-23. Rama `hito/v3.19-operaciones-negocio-tui`. ADR 298: al cerrar sesion se limpian la confirmacion pendiente (`limpiarEmpleado`) y la conversacion (`eliminar(K1)`); el store de la TUI no tiene TTL (R8), asi que sin esta limpieza el estado quedaria colgado.

## Procedimiento

1. Mismo respaldo y misma linea de base que M1 (`sha256` original `ccb31b0188e67075a03dd8c02dff871f5021647c624aa40608d800f4375417df`; `npm test` = 162 archivos passed | 2 skipped, 3252 passed | 5 skipped). Sin `git checkout`/`restore`/`stash`: la tarea 2.2 seguia sin commitear.
2. Mutacion: quitar la llamada **L2** de `manejarLogout` (`build-on-comando-empleado.ts:851`). Las otras tres (L1, L3, L4) quedan intactas.

```diff
     sesion = undefined;
     confirmacionPendiente = undefined;
-    cerrarEstadoOperaciones(empleadoId); // L2 (ADR 298)
     logEvent(COMANDO_LOG_CORRELATION_ID, "logout", { empleadoId });
```

3. `npm test` con la mutacion (salida roja, abajo).
4. Restauracion copiando el respaldo: `cmp` = identico, mismo `sha256`, `rg -c "cerrarEstadoOperaciones\("` = 5 (definicion + 4 llamadas), `git diff --stat` igual al de antes de mutar, y `npm test` en verde.

## Salida roja (con la mutacion)

Comando: `npm test`

```
Test Files  1 failed | 161 passed | 2 skipped (164)
     Tests  1 failed | 3251 passed | 5 skipped (3257)

 × U3 (limpieza, L2): /logout llama limpiarEmpleado('ana') y luego eliminar(K1), sin escribir en el registro de acciones

AssertionError: expected [] to deeply equal [ 'limpiarEmpleado:ana', 'eliminar:id-2' ]
  src/build-on-comando-empleado.test.ts:3040
  expect(banco.operaciones.orden).toEqual(["limpiarEmpleado:ana", `e…
```

Falla exactamente el test nombrado por la tarea (U3-limpieza) y **solo ese**: el `/logout` ya no llama a ninguno de los dos metodos de limpieza.

Observacion: el `it` 4 de 5.2 (una confirmacion marcada antes del `/logout` no sobrevive a un re-login) **sigue verde** con esta mutacion, y es lo esperado: el re-login pasa por L3 (entrada de `manejarLogin`), que limpia igual. L2 y L3 son defensa en profundidad; lo que distingue a L2 es la limpieza **en el momento del logout**, y eso solo lo vigila U3-limpieza (unitario, observa el orden de las llamadas). Si se quisiera un diente de integracion para L2 aislado, habria que inspeccionar el store tras `/logout` sin re-login; no se agrego porque la tarea 5.2 no lo pide.

## Salida verde (codigo restaurado)

Comando: `npm test`

```
Test Files  162 passed | 2 skipped (164)
     Tests  3252 passed | 5 skipped (3257)
```

Resultado: la mutacion es atrapada por U3-limpieza; sin ella la suite completa esta en verde y `src/build-on-comando-empleado.ts` quedo byte a byte igual a como estaba antes de mutar.
