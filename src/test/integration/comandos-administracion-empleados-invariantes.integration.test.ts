import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { COMANDOS } from "../../core/commands/comando-empleado.js";
import { ROLES_EMPLEADO } from "../../core/auth/rol-contract.js";

/**
 * `comandos-administracion-empleados`, tarea 10 — Success Criteria de
 * cierre que ninguna tarea anterior deja cerrados en solitario (`tasks.md`
 * §"Verificación de cierre de PR3"). TDD estricto aplica a las aserciones
 * de COMPORTAMIENTO (abajo, invariantes sobre `COMANDOS`/`ROLES_EMPLEADO`
 * en runtime); las de `git diff` son ESTÁTICAS por naturaleza — no hay un
 * "rojo" que escribir primero para "un archivo no cambió", así que se
 * agregan directo, mismo criterio que el resto de este archivo (tests, sin
 * archivo de producción propio).
 *
 * `describe.skipIf` degrada a skip (no a fallo) cuando `git` no está en
 * `PATH` o cuando la rama local `main` no existe — mismo molde que
 * `worktree.integration.test.ts` (`isGitBinaryAvailable`). Compara SIEMPRE
 * contra `main`, nunca contra un commit fijo: es la base real desde la que
 * se abrió la rama del hito (`AGENTS.md`, convención de ramas).
 */
function isGitDiffAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { windowsHide: true, stdio: "ignore" });
    execFileSync("git", ["rev-parse", "--verify", "main"], { windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const GIT_DIFF_AVAILABLE = isGitDiffAvailable();

function diffStat(paths: readonly string[]): string {
  return execFileSync("git", ["diff", "--stat", "main", "--", ...paths], { encoding: "utf8", windowsHide: true });
}

describe.skipIf(!GIT_DIFF_AVAILABLE)(
  "comandos-administracion-empleados — Success Criteria de cierre, git diff contra main (tarea 10)",
  () => {
    it("src/core/auth/sesion.ts NO fue modificado (invariante heredado del ADR 154 pto 2 de autorizacion-empleado)", () => {
      expect(diffStat(["src/core/auth/sesion.ts"]).trim()).toBe("");
    });

    it("src/adapters/webhooks/, src/adapters/board/ y src/core/config/env.ts NO fueron tocados (ADR 178: el diferido se respetó pese a agregar /estado-bot-prs)", () => {
      expect(
        diffStat(["src/adapters/webhooks/", "src/adapters/board/", "src/core/config/env.ts"]).trim(),
      ).toBe("");
    });

    it("src/adapters/memory/migrations/ NO ganó ninguna migración nueva (R4 — cero CREATE TABLE, cero tabla de rol nueva)", () => {
      expect(diffStat(["src/adapters/memory/migrations/"]).trim()).toBe("");
    });
  },
);

describe("comandos-administracion-empleados — Success Criteria de cierre, invariantes de comportamiento (tarea 10)", () => {
  it("ROLES_EMPLEADO sigue con EXACTAMENTE dos miembros — este change no agrega un rol (ADR 176 pto 4, R4)", () => {
    expect(ROLES_EMPLEADO).toHaveLength(2);
    expect(ROLES_EMPLEADO).toEqual(["empleado", "administrador"]);
  });

  it("DESCRIPTORES queda en DIECIOCHO entradas — conteo final del change (banner de tasks.md)", () => {
    expect(COMANDOS).toHaveLength(18);
  });

  it("los tres descriptores nuevos del change (/estado-bot-prs, /asignar-rol, /crear-empleado) están todos ANTES de /ayuda, que sigue último", () => {
    const nombres = COMANDOS.map((d) => d.nombre);
    const idxAyuda = nombres.indexOf("/ayuda");
    expect(idxAyuda).toBe(nombres.length - 1);
    for (const nuevo of ["/estado-bot-prs", "/asignar-rol", "/crear-empleado"]) {
      const idx = nombres.indexOf(nuevo);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(idxAyuda);
    }
  });

  it("ningún descriptor de los quince originales cambió de nombre/forma (regresión ya cubierta por comando-empleado.test.ts — repetida acá como cierre explícito del Success Criterion)", () => {
    const originales = [
      ["/login", "id_mas_resto"],
      ["/logout", "sin_argumentos"],
      ["/soporte", "id_mas_resto"],
      ["/aprobar-reembolso", "id_opcional"],
      ["/rechazar-reembolso", "id_opcional"],
      ["/reabrir-reembolso", "id_opcional"],
      ["/aprobar-solicitud", "id_opcional_solicitud"],
      ["/rechazar-solicitud", "id_opcional_solicitud"],
      ["/ver-propuesta", "id_opcional_propuesta"],
      ["/aplicar-propuesta", "id_mas_resto"],
      ["/descartar-propuesta", "id_mas_resto"],
      ["/consultar-kpi", "id_mas_resto"],
      ["/reporte-comisiones", "id_opcional_periodo"],
      ["/ver-solicitudes-a2a", "id_opcional_a2a_task"],
    ] as const;
    type DescriptorConForma = { readonly nombre: string; readonly forma: string };
    const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];
    for (const [nombre, forma] of originales) {
      const encontrado = descriptores.find((d) => d.nombre === nombre);
      expect(encontrado).toMatchObject({ nombre, forma });
    }
  });

  it("privilegiado NO fue resignificado: los comandos de solo lectura ya privilegiados siguen sin requerir administrador", () => {
    type DescriptorAdmin = { readonly nombre: string; readonly privilegiado: boolean; readonly requiereAdministrador: boolean };
    const descriptores = COMANDOS as unknown as readonly DescriptorAdmin[];
    for (const nombre of ["/consultar-kpi", "/ver-propuesta", "/ver-solicitudes-a2a", "/estado-bot-prs"]) {
      const d = descriptores.find((x) => x.nombre === nombre);
      expect(d).toMatchObject({ privilegiado: true, requiereAdministrador: false });
    }
  });
});
