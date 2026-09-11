# Evidencia — Hito 3.1 "definicion-skills" (Registro de Skills)

Verificación manual del entregable, `openspec/changes/definicion-skills/design.md` §8 (tarea 11 de `tasks.md`). Corrida el 2026-09-11 sobre `hito/v3.1-definicion-skills`, commit `8e862ef` (después de las 2 correcciones del Reviewer sobre tareas 1-10, ambas re-verificadas y aprobadas).

Cada paso corrió el arnés real (`node dist/main.js`, `timeout` de 4-6s para capturar el arranque sin quedar colgado en la TUI interactiva) contra `.claude/skills/citar-conocimiento/SKILL.md`, mutado temporalmente y restaurado después de cada prueba (`git diff --stat` confirmó el archivo limpio tras cada restauración).

## Paso 1 — Arranque real limpio ✅

`npm run build && node dist/main.js`. Log real: [`paso1-log-real.txt`](paso1-log-real.txt).

```
skills-registro-cargado {"cantidad":1,"nombres":["citar-conocimiento"]}
```

Salida de la TUI (banner ASCII, prompt) en [`paso1-arranque-real-stdout.txt`](paso1-arranque-real-stdout.txt) — confirma que el proceso sigue vivo después del arranque de Skills (no abortó).

## Paso 2 — Carpeta ausente degrada, no aborta ✅

`mv .claude/skills .claude/skills.off` → arranque → `.claude/skills` restaurada. Stdout en [`paso2-carpeta-ausente-stdout.txt`](paso2-carpeta-ausente-stdout.txt) muestra la TUI arrancando igual (`exit=124` del `timeout`, no un crash). Log: `skills-carpeta-ausente`.

## Paso 3 — Subdirectorio sin `SKILL.md` se omite, no aborta ✅

`mkdir .claude/skills/vacia` (sin `SKILL.md`) → arranque → carpeta eliminada. Log:
```
skill-omitida-sin-skill-md {"directorio":"vacia"}
skills-registro-cargado {"cantidad":1,"nombres":["citar-conocimiento"]}
```
`citar-conocimiento` se sigue cargando — el directorio vacío no contamina el resto del descubrimiento.

## Paso 4 — `allowed-tools` aborta el arranque (límite 2 del ADR 106) ✅

Agregado `allowed-tools: Read` al frontmatter real → arranque → restaurado. `exit=1`, stderr en [`paso4-allowed-tools-stderr.txt`](paso4-allowed-tools-stderr.txt):
```
No se pudo inicializar el arnés: el Registro de Skills rechazó .claude/skills/citar-conocimiento/SKILL.md: campo no permitido: 'allowed-tools'
```

## Paso 5 — `name` distinto del directorio aborta ✅

`name: nombre-distinto` → arranque → restaurado. `exit=1`, stderr en [`paso5-name-distinto-stderr.txt`](paso5-name-distinto-stderr.txt):
```
No se pudo inicializar el arnés: el Registro de Skills rechazó .claude/skills/citar-conocimiento/SKILL.md: el campo 'name' ('nombre-distinto') no coincide con el nombre del directorio ('citar-conocimiento')
```

## Paso 6 — Tope de `description`: 1024 es el borde real ✅

- 1100 caracteres → `exit=1`, [`paso6-desc-1100-stderr.txt`](paso6-desc-1100-stderr.txt): `el campo 'description' supera el tope de 1024 caracteres`.
- 1000 caracteres → arranca (`exit=124`, sigue vivo), log `skills-registro-cargado`.

Tope portable **1024** confirmado en ejecución real, no solo en el test unitario (`skill-frontmatter.test.ts`).

## Paso 7 — Turno real desde la TUI citando con `citar-conocimiento`

**PENDIENTE — requiere ejecución humana.** Este paso invoca el modelo real vía Claude Agent SDK (costo de API real, y requiere leer la respuesta e interactuar con la TUI interactiva) — no lo ejecuté sin tu confirmación explícita. Los pasos 1-6, 8-13 ya prueban de forma determinística y sin costo que `options.skills`/`options.settingSources` llegan correctos al SDK (`invoke-model.test.ts:532-705`, cubre exactamente este contrato con dobles). Falta la demostración end-to-end: hacer una pregunta de política real desde la TUI y confirmar visualmente que la respuesta cita con el formato de `citar-conocimiento/SKILL.md`.

## Paso 8 — Aclaración 2: skill fuera de `.claude/skills/` del repo no se habilita ✅

Planté `~/.claude/skills/impostora/SKILL.md` (fuera del repo, en el home real del operador) → arranque → **eliminada inmediatamente después** (no queda en el disco del operador). Log: `nombres:["citar-conocimiento"]` — `impostora` nunca aparece. Confirma que `DEFAULT_SKILLS_DIR` resuelve contra `process.cwd()` del repo, nunca contra `~/.claude/skills/` del SDK.

