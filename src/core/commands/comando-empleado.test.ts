import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMANDOS, formatearAyuda, parsearComando } from "./comando-empleado.js";

/**
 * Spec `comando-empleado-tui`, requirements "Texto sin prefijo `/` se
 * delega intacto", "Reconocimiento y ruteo de los siete comandos",
 * "Comando desconocido o con argumentos faltantes responde con ayuda, sin
 * efecto" (ADR 21, 34 de la propuesta/diseño de `tui-canal-empleado`).
 */

describe("parsearComando", () => {
  it.each(["hola", "", "  hola", "hola /login"])(
    "texto sin '/' al inicio (%j) → undefined",
    (texto) => {
      expect(parsearComando(texto)).toBeUndefined();
    },
  );

  it("/login <id> <password> → tipo login con empleadoId y password", () => {
    expect(parsearComando("/login ana secreto")).toEqual({
      tipo: "login",
      empleadoId: "ana",
      password: "secreto",
    });
  });

  it("/login sin password → ayuda/argumentos", () => {
    expect(parsearComando("/login ana")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/login",
    });
  });

  it("/login ana mi pass larga → password es el resto de línea entero (ADR 34)", () => {
    expect(parsearComando("/login ana mi pass larga")).toEqual({
      tipo: "login",
      empleadoId: "ana",
      password: "mi pass larga",
    });
  });

  it("/login ana  pass   → password recorta solo los bordes con espacios (límite del trim, R4)", () => {
    expect(parsearComando("/login ana  pass  ")).toEqual({
      tipo: "login",
      empleadoId: "ana",
      password: "pass",
    });
  });

  it("/logout sin argumentos → tipo logout", () => {
    expect(parsearComando("/logout")).toEqual({ tipo: "logout" });
  });

  it("/logout con texto sobrante → se ignora, sigue siendo logout", () => {
    expect(parsearComando("/logout lo que sea")).toEqual({ tipo: "logout" });
  });

  it("/soporte <consulta multi-palabra> → tipo soporte con la consulta completa", () => {
    expect(parsearComando("/soporte no me llegó el link de confirmación")).toEqual({
      tipo: "soporte",
      consulta: "no me llegó el link de confirmación",
    });
  });

  it("/soporte sin consulta → ayuda/argumentos", () => {
    expect(parsearComando("/soporte")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/soporte",
    });
  });

  it("/devolucion <token> sin motivo → motivo AUSENTE (no cadena vacía)", () => {
    const resultado = parsearComando("/devolucion tok-1");
    expect(resultado).toEqual({ tipo: "devolucion", token: "tok-1" });
    expect(resultado && "motivo" in resultado ? resultado.motivo : undefined).toBeUndefined();
  });

  it("/devolucion tok se rompió todo → motivo es el resto de línea entero", () => {
    expect(parsearComando("/devolucion tok se rompió todo")).toEqual({
      tipo: "devolucion",
      token: "tok",
      motivo: "se rompió todo",
    });
  });

  it("/devolucion sin token → ayuda/argumentos", () => {
    expect(parsearComando("/devolucion")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/devolucion",
    });
  });

  it.each<["aprobar_reembolso" | "rechazar_reembolso" | "reabrir_reembolso", string]>([
    ["aprobar_reembolso", "/aprobar-reembolso"],
    ["rechazar_reembolso", "/rechazar-reembolso"],
    ["reabrir_reembolso", "/reabrir-reembolso"],
  ])("%s sin id → ventaId ausente", (tipo, prefijo) => {
    expect(parsearComando(prefijo)).toEqual({ tipo });
  });

  describe("forma id_opcional — el tipo se lee del descriptor, no de una cadena de nombres", () => {
    // Recorre DESCRIPTORES dinámicamente (vía COMANDOS, que es el mismo array
    // en runtime aunque el tipo público DescriptorComando no declare `forma`
    // ni `tipo`): así el test cubre cualquier comando de forma "id_opcional"
    // que exista hoy o se agregue mañana, sin hardcodear los tres nombres.
    type DescriptorConTipo = { readonly nombre: string; readonly tipo: string; readonly forma: string };
    const descriptoresIdOpcional = (COMANDOS as unknown as readonly DescriptorConTipo[]).filter(
      (d) => d.forma === "id_opcional",
    );

    it("hay al menos un descriptor de forma id_opcional (no testear un array vacío)", () => {
      expect(descriptoresIdOpcional.length).toBeGreaterThan(0);
    });

    it.each(descriptoresIdOpcional.map((d) => [d.nombre, d.tipo] as const))(
      "%s sin ventaId → tipo devuelto == descriptor.tipo declarado (%s)",
      (nombre, tipoDeclarado) => {
        expect(parsearComando(nombre)).toEqual({ tipo: tipoDeclarado });
      },
    );
  });

  it("/aprobar-reembolso <ventaId> → ventaId presente", () => {
    expect(parsearComando("/aprobar-reembolso venta-1")).toEqual({
      tipo: "aprobar_reembolso",
      ventaId: "venta-1",
    });
  });

  it("/rechazar-reembolso <ventaId> → ventaId presente", () => {
    expect(parsearComando("/rechazar-reembolso venta-9")).toEqual({
      tipo: "rechazar_reembolso",
      ventaId: "venta-9",
    });
  });

  it("/reabrir-reembolso <ventaId> → ventaId presente", () => {
    expect(parsearComando("/reabrir-reembolso venta-3")).toEqual({
      tipo: "reabrir_reembolso",
      ventaId: "venta-3",
    });
  });

  it("/ayuda explícito → motivo 'solicitada', sin campo comando", () => {
    expect(parsearComando("/ayuda")).toEqual({ tipo: "ayuda", motivo: "solicitada" });
  });

  it("comando desconocido → ayuda/desconocido, y 'comando' es SOLO el primer token", () => {
    expect(parsearComando("/noexiste algo mas")).toEqual({
      tipo: "ayuda",
      motivo: "desconocido",
      comando: "/noexiste",
    });
  });

  it("★ test de fuga ★: para '/logni ana secreto', JSON.stringify(resultado) NO contiene 'secreto'", () => {
    const resultado = parsearComando("/logni ana secreto");
    expect(JSON.stringify(resultado)).not.toContain("secreto");
    expect(resultado).toEqual({ tipo: "ayuda", motivo: "desconocido", comando: "/logni" });
  });
});

describe("formatearAyuda", () => {
  it("lista los ocho descriptores (siete comandos + ayuda)", () => {
    const texto = formatearAyuda();
    expect(COMANDOS).toHaveLength(8);
    for (const descriptor of COMANDOS) {
      expect(texto).toContain(descriptor.uso);
    }
  });
});

describe("comando-empleado.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./comando-empleado.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });
});
