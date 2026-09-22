---
tags: [arnes, investigacion, arquitectura-arneses]
fuente: "docs/Investigacion Pre-proyecto/DOCUMENTACION_PROYECTO_OpenHands.md"
---

# OpenHands (Agent Canvas)

Agent Canvas es el frontend en React + TypeScript de OpenHands: una interfaz visual para ejecutar y monitorear agentes de IA de programación contra el **OpenHands Agent Server**. Importante: **no es un harness** — no ejecuta acciones, no provee sandbox ni hospeda credenciales; el trabajo real vive en el Agent Server, que queda fuera de este documento.

## Arquitectura clave

- El **Backend Registry** es el eje transversal: define `Backend`, el store activo y el contexto de selección — casi todo el resto del sistema (chat, settings, automations, MCP, telemetría) depende de saber cuál es el backend activo.
- Permite conectarse a **varias instancias** del Agent Server y cambiar entre ellas desde la UI, vía el protocolo ACP (Agent Client Protocol).
- Flujo de conversación: UI → hooks (React Query + Zustand) → `conversation-service.api.ts` → `getAgentServerClientOptions()` → Agent Server (HTTP + WebSocket) → eventos tipados filtrados por *type guards*.
- Se empaqueta como app standalone, como app de escritorio (Electron) y como librería con entrypoints embebibles (`browser`, `conversation`, `files`, `settings`, `terminal`, …).

En la [[Matriz-Comparativa]] OpenHands queda **fuera de categoría**: no es la capa de runtime que el marco de 14 criterios evalúa, por lo que no se le asigna puntaje.

## Relevancia para nuestro arnés

Aunque no aplica como núcleo, el patrón de "registro de backend activo" como eje transversal es útil para pensar cómo nuestro adaptador TUI podría, a futuro, hablar con más de un backend de modelo a través del puerto *ModelProvider* (ver [[Componentes-e-Interfaces]]).
