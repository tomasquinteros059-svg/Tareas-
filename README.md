# Tareas

Marketplace de tareas remuneradas: alguien publica un trabajo con precio cerrado y
el primer trabajador habilitado que lo ve, se lo lleva. De cortar el pasto a un
abogado por el día.

La regla de la casa: **una tarea no es un post, es una orden de trabajo**. Tiene
folio, estado, precio mínimo, responsable y bitácora. No hay comentarios públicos
ni regateo.

## Cómo está hecho

```
packages/domain/   Reglas de negocio puras: precios, niveles, despacho,
                   comisiones y máquina de estados. Sin base de datos, sin HTTP.
apps/api/          API HTTP (Fastify) + Postgres (Prisma). Orquesta el dominio.
docs/              Las decisiones de diseño y lo que falta.
```

El dominio va aparte a propósito: son las reglas que definen el negocio y tienen
que poder probarse en milisegundos, sin levantar nada. La app móvil, el panel de
soporte y cualquier integración futura consumen esas mismas reglas.

## Levantarlo

```bash
pnpm install
docker compose up -d db          # o un Postgres propio en el puerto 5432
cp apps/api/.env.example apps/api/.env
# generá las claves:  openssl rand -hex 32
pnpm db:migrate
pnpm db:seed                     # 1 cliente, 4 trabajadores y 2 tareas de ejemplo
pnpm dev:api
```

```bash
curl localhost:3000/salud
curl -X POST localhost:3000/cotizar -H 'content-type: application/json' \
  -d '{"rubroSlug":"abogado-dia","unidades":1,"dificultad":"ALTA","urgencia":"HOY","nivelMinimo":"ORO"}'
```

## Probarlo

```bash
pnpm test        # dominio (sin base) + API (contra Postgres)
pnpm typecheck
```

Los tests de la API usan una base real (`tareas_test`): el caso más importante
—dos trabajadores aceptando la misma tarea en el mismo instante— sólo se puede
probar de verdad contra Postgres.

## Endpoints

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/catalogo` | Rubros disponibles con su tarifa mínima |
| `POST` | `/cotizar` | Presupuesto mínimo y sugerido de una tarea |
| `POST` | `/auth/telefono/codigo` | Manda el código por SMS |
| `POST` | `/auth/telefono/verificar` | Verifica el código y devuelve la sesión |
| `GET` | `/auth/google` · `/auth/linkedin` | Ingreso social (LinkedIn además trae el perfil profesional) |
| `POST` | `/identidad` | Carga del documento para verificación |
| `POST` | `/tareas` | Publica la tarea (retiene los fondos si paga con tarjeta) |
| `GET` | `/feed` | Radar del trabajador, filtrado y ordenado |
| `POST` | `/tareas/:id/aceptar` | La toma el primero que llega |
| `POST` | `/tareas/:id/estado` | En camino, en progreso, entregada, confirmada, cancelada |
| `POST` | `/tareas/:id/preguntas` | Hasta 2 preguntas por trabajador, antes de asignar |
| `POST` | `/tareas/:id/mensajes` | Chat privado, sólo con la tarea en curso |
| `POST` | `/tareas/:id/calificar` | Calificación de doble vía |
| `GET` | `/tareas/:folio` | La tarea completa con su bitácora |
| `GET` | `/saldo` | Saldo y movimientos del trabajador |

## Lo que hay que leer antes de tocar el código

- [`docs/DECISIONES.md`](docs/DECISIONES.md) — por qué las cosas son así.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — qué falta para salir a la calle.
