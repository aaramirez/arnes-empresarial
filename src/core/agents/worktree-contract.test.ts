import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MOTIVO_PATCH_CONFLICTO,
  MOTIVO_PATCH_ERROR_GIT,
  type AplicarPatchPort,
  type BarridoResumen,
  type BarridoWorktreePort,
  type MotivoPatchNoAplicable,
  type ResultadoPatch,
  WORKTREE_MCP_SERVER_NAME,
  WORKTREE_RAMA_PREFIJO,
  WORKTREE_TEST_TOOL_NAME,
  WORKTREE_TEST_TOOL_QUALIFIED_NAME,
  type WorktreeAbierto,
  type WorktreePort,
} from "./worktree-contract.js";

describe("worktree-contract constants", () => {
  it("WORKTREE_MCP_SERVER_NAME es 'worktree'", () => {
    expect(WORKTREE_MCP_SERVER_NAME).toBe("worktree");
  });

  it("WORKTREE_TEST_TOOL_NAME es 'run_tests'", () => {
    expect(WORKTREE_TEST_TOOL_NAME).toBe("run_tests");
  });

  it("WORKTREE_TEST_TOOL_QUALIFIED_NAME es 'mcp__worktree__run_tests'", () => {
    expect(WORKTREE_TEST_TOOL_QUALIFIED_NAME).toBe("mcp__worktree__run_tests");
  });

  it("WORKTREE_RAMA_PREFIJO es 'harness/caso-'", () => {
    expect(WORKTREE_RAMA_PREFIJO).toBe("harness/caso-");
  });

  it("MOTIVO_PATCH_CONFLICTO es 'conflicto'", () => {
    expect(MOTIVO_PATCH_CONFLICTO).toBe("conflicto");
  });

  it("MOTIVO_PATCH_ERROR_GIT es 'error_git'", () => {
    expect(MOTIVO_PATCH_ERROR_GIT).toBe("error_git");
  });
});

describe("MotivoPatchNoAplicable", () => {
  it("acepta únicamente los dos literales declarados", () => {
    const motivos: readonly MotivoPatchNoAplicable[] = [
      MOTIVO_PATCH_CONFLICTO,
      MOTIVO_PATCH_ERROR_GIT,
    ];

    expect(motivos).toEqual(["conflicto", "error_git"]);
  });
});

describe("WorktreeAbierto", () => {
  it("tiene casoId, ruta, rama y baseCommit", () => {
    const worktree: WorktreeAbierto = {
      casoId: "caso-1",
      ruta: "/repo/.harness/worktrees/caso-1-abc",
      rama: "harness/caso-caso-1-abc",
      baseCommit: "deadbeef",
    };

    expect(worktree.casoId).toBe("caso-1");
    expect(worktree.ruta).toBe("/repo/.harness/worktrees/caso-1-abc");
    expect(worktree.rama).toBe("harness/caso-caso-1-abc");
    expect(worktree.baseCommit).toBe("deadbeef");
  });
});

describe("WorktreePort", () => {
  it("expone abrir, capturarDiff y cerrar con las firmas asimétricas del contrato", async () => {
    const worktree: WorktreeAbierto = {
      casoId: "caso-1",
      ruta: "/repo/.harness/worktrees/caso-1-abc",
      rama: "harness/caso-caso-1-abc",
      baseCommit: "deadbeef",
    };

    const port: WorktreePort = {
      abrir: async (input) => {
        expect(input.casoId).toBe("caso-1");
        expect(input.id).toBe("abc");
        return worktree;
      },
      capturarDiff: async (wt) => {
        expect(wt).toBe(worktree);
        return "diff --git a/x b/x";
      },
      cerrar: async (wt) => {
        expect(wt).toBe(worktree);
      },
    };

    const abierto = await port.abrir({ casoId: "caso-1", id: "abc" });
    const diff = await port.capturarDiff(abierto);
    await port.cerrar(abierto);

    expect(abierto).toBe(worktree);
    expect(diff).toBe("diff --git a/x b/x");
  });
});

describe("BarridoWorktreePort", () => {
  it("expone barrerHuerfanos que devuelve un BarridoResumen", async () => {
    const port: BarridoWorktreePort = {
      barrerHuerfanos: async (input) => {
        expect(input.ttlMs).toBe(7_200_000);
        expect(input.ahoraMs).toBe(1_000);
        const resumen: BarridoResumen = { examinados: 3, borrados: 1, fallidos: 0 };
        return resumen;
      },
    };

    const resumen = await port.barrerHuerfanos({ ttlMs: 7_200_000, ahoraMs: 1_000 });

    expect(resumen).toEqual({ examinados: 3, borrados: 1, fallidos: 0 });
  });
});

describe("ResultadoPatch", () => {
  /** Ejercita las dos variantes en un switch exhaustivo — falla en compilación si falta una. */
  function describirResultado(resultado: ResultadoPatch): string {
    if (resultado.ok) {
      return "ok";
    }
    switch (resultado.motivo) {
      case MOTIVO_PATCH_CONFLICTO:
        return `no-ok:${resultado.motivo}`;
      case MOTIVO_PATCH_ERROR_GIT:
        return `no-ok:${resultado.motivo}`;
    }
  }

  it("la variante ok:true no trae motivo", () => {
    const resultado: ResultadoPatch = { ok: true };

    expect(describirResultado(resultado)).toBe("ok");
  });

  it("la variante ok:false trae motivo y detalle opcional", () => {
    const resultado: ResultadoPatch = { ok: false, motivo: MOTIVO_PATCH_CONFLICTO };

    expect(describirResultado(resultado)).toBe("no-ok:conflicto");

    const conDetalle: ResultadoPatch = {
      ok: false,
      motivo: MOTIVO_PATCH_ERROR_GIT,
      detalle: "exit code 128",
    };

    expect(conDetalle.detalle).toBe("exit code 128");
    expect(describirResultado(conDetalle)).toBe("no-ok:error_git");
  });
});

describe("AplicarPatchPort", () => {
  it("expone verificar y aplicar, cada uno devolviendo un ResultadoPatch", async () => {
    const port: AplicarPatchPort = {
      verificar: async (patch) => {
        expect(patch).toBe("diff --git a/x b/x");
        return { ok: true };
      },
      aplicar: async (patch) => {
        expect(patch).toBe("diff --git a/x b/x");
        return { ok: false, motivo: MOTIVO_PATCH_ERROR_GIT };
      },
    };

    const verificado = await port.verificar("diff --git a/x b/x");
    const aplicado = await port.aplicar("diff --git a/x b/x");

    expect(verificado).toEqual({ ok: true });
    expect(aplicado).toEqual({ ok: false, motivo: MOTIVO_PATCH_ERROR_GIT });
  });
});

describe("worktree-contract.ts source", () => {
  it("has no import statements — the core module must not import SDK, Node, or adapters", () => {
    const sourcePath = fileURLToPath(new URL("./worktree-contract.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