## Paso 9 — `rg 'settingSources' src/`

18 coincidencias totales (no "una sola" como dice el checklist original de `tasks.md`/`design.md` — ya señalado como WARNING documental por el Reviewer, no bloqueante). Filtrando tests: **exactamente 3 en producción**, 2 comentarios de prosa (`invoke-model.ts:179,328`) y **1 sola asignación real** (`invoke-model.ts:361`, dentro del literal inicial de `Options`). El invariante que importa —un único punto de asignación, nunca detrás de un `if`— se sostiene.

## Paso 10 — `rg 'Skill' src/core/agents/definitions.ts` ✅

2 coincidencias, ambas en comentarios de prosa (líneas 83, 87). **Cero** dentro de ningún array `allowedTools` (ADR 107 pto 3).

## Paso 11 — Aislamiento de dominio (ADR 103 pto 5, R4) ✅

`git diff --stat main -- src/adapters/` → vacío.
`git diff --stat main -- src/core/ventas/` → vacío.
Ninguna skill ni el Registro de Skills tocan adaptadores ni el camino del dinero.

## Paso 12 — Rollback: `Options` vuelve byte a byte a `v3.0.0` ✅

`git revert --no-commit 8d73572` (commit de la tarea 6) → comparado vía `git diff <blob-pre-tarea6> <blob-revertido>` → **diff vacío** (idéntico byte a byte según el object store de git; la primera comparación con `diff` de shell dio falsos positivos por CRLF/LF, descartados al comparar con los blobs de git directamente). `git revert --abort` restauró la rama exactamente a `8e862ef`, sin dejar rastro.

## Paso 13 — Suite y typecheck en verde, integración corriendo ✅

- `npm run typecheck` → limpio ([`paso13-typecheck.txt`](paso13-typecheck.txt)).
- `skills.integration.test.ts` en modo verbose → 3/3 passed, ninguno `skipped` ([`paso13-integration-verbose.txt`](paso13-integration-verbose.txt)).
- Suite completa → **1881 passed, 3 skipped** (los 3 skips son preexistentes, de integración A2A por red, sin relación con este change) ([`paso13-full-suite.txt`](paso13-full-suite.txt)).

**Nota de proceso**: la primera corrida de la suite completa reportó 22 archivos fallidos con un conteo duplicado (~3768 tests en vez de ~1884) porque `dist/` (generado en el paso 1 para el arranque real) quedó en el árbol y Vitest recogió los `.test.js` compilados además de los `.test.ts` fuente — problema de tooling conocido, no una regresión de código (ver memoria de sesión "Vitest doubles test count with stale dist/"). Borrar `dist/` y correr de nuevo dio el resultado limpio de arriba.

## Paso 14 — Esta carpeta

Es la evidencia de este mismo paso. Citas de la documentación oficial que cerraron RD-44 y RD-45: ver `openspec/changes/definicion-skills/proposal.md` líneas 143-145 (RD-44, `settingSources: ['project']`, verificado contra [code.claude.com/docs/en/agent-sdk/skills](https://code.claude.com/docs/en/agent-sdk/skills)) y línea 236 (RD-45, whitelist de frontmatter, contra [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)) — ya versionadas ahí, no se duplican acá.

Resolución de RD-48 (`design.md` línea 517): *"Base relativa `.claude/skills` — la misma resolución que usa el SDK, no `import.meta.url`. El desfase del worktree del Developer se acepta y se documenta (con su propiedad de seguridad: una rama no se concede skills a sí misma), y el supuesto `process.cwd()` = raíz se testea (§7.E.3), no se hereda en silencio."* — confirmado en ejecución real por el paso 12 de `skills.integration.test.ts` (el testigo de `import.meta.url` vs `process.cwd()`) y por el paso 8 de esta corrida (el desfase de `~/.claude/skills/` nunca se hereda).

## Resumen

| Paso | Estado |
|---|---|
| 1-6, 8-13 | ✅ Verificados con ejecución real, evidencia en esta carpeta |
| 7 (turno real TUI) | ⏳ Pendiente — requiere ejecución humana (costo real de API) |
| 14 | ✅ Esta carpeta + citas ya versionadas en `proposal.md`/`design.md` |

**Las 4 preguntas de `design.md` §13 para el checkpoint humano** (ADR 114 como enmienda vs. ADR nuevo; rigidez de la whitelist del ADR 110 pto 2; modestia deliberada de `citar-conocimiento`; costo de los dos escaneos del ADR 115 pto 4 — **hoy reducidos a uno solo por la corrección del hallazgo 1 del Reviewer**, RD-49 queda desactualizado y debería revisarse) siguen abiertas y no las resuelve esta verificación.
