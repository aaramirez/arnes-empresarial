# Verificación manual de cierre — `aprobacion-conversacional-hitl` (tarea 19)

**Fecha**: 2026-09-16
**Rama**: `hito/v3.10-aprobacion-conversacional-hitl--unit5-prompt-skills-evidencia` (tracker `hito/v3.10-aprobacion-conversacional-hitl`)
**Ejecutor**: verificación manual del entregable, tarea 19 de `openspec/changes/aprobacion-conversacional-hitl/tasks.md` — sin código de producción. Molde de `docs/progreso/v3.6-operaciones-conversacionales/verificacion-manual-tarea-15.md` (dispatcher real + SQLite real, sin capturas de pantalla).

## 0. Nota de método — por qué esta evidencia no pasa por el Claude Agent SDK real

Este entorno no tiene `ANTHROPIC_API_KEY` disponible (verificado: `node -e "console.log(!!process.env.ANTHROPIC_API_KEY)"` → `false`), así que no se puede levantar un turno conversacional real de punta a punta (el molde de `curl` contra `POST /operaciones` de `v3.6`/`v3.9` necesita que el modelo elija la operación y sus campos).

La evidencia de abajo se detiene un nivel por debajo: invoca `ejecutarOperacion` directamente — el dispatcher REAL que el turno conversacional llama DESPUÉS de que el modelo ya eligió la operación (mismo criterio que la tarea 13 de este propio change usó para su test de integración, `src/test/integration/comandos-administracion-empleados-flujo.integration.test.ts`, commit `de4aa0b`). Todo lo demás es real, sin ningún doble en el camino crítico: SQLite real (`:memory:`, migraciones reales vía `openDatabase`), `createVentaStore`/`createSolicitudStore` reales, `rolPort` real (lee `roles_empleado` real), `registro` real (escribe `registro_acciones_empleado` real), y las funciones deterministas reales (`registrarVenta`, `resolverDecisionVenta`, `procesarDevolucion`, `resolverEscalacionReembolso`, `resolverSolicitudInterna`, `crearSolicitudInterna`).

La única pieza que no es real es `despacharDeps.invocar` (la llamada al subagente `validador-solicitudes`, que si funcionara invocaría al modelo): se dejó que **rechace a propósito**, para ejercitar el camino de degradación de fallo que `crear-solicitud-interna.ts` ya documenta (ADR 40) — la solicitud queda creada igual, sin dictamen. No es un atajo del script: es el comportamiento de producción para cuando la validación automática no está disponible.

El script (`verificacion-tarea-19-temp.ts`, en la raíz del repo durante la corrida) se ejecutó una única vez con `npx tsx`, se capturó su salida completa (abajo) y se borró — no queda en `git status` ni en el árbol de trabajo.

## 1. Escenario A — reembolso: venta dada de alta por el PROPIO canal conversacional

```
=== A. registrar_venta por el canal conversacional (sesion = vero) ===
Venta id-3 registrada (caso id-2). Notificación al cliente: no se pudo notificar automáticamente. Link de confirmación: https://ventas.example.com/confirmar/token-1.
venta.id=id-3 venta.vendedor_id=vero (== sesion.empleadoId 'vero'? true)
```

Confirma, con código real (no un fixture con dos strings iguales por casualidad): `ejecutarRegistrarVenta` escribe `vendedorId: sesion.empleadoId` literal (ADR 171 pto 2) — la venta `id-3` quedó con `vendedor_id = "vero"`, el mismo `empleadoId` que la registró.

```
=== A. resolver_decision_venta (confirmar) para poder escalar el reembolso después ===
Venta confirmada. Comisión calculada: 100 (período 2026-01).

=== A. procesar_devolucion (monto 1000 > umbral 500 ⇒ ESCALADA) ===
Devolución escalada a revisión humana para la venta id-3 (caso id-2). Queda pendiente de aprobación.
```

### 1.1 [Success Criterion] Listado sin id, dominio reembolso

```
=== A.1 [Success Criterion] Listado de resolver_reembolso SIN id (modo listado, cero escrituras) ===
- venta id-3 | vendedor Vero Vendedora | cliente cliente-verif-19 | monto 1000.00 | caso id-2 | confirmada 2026-01-01T00:00:00.006Z
```

