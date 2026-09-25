import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMANDOS, esComandoPrivilegiado, formatearAyuda, parsearComando, requiereAdministrador } from "./comando-empleado.js";
import { contieneSecreto, enmascararSecreto } from "./comando-empleado.js";

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

  it("★ /estado-bot-prs (comandos-administracion-empleados, tarea 3, ADR 185) → tipo estado_bot_prs, NO logout — blinda la corrección de la rama genérica de 'sin_argumentos', que devolvía hardcodeado {tipo:'logout'}", () => {
    expect(parsearComando("/estado-bot-prs")).toEqual({ tipo: "estado_bot_prs" });
  });

  it("/estado-bot-prs con texto sobrante → se ignora, sigue siendo estado_bot_prs (mismo criterio que /logout)", () => {
    expect(parsearComando("/estado-bot-prs lo que sea")).toEqual({ tipo: "estado_bot_prs" });
  });

  it("/asignar-rol <empleadoId> <rol> → tipo asignar_rol con empleadoId y rol (comandos-administracion-empleados, tarea 7, ADR 184)", () => {
    expect(parsearComando("/asignar-rol ana administrador")).toEqual({
      tipo: "asignar_rol",
      empleadoId: "ana",
      rol: "administrador",
    });
  });

  it("/asignar-rol sin rol → ayuda/argumentos", () => {
    expect(parsearComando("/asignar-rol ana")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/asignar-rol",
    });
  });

  it("/asignar-rol sin argumentos → ayuda/argumentos", () => {
    expect(parsearComando("/asignar-rol")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/asignar-rol",
    });
  });

  it("/asignar-rol ana lo-que-sea → el parser NO valida el formato de rol (ADR 177 pto 2): 'rol' viaja como string plano, la validación contra ROLES_EMPLEADO vive en el dispatcher", () => {
    expect(parsearComando("/asignar-rol ana lo-que-sea")).toEqual({
      tipo: "asignar_rol",
      empleadoId: "ana",
      rol: "lo-que-sea",
    });
  });

  it("/crear-empleado <empleadoId> <password> → tipo crear_empleado con empleadoId y password (comandos-administracion-empleados, tarea 8, ADR 184)", () => {
    expect(parsearComando("/crear-empleado ana secreto-largo-123")).toEqual({
      tipo: "crear_empleado",
      empleadoId: "ana",
      password: "secreto-largo-123",
    });
  });

  it("/crear-empleado ana mi pass larga → password es el resto de línea entero (mismo criterio que /login, ADR 34)", () => {
    expect(parsearComando("/crear-empleado ana mi pass larga")).toEqual({
      tipo: "crear_empleado",
      empleadoId: "ana",
      password: "mi pass larga",
    });
  });

  it("/crear-empleado sin password → ayuda/argumentos", () => {
    expect(parsearComando("/crear-empleado ana")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/crear-empleado",
    });
  });

  it("/crear-empleado sin argumentos → ayuda/argumentos", () => {
    expect(parsearComando("/crear-empleado")).toEqual({
      tipo: "ayuda",
      motivo: "argumentos",
      comando: "/crear-empleado",
    });
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

  it.each(["/devolucion", "/devolucion tok-1", "/devolucion tok se rompió todo"])(
    "%j → ayuda/desconocido: /devolucion ya no es un comando (baja, operaciones-negocio-conversacionales, ADR 148 pto 2, tarea 14 — se resuelve por conversación vía la herramienta `operaciones`)",
    (texto) => {
      expect(parsearComando(texto)).toEqual({
        tipo: "ayuda",
        motivo: "desconocido",
        comando: "/devolucion",
      });
    },
  );

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

  it.each(["/solicitar", "/solicitar vacaciones", "/solicitar vacaciones una semana en marzo"])(
    "%j → ayuda/desconocido: /solicitar ya no es un comando (baja, operaciones-negocio-conversacionales, ADR 148 pto 2, tarea 14 — se resuelve por conversación vía la herramienta `operaciones`)",
    (texto) => {
      expect(parsearComando(texto)).toEqual({
        tipo: "ayuda",
        motivo: "desconocido",
        comando: "/solicitar",
      });
    },
  );

  it.each([
    "/aprobar-solicitud",
    "/aprobar-solicitud sol-1",
    "/rechazar-solicitud",
    "/rechazar-solicitud sol-9",
  ])(
    "%j → ayuda/desconocido: /aprobar-solicitud y /rechazar-solicitud ya no son comandos (baja, aprobacion-conversacional-hitl, ADR 210 pto 1, tarea 10 — se resuelven por conversación vía la herramienta `operaciones`, resolver_solicitud)",
    (texto) => {
      const comandoToken = texto.split(" ")[0];
      expect(parsearComando(texto)).toEqual({
        tipo: "ayuda",
        motivo: "desconocido",
        comando: comandoToken,
      });
    },
  );

  it.each(["/cancelar-solicitud", "/cancelar-solicitud S-7"])(
    "%j → ayuda/desconocido: /cancelar-solicitud ya no es un comando (baja, operaciones-negocio-conversacionales, ADR 148 pto 2, tarea 14 — se resuelve por conversación vía la herramienta `operaciones`)",
    (texto) => {
      expect(parsearComando(texto)).toEqual({
        tipo: "ayuda",
        motivo: "desconocido",
        comando: "/cancelar-solicitud",
      });
    },
  );

  it("/cancelar-solicitud ya no está en COMANDOS (baja, operaciones-negocio-conversacionales, tarea 14)", () => {
    const cancelar = (COMANDOS as unknown as readonly { readonly nombre: string }[]).find(
      (d) => d.nombre === "/cancelar-solicitud",
    );
    expect(cancelar).toBeUndefined();
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

  it("/ver-solicitudes-a2a X → tipo ver_solicitudes_a2a con a2aTaskId presente (comando-visibilidad-a2a-entrante, tarea 5, ADR 56/138)", () => {
    expect(parsearComando("/ver-solicitudes-a2a X")).toEqual({
      tipo: "ver_solicitudes_a2a",
      a2aTaskId: "X",
    });
  });

  it("/ver-solicitudes-a2a sin argumento → tipo ver_solicitudes_a2a sin a2aTaskId (comando-visibilidad-a2a-entrante, tarea 5)", () => {
    const resultado = parsearComando("/ver-solicitudes-a2a");
    expect(resultado).toEqual({ tipo: "ver_solicitudes_a2a" });
    expect(resultado && "a2aTaskId" in resultado).toBe(false);
  });

  describe("forma id_opcional_a2a_task — el tipo se lee del descriptor, no de una cadena de nombres (comando-visibilidad-a2a-entrante, tarea 5, ADR 56/138)", () => {
    // Mismo criterio que los describes de "forma id_opcional*" de arriba:
    // recorre DESCRIPTORES dinámicamente vía COMANDOS, sin hardcodear nombres.
    type DescriptorConTipo = { readonly nombre: string; readonly tipo: string; readonly forma: string };
    const descriptoresIdOpcionalA2ATask = (COMANDOS as unknown as readonly DescriptorConTipo[]).filter(
      (d) => d.forma === "id_opcional_a2a_task",
    );

    it("hay al menos un descriptor de forma id_opcional_a2a_task (no testear un array vacío)", () => {
      expect(descriptoresIdOpcionalA2ATask.length).toBeGreaterThan(0);
    });

    it.each(descriptoresIdOpcionalA2ATask.map((d) => [d.nombre, d.tipo] as const))(
      "%s sin a2aTaskId → tipo devuelto == descriptor.tipo declarado (%s)",
      (nombre, tipoDeclarado) => {
        expect(parsearComando(nombre)).toEqual({ tipo: tipoDeclarado });
      },
    );
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
  it("lista los TRECE descriptores finales (18 − 5 por la baja de los cinco comandos HITL: /aprobar-solicitud y /rechazar-solicitud —tarea 10— más /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso —tarea 14—) — conteo final, verificado contra el estado real de main (banner de tasks.md)", () => {
    const texto = formatearAyuda();
    expect(COMANDOS).toHaveLength(13);
    for (const descriptor of COMANDOS) {
      expect(texto).toContain(descriptor.uso);
    }
  });

  it("incluye la línea de /asignar-rol (comandos-administracion-empleados, tarea 7, ADR 184)", () => {
    const texto = formatearAyuda();
    expect(texto).toContain("/asignar-rol <empleadoId> <rol>");
  });

  it("incluye la línea de /crear-empleado (comandos-administracion-empleados, tarea 8, ADR 184)", () => {
    const texto = formatearAyuda();
    expect(texto).toContain("/crear-empleado <empleadoId> <password>");
  });

  it("incluye la línea de /estado-bot-prs (comandos-administracion-empleados, tarea 3, ADR 185)", () => {
    const texto = formatearAyuda();
    expect(texto).toContain("/estado-bot-prs");
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
  it("solicitar ya no es privilegiado: sin descriptor, esComandoPrivilegiado cae al default false (baja, operaciones-negocio-conversacionales, tarea 14)", () => {
    expect(esComandoPrivilegiado("solicitar")).toBe(false);
  });

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

  it("cancelar_solicitud ya no es privilegiado: sin descriptor, esComandoPrivilegiado cae al default false (baja, operaciones-negocio-conversacionales, tarea 14)", () => {
    expect(esComandoPrivilegiado("cancelar_solicitud")).toBe(false);
  });

  it("ver_solicitudes_a2a es privilegiado (ADR 138, comando-visibilidad-a2a-entrante tarea 5 — el resultado de una tarea COMPLETED es la respuesta real que el arnés dio a un tercero)", () => {
    expect(esComandoPrivilegiado("ver_solicitudes_a2a")).toBe(true);
  });

  it("estado_bot_prs es privilegiado (comandos-administracion-empleados, tarea 3, ADR 185 — exige sesión, mismo criterio que /consultar-kpi/reporte-comisiones)", () => {
    expect(esComandoPrivilegiado("estado_bot_prs")).toBe(true);
  });

  it("asignar_rol es privilegiado (comandos-administracion-empleados, tarea 7, ADR 177 pto 3 — exige sesión, distinto del gate de administrador)", () => {
    expect(esComandoPrivilegiado("asignar_rol")).toBe(true);
  });

  it("crear_empleado es privilegiado (comandos-administracion-empleados, tarea 8, ADR 177 pto 3 — exige sesión, distinto del gate de administrador)", () => {
    expect(esComandoPrivilegiado("crear_empleado")).toBe(true);
  });
});

describe("regresión — descriptores previos conservan nombre y forma tras la baja de autoservicio (operaciones-negocio-conversacionales, tarea 14) y la baja de los cinco comandos HITL (aprobacion-conversacional-hitl, tarea 10 + tarea 14; índices recalculados)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("los primeros tres (sin /devolucion ni los tres de reembolso, todos dados de baja) conservan nombre y forma", () => {
    expect(descriptores.slice(0, 3).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/login", "id_mas_resto"],
      ["/logout", "sin_argumentos"],
      ["/soporte", "id_mas_resto"],
    ]);
  });

  it("los cinco comandos HITL (/aprobar-solicitud, /rechazar-solicitud, tarea 10; /aprobar-reembolso, /rechazar-reembolso, /reabrir-reembolso, tarea 14) se dieron de baja — el índice 3 ahora es /ver-propuesta, sin hueco", () => {
    expect(descriptores.slice(3, 5).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/ver-propuesta", "id_opcional_propuesta"],
      ["/aplicar-propuesta", "id_mas_resto"],
    ]);
  });
});

describe("regresión — los tres descriptores de la tarea 29 van antes de /ayuda, que sigue último (ADR 69; índices recalculados tras la baja de autoservicio, tarea 14, y la baja de los cinco comandos HITL, aprobacion-conversacional-hitl tareas 10 y 14)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("los tres descriptores ocupan los índices 3-5, en el orden de design.md §5.9 / ADR 69", () => {
    expect(descriptores.slice(3, 6).map((d) => [d.nombre, d.forma] as const)).toEqual([
      ["/ver-propuesta", "id_opcional_propuesta"],
      ["/aplicar-propuesta", "id_mas_resto"],
      ["/descartar-propuesta", "id_mas_resto"],
    ]);
  });

  it("/ayuda sigue último (índice 12, TRECE descriptores — conteo final: baja de /devolucion, /solicitar, /cancelar-solicitud (tarea 14 de operaciones-negocio-conversacionales) + baja de /aprobar-solicitud, /rechazar-solicitud (aprobacion-conversacional-hitl, tarea 10) + baja de /aprobar-reembolso, /rechazar-reembolso, /reabrir-reembolso (aprobacion-conversacional-hitl, tarea 14) + alta de /estado-bot-prs (tarea 3) + /asignar-rol (tarea 7) + /crear-empleado (tarea 8))", () => {
    expect(descriptores).toHaveLength(13);
    expect(descriptores[12]).toMatchObject({ nombre: "/ayuda", forma: "sin_argumentos" });
  });
});

