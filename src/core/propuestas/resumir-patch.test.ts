import { describe, expect, it } from "vitest";
import { contarBytesUtf8, resumirPatch } from "./resumir-patch.js";

describe("contarBytesUtf8 — verificado contra Buffer.byteLength (Node, sólo desde el test)", () => {
  const corpus: ReadonlyArray<readonly [string, string]> = [
    ["string vacía", ""],
    ["ASCII", "hello world"],
    ["acentos", "café con leche y ñoño"],
    ["CJK", "漢字とひらがなとカタカナ"],
    ["emoji (par surrogate)", "hola 😀 mundo"],
    // Surrogate alto huérfano AL FINAL de la string: sin unidad siguiente, la
    // rama "par surrogate" nunca se activa (i + 1 < texto.length es falso) y
    // cae en la rama final (3 bytes) — mismo resultado que Buffer.byteLength.
    ["surrogate alto huérfano (al final)", "texto\uD800"],
    // Surrogate bajo huérfano en medio de texto: un surrogate bajo NUNCA
    // entra a la rama de par (el chequeo es 0xD800-0xDBFF, rango de altos),
    // así que siempre toma la rama final (3 bytes) sin importar qué siga —
    // coincide con Buffer.byteLength en cualquier posición.
    ["surrogate bajo huérfano (en medio)", "texto\uDC00fin"],
    // Surrogate alto huérfano SEGUIDO de un BMP normal (no un surrogate bajo
    // válido): antes del fix, la rama "par surrogate" sólo chequeaba que
    // hubiera ALGUNA unidad siguiente (no que fuera un low surrogate real),
    // así que consumía "é" sin contarlo — resultado 4 en vez de 5. El low
    // surrogate válido es 0xDC00-0xDFFF; "é" (U+00E9) está fuera de ese
    // rango, así que la rama de par NUNCA debe activarse acá.
    ["surrogate alto huérfano seguido de BMP normal", "\uD800é"],
  ];

  it.each(corpus)("%s: coincide con Buffer.byteLength", (_etiqueta, texto) => {
    expect(contarBytesUtf8(texto)).toBe(Buffer.byteLength(texto, "utf8"));
  });

  it("no depende del orden de evaluación: el resultado es determinista", () => {
    const texto = "café 😀 漢字";
    expect(contarBytesUtf8(texto)).toBe(contarBytesUtf8(texto));
  });
});

describe("resumirPatch — patches fijados, un solo recorrido por líneas", () => {
  it("1 archivo: cuenta agregados y eliminados del mismo archivo", () => {
    const patch = [
      "diff --git a/foo.txt b/foo.txt",
      "index abc1234..def5678 100644",
      "--- a/foo.txt",
      "+++ b/foo.txt",
      "@@ -1,3 +1,3 @@",
      " line1",
      "-old line",
      "+new line",
      " line3",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen).toEqual({
      patchBytes: contarBytesUtf8(patch),
      archivos: 1,
      lineasAgregadas: 1,
      lineasEliminadas: 1,
    });
  });

  it("N archivos: cuenta una vez por cada línea 'diff --git '", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "index 111..222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,1 +1,1 @@",
      "-vieja a",
      "+nueva a",
      "diff --git a/b.txt b/b.txt",
      "index 333..444 100644",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1,2 +1,3 @@",
      " sin cambios",
      "+agregada b",
      "-eliminada b",
      "diff --git a/c.txt b/c.txt",
      "index 555..666 100644",
      "--- a/c.txt",
      "+++ b/c.txt",
      "@@ -1,1 +1,2 @@",
      " sin cambios",
      "+agregada c",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen.archivos).toBe(3);
    expect(resumen.lineasAgregadas).toBe(3);
    expect(resumen.lineasEliminadas).toBe(2);
    expect(resumen.patchBytes).toBe(contarBytesUtf8(patch));
  });

  it("sólo agregados: ninguna línea de eliminación fuera del header '---'", () => {
    const patch = [
      "diff --git a/existente.txt b/existente.txt",
      "index abc..def 100644",
      "--- a/existente.txt",
      "+++ b/existente.txt",
      "@@ -1,2 +1,4 @@",
      " line1",
      " line2",
      "+line3",
      "+line4",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen.archivos).toBe(1);
    expect(resumen.lineasAgregadas).toBe(2);
    expect(resumen.lineasEliminadas).toBe(0);
  });

  it("sólo borrados: ninguna línea de agregado fuera del header '+++'", () => {
    const patch = [
      "diff --git a/existente2.txt b/existente2.txt",
      "index abc..def 100644",
      "--- a/existente2.txt",
      "+++ b/existente2.txt",
      "@@ -1,4 +1,2 @@",
      " line1",
      "-line2",
      "-line3",
      " line4",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen.archivos).toBe(1);
    expect(resumen.lineasAgregadas).toBe(0);
    expect(resumen.lineasEliminadas).toBe(2);
  });

  it("archivo nuevo: '--- /dev/null' y '+++ b/...' no se cuentan como líneas de contenido", () => {
    const patch = [
      "diff --git a/nuevo.txt b/nuevo.txt",
      "new file mode 100644",
      "index 0000000..abc1234",
      "--- /dev/null",
      "+++ b/nuevo.txt",
      "@@ -0,0 +1,3 @@",
      "+primera",
      "+segunda",
      "+tercera",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen.archivos).toBe(1);
    expect(resumen.lineasAgregadas).toBe(3);
    expect(resumen.lineasEliminadas).toBe(0);
  });

  it("patch binario: sin líneas +/- de contenido, sólo el encabezado 'diff --git '", () => {
    const patch = [
      "diff --git a/imagen.png b/imagen.png",
      "index abc1234..def5678 100644",
      "Binary files a/imagen.png and b/imagen.png differ",
      "",
    ].join("\n");

    const resumen = resumirPatch(patch);

    expect(resumen).toEqual({
      patchBytes: contarBytesUtf8(patch),
      archivos: 1,
      lineasAgregadas: 0,
      lineasEliminadas: 0,
    });
  });

  it("string vacía: cero archivos, cero líneas, cero bytes", () => {
    const resumen = resumirPatch("");

    expect(resumen).toEqual({
      patchBytes: 0,
      archivos: 0,
      lineasAgregadas: 0,
      lineasEliminadas: 0,
    });
  });
});

describe("resumir-patch.ts source — PURO, sin ningún import", () => {
  it("no tiene ninguna línea 'import' ni 'require'", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(new URL("./resumir-patch.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
