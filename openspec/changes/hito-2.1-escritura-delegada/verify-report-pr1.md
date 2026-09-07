# Verify Report — PR1 (Hito 5.1 / v2.1.0)

**Alcance**: tareas 1-6 de `tasks.md` — "Contrato del worktree + runner `git` + argv nombrados". Tareas 7-37 fuera de alcance, no evaluadas.

**Rama verificada**: `hito/v2.1-escritura-delegada` (working tree limpio al momento de la verificación).

**Metodología**: lectura directa de código + `tasks.md` + `design.md` §5.1/§6.1 + `specs/escritura-aislada-worktree/spec.md` + `AGENTS.md`, más ejecución real de `npm test` y `npm run typecheck` en esta sesión (no se reutilizaron números reportados por Implementers anteriores).

## Evidencia de ejecución (recalculada en esta sesión)

- `npm test` (con `dist/` inexistente, sin build previo que lo inflara): **82 archivos / 1265 tests, todos verdes**. Coincide exactamente con lo que `tasks.md` tareas 5 y 6 afirman como baseline y post-cambio.
- `npm run typecheck` (`tsc --noEmit`): **sin errores**.
- Archivos aislados de PR1 corridos con `--reporter=verbose`: `worktree-contract.test.ts` (14/14), `config.test.ts` (16/16), `git-cli.test.ts` (115/115) — **145/145** total, todos en verde.

## Puntos de atención específicos (verificados, no de oídas)

1. **Los diez constructores de argv nunca emiten `commit`/`push`/`remote`/`tag` en `argv[0]`**: corrí yo mismo `git-cli.test.ts`. El bloque `CONSTRUCTORES_ARGV` itera los 10 constructores contra 5 entradas adversariales (`"commit"`, `"push"`, `"--exec=x"`, `"; rm -rf /"`, `"--upload-pack=x"`) verificando `argv[0] ∈ SUBCOMANDOS_PERMITIDOS` (lista cerrada: `rev-parse`, `worktree`, `add`, `diff`, `branch`, `apply`) y, para las 3 entradas sin colisión literal, que ningún elemento del array completo sea `commit`/`push`/`remote`/`tag`. Todo pasó. El diseño hace la garantía estructural, no solo testeada: no existe ningún parámetro que escriba en la posición 0 del argv en ninguno de los 10 constructores (`git-cli.ts` líneas 109-147) — confirmado leyendo el código, no solo el test.
2. **`classifyGitFailure`/`GitCliError` evitan que el error nativo cruce el borde sin clasificar**: confirmado por lectura + ejecución. `classifyGitFailure` solo devuelve un `GitFailureReason` (`"not-found"|"timeout"|"exit-code"|"unknown"`), nunca el objeto crudo. `GitCliError` envuelve el error nativo en `cause: unknown` — accesible solo explícitamente, nunca propagado como excepción no tipada. El test `boundary crossing with a fake GitExecFileFn` verifica `caught).not.toBe(rawEnoent)` (el objeto nativo no es el objeto lanzado). Correcto y verificado en ejecución real.
3. **`worktree-contract.ts` no tiene ningún `import`**: verificado con `Grep` (`^import`) sobre el archivo — cero coincidencias. Además hay un test dedicado (`worktree-contract.test.ts`, describe "worktree-contract.ts source") que lee el archivo fuente con `readFileSync` y asegura `/\bimport\b/` no matchea — pasó en ejecución real.
4. **`vitest.config.ts` no cambió qué archivos descubre la suite**: confirmado — `npm test` reporta 82 archivos / 1265 tests, idéntico al baseline documentado en `tasks.md` tarea 5 (82/82, 1265/1265 antes y después). El único cambio es `exclude: [...configDefaults.exclude, ".harness/**"]`, que hoy no tiene efecto observable porque no existe ningún worktree abierto en esta corrida (el escenario real solo es verificable en PR2/PR6 con un worktree real, tal como el propio `tasks.md` aclara).
5. **`.gitignore` agrega `.harness/`**: confirmado, línea 20. El conteo de "15 entradas reales de patrón" que documenta la tarea 6 es exacto (verificado línea por línea, sin contar el comentario ni `nul`).

## Hallazgo nuevo (no reportado por el Implementer)