describe("regresión — /asignar-rol (comandos-administracion-empleados, tarea 7, ADR 184) va antes de /ayuda, que sigue último", () => {
  type DescriptorConForma = {
    readonly nombre: string;
    readonly forma: string;
    readonly privilegiado: boolean;
    readonly secreto: boolean;
    readonly requiereAdministrador: boolean;
  };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/asignar-rol ocupa el índice 10, forma NUEVA id_mas_resto_rol, privilegiado true, secreto false, requiereAdministrador true", () => {
    expect(descriptores[10]).toMatchObject({
      nombre: "/asignar-rol",
      forma: "id_mas_resto_rol",
      privilegiado: true,
      secreto: false,
      requiereAdministrador: true,
    });
  });
});

describe("regresión — /crear-empleado (comandos-administracion-empleados, tarea 8, ADR 184) va DESPUÉS de /asignar-rol y ANTES de /ayuda, que sigue último", () => {
  type DescriptorConForma = {
    readonly nombre: string;
    readonly forma: string;
    readonly privilegiado: boolean;
    readonly secreto: boolean;
    readonly requiereAdministrador: boolean;
  };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/crear-empleado ocupa el índice 11, forma NUEVA id_mas_resto_password, privilegiado true, secreto true (2º del repo tras /login), requiereAdministrador true", () => {
    expect(descriptores[11]).toMatchObject({
      nombre: "/crear-empleado",
      forma: "id_mas_resto_password",
      privilegiado: true,
      secreto: true,
      requiereAdministrador: true,
    });
  });

  it("/crear-empleado es el SEGUNDO descriptor con secreto:true en todo COMANDOS, después de /login (R1 de proposal.md)", () => {
    const secretos = descriptores.filter((d) => d.secreto);
    expect(secretos.map((d) => d.nombre)).toEqual(["/login", "/crear-empleado"]);
  });
});

