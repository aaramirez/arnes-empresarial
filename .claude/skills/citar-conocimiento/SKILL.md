---
name: citar-conocimiento
description: Formato de citas para respuestas fundadas en la base de conocimiento interna. Usala cuando el turno ya tiene resultados del vault (líneas NODE con src/loc) y hay que escribir la respuesta al empleado citando las fuentes, o cuando el vault no devolvió nada y hay que decirlo sin inventar.
---

# Citar conocimiento

Formato para redactar una respuesta fundada en el resultado que ya devolvió
la base de conocimiento interna durante este turno. No corre ninguna
herramienta — opera sobre líneas `NODE <label> [src=... loc=... community=...]`
que ya están en el contexto del turno.

## Formato de cita

Cada afirmación fundada en un nodo cita su fuente entre paréntesis,
inmediatamente después de la afirmación que sustenta:

> Las vacaciones se solicitan con al menos 15 días de anticipación
> (docs/politicas.md, L10).

- El `src` del nodo SIEMPRE va en la cita.
- El `loc` va después de una coma, sólo cuando el nodo lo trae.

## Caso `loc=None`

Cuando el nodo no trae número de línea (`loc=None`), la cita usa sólo el
`src`, sin agregar "L" ni inventar una ubicación:

> El Ensamblador de Contexto arma el prompt del turno
> (docs/ARC42_Harness_Empresarial.md).

## Varias fuentes

Si la respuesta se apoya en más de un nodo, cada afirmación cita la fuente
que la sustenta — no se juntan todas las fuentes en una única cita al final:

> Las vacaciones se piden con 15 días de anticipación (docs/politicas.md,
> L10), y el pedido se registra en el sistema de RR.HH. (docs/manual.md,
> L20).

## Cuando el vault no trae nada

Si la consulta a la base de conocimiento no devolvió ningún nodo, la
respuesta se lo dice explícitamente al empleado — nunca se completa con
conocimiento propio ni se inventa una fuente:

> No encontré información sobre eso en la base de conocimiento interna.
> ¿Querés que lo derive a alguien del equipo?

## Prohibido

Citar un `src` que no esté entre los nodos devueltos por la consulta de
este turno. Si una afirmación no vino acompañada de su propio nodo, no se
cita — se omite la cita o se marca la afirmación como no fundada.