**Discrepancia de conteo en la tarea 4** — WARNING, no bloqueante para este commit de PR1, pero corregible antes del cierre del hito:

- `tasks.md` tarea 4 afirma "RED→GREEN: 120/120 nuevos tests verdes, cero skips".
- Recalculado en esta sesión: el bloque `CONSTRUCTORES_ARGV` tiene 92 tests (2 de metadata + 10 normales + 50 adversariales-con-colisión + 30 adversariales-sin-colisión) y el bloque `named argv builders` tiene 10. Total agregado por la tarea 4: **102 tests nuevos**, no 120.
- La aritmética global sigue siendo consistente: tarea 3 dejó `git-cli.test.ts` en 13/13; 13 + 102 = 115, que es exactamente lo que corrí yo (115/115). Y 1163 (post-tarea 3, según `tasks.md`) + 102 = 1265, que es el total real de la suite completa que corrí. Es decir: **los totales finales (115 y 1265) son correctos**; el número intermedio "120 nuevos" que la tarea 4 se auto-atribuye es incorrecto por 18 tests.
- Es un error de conteo en la documentación del Implementer, no un defecto de código ni de cobertura — el invariante de seguridad sigue estando cubierto por los 92+10 tests reales. No bloquea el commit de PR1. Sí debería corregirse el texto de `tasks.md` tarea 4 (120→102) antes de dar el hito completo por cerrado, para que el registro que exige `AGENTS.md` ("el repositorio muestre el proceso de construcción paso a paso") sea exacto.

## Contra `AGENTS.md`

- Arquitectura hexagonal: `worktree-contract.ts` (core) no importa nada. `config.ts`/`git-cli.ts` (adapter) importan solo de `core/config/env.js` y de `node:*` — cero imports cruzados entre adaptadores. Cumple.
- Regla no negociable "el adaptador de git expone funciones nombradas, nunca un `git(args)` genérico": cumple, verificado en código y en test (ver punto 1 arriba).
- TDD estricto: tareas 1-4 con RED confirmado antes de cada implementación (documentado en `tasks.md` y consistente con los commits `5d96548`, `0240ba3`, `8391db4`, `f97ca3c` — uno por tarea). Tareas 5-6 declaran excepción TDD explícita (scaffolding), tal como anticipa la sección "Metodología" de `tasks.md`. Cumple.
- Commits por unidad de trabajo: un commit por tarea, formato `<tipo>(<scope>): <descripción> (Hito X.Y, tarea N)` respetado en los 6 commits de PR1 (verificado con `git log`).

## Nota de proceso heredada (no es hallazgo mío)

Confirmo lo que el orquestador ya señaló: la tarea 1 (`5d96548`) está commiteada y su checklist ya aparece marcado `[x]` en el `tasks.md` leído en esta sesión. No encontré ninguna tarea de PR1 sin marcar que sí tenga código commiteado, ni viceversa.

## Veredicto

**APROBADO, sin reservas, para el commit final de PR1** (tareas 1-6).

Motivo: las cinco garantías puntuales que el orquestador pidió confirmar están verificadas con evidencia de ejecución real, no de lectura. El único hallazgo (discrepancia de conteo 120 vs 102 en la tarea 4) es un WARNING de exactitud documental — no compromete el código, la cobertura ni el invariante de seguridad que la tarea 4 existe para garantizar. No es bloqueante para PR1.

### Bloqueante para el cierre del hito completo (no para PR1)

- Corregir el número "120/120 nuevos tests" de la tarea 4 en `tasks.md` a 102, para que el registro sea exacto cuando se lea en el futuro.
- Las 4 preguntas abiertas de `design.md` §15 (ADR 65, ADR 69, `HARNESS_WORKTREE_ROOT`, chain strategy — esta última ya resuelta según el propio `tasks.md`) siguen pendientes, pero no afectan el código de PR1; deben resolverse antes de cerrar el hito completo (quedan lejos, PR2-PR7).

## CRITICAL

Ninguno.

## WARNING

1. `tasks.md` tarea 4: conteo de "120/120 nuevos tests" no coincide con el delta real (102). Corregir antes del cierre del hito.

## SUGGESTION

Ninguna adicional a lo ya señalado en `tasks.md` (ADR 65/69/`HARNESS_WORKTREE_ROOT` pendientes de checkpoint, fuera del alcance de código de PR1).