describe("regresión — /estado-bot-prs (comandos-administracion-empleados, tarea 3, ADR 185) va antes de /ayuda, que sigue último", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string; readonly requiereAdministrador: boolean };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/estado-bot-prs ocupa el índice 9, forma reusada 'sin_argumentos', requiereAdministrador false", () => {
    expect(descriptores[9]).toMatchObject({
      nombre: "/estado-bot-prs",
      forma: "sin_argumentos",
      requiereAdministrador: false,
    });
  });
});

describe("regresión — el descriptor de la tarea 19 va antes de /ayuda, que sigue último (ADR 85; índice recalculado tras la baja de autoservicio, tarea 14)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/consultar-kpi ocupa el índice 6, en el orden de design.md §5.7.1 / ADR 85", () => {
    expect(descriptores[6]).toMatchObject({ nombre: "/consultar-kpi", forma: "id_mas_resto" });
  });
});

describe("regresión — el descriptor de comando-reporte-comisiones (tarea 3) va antes de /ayuda, que sigue último (ADR 117, 119; índice recalculado tras la baja de autoservicio, tarea 14)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/reporte-comisiones ocupa el índice 7, en el orden de design.md §3 / ADR 119", () => {
    expect(descriptores[7]).toMatchObject({ nombre: "/reporte-comisiones", forma: "id_opcional_periodo" });
  });
});

