---
tags: [arnes, investigacion, moc]
---

# MOC — Arquitectura del Claude Agent SDK y del arnés propio

Mapa de navegación para la investigación sobre el funcionamiento del Claude Agent SDK y su aplicación concreta en el diseño del arnés propio, documentado en el ARC42 del proyecto (`docs/ARC42_Harness_Empresarial.md`).

## Notas de esta área

- [[Componentes-e-Interfaces]] — la Vista de Bloques: núcleo de orquestación hexagonal más cuatro adaptadores (TUI, Conocimiento, Memoria Compartida, A2A).
- [[Mensajes-y-Flujos]] — el catálogo de interfaces I1-I5 y los escenarios de ejecución: cómo viaja un mensaje desde el prompt del empleado hasta la respuesta citada.
- [[Tipos-de-Mensaje-SDK]] — el catálogo de tipos de mensaje del SDK (`SDKMessage`), los tres que el arnés consume de verdad y lo que deja sin manejar.

Para la visión general del arnés propio (agentes, hooks, skills, A2A, memoria SQLite), ver [[Vision-General]] en `04-Arnes-Empresarial-Propio/`.

## Relevancia para nuestro arnés

Esta área documenta el objetivo específico 4 de la propuesta de pasantía: investigar el funcionamiento exacto del SDK, sus mensajes y flujos principales, como base directa del diseño en `docs/ARC42_Harness_Empresarial.md`.