### 1.2 [Success Criterion] Rechazo por rol base, dominio reembolso

```
=== A.2 [Success Criterion] Rechazo por ROL BASE (reembolso) — 'beto' sin fila en roles_empleado ===
No estás autorizado para aprobar esa escalación de reembolso: se requiere rol elevado.
```

`beto` no tiene fila en `roles_empleado` (default deny, ADR 154 pto 5) — dos turnos por el dispatcher real (eco + confirmación), el gate de rol se evalúa recién en el segundo, mismo orden que produce el texto distinguible de rol insuficiente.

### 1.3 [Success Criterion ★] Rechazo por autoaprobación, dominio reembolso — sobre una venta del canal conversacional

```
=== A.3 [Success Criterion ★] Rechazo por AUTOAPROBACIÓN (reembolso) — 'vero' (administrador) sobre SU PROPIA venta creada por el canal conversacional ===
[turno 1, eco] Vas a aprobar el reembolso de la venta id-3 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmación] No podés aprobar el reembolso de tu propia venta, aunque tengas rol elevado.
venta.estado tras el intento de autoaprobación = reembolso_pendiente (NO debe ser 'reembolsada')
```

`vero` tiene rol `administrador` (asignado con la misma escritura que `/asignar-rol`, `upsertRolEmpleado`) y es el vendedor de la venta `id-3` — el predicado `venta.vendedorId === sesion.empleadoId` dispara, `resultado.estado` queda en `reembolso_pendiente`, **no** en `reembolsada`. Esto es exactamente el escenario que Aclaración 3 de `proposal.md` identificó como el que de verdad dispara en producción (a diferencia de un fixture con dos strings iguales sin relación causal).

### 1.4 [Success Criterion ★, ADR 213] Cambio de `accion` entre turnos sobre el mismo ítem

```
=== A.4 [Success Criterion ★, ADR 213] Cambio de ACCION entre turnos sobre el MISMO ítem exige eco nuevo, nunca ejecuta la vieja ni la nueva sin confirmar ===
[turno 1, pide 'rechazar'] Vas a rechazar el reembolso de la venta id-3 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, pide 'aprobar' en vez de confirmar 'rechazar'] Vas a aprobar el reembolso de la venta id-3 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
venta.estado tras el cambio de accion = reembolso_pendiente (NO debe haber ejecutado 'rechazar' NI 'aprobar' todavía — la respuesta de arriba debe ser un pedido de confirmación de 'aprobar', no un resultado aplicado)
```

Turno 1 pide `rechazar` sobre `id-3` → eco, ranura pendiente `(vero, reembolso, id-3, rechazar)`. Turno 2, el empleado cambia de idea y pide `aprobar` sobre el MISMO ítem — el dispatcher real responde con un **eco nuevo** para `aprobar` (no ejecuta nada): la ranura vieja (`accion:"rechazar"`) queda reemplazada, nunca acumulada, y `estaConfirmada` da `false` para la llave nueva (`accion:"aprobar"`) porque `accion` es parte del predicado, no sólo de la llave (ADR 213/R13). `venta.estado` sigue en `reembolso_pendiente` — ni `rechazar` ni `aprobar` se ejecutaron sin el turno de confirmación correspondiente.

## 2. Escenario B — venta EXTERNA (molde `POST /ventas`): el predicado NO dispara

```
=== B. [Success Criterion, negativo de R7] Venta EXTERNA (vendedorId ajeno, molde POST /ventas) — un administrador SÍ puede resolver su reembolso ===
Listo: el reembolso de la venta venta-externa-post-ventas quedó reembolsada y el caso caso-externo-1 en resuelto.
venta_externa.estado = reembolsada (DEBE ser 'reembolsada' — el predicado vendedorId===empleadoId NO dispara sobre una venta externa)
```

Venta sembrada directamente con `vendedorId: "vendedor-externo-no-empleado"` (mismo molde que `POST /ventas`: identidad externa, sin sesión de empleado) — `vero` (administrador, sin relación con ese `vendedorId`) la resuelve con normalidad. Confirma el escenario negativo obligatorio de R7 (Aclaración 3(b) de `proposal.md`): el control no es un fixture complaciente, distingue el camino conversacional del externo.

