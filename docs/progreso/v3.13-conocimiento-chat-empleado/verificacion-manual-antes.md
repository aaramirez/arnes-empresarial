# Verificación manual "antes" — `conocimiento-chat-empleado` (tarea 1)

**Fecha**: 2026-09-19
**Rama**: `hito/v3.13-conocimiento-chat-empleado`, creada desde `main` (tag `v3.12.0`), árbol en el estado de la base (sin las tareas 2-7 aplicadas).
**Ejecutor**: verificación manual de la tarea 1 de `openspec/changes/conocimiento-chat-empleado/tasks.md` — sin código de producción. Molde de `docs/progreso/v3.12-devolucion-sin-token-dos-personas/verificacion-manual-tarea-27.md`.

## 0. Nota de método

Este entorno **sí tiene** `ANTHROPIC_API_KEY` disponible vía `.env` (cargado por `dotenv`, verificado con `node -e "require('dotenv').config(); console.log(!!process.env.ANTHROPIC_API_KEY)"` → `true`) — a diferencia de las evidencias de v3.10/v3.12, esta corrida ejercitó el turno conversacional real de punta a punta contra el Claude Agent SDK, por el chat web (`POST /operaciones`), no la TUI.

Arranque desde build (camino de producción, no `tsx`), molde de la sección v3.9.0 de `docs/progreso/guia-verificacion-completa.md`:

```bash
rm -rf dist && npm run build
WEB_PORT=8793 node dist/main.js
```

**Empleado usado**: `verif-antes-v313` (creado con `npm run empleados:crear -- verif-antes-v313`, molde de `verif-ergo-v311`/`verif-tarea23`), en vez de `ana` — las credenciales de `ana` en `data/harness.db` quedaron de una sesión anterior y la contraseña no se conocía; crear un empleado dedicado evita tocar datos de otras verificaciones.

## 1. Login

```bash
$ curl -s -X POST http://localhost:8793/login -H "Content-Type: application/json" \
  -d '{"empleadoId":"verif-antes-v313","password":"clave-verif-313"}'
{"token":"39d9ed53-216f-4981-a769-7e7fd6dd7769","expiraEn":"2026-09-20T05:52:53.634Z"}
```

## 2. Turno — "¿Cuál es la política de reembolsos de la empresa?"

```bash
$ curl -s -X POST http://localhost:8793/operaciones -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"consulta":"¿Cuál es la política de reembolsos de la empresa?"}'
{
  "casoId": "cbf43acb-47f9-45cb-9c83-5f484355c28a",
  "respuesta": "No tengo disponible en este turno la herramienta de consulta a la base de conocimiento interna, así que no puedo traerte la política de reembolsos citando la fuente correspondiente. No quiero inventarte una respuesta sin sustento documental.\n\n¿Querés que lo intente en otro turno, o necesitás que en cambio te ayude con algo operativo puntual (por ejemplo, resolver una escalación de reembolso o iniciar/procesar una devolución de una venta específica)?"
}
```

**`casoId`**: `cbf43acb-47f9-45cb-9c83-5f484355c28a`.

**¿Trae cita `src`/`loc`?** No — no hay ninguna referencia a archivo ni ubicación en la respuesta. El modelo declara explícitamente que no tiene la herramienta de conocimiento disponible en este turno y evita inventar contenido ("No quiero inventarte una respuesta sin sustento documental").

## 3. `graphify-out/memory/` — conteo baseline

```bash
$ find graphify-out/memory -maxdepth 1 -type f | wc -l
39
```

Antes y después del turno: **39** (sin cambios) — coincide con el baseline citado en `design.md` (39 al escribir el diseño).

## 4. `data/harness.log` — eventos del turno

```
{"casoId":"cbf43acb-47f9-45cb-9c83-5f484355c28a","event":"operaciones-caso-creado","timestamp":"2026-09-19T21:52:58.308Z"}
{"agentId":"agente-conversacional","sdkSessionId":"631c3079-24a9-4239-8894-6a2ebf8b5d62","casoId":"cbf43acb-47f9-45cb-9c83-5f484355c28a","event":"turno-completado","timestamp":"2026-09-19T21:53:11.301Z"}
{"conversacionId":"d9dbeb18-85a7-424b-93e4-17fceb599f8c","casoId":"cbf43acb-47f9-45cb-9c83-5f484355c28a","event":"operaciones-conversacion","timestamp":"2026-09-19T21:53:11.301Z"}
```

Ningún evento `conocimiento-*` (esperado: la tool de conocimiento todavía no está cableada en `build-on-operaciones-empleado.ts` en este estado base).

## 5. Resultado — ¿confirma la hipótesis del diseño?

✅ **Sí, confirma la hipótesis** (R11: no hay contradicción, no hace falta volver al Spec Author). El comportamiento observado es exactamente el descrito por la propuesta como el problema a resolver: el chat web del empleado **no** tiene acceso al servidor MCP de conocimiento, así que ante una pregunta de política interna el modelo responde honestamente que no puede consultarla — sin crash, sin cita inventada, sin alucinación — en vez de resolver la consulta citando una fuente real del vault (Graphify).

| Criterio de aceptación (tarea 1) | Resultado |
|---|---|
| Captura textual con `casoId` | ✅ §2 |
| Conteo baseline de `graphify-out/memory/` | ✅ §3 — 39 |
| Sin cita `src`/`loc` en el "antes" | ✅ §2 |
| Comportamiento consistente con la hipótesis del diseño (sin STOP por R11) | ✅ §5 |
