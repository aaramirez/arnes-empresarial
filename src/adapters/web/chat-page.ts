/**
 * Página del chat de empleado (`chat-web-empleado`, ADR 191 pto 1, ADR 198,
 * ADR 200 pto 5). Funciones puras, **100% estáticas**: cero valores
 * dinámicos concatenados -- ni un empleado, ni un `casoId`, ni nada que
 * venga de fuera entra a `renderChatHtml()` (ADR 200 pto 5: lo que no se
 * concatena no puede escaparse mal, así que `escapeHtml` no hace falta acá).
 *
 * Una sola página, dos secciones (`login`/`chat`) conmutadas con el
 * atributo `hidden` -- sin navegación entre documentos, sin ruteo de
 * cliente (ADR 198): recargar pierde el token (ADR 193), así que no hay
 * ningún beneficio en partir esto en dos documentos.
 *
 * Sin `<form>` con submit real (ADR 199, `form-action 'none'`): los botones
 * son `type="button"`, manejados por `chat-client.ts` vía `addEventListener`.
 *
 * IDs consumidos por `CHAT_CLIENT_JS` (`chat-client.ts`) -- deben coincidir
 * exactamente: `login-view`, `chat-view`, `empleado-id-input`,
 * `password-input`, `login-boton`, `login-error`, `mensajes`,
 * `mensaje-textarea`, `enviar-boton`, `logout-boton`, `estado-mensaje`.
 */

/** `text/css`, servido por separado en `/chat/app.css` -- nunca inline (CSP `style-src 'self'`, ADR 199). */
export const CHAT_CSS = `
* {
  box-sizing: border-box;
}
body {
  font-family: sans-serif;
  margin: 0 auto;
  max-width: 640px;
  padding: 16px;
}
section[hidden] {
  display: none;
}
#mensajes {
  border: 1px solid #ccc;
  min-height: 200px;
  padding: 8px;
  white-space: pre-wrap;
}
textarea {
  width: 100%;
}
.turno {
  border-left: 3px solid transparent;
  margin-bottom: 8px;
  padding-left: 8px;
}
.turno-hora {
  color: #616161;
  font-variant-numeric: tabular-nums;
  margin-right: 8px;
}
.turno-autor {
  font-weight: 600;
  margin-right: 8px;
}
.turno-texto {
  display: block;
}
.turno-empleado { border-left-color: #1b5e20; }
.turno-empleado .turno-autor { color: #1b5e20; }
.turno-arnes { border-left-color: #0d47a1; }
.turno-arnes .turno-autor { color: #0d47a1; }
`;

/** `text/html`, sin un solo valor dinámico. Determinista: dos invocaciones dan el mismo string. */
export function renderChatHtml(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Chat de empleado</title>
<link rel="stylesheet" href="/chat/app.css">
</head>
<body>
<section id="login-view">
<h1>Ingresar</h1>
<p id="login-error"></p>
<label for="empleado-id-input">Empleado</label>
<input id="empleado-id-input" type="text" autocomplete="username">
<label for="password-input">Contraseña</label>
<input id="password-input" type="password" autocomplete="current-password">
<button id="login-boton" type="button">Ingresar</button>
</section>
<section id="chat-view" hidden>
<h1>Chat</h1>
<button id="logout-boton" type="button">Cerrar sesión</button>
<div id="mensajes"></div>
<p id="estado-mensaje"></p>
<textarea id="mensaje-textarea"></textarea>
<button id="enviar-boton" type="button">Enviar</button>
</section>
<script src="/chat/app.js" defer></script>
</body>
</html>`;
}
