import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMANDOS, esComandoPrivilegiado, formatearAyuda, parsearComando } from "./comando-empleado.js";

/**
 * Spec `comando-empleado-tui`, requirements "Texto sin prefijo `/` se
 * delega intacto", "Reconocimiento y ruteo de los siete comandos",
 * "Comando desconocido o con argumentos faltantes responde con ayuda, sin
 * efecto" (ADR 21, 34 de la propuesta/diseño de `tui-canal-empleado`).
 *
 * Los tres comandos `/solicitar`, `/aprobar-solicitud`, `/rechazar-solicitud`
 * (Hito 5, tarea 20, §5.7, ADR 56) cubren un prerrequisito de puro parseo
 * de la spec `solicitud-interna-hitl` — la resolución real (validación,
 * escritura, confirmación en dos pasos) vive en
 * `resolver-solicitud-interna.ts` (tarea 18) y en el dispatcher
 * (`build-on-comando-empleado.ts`, tareas 22-23), no acá.
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

  describe("invariante nombre ↔ tipo (Reviewer finding: `tipo` es un campo escrito a mano en cada descriptor, sin nada del compilador que lo ate a `nombre` — un copy-paste puede dejarlos desincronizados)", () => {
    // No alcanza con probar que `parsearComando` propaga `descriptor.tipo` tal
    // cual (eso es tautológico: compara el descriptor contra sí mismo). Este
    // test verifica la convención REAL que los ocho descriptores siguen hoy
    // -- `nombre` sin la barra inicial, con `-` por `_`, es exactamente
    // `tipo` -- de forma INDEPENDIENTE de cómo el dispatcher lee `tipo`. Si
    // un futuro descriptor rompe la convención (nombre y tipo editados por
    // separado y quedan desincronizados), este test lo agarra sin necesidad
    // de ejercitar `parsearComando`.
    type DescriptorConTipo = { readonly nombre: string; readonly tipo: string };
    const descriptores = COMANDOS as unknown as readonly DescriptorConTipo[];

    it.each(descriptores.map((d) => [d.nombre, d.tipo] as const))(
      "%s → tipo declarado (%s) coincide con la convención nombre-sin-barra-con-guiones-bajos",
      (nombre, tipoDeclarado) => {
        expect(tipoDeclarado).toBe(nombre.slice(1).replace(/-/g, "_"));
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

  it("/solicitar <tipo> <detalle> → tipo solicitar con tipoSolicitud y detalle (ADR 56)", () => {
    expect(parsearComando("/solicitar vacaciones una semana en marzo")).toEqual({
      tipo: "solicitar",
      tipoSolicitud: "vacaciones",
      detalle: "una semana en marzo",
    });
  });

  it("/solicitar sin detalle (solo tipo) → ayuda/argumentos", () => {
    expect(parsearComando("/solicitar vacaciones")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/solicitar",
    });
  });

  it("/solicitar sin ningún argumento → ayuda/argumentos", () => {
    expect(parsearComando("/solicitar")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/solicitar",
    });
  });

  it.each<["aprobar_solicitud" | "rechazar_solicitud" | "cancelar_solicitud", string]>([
    ["aprobar_solicitud", "/aprobar-solicitud"],
    ["rechazar_solicitud", "/rechazar-solicitud"],
    ["cancelar_solicitud", "/cancelar-solicitud"],
  ])("%s sin id → solicitudId ausente", (tipo, prefijo) => {
    expect(parsearComando(prefijo)).toEqual({ tipo });
  });

  describe("forma id_opcional_solicitud — el tipo se lee del descriptor, no de una cadena de nombres (ADR 56)", () => {
    // Mismo criterio que el describe de "forma id_opcional" de arriba: recorre
    // DESCRIPTORES dinámicamente vía COMANDOS, así el test cubre cualquier
    // comando de forma "id_opcional_solicitud" que exista hoy o se agregue
    // mañana, sin hardcodear los nombres.
    type DescriptorConTipo = { readonly nombre: string; readonly tipo: string; readonly forma: string };
    const descriptoresIdOpcionalSolicitud = (COMANDOS as unknown as readonly DescriptorConTipo[]).filter(
      (d) => d.forma === "id_opcional_solicitud",
    );

    it("hay al menos un descriptor de forma id_opcional_solicitud (no testear un array vacío)", () => {
      expect(descriptoresIdOpcionalSolicitud.length).toBeGreaterThan(0);
    });

    it.each(descriptoresIdOpcionalSolicitud.map((d) => [d.nombre, d.tipo] as const))(
      "%s sin solicitudId → tipo devuelto == descriptor.tipo declarado (%s)",
      (nombre, tipoDeclarado) => {
        expect(parsearComando(nombre)).toEqual({ tipo: tipoDeclarado });
      },
    );
  });

  it("/aprobar-solicitud <solicitudId> → solicitudId presente", () => {
    expect(parsearComando("/aprobar-solicitud sol-1")).toEqual({
      tipo: "aprobar_solicitud",
      solicitudId: "sol-1",
    });
  });

  it("/rechazar-solicitud <solicitudId> → solicitudId presente", () => {
    expect(parsearComando("/rechazar-solicitud sol-9")).toEqual({
      tipo: "rechazar_solicitud",
      solicitudId: "sol-9",
    });
  });

  it("/cancelar-solicitud <solicitudId> → solicitudId presente (comando-cancelar-solicitud, tarea 9, ADR 127)", () => {
    expect(parsearComando("/cancelar-solicitud S-7")).toEqual({
      tipo: "cancelar_solicitud",
      solicitudId: "S-7",
    });
  });

  it("Forma id_opcional_solicitud reusada: el descriptor de /cancelar-solicitud NO agrega una forma propia (spec cancelacion-solicitud-interna)", () => {
    const cancelar = (COMANDOS as unknown as readonly { readonly nombre: string; readonly forma: string }[]).find(
      (d) => d.nombre === "/cancelar-solicitud",
    );
    expect(cancelar?.forma).toBe("id_opcional_solicitud");
  });

  it("/ver-propuesta sin propuestaId → propuestaId ausente (ADR 69)", () => {
    expect(parsearComando("/ver-propuesta")).toEqual({ tipo: "ver_propuesta" });
  });

  it("/ver-propuesta <propuestaId> → propuestaId presente (ADR 69)", () => {
    expect(parsearComando("/ver-propuesta prop-1")).toEqual({
      tipo: "ver_propuesta",
      propuestaId: "prop-1",
    });
  });

  describe("forma id_opcional_propuesta — el tipo se lee del descriptor, no de una cadena de nombres (ADR 69)", () => {
    // Mismo criterio que los describes de "forma id_opcional"/"forma
    // id_opcional_solicitud" de arriba: recorre DESCRIPTORES dinámicamente
    // vía COMANDOS, sin hardcodear nombres.
    type DescriptorConTipo = { readonly nombre: string; readonly tipo: string; readonly forma: string };
    const descriptoresIdOpcionalPropuesta = (COMANDOS as unknown as readonly DescriptorConTipo[]).filter(
      (d) => d.forma === "id_opcional_propuesta",
    );

    it("hay al menos un descriptor de forma id_opcional_propuesta (no testear un array vacío)", () => {
      expect(descriptoresIdOpcionalPropuesta.length).toBeGreaterThan(0);
    });

    it.each(descriptoresIdOpcionalPropuesta.map((d) => [d.nombre, d.tipo] as const))(
      "%s sin propuestaId → tipo devuelto == descriptor.tipo declarado (%s)",
      (nombre, tipoDeclarado) => {
        expect(parsearComando(nombre)).toEqual({ tipo: tipoDeclarado });
      },
    );
  });

  it("/aplicar-propuesta <propuestaId> → tipo aplicar_propuesta con propuestaId (ADR 69)", () => {
    expect(parsearComando("/aplicar-propuesta prop-1")).toEqual({
      tipo: "aplicar_propuesta",
      propuestaId: "prop-1",
    });
  });

  it("/aplicar-propuesta sin propuestaId → ayuda/argumentos (propuestaId es OBLIGATORIO, ADR 69)", () => {
    expect(parsearComando("/aplicar-propuesta")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/aplicar-propuesta",
    });
  });

  it("/aplicar-propuesta prop-1 resto ignorado → el resultado NO lleva 'motivo' (el tipo no lo tiene, ADR 69)", () => {
    const resultado = parsearComando("/aplicar-propuesta prop-1 esto no debería importar");
    expect(resultado).toEqual({ tipo: "aplicar_propuesta", propuestaId: "prop-1" });
    expect(resultado && "motivo" in resultado).toBe(false);
  });

  it("/descartar-propuesta <propuestaId> \"motivo con espacios\" → motivo es el resto de línea entero (ADR 69)", () => {
    expect(parsearComando("/descartar-propuesta prop-1 ya no aplica, cambió el requisito")).toEqual({
      tipo: "descartar_propuesta",
      propuestaId: "prop-1",
      motivo: "ya no aplica, cambió el requisito",
    });
  });

  it("/descartar-propuesta <propuestaId> sin motivo → motivo AUSENTE (no cadena vacía, ADR 69)", () => {
    const resultado = parsearComando("/descartar-propuesta prop-1");
    expect(resultado).toEqual({ tipo: "descartar_propuesta", propuestaId: "prop-1" });
    expect(resultado && "motivo" in resultado ? resultado.motivo : undefined).toBeUndefined();
  });

  it("/descartar-propuesta sin propuestaId → ayuda/argumentos (ADR 69)", () => {
    expect(parsearComando("/descartar-propuesta")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/descartar-propuesta",
    });
  });

  it("/consultar-kpi <consulta multi-palabra> → tipo consultar_kpi con la consulta completa (ADR 85)", () => {
    expect(parsearComando("/consultar-kpi hola que tal")).toEqual({
      tipo: "consultar_kpi",
      consulta: "hola que tal",
    });
  });

  it("★ crítico ★: /consultar-kpi hola que tal NO cae en el fallthrough de /devolucion (ADR 85)", () => {
    const resultado = parsearComando("/consultar-kpi hola que tal");
    expect(resultado).not.toEqual({ tipo: "devolucion", token: "hola", motivo: "que tal" });
    expect(resultado?.tipo).not.toBe("devolucion");
  });

  it("/consultar-kpi sin consulta → ayuda/argumentos (ADR 85)", () => {
    expect(parsearComando("/consultar-kpi")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/consultar-kpi",
    });
  });

  it("/consultar-kpi con solo espacios → ayuda/argumentos (ADR 85)", () => {
    expect(parsearComando("/consultar-kpi    ")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/consultar-kpi",
    });
  });

  it("/reporte-comisiones 2026-08 → tipo reporte_comisiones con periodo presente (comando-reporte-comisiones, tarea 3)", () => {
    expect(parsearComando("/reporte-comisiones 2026-08")).toEqual({
      tipo: "reporte_comisiones",
      periodo: "2026-08",
    });
  });

  it("/reporte-comisiones sin argumento → tipo reporte_comisiones sin campo periodo, sin validar formato acá (ADR 123 pto 1)", () => {
    const resultado = parsearComando("/reporte-comisiones");
    expect(resultado).toEqual({ tipo: "reporte_comisiones" });
    expect(resultado && "periodo" in resultado).toBe(false);
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
  it("lista los diecisiete descriptores (dieciséis previos + /cancelar-solicitud, comando-cancelar-solicitud tarea 9)", () => {
    const texto = formatearAyuda();
    expect(COMANDOS).toHaveLength(17);
    for (const descriptor of COMANDOS) {
      expect(texto).toContain(descriptor.uso);
    }
  });

  it("incluye la línea de /consultar-kpi (ADR 85)", () => {
    const texto = formatearAyuda();
    expect(texto).toContain("/consultar-kpi <consulta>");
  });

  it("incluye la línea de /reporte-comisiones (comando-reporte-comisiones, tarea 3)", () => {
    const texto = formatearAyuda();
    expect(texto).toContain("/reporte-comisiones [periodo]");
  });
});

describe("esComandoPrivilegiado", () => {
  it.each(["solicitar", "aprobar_solicitud", "rechazar_solicitud"] as const)(
    "%s es privilegiado (ADR 56, exige sesión vigente)",
    (tipo) => {
      expect(esComandoPrivilegiado(tipo)).toBe(true);
    },
  );

  it.each(["ver_propuesta", "aplicar_propuesta", "descartar_propuesta"] as const)(
    "%s es privilegiado (ADR 69, exige sesión vigente — incluso ver-propuesta, que no escribe)",
    (tipo) => {
      expect(esComandoPrivilegiado(tipo)).toBe(true);
    },
  );

  it("consultar_kpi es privilegiado (ADR 85, manda contexto de la empresa a un tercero externo)", () => {
    expect(esComandoPrivilegiado("consultar_kpi")).toBe(true);
  });

  it("reporte_comisiones es privilegiado (ADR 117, comando-reporte-comisiones tarea 3)", () => {
    expect(esComandoPrivilegiado("reporte_comisiones")).toBe(true);
  });

  it("cancelar_solicitud es privilegiado (ADR 127, comando-cancelar-solicitud tarea 9 — sin sesión el comando se rechaza antes de leer nada)", () => {
    expect(esComandoPrivilegiado("cancelar_solicitud")).toBe(true);
  });
});

describe("regresión — los ocho descriptores de v1.4.0 no cambian de orden ni de forma (tarea 20)", () => {
  // Los tres nuevos van ANTES de /ayuda, que "sigue último" (design.md §5.7):
  // los primeros siete originales conservan su índice, /ayuda pasa del
  // índice 7 al 10, y los tres nuevos ocupan los índices 7-9 en el orden en
  // que design.md §5.7 los tabula.
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("los primeros siete (todo lo anterior a /ayuda en v1.4.0) conservan nombre y forma", () => {
    expect(descriptores.slice(0, 7).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/login", "id_mas_resto"],
      ["/logout", "sin_argumentos"],
      ["/soporte", "id_mas_resto"],
      ["/devolucion", "id_mas_resto"],
      ["/aprobar-reembolso", "id_opcional"],
      ["/rechazar-reembolso", "id_opcional"],
      ["/reabrir-reembolso", "id_opcional"],
    ]);
  });

  it("los tres descriptores de Hito 5 (índices 7-9) conservan nombre y forma (design.md §5.7, ADR 56)", () => {
    expect(descriptores.slice(7, 10).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/solicitar", "id_mas_resto"],
      ["/aprobar-solicitud", "id_opcional_solicitud"],
      ["/rechazar-solicitud", "id_opcional_solicitud"],
    ]);
  });
});

describe("regresión — los tres descriptores nuevos de la tarea 29 van antes de /ayuda, que sigue último (ADR 69)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("los tres descriptores nuevos ocupan los índices 10-12, en el orden de design.md §5.9 / ADR 69", () => {
    expect(descriptores.slice(10, 13).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/ver-propuesta", "id_opcional_propuesta"],
      ["/aplicar-propuesta", "id_mas_resto"],
      ["/descartar-propuesta", "id_mas_resto"],
    ]);
  });

  it("/ayuda sigue último (índice 16, tras la incorporación de /cancelar-solicitud en comando-cancelar-solicitud tarea 9)", () => {
    expect(descriptores).toHaveLength(17);
    expect(descriptores[16]).toMatchObject({ nombre: "/ayuda", forma: "sin_argumentos" });
  });
});

describe("regresión — el descriptor nuevo de la tarea 19 va antes de /ayuda, que sigue último (ADR 85)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/consultar-kpi ocupa el índice 13, en el orden de design.md §5.7.1 / ADR 85", () => {
    expect(descriptores[13]).toMatchObject({ nombre: "/consultar-kpi", forma: "id_mas_resto" });
  });
});

describe("regresión — el descriptor nuevo de comando-reporte-comisiones (tarea 3) va antes de /ayuda, que sigue último (ADR 117, 119)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/reporte-comisiones ocupa el índice 14, en el orden de design.md §3 / ADR 119", () => {
    expect(descriptores[14]).toMatchObject({ nombre: "/reporte-comisiones", forma: "id_opcional_periodo" });
  });
});

describe("regresión — el descriptor nuevo de la tarea 9 (comando-cancelar-solicitud) va antes de /ayuda, que sigue último (ADR 127)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/cancelar-solicitud ocupa el índice 15, forma reusada id_opcional_solicitud (comando-cancelar-solicitud, tarea 9)", () => {
    expect(descriptores[15]).toMatchObject({ nombre: "/cancelar-solicitud", forma: "id_opcional_solicitud" });
  });
});

describe("Forma no gana un miembro nuevo (comando-cancelar-solicitud, tarea 9 — reusa id_opcional_solicitud, no crea una forma propia)", () => {
  // `Forma` es un tipo privado de comando-empleado.ts, no exportado: se
  // verifica en runtime sobre el conjunto de valores `forma` realmente en
  // uso en COMANDOS, que es la proyección observable del tipo. El número de
  // referencia es 6 (no 7): al momento de esta tarea, `id_opcional_periodo`
  // ya fue incorporado por `comando-reporte-comisiones` (mergeado a main
  // antes que este change), así que la unión ya tenía seis miembros -- no
  // cinco -- antes de esta tarea.
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("el conjunto de formas distintas en uso sigue teniendo seis miembros (no siete) tras agregar /cancelar-solicitud", () => {
    const formasDistintas = new Set(descriptores.map((d) => d.forma));
    expect(formasDistintas.size).toBe(6);
  });
});

describe("comando-empleado.ts source", () => {
  it("no tiene declaraciones import — módulo puro, sin dependencias", () => {
    const sourcePath = fileURLToPath(new URL("./comando-empleado.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bimport\b/);
  });

  it("no referencia ningún reloj (Date) — el default de /reporte-comisiones sin periodo se resuelve en otra capa (ADR 119, 123)", () => {
    const sourcePath = fileURLToPath(new URL("./comando-empleado.ts", import.meta.url));
    const source = readFileSync(sourcePath, "utf-8");

    expect(source).not.toMatch(/\bDate\b/);
  });
});