describe("regresión — /cancelar-solicitud se dio de baja (operaciones-negocio-conversacionales, tarea 14, ADR 148 pto 2) — comando-cancelar-solicitud tarea 9 queda como registro histórico, ya no aplica", () => {
  it("/cancelar-solicitud ya no ocupa ningún índice de COMANDOS", () => {
    const descriptores = COMANDOS as unknown as readonly { readonly nombre: string }[];
    expect(descriptores.some((d) => d.nombre === "/cancelar-solicitud")).toBe(false);
  });
});

describe("regresión — el descriptor de la tarea 5 (comando-visibilidad-a2a-entrante) va antes de /ayuda, que sigue último (ADR 56/138; índice recalculado tras la baja de autoservicio, tarea 14)", () => {
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("/ver-solicitudes-a2a ocupa el índice 8, forma NUEVA id_opcional_a2a_task (comando-visibilidad-a2a-entrante, tarea 5, design.md §3)", () => {
    expect(descriptores[8]).toMatchObject({ nombre: "/ver-solicitudes-a2a", forma: "id_opcional_a2a_task" });
  });
});

describe("Forma pierde dos miembros: id_opcional_solicitud (aprobacion-conversacional-hitl, tarea 10) e id_opcional (aprobacion-conversacional-hitl, tarea 14 — sus tres únicos usuarios, /aprobar-reembolso/rechazar-reembolso/reabrir-reembolso, se dieron de baja); no gana uno por /cancelar-solicitud (comando-cancelar-solicitud, tarea 9 — reusaba id_opcional_solicitud, ya retirada); SÍ gana uno por /ver-solicitudes-a2a (comando-visibilidad-a2a-entrante, tarea 5 — id_opcional_a2a_task es forma NUEVA, no reusada)", () => {
  // `Forma` es un tipo privado de comando-empleado.ts, no exportado: se
  // verifica en runtime sobre el conjunto de valores `forma` realmente en
  // uso en COMANDOS, que es la proyección observable del tipo. El número de
  // referencia llegó a nueve tras /crear-empleado (comandos-administracion-
  // empleados, tarea 8); la baja de /aprobar-solicitud/rechazar-solicitud
  // (tarea 10) lo bajó a ocho; la baja de los tres comandos de reembolso
  // (tarea 14) deja `id_opcional` sin ningún descriptor que la use: baja el
  // conteo real a siete (final).
  type DescriptorConForma = { readonly nombre: string; readonly forma: string };
  const descriptores = COMANDOS as unknown as readonly DescriptorConForma[];

  it("el conjunto de formas distintas en uso tiene siete miembros (final) tras la baja de los cinco comandos HITL", () => {
    const formasDistintas = new Set(descriptores.map((d) => d.forma));
    expect(formasDistintas.size).toBe(7);
  });
});

