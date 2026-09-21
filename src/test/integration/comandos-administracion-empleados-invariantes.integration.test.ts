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
 *
 * Una sola llamada a `git rev-parse --verify main` alcanza para las dos
 * condiciones (code-review, hallazgo 8): si `git` no está en `PATH`, este
 * comando falla igual que `git --version` fallaría, bajo el mismo `catch` —
 * la llamada previa a `git --version` era redundante.
 */
function isGitDiffAvailable(): boolean {
  try {
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

    it("src/adapters/board/ y src/core/config/env.ts NO fueron tocados (ADR 178: el diferido sigue vigente; su parte webhooks/ queda superada por WEBHOOK_HOST y closeIdleConnections de modo-headless-cierre-limpio, ADR 248-251)", () => {
      expect(
        diffStat(["src/adapters/board/", "src/core/config/env.ts"]).trim(),
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

  it("DESCRIPTORES queda en TRECE entradas (final) — 18 menos los cinco comandos HITL, dados de baja por aprobacion-conversacional-hitl (ADR 210 pto 1): /aprobar-solicitud y /rechazar-solicitud (tarea 10) + /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso (tarea 14)", () => {
    expect(COMANDOS).toHaveLength(13);
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

  it("ningún descriptor de los diez originales sobrevivientes cambió de nombre/forma (regresión ya cubierta por comando-empleado.test.ts — repetida acá como cierre explícito del Success Criterion; los cinco comandos HITL se dieron de baja, aprobacion-conversacional-hitl, ADR 210 pto 1: /aprobar-solicitud y /rechazar-solicitud —tarea 10— + /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso —tarea 14—)", () => {
    const originales = [
      ["/login", "id_mas_resto"],
      ["/logout", "sin_argumentos"],
      ["/soporte", "id_mas_resto"],
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

  it("los cinco comandos HITL ya no ocupan ningún índice de COMANDOS (aprobacion-conversacional-hitl, ADR 210 pto 1: tareas 10 y 14)", () => {
    const nombres = COMANDOS.map((d) => d.nombre);
    for (const bajado of [
      "/aprobar-solicitud",
      "/rechazar-solicitud",
      "/aprobar-reembolso",
      "/rechazar-reembolso",
      "/reabrir-reembolso",
    ]) {
      expect(nombres).not.toContain(bajado);
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

  /**
   * code-review de `comandos-administracion-empleados`, hallazgo 3: el paso
   * 6.5 del dispatcher (`build-on-comando-empleado.ts`) hace
   * `(sesion as SesionEmpleado).empleadoId` para todo comando con
   * `requiereAdministrador: true`, un cast que es seguro SOLO porque, por
   * convención (ADR 177 pto 3), todo descriptor así también es
   * `privilegiado: true` — lo que garantiza que el gate de sesión (paso 6,
   * ANTES en el mismo dispatcher) ya cortó la ejecución si no hay sesión
   * vigente. Nada fuerza esa convención a nivel de tipos: este test la
   * blinda a nivel de runtime, recorriendo TODOS los descriptores reales —
   * si algún día se agrega uno con `requiereAdministrador: true` y
   * `privilegiado: false`, este test rompe ANTES de que el cast del
   * dispatcher se vuelva inseguro.
   */
  it("todo descriptor con requiereAdministrador: true es también privilegiado: true (invariante del cast de sesión en el paso 6.5 del dispatcher)", () => {
    type DescriptorAdmin = { readonly nombre: string; readonly privilegiado: boolean; readonly requiereAdministrador: boolean };
    const descriptores = COMANDOS as unknown as readonly DescriptorAdmin[];
    const violaciones = descriptores.filter((d) => d.requiereAdministrador && !d.privilegiado);
    expect(violaciones).toEqual([]);
  });
});
