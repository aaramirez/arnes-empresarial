/**
 * Cliente vanilla del chat de empleado (`chat-web-empleado`, ADR 191, 192,
 * 193, 194, 200, 204). Vive como `string` exportado de un módulo `.ts`
 * -- nunca un `.js` suelto en disco -- porque `tsc -p tsconfig.json` sólo
 * emite lo que compila (ADR 200 pto 1, R12): un archivo suelto NUNCA
 * llegaría a `dist/`.
 *
 * Invariantes no negociables de este archivo (R2, el riesgo de seguridad
 * principal del change):
 *   - Todo texto dinámico (mensaje del empleado, `respuesta` del modelo) se
 *     inserta EXCLUSIVAMENTE por `textContent`/`createTextNode`. Prohibido
 *     `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/
 *     `new Function`/`srcdoc` en cualquier camino (ADR 192 pto 2, ADR 200
 *     pto 2) -- verificado por un test mecánico sobre este mismo string.
 *   - El token de sesión vive SÓLO en una variable de closure -- nunca
 *     `localStorage`/`sessionStorage`/URL/DOM/consola (ADR 193).
 *   - Sólo toca el entorno por los identificadores libres `document`,
 *     `fetch`, `setInterval`, `clearInterval` -- nada de `window.X` ni
 *     `globalThis` (ADR 200 pto 3): es lo que permite el test de XSS en
 *     negativo con `new Function(...)` contra un doble de DOM escrito a
 *     mano, sin instalar jsdom (ADR 191 pto 2 lo prohíbe incluso como
 *     `devDependency`).
 *   - Nunca lee `body.error` del servidor: la tabla de errores de ADR 204
 *     es un literal del cliente, uno por código, no un pass-through.
 *
 * Consecuencia aceptada en voz alta (ADR 200 pto 4): dentro de este
 * template literal no hay resaltado de sintaxis, lint ni typecheck del JS.
 * El archivo se mantiene chico (~170 líneas) y los tests cubren justo lo
 * que el compilador no puede ver.
 */
export const CHAT_CLIENT_JS = `
(function () {
  "use strict";

  var token = null;
  var mensajePendiente = "";
  var enVuelo = false;

  var MENSAJES_ERROR = {
    400: "El mensaje no pudo procesarse. Revisá el texto e intentá de nuevo.",
    401: "Tu sesión venció. Volvé a ingresar — tu mensaje quedó guardado.",
    502: "El arnés no pudo completar la operación. Probá de nuevo en un momento.",
    504:
      "La operación tardó demasiado y no se completó. No sabemos si llegó " +
      "a aplicarse — verificá antes de reintentar."
  };
  var MENSAJE_ERROR_RED = "No hubo respuesta del servidor.";

  var vistaLogin = document.getElementById("login-view");
  var vistaChat = document.getElementById("chat-view");
  var empleadoIdInput = document.getElementById("empleado-id-input");
  var passwordInput = document.getElementById("password-input");
  var loginBoton = document.getElementById("login-boton");
  var loginError = document.getElementById("login-error");
  var mensajes = document.getElementById("mensajes");
  var mensajeTextarea = document.getElementById("mensaje-textarea");
  var enviarBoton = document.getElementById("enviar-boton");
  var logoutBoton = document.getElementById("logout-boton");
  var estadoMensaje = document.getElementById("estado-mensaje");

  function mostrarVista(nombre) {
    vistaLogin.hidden = nombre !== "login";
    vistaChat.hidden = nombre !== "chat";
  }

  function agregarTurno(autor, texto) {
    var turno = document.createElement("div");
    turno.appendChild(document.createTextNode(autor + ": " + texto));
    mensajes.appendChild(turno);
  }

  function ponerEstado(texto) {
    estadoMensaje.textContent = texto;
  }

  function establecerEnvioHabilitado(habilitado) {
    enviarBoton.disabled = !habilitado;
    mensajeTextarea.disabled = !habilitado;
  }

  /** Cuatro estados explícitos de primera clase (ADR 194 pto 1). */
  function cambiarEstado(nuevoEstado, textoEstado) {
    establecerEnvioHabilitado(nuevoEstado !== "esperando");
    ponerEstado(textoEstado === undefined ? "" : textoEstado);
  }

  function manejarLogin() {
    loginError.textContent = "";
    var empleadoId = empleadoIdInput.value;
    var password = passwordInput.value;

    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId: empleadoId, password: password })
    }).then(
      function (respuesta) {
        if (!respuesta.ok) {
          loginError.textContent = "Credenciales inválidas.";
          return undefined;
        }
        return respuesta.json().then(function (cuerpo) {
          token = cuerpo.token;
          passwordInput.value = "";
          mostrarVista("chat");
          cambiarEstado("idle");
          if (mensajePendiente !== "") {
            mensajeTextarea.value = mensajePendiente;
            mensajePendiente = "";
          }
        });
      },
      function () {
        loginError.textContent = MENSAJE_ERROR_RED;
      }
    );
  }

  function manejarEnvio() {
    if (enVuelo) {
      return;
    }
    var texto = mensajeTextarea.value;
    if (texto === "") {
      return;
    }

    enVuelo = true;
    cambiarEstado("esperando", "Esperando respuesta…");

    fetch("/operaciones", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ consulta: texto })
    }).then(
      function (respuesta) {
        if (respuesta.status === 401) {
          mensajePendiente = texto;
          token = null;
          mostrarVista("login");
          loginError.textContent = MENSAJES_ERROR[401];
          enVuelo = false;
          cambiarEstado("idle");
          return undefined;
        }
        if (
          respuesta.status === 400 ||
          respuesta.status === 502 ||
          respuesta.status === 504
        ) {
          enVuelo = false;
          cambiarEstado("error", MENSAJES_ERROR[respuesta.status]);
          return undefined;
        }
        if (!respuesta.ok) {
          enVuelo = false;
          cambiarEstado("error", MENSAJE_ERROR_RED);
          return undefined;
        }
        return respuesta.json().then(function (cuerpo) {
          agregarTurno("Vos", texto);
          agregarTurno("Arnés", cuerpo.respuesta);
          mensajeTextarea.value = "";
          enVuelo = false;
          cambiarEstado("respondido");
        });
      },
      function () {
        enVuelo = false;
        cambiarEstado("error", MENSAJE_ERROR_RED);
      }
    );
  }

  function manejarLogout() {
    var tokenActual = token;
    token = null;
    mostrarVista("login");
    mensajeTextarea.value = "";
    cambiarEstado("idle");
    if (tokenActual === null) {
      return;
    }
    fetch("/logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + tokenActual }
    });
  }

  function conPreventDefault(manejador) {
    return function (evento) {
      if (evento && typeof evento.preventDefault === "function") {
        evento.preventDefault();
      }
      manejador();
    };
  }

  loginBoton.addEventListener("click", conPreventDefault(manejarLogin));
  enviarBoton.addEventListener("click", conPreventDefault(manejarEnvio));
  logoutBoton.addEventListener("click", conPreventDefault(manejarLogout));
})();
`;