describe("regresión — los CINCO comandos HITL se dieron de baja, ADR 151 EJECUTADO (aprobacion-conversacional-hitl, ADR 210 pto 1): /aprobar-solicitud y /rechazar-solicitud (tarea 10, resolver_solicitud) + /aprobar-reembolso, /rechazar-reembolso y /reabrir-reembolso (tarea 14, resolver_reembolso) — ninguno vuelve a matchear ni a estar privilegiado, todos caen a ayuda/desconocido", () => {
  it.each([
    ["/aprobar-solicitud", "/aprobar-solicitud"],
    ["/rechazar-solicitud", "/rechazar-solicitud"],
    ["/aprobar-reembolso", "/aprobar-reembolso"],
    ["/rechazar-reembolso", "/rechazar-reembolso"],
    ["/reabrir-reembolso", "/reabrir-reembolso"],
  ])("%s YA NO matchea → ayuda/desconocido", (comando, comandoEsperado) => {
    expect(parsearComando(comando)).toEqual({ tipo: "ayuda", motivo: "desconocido", comando: comandoEsperado });
  });

  it.each([
    "/aprobar-solicitud sol-1",
    "/rechazar-solicitud sol-1",
    "/aprobar-reembolso venta-1",
    "/rechazar-reembolso venta-1",
    "/reabrir-reembolso venta-1",
  ])("%s (con id) tampoco matchea → ayuda/desconocido", (texto) => {
    const comandoToken = texto.split(" ")[0];
    expect(parsearComando(texto)).toEqual({ tipo: "ayuda", motivo: "desconocido", comando: comandoToken });
  });

  it.each(["aprobar_solicitud", "rechazar_solicitud", "aprobar_reembolso", "rechazar_reembolso", "reabrir_reembolso"])(
    "%s ya no es privilegiado: sin descriptor, esComandoPrivilegiado cae al default false (tipo ya no existe en ComandoEmpleado, mismo criterio 'as never' que el tipo inexistente de requiereAdministrador)",
    (tipo) => {
      expect(esComandoPrivilegiado(tipo as never)).toBe(false);
    },
  );
});