## 3. Escenario C — solicitud interna: listado, rol base, autoaprobación, dos turnos

```
=== C. crear_solicitud_interna (sesion = vero) — degradación ADR 40: sin modelo, queda SIN dictamen ===
Solicitud delegacion-20 creada (caso delegacion-19). Sin dictamen: la validación automática no se pudo completar.
solicitud.id=delegacion-20 solicitud.solicitante_id=vero
```

### 3.1 [Success Criterion] Listado sin id, dominio solicitud

```
=== C.1 [Success Criterion] Listado de resolver_solicitud SIN id (modo listado, cero escrituras) ===
- delegacion-20 (vacaciones): una semana de vacaciones, solicitud de verificacion tarea 19
```

### 3.2 [Success Criterion] Rechazo por rol base, dominio solicitud

```
=== C.2 [Success Criterion] Rechazo por ROL BASE (solicitud) — 'beto' ===
No estás autorizado para aprobar esa solicitud: se requiere rol elevado.
```

### 3.3 [Success Criterion ★] Rechazo por autoaprobación, dominio solicitud

```
=== C.3 [Success Criterion ★] Rechazo por AUTOAPROBACIÓN (solicitud) — 'vero' (administrador, y además solicitante) sobre SU PROPIA solicitud ===
[turno 1, eco] Vas a aprobar la solicitud delegacion-20 (una semana de vacaciones, solicitud de verificacion tarea 19). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmación] No podés aprobar tu propia solicitud, aunque tengas rol elevado.
```

Mecanismo vigente desde v3.5 (`autorizacion-empleado`), ahora alcanzado por el canal conversacional a través del dispatcher real — sin cambio de comportamiento, sólo de superficie de entrada.

### 3.4 [Success Criterion] Resolución confirmada en dos turnos, sobre la solicitud de un tercero

```
=== C.4 [Success Criterion] Resolución CONFIRMADA en dos turnos, para el dominio solicitud — otro empleado ('vero', admin) resuelve la solicitud de un TERCERO ('beto') ===
Solicitud delegacion-31 creada (caso delegacion-30). Sin dictamen: la validación automática no se pudo completar.
[turno 1, eco] Vas a aprobar la solicitud delegacion-31 (reembolso de taxi, solicitud de verificacion tarea 19). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmación] Listo: la solicitud delegacion-31 quedó aprobada.
```

`vero` (administrador) resuelve la solicitud de `beto` (rol base) en dos turnos reales — eco en el primero, aplicación real en el segundo, con `casoIdActual` distinto en cada turno (el predicado `origenCasoId !== casoIdActual` exige un turno posterior real, mismo mecanismo que `cancelar_solicitud_interna` desde v3.6).

## 4. Auditoría real generada durante la corrida

```
=== RESUMEN de filas de auditoria (registro_acciones_empleado) generadas en esta corrida ===
  empleado=vero comando=operacion:registrar_venta resultado=creada
  empleado=vero comando=operacion:resolver_decision_venta resultado=confirmada
  empleado=vero comando=/devolucion resultado=escalada
  empleado=beto comando=/aprobar-reembolso resultado=no_autorizado
  empleado=vero comando=/aprobar-reembolso resultado=autoaprobacion_prohibida
  empleado=vero comando=/aprobar-reembolso resultado=aprobada
  empleado=vero comando=/solicitar resultado=creada
  empleado=beto comando=/aprobar-solicitud resultado=no_autorizado
  empleado=vero comando=/aprobar-solicitud resultado=autoaprobacion_prohibida
  empleado=beto comando=/solicitar resultado=creada
  empleado=vero comando=/aprobar-solicitud resultado=aprobada

[OK] Script de verificación terminado sin excepciones no controladas.
```

Confirma que las filas de auditoría (ADR 188, `registro_acciones_empleado`) reusan el mismo literal de `comando` que el comando de TUI dado de baja habría escrito (`/aprobar-reembolso`, `/aprobar-solicitud`) — la migración de canal no cambió el vocabulario de auditoría, sólo el origen de la invocación.

