# Evidencia de verificación manual — tarea 12, `comandos-administracion-empleados`

Ejecutada sobre `hito/v3.7-comandos-administracion-empleados`, HEAD `ded56b2` (tras la separación de commits de PR3 y el fix de code-review). Alcance: tasks.md, tarea 12, los cinco puntos mínimos exigidos.

## 1. Flujo completo (bootstrap CLI → login → `/crear-empleado` → `/asignar-rol` → `/aprobar-reembolso`)

**Verificado a nivel de lógica de negocio real** (SQLite real en memoria, scrypt real, `VentaStorePort` real), NO a través de la interfaz Ink real — ver limitación en la sección final.

```
npx vitest run comandos-administracion-empleados-flujo comandos-administracion-empleados-invariantes
 Test Files  2 passed (2)
      Tests  11 passed (11)
```

`src/test/integration/comandos-administracion-empleados-flujo.integration.test.ts` ejercita exactamente esta secuencia: bootstrap equivalente al CLI → login → `/crear-empleado ana <password>` → `/asignar-rol ana administrador` → `ana` aprueba un reembolso — sin re-login entre pasos, confirmando que el rol escrito por la TUI (`rolEscritor.asignarRol` → `upsertRolEmpleado`) surte el mismo efecto que uno asignado por CLI.

## 2. Rol base rechazado en los tres comandos administrativos

Cubierto por el mismo archivo de integración (caso "rol base rechazado en `/asignar-rol` y `/crear-empleado`, `/estado-bot-prs` responde igual que a un administrador") y por los tests unitarios de `build-on-comando-empleado.test.ts` de las tareas 5, 7 y 8 (gate de rol + auto-degradación).

## 3. `/estado-bot-prs` nunca revela secretos

Cubierto por tests ya existentes de la tarea 3, re-confirmados en esta corrida (`build-on-comando-empleado.test.ts:2178-2255`):
- Listener habilitado/deshabilitado ⇒ responde puerto/path o `"deshabilitado (sin GITHUB_WEBHOOK_SECRET)"`.
- `GITHUB_TOKEN` presente/ausente ⇒ `"presente"`/`"ausente"`, **nunca** el valor (test explícito: `"GITHUB_TOKEN presente ⇒ 'presente', NUNCA el valor del token en el texto"`).

## 4. Rollback de la tarea 7 (o 8) — experimento real, no simulado

Con los commits ya separados (`e38b5c5` tarea 7, `b769083` tarea 8 — ver hallazgo de code-review corregido), se hizo el experimento real sobre una rama descartable:

```
git checkout -b tmp/verificacion-rollback-tarea12
git reset --hard e38b5c5        # snapshot: tarea 7 aplicada, tarea 8 NO existe todavía
grep crear_empleado|CrearEmpleado|COMANDO_CREAR_EMPLEADO src/core/commands/comando-empleado.ts src/build-on-comando-empleado.ts
  → sin resultados (confirmado: /crear-empleado no existe en este snapshot)
grep 'nombre: "/' src/core/commands/comando-empleado.ts
  → 17 entradas, /ayuda sigue último, /crear-empleado ausente
npm run typecheck → limpio
npx vitest run comando-empleado build-on-comando-empleado
  → 234 passed
git checkout hito/v3.7-comandos-administracion-empleados
git branch -D tmp/verificacion-rollback-tarea12
```

Confirma: al quitar el commit de `/crear-empleado`, el comando desaparece de `DESCRIPTORES` (cae a `ayudaDesconocido` vía el mecanismo estándar de comando no reconocido — mismo camino que cualquier otro comando inexistente, sin rama especial), y el resto del sistema (17 comandos restantes, incluido `/asignar-rol`) sigue compilando y pasando tests de forma independiente. Ningún dato (`credenciales_empleado`, `roles_empleado`) se ve afectado por el rollback de código: no hay migraciones nuevas asociadas a ninguna de las dos tareas (`git diff --stat main -- src/adapters/memory/migrations/` vacío, verificado en la ronda de `sdd-verify`), así que cualquier credencial/rol ya escrito por la TUI antes del rollback sobrevive intacto y sigue siendo el mismo dato que hubiera escrito el CLI.

Este experimento **no era posible antes de separar los commits** (`f15f818` original no contenía código real de `/asignar-rol`) — es evidencia adicional de por qué ese hallazgo de code-review importaba.

## 5. `npm test` / `npm run typecheck` en verde, estado final de las tres PRs encadenadas

```
npm test
 Test Files  128 passed | 1 skipped (129)
      Tests  2267 passed | 3 skipped (2270)

npm run typecheck
  (sin salida, sin errores)
```

## 6. Sesión TUI interactiva real — verificada a mano por el humano

El punto del checklist que exige demostrar el flujo **a través de la interfaz Ink real** no se podía verificar desde el entorno de ejecución del agente (Ink usa modo raw sobre un TTY real; las herramientas de shell del agente no exponen una terminal interactiva de verdad). Se dejaron los pasos exactos para que el humano lo corriera a mano:

```
npm run dev
/login jimmy <password>
/crear-empleado ana <password>
/asignar-rol ana administrador
/logout
/login ana <password>
/asignar-rol jimmy administrador   # o /aprobar-reembolso <ventaId> si había uno pendiente
/logout
/login bob <password>              # empleado con rol base
/asignar-rol bob administrador     # y /crear-empleado, ambos deben rechazar
/estado-bot-prs                    # nunca debe imprimir el valor de los secretos
```

**Resultado: corrido a mano por el humano (JimmyFung123) el 2026-09-13 sobre `hito/v3.7-comandos-administracion-empleados` — confirmado funcionando correctamente.** El rol asignado vía `/asignar-rol` en la TUI le dio a `ana` privilegios de administrador reales de inmediato tras el login, sin ningún paso adicional tipo CLI; el rol base fue rechazado en los comandos gateados; `/estado-bot-prs` no filtró secretos.

Con este último punto, el checklist de tarea 12 de `tasks.md` queda **completo**.