describe("requiereAdministrador (comandos-administracion-empleados, tarea 2, ADR 183 parte 1/RD-84) — desde la tarea 7 tiene sus consumidores reales, /asignar-rol y /crear-empleado", () => {
  const DESCRIPTORES_ADMINISTRADOR = new Set(["/asignar-rol", "/crear-empleado"]);

  it("todo descriptor que NO es administrativo sigue declarando requiereAdministrador === false (trece descriptores finales)", () => {
    type DescriptorConRequiereAdministrador = { readonly nombre: string; readonly requiereAdministrador: boolean };
    const descriptores = COMANDOS as unknown as readonly DescriptorConRequiereAdministrador[];
    expect(descriptores).toHaveLength(13);
    for (const descriptor of descriptores) {
      if (DESCRIPTORES_ADMINISTRADOR.has(descriptor.nombre)) continue;
      expect(descriptor.requiereAdministrador).toBe(false);
    }
  });

  it("/asignar-rol declara requiereAdministrador === true (comandos-administracion-empleados, tarea 7, ADR 175/183)", () => {
    expect(requiereAdministrador("asignar_rol")).toBe(true);
  });

  it("/crear-empleado declara requiereAdministrador === true (comandos-administracion-empleados, tarea 8, ADR 175/183)", () => {
    expect(requiereAdministrador("crear_empleado")).toBe(true);
  });

  it("requiereAdministrador('logout') devuelve false (molde exacto de esComandoPrivilegiado)", () => {
    expect(requiereAdministrador("logout")).toBe(false);
  });

  it.each(["ver_propuesta", "consultar_kpi", "reporte_comisiones"] as const)(
    "%s (privilegiado, comando existente) también devuelve false: no exige administrador",
    (tipo) => {
      expect(requiereAdministrador(tipo)).toBe(false);
    },
  );

  it("un tipo inexistente devuelve false (el '?? false' del find, mismo criterio que esComandoPrivilegiado)", () => {
    expect(requiereAdministrador("no_existe" as never)).toBe(false);
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

/**
 * `enmascar-password-en-tui` (ADR 300, RD-172), spec `comando-empleado-tui`,
 * requirement "El enmascarado de secretos es una función pura derivada del
 * parser y del flag `secreto`". Las dos funciones son PURAS y viven junto al
 * parser: la TUI las consume, no mantiene ninguna lista propia de comandos.
 */
describe("enmascararSecreto y contieneSecreto (ADR 300, spec comando-empleado-tui)", () => {
  // U1 — scenarios literales del spec: [entrada, salida esperada].
  const CON_SECRETO: readonly (readonly [string, string])[] = [
    ["/login ana s3cret", "/login ana ******"],
    ["/login ana s3cr et", "/login ana *******"],
    ["/crear-empleado bob abc", "/crear-empleado bob ***"],
    ["  /login  ana  pw", "  /login  ana ***"],
  ];
  // U2 — todavía no hay clave (tramo secreto vacío) o el comando no es secreto: texto intacto.
  const SIN_CLAVE_TODAVIA = ["/login", "/login ana", "/login ana ", "/crear-empleado bob", "/crear-empleado bob "];
  const NO_SECRETOS = ["/estado-bot-prs", "/soporte ayuda con mi clave", "hola /login x y", ""];
  const INTACTOS = [...SIN_CLAVE_TODAVIA, ...NO_SECRETOS];
  // U3 — residual R2 fijado: mismo match EXACTO y separador U+0020 que `parsearComando`.
  const TYPOS = ["/logni ana secreto", "/Login ana secreto", "/login\tana secreto"];

  it.each(CON_SECRETO)("U1: enmascara todo lo posterior al id, espacios internos y de cola incluidos (%j → %j)", (entrada, esperado) => {
    expect(enmascararSecreto(entrada)).toBe(esperado);
  });

  it.each(INTACTOS)("U2: sin clave todavía o sin comando secreto, el texto queda intacto (%j)", (texto) => {
    expect(enmascararSecreto(texto)).toBe(texto);
  });

  it.each(TYPOS)("U3: un typo, las mayúsculas o un tab como separador NO se enmascaran (residual R2, %j)", (texto) => {
    expect(enmascararSecreto(texto)).toBe(texto);
  });

  it.each([...CON_SECRETO.map(([entrada]) => entrada), "/login ana ***"])(
    "U6: contieneSecreto es true si hay un tramo secreto no vacío (%j)",
    (texto) => {
      expect(contieneSecreto(texto)).toBe(true);
    },
  );

  it.each([...INTACTOS, ...TYPOS])("U6: contieneSecreto es false sin tramo secreto (%j)", (texto) => {
    expect(contieneSecreto(texto)).toBe(false);
  });

  it("U6: una clave hecha sólo de '*' deja el texto intacto y aun así cuenta como secreto (por eso el predicado es estructural, no `!==`)", () => {
    const texto = "/login ana ***";
    expect(enmascararSecreto(texto)).toBe(texto);
    expect(contieneSecreto(texto)).toBe(true);
  });
});
