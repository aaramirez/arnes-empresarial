import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultadoDescubrimiento } from "./descubrir-skills.js";

vi.mock("./descubrir-skills.js", () => ({
  descubrirSkills: vi.fn(),
}));

import { descubrirSkills } from "./descubrir-skills.js";
import { SKILLS_LOG_CORRELATION_ID } from "./skills-habilitadas.js";

const mockedDescubrirSkills = vi.mocked(descubrirSkills);

function resultado(nombres: readonly string[]): ResultadoDescubrimiento {
  return {
    baseAusente: false,
    skills: nombres.map((nombre) => ({ nombre, descripcion: "una descripcion cualquiera" })),
    omitidos: [],
  };
}

beforeEach(() => {
  vi.resetModules();
  mockedDescubrirSkills.mockReset();
});

describe("SKILLS_LOG_CORRELATION_ID", () => {
  it("es exactamente 'arranque-skills'", () => {
    expect(SKILLS_LOG_CORRELATION_ID).toBe("arranque-skills");
  });
});

describe("listarSkillsHabilitadas", () => {
  it("dos llamadas sin argumentos invocan a descubrirSkills una sola vez (memoización real)", async () => {
    mockedDescubrirSkills.mockReturnValue(resultado(["demo"]));
    const { listarSkillsHabilitadas } = await import("./skills-habilitadas.js");

    expect(listarSkillsHabilitadas()).toEqual(["demo"]);
    expect(listarSkillsHabilitadas()).toEqual(["demo"]);
    expect(mockedDescubrirSkills).toHaveBeenCalledTimes(1);
  });

  it("una llamada con base/deps explícitos no lee ni escribe la memo", async () => {
    mockedDescubrirSkills
      .mockReturnValueOnce(resultado(["original"]))
      .mockReturnValueOnce(resultado(["explicito"]));
    const { listarSkillsHabilitadas } = await import("./skills-habilitadas.js");

    expect(listarSkillsHabilitadas()).toEqual(["original"]);
    expect(listarSkillsHabilitadas(".claude/skills")).toEqual(["explicito"]);
    expect(listarSkillsHabilitadas()).toEqual(["original"]);
    expect(mockedDescubrirSkills).toHaveBeenCalledTimes(2);
  });

  it("si la primera llamada sin argumentos lanza, la siguiente reintenta (no memoiza el fallo)", async () => {
    mockedDescubrirSkills.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    mockedDescubrirSkills.mockReturnValueOnce(resultado(["demo"]));
    const { listarSkillsHabilitadas } = await import("./skills-habilitadas.js");

    expect(() => listarSkillsHabilitadas()).toThrow("boom");
    expect(listarSkillsHabilitadas()).toEqual(["demo"]);
    expect(mockedDescubrirSkills).toHaveBeenCalledTimes(2);
  });
});