## 5. `git diff main` — invariantes estructurales de la propuesta

```
$ git diff --stat main -- src/core/auth/sesion.ts
(vacío)

$ git diff --stat main -- src/core/auth/rol-contract.ts src/core/auth/autorizacion-resolucion.ts
(vacío)

$ git diff --stat main -- src/core/ventas/ventas-contract.ts src/adapters/memory/repository.ts
(vacío — VentaStorePort, la query y la proyección de escalaciones sin tocar)

$ git diff --stat main -- src/core/solicitudes/resolver-solicitud-interna.ts
(vacío — resolverSolicitudInterna entera sin cambio)

$ git diff --stat main -- package.json
(vacío — sin dependencias nuevas)

$ grep -rln 'from "../../adapters\|from "\.\./adapters\|from "\./adapters"' src/core/ --exclude='*.test.ts'
(sin resultados — src/core/ sigue sin importar de src/adapters/*)
```

## 6. `npm test`, `npm run typecheck`, lint

```
$ rm -rf dist && npm test
 Test Files  137 passed | 1 skipped (138)
      Tests  2475 passed | 3 skipped (2478)

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)

$ npm run lint
→ no existe script "lint" en package.json — N/A para este proyecto (mismo hallazgo que docs/progreso/v3.8-consultas-negocio-a2a-entrante/evidencia-verificacion-manual-tarea-15.md, punto 5)
```

`dist/` se limpió antes de correr `npm test` (gotcha ya documentado del repo: un `dist/` poblado duplica el conteo de archivos/tests porque Vitest recoge también los `.test.js` compilados).

## 7. Resultado

| # | Success Criterion (`proposal.md`) | Resultado |
|---|---|---|
| 1 | Un listado sin id, para cada dominio | ✅ §1.1 (reembolso), §3.1 (solicitud) |
| 2 | Una resolución confirmada en dos turnos | ✅ §3.4 (solicitud, sobre un tercero) — reembolso también en dos turnos en §1.3/§2, aunque el camino feliz completo del dominio reembolso ya lo cubre el test de integración de la tarea 13 (`comandos-administracion-empleados-flujo.integration.test.ts`) |
| 3 | Un rechazo por rol base, para cada dominio | ✅ §1.2 (reembolso), §3.2 (solicitud) |
| 4 | ★ Un rechazo por autoaprobación en CADA dominio — el de reembolso sobre una venta dada de alta por el propio canal conversacional | ✅ §1.3 (reembolso, venta con `vendedorId` escrito por `ejecutarRegistrarVenta`), §3.3 (solicitud) — y §2 confirma el negativo (venta externa, el predicado NO dispara) |
| 5 | ★ Cambio de `accion` entre turnos (ADR 213) sobre el mismo ítem, exigiendo eco nuevo | ✅ §1.4 |
| 6 | `git diff main`: `sesion.ts`, modelo de rol, `puedeResolverAjeno`, `VentaStorePort`/query/proyección, `resolverSolicitudInterna`, `package.json` sin tocar; `src/core/` sin imports de `src/adapters/*` | ✅ §5 |
| 7 | `npm test`, `npm run typecheck` y lint en verde | ✅ §6 |

**Hallazgo de método, no bloqueante**: esta verificación no ejercitó el Claude Agent SDK real (sin `ANTHROPIC_API_KEY` en este entorno) — se detuvo en `ejecutarOperacion`, el dispatcher real. Las tres superficies de prompt (tarea 15) y las dos skills nuevas (tarea 16) que instruyen al modelo a elegir `accion`/pedir confirmación ya están verificadas por contenido exacto en `definitions.test.ts`/`soporte-prompt.test.ts`/`operaciones/index.test.ts` — lo que esta verificación no cubre es la elección real del modelo en runtime, que es exactamente lo que RD-100/§11 de `design.md` ya advierte: *"las líneas de seguridad del prompt son necesarias y NUNCA suficientes"* — el mecanismo real (lo que este documento sí verificó) vive en el dispatcher y las funciones deterministas, no en el prompt.
