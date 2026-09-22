import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CUERPO_LISTO,
  CUERPO_VIVO,
  OPS_CLOSE_TIMEOUT_MS,
  OPS_LOG_CORRELATION_ID,
  RUTA_LISTO,
  RUTA_VIVO,
  isOpsEnabled,
  resolveOpsConfig,
} from "./config.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function listarArchivosTs(dir: string): string[] {
  const archivos: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...listarArchivosTs(ruta));
      continue;
    }
    if (entrada.name.endsWith(".ts") && !entrada.name.endsWith(".test.ts")) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

describe("resolveOpsConfig — S1: OPS_PORT es el único gate, nunca lanza", () => {
  it("returns port 0 and isOpsEnabled false for an empty env", () => {
    const config = resolveOpsConfig({});

    expect(config.port).toBe(0);
    expect(isOpsEnabled(config)).toBe(false);
  });

  it("returns port 8788 and isOpsEnabled true when OPS_PORT is a valid positive integer", () => {
    const config = resolveOpsConfig({ OPS_PORT: "8788" });

    expect(config.port).toBe(8788);
    expect(isOpsEnabled(config)).toBe(true);
  });

  it.each(["", "   ", "abc", "0", "-1", "NaN", "Infinity", "8788x"])(
    "does not throw and disables the listener when OPS_PORT is %s",
    (raw) => {
      expect(() => resolveOpsConfig({ OPS_PORT: raw })).not.toThrow();

      const config = resolveOpsConfig({ OPS_PORT: raw });

      expect(config.port).toBe(0);
      expect(isOpsEnabled(config)).toBe(false);
    },
  );
});

describe("resolveOpsConfig — S2: puertoInvalido presente SOLO si OPS_PORT venía y no servía", () => {
  it.each(["abc", "0", "-1"])(
    "includes puertoInvalido with the raw value when OPS_PORT is %s",
    (raw) => {
      const config = resolveOpsConfig({ OPS_PORT: raw });

      expect(config.puertoInvalido).toBe(raw);
    },
  );

  it("omits the puertoInvalido KEY when OPS_PORT is absent", () => {
    const config = resolveOpsConfig({});

    expect("puertoInvalido" in config).toBe(false);
  });

  it.each(["", "   "])("omits the puertoInvalido KEY when OPS_PORT is %s (blank)", (raw) => {
    const config = resolveOpsConfig({ OPS_PORT: raw });

    expect("puertoInvalido" in config).toBe(false);
  });

  it("omits the puertoInvalido KEY when OPS_PORT is valid", () => {
    const config = resolveOpsConfig({ OPS_PORT: "8788" });

    expect("puertoInvalido" in config).toBe(false);
  });
});

describe("resolveOpsConfig — S3 (config): OPS_HOST opcional, clave omitida por default", () => {
  it("omits the host KEY (never host: undefined) when OPS_HOST is absent", () => {
    const config = resolveOpsConfig({ OPS_PORT: "8788" });

    expect("host" in config).toBe(false);
  });

  it.each(["", "   "])("omits the host KEY when OPS_HOST is %s (blank)", (raw) => {
    const config = resolveOpsConfig({ OPS_PORT: "8788", OPS_HOST: raw });

    expect("host" in config).toBe(false);
  });

  it("keeps OPS_HOST exactly as configured", () => {
    const config = resolveOpsConfig({ OPS_PORT: "8788", OPS_HOST: "127.0.0.1" });

    expect(config.host).toBe("127.0.0.1");
  });
});

describe("Constantes — RD-130, ADR 251", () => {
  it("OPS_CLOSE_TIMEOUT_MS is the constant 5000, never read from env", () => {
    expect(OPS_CLOSE_TIMEOUT_MS).toBe(5000);

    let coincidencias = 0;
    for (const archivo of listarArchivosTs(SRC_DIR)) {
      const contenido = readFileSync(archivo, "utf-8");
      if (contenido.includes("env.OPS_CLOSE_TIMEOUT_MS")) {
        coincidencias += 1;
      }
    }
    expect(coincidencias).toBe(0);
  });

  it("OPS_LOG_CORRELATION_ID is the literal ops-adapter", () => {
    expect(OPS_LOG_CORRELATION_ID).toBe("ops-adapter");
  });

  it("RUTA_VIVO and RUTA_LISTO are the literal /salud/vivo and /salud/listo", () => {
    expect(RUTA_VIVO).toBe("/salud/vivo");
    expect(RUTA_LISTO).toBe("/salud/listo");
  });

  it("CUERPO_VIVO and CUERPO_LISTO are the literal vivo and listo", () => {
    expect(CUERPO_VIVO).toBe("vivo");
    expect(CUERPO_LISTO).toBe("listo");
  });
});
