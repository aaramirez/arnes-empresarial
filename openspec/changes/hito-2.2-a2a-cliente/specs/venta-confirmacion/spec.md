> **DELTA — aditiva sobre `openspec/changes/hito-1.3-ventas-comisiones/specs/venta-confirmacion/spec.md`.** Ninguno de los seis requirements existentes ahí (listener web opt-in, alta autenticada sin invocar al modelo, notificación best-effort, validación de token/confirmación determinista, transacción única con cálculo de comisión, configuración de comisión validada al arranque) cambia de texto — por eso esta delta usa `## ADDED Requirements`, no `MODIFIED`. Lo que agrega `v2.2.0` es el punto de enganche de la verificación de riesgo/crédito para ventas grandes (Escenario 4 del arc42, Plan Hito 6 línea 332), resuelto por `proposal.md` como la alternativa de su R1: `registrarVenta` (`src/core/ventas/registrar-venta.ts:86`, `async` por naturaleza) en vez de `resolverDecisionVenta`/`confirmarVenta` (síncrona a propósito, invariante documentado de ausencia de ventana de carrera — `src/core/ventas/confirmar-venta.ts:1-15` — que este change no toca).
>
> **Nota de proceso**: mismo `graphify query` documentado en `cliente-a2a-jsonrpc/spec.md` y `delegacion-a2a-saliente/spec.md`. Se leyó completo `src/core/ventas/registrar-venta.ts` (secuencia de 5 pasos: crear token/expiración → `store.crearVentaConCaso` en transacción, PROPAGA si falla → armar `linkConfirmacion` → `notifier.notificarLinkConfirmacion`, NUNCA rechaza → devolver resultado) y `src/core/ventas/ventas-config.ts` (`VentasConfig`, `resolveVentasConfig`, `resolveNumeroValidado` — sin lanzar, acumula errores, ABORTA el arranque si algo excede su rango) para verificar dónde encaja el umbral nuevo y con qué criterio de validación.

# Delta for Venta Confirmación

## ADDED Requirements

### Requirement: `ventas-config.ts` valida un umbral de "venta grande" al arranque, mismo criterio que `reembolsoUmbral`

`VentasConfig` SHALL exponer un campo nuevo `ventaGrandeUmbral`, resuelto desde una variable de entorno con el mismo criterio de validación que `reembolsoUmbral` (finito, `> 0`, ausente o en blanco ⇒ default; presente pero inválido ⇒ error de arranque acumulado junto a los demás). El sistema SHALL NOT permitir que el proceso arranque con un `ventaGrandeUmbral` no numérico, no finito, o `<= 0`.

#### Scenario: Umbral de venta grande válido se resuelve al arrancar
- GIVEN la variable de entorno del umbral configurada con un número válido mayor a 0
- WHEN el proceso arranca
- THEN `VentasConfig.ventaGrandeUmbral` queda fijado a ese valor

#### Scenario: Umbral ausente usa un default, sin abortar el arranque
- GIVEN la variable de entorno del umbral no está configurada
- WHEN el proceso arranca
- THEN `VentasConfig.ventaGrandeUmbral` toma su valor por default y el arranque completa igual

#### Scenario: Umbral inválido aborta el arranque, acumulado junto a otros errores de configuración de ventas
- GIVEN la variable de entorno del umbral configurada con un valor no numérico, no finito, o `<= 0`
- WHEN el proceso arranca
- THEN el arranque falla con un error explícito que nombra la variable y el valor recibido, en la misma lista de errores que `COMISION_PORCENTAJE`/`REEMBOLSO_UMBRAL` si también fallan

### Requirement: `registrarVenta` delega una verificación de riesgo/crédito por A2A cuando el monto alcanza el umbral de venta grande, antes de notificar el link al cliente

