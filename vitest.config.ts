import { configDefaults, defineConfig } from "vitest/config";

/**
 * Root vitest config (Hito 5.1, tarea 5).
 *
 * Excludes `.harness/**` from test discovery. `.harness/worktrees/` holds
 * isolated `git worktree` checkouts opened by the delegated-writing Developer
 * (`escritura-aislada-worktree`, ADR 57), each with its own `node_modules`
 * and its own copy of colocated `*.test.ts` files. Without this exclusion,
 * the main checkout's `vitest run` would pick up and double-run every test
 * file inside any worktree that happens to be open — a false "test count"
 * inflation distinct from (but with the same symptom as) a stale `dist/`
 * build being scanned alongside `src/`.
 *
 * Covers spec `escritura-aislada-worktree` req. "El worktree no es
 * descubierto por la suite de tests del checkout principal" — verifiable
 * end-to-end only with a real worktree open (design.md §11 step 14, PR2/PR6).
 *
 * `**\/dist/**` (`modo-headless-cierre-limpio`, tarea 1.7, design §0.4/§9.3):
 * defensa en profundidad contra un `dist/` viejo con `*.test.js` inflando el
 * conteo de `npm test` — Vitest 4's `configDefaults.exclude` NO incluye
 * `dist/**` por defecto. `tsconfig.build.json` (tarea 1.7) ya evita que un
 * `dist/` NUEVO contenga tests; esta línea cierra la clase de bug para un
 * `dist/` viejo que quedó de antes del cambio.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".harness/**", "**/dist/**"],
  },
});