Cuando `input.monto >= config.ventaGrandeUmbral`, `registrarVenta` SHALL delegar una verificación de riesgo/crédito hacia la clave de destino `"riesgo-credito"` (capability `delegacion-a2a-saliente`) después de que la venta y el caso quedaron persistidos (paso 2 de la secuencia existente) y **antes** de notificar el link de confirmación al cliente (paso 4) — de forma que el cliente nunca reciba un link de confirmación para una venta grande sin que la verificación de riesgo ya se haya intentado. Cuando `input.monto < config.ventaGrandeUmbral`, el sistema SHALL NOT invocar ninguna delegación A2A, y el flujo SHALL comportarse exactamente como en `v2.1.0`.

> **Nota de riesgo — equivalente a R1/R3 de `proposal.md`, deliberadamente NO resuelta por esta fase.** Este requirement fija el **punto de enganche** (`registrarVenta`, después de persistir, antes de notificar) y el **umbral** como el disparador, que es lo que `proposal.md` propuso como alternativa a enganchar en `resolverDecisionVenta`/`confirmarVenta` (síncronas a propósito, invariante de ausencia de ventana de carrera que este change no toca). Lo que **no** fija este requirement, porque `proposal.md` lo dejó explícitamente al checkpoint humano (punto 1 de su sección final, sin respuesta registrada al momento de esta fase de spec) y esta fase no puede inventarlo sin reabrir una decisión de diseño: **qué pasa con la venta y el caso ya persistidos cuando la delegación de riesgo falla** (`DelegacionA2ANoCompletadaError`, con cualquiera de sus `reason`, incluido `timeout`). Las alternativas visibles — (a) la falla propaga y `registrarVenta` rechaza sin notificar, dejando `ventas.estado = 'pendiente_confirmacion'` sin que el cliente nunca reciba el link; (b) la falla se trata best-effort como `VentaNotifierPort` (se loguea, se notifica igual) y la verificación queda solo como auditoría sin gatear nada; (c) se introduce un estado nuevo de venta bloqueada, fuera del catálogo `pendiente_confirmacion | confirmada | rechazada` ya cerrado por la spec base de esta capability — tienen consecuencias de esquema/estado distintas y quedan para `sdd-design`, con el checkpoint humano decidiendo entre ellas antes de bajarlas a un diseño concreto. Ligado además a **R3**: si el timeout total de la delegación (`HARNESS_A2A_TASK_TIMEOUT_MS`, default 2 min) se aplica tal cual a este camino, un `POST /ventas` puede quedar bloqueado hasta 2 minutos — `sdd-design` debe decidir si ese camino usa un techo más bajo o el patrón "responder primero, procesar después" ya usado por el adaptador de webhooks (ADR 10).

#### Scenario: Venta por debajo del umbral no dispara ninguna consulta de riesgo/crédito
- GIVEN `input.monto < config.ventaGrandeUmbral`
- WHEN se registra la venta
- THEN no se invoca ninguna delegación A2A y no se crea ninguna fila en `delegaciones_a2a`
- AND el resto de la secuencia (crear venta+caso, notificar) se comporta exactamente como en `v2.1.0`

#### Scenario: Venta que alcanza el umbral dispara la consulta antes de notificar
- GIVEN `input.monto >= config.ventaGrandeUmbral` y la venta+caso ya persistidos por el paso 2 existente
- WHEN `registrarVenta` continúa su secuencia
- THEN la delegación hacia `"riesgo-credito"` se invoca antes de que `notifier.notificarLinkConfirmacion` se llame
- AND `HARNESS_A2A_SALIENTE=off` hace que este requirement no dispare ninguna delegación, comportándose como el escenario "por debajo del umbral" (capability `delegacion-a2a-saliente`, requirement del interruptor)

#### Scenario: Un monto exactamente igual al umbral cuenta como venta grande
- GIVEN `input.monto === config.ventaGrandeUmbral`
- WHEN se registra la venta
- THEN se dispara la delegación hacia `"riesgo-credito"`, igual que si el monto la superara
