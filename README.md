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

## La app en un solo archivo

`apps/demo-app.html` es la aplicación completa funcionando en un archivo suelto: se abre
haciendo doble clic, sin instalar nada y sin conexión. Corre las mismas reglas que el
servidor —cotizador, olas del radar, comisiones, niveles y máquina de estados— y guarda
los datos en el propio dispositivo.

Arranca en la portada: se entra con LinkedIn —que acredita la formación y habilita los
trabajos especializados— o con el teléfono y un código. Adentro, los trabajos se ven como
un muro, uno abajo del otro, con cuatro solapas: **Para vos** (recomendados según el
perfil), **Para uno**, **Varios** y **Especializados** (los que piden carrera
universitaria o matrícula). El perfil se administra desde la app: datos, formación, zona,
oficios y matrículas.

Además tiene avisos con campanita, buscador y filtros por distancia y monto, fotos en
las publicaciones (comprimidas en el navegador), día y franja horaria, propina al
confirmar, cargo por cancelación tardía, reclamos con resolución de soporte y el perfil
público de cada trabajador con sus reseñas.

Está en pesos chilenos y con comunas de Santiago, con los pisos del catálogo
ajustados: cortar el pasto tres horas arranca en $28.000.

Trae cinco cuentas de ejemplo —una clienta, tres trabajadores de distinto nivel y una
ingeniera con LinkedIn conectado— y se puede cambiar de una a otra para ver los dos lados.
Abriéndola en dos ventanas a la vez se comprueba lo que importa: la tarea se la lleva el
primero que la acepta.

## La app instalable

`apps/demo-app.html` sigue siendo el archivo suelto que se abre con doble clic.
Encima de ese mismo archivo se arma la versión que se instala en un teléfono:

```bash
pnpm build:web        # deja apps/web/dist listo
```

Suma tres cosas: el manifiesto (para que se pueda "agregar a la pantalla de
inicio"), un trabajador de servicio que la hace abrir sin señal —el que corta el
pasto está en el fondo de una casa con media barra— y la recepción de los avisos
push, que son lo único que hace que alguien se entere de una tarea nueva sin
estar mirando la pantalla. Se sirve desde el **mismo dominio que la API**: un
trabajador de servicio sólo controla su propio origen, y de eso dependen los
avisos.

Adentro, en **Perfil → Conectar con el servidor**, la app deja de estar sola:
se entra con el teléfono y un código que manda el servidor de verdad, la sesión
queda guardada, se ven los trabajos publicados en el servidor y ahí sí se pueden
prender los avisos —antes no había con qué sesión suscribirse—. Abierta como
archivo suelto lo dice de frente: no hay ningún servidor al que llamar.

Publicar y tomar trabajos desde el modo conectado es lo que sigue; el resto de
las pantallas son todavía la demostración local. Ver el punto 3 de
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## El reloj

Lo que pasa solo —tareas que nadie tomó, confirmaciones automáticas a las 24 h,
calificaciones a ciegas que se publican, reservas de tarjeta que van a caducar,
comisiones de trabajos en efectivo que hay que cobrar— lo hace el planificador:

```bash
pnpm --filter @tareas/api reloj      # una pasada; pensado para un cron
```

Cada trabajo es idempotente y condiciona el UPDATE al estado esperado, así que
correrlo dos veces, o en dos servidores a la vez, no duplica nada.

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
| `POST` | `/auth/telefono/codigo` | Manda el código por SMS (Twilio o al log en desarrollo) |
| `POST` | `/auth/telefono/verificar` | Verifica el código y devuelve la sesión |
| `GET` | `/auth/google` · `/auth/linkedin` | Ingreso social (LinkedIn además trae el perfil profesional) |
| `POST` | `/identidad` | Carga del documento para verificación |
| `POST` | `/tareas` | Publica la tarea (retiene los fondos si paga con tarjeta) |
| `GET` · `PUT` | `/perfil` | Activar o editar el perfil de trabajador |
| `GET` | `/feed` | Radar del trabajador, filtrado y ordenado, con quién publica |
| `GET` | `/tareas/mias` | Lo que publiqué y lo que estoy haciendo |
| `POST` | `/tareas/:id/aceptar` | La toma el primero que llega |
| `POST` | `/tareas/:id/estado` | En camino, en progreso, entregada, confirmada, cancelada |
| `POST` | `/tareas/:id/preguntas` | Hasta 2 preguntas por trabajador, antes de asignar |
| `POST` | `/tareas/:id/mensajes` | Chat privado, sólo con la tarea en curso |
| `POST` | `/tareas/:id/calificar` | Calificación de doble vía |
| `GET` | `/tareas/:folio` | La tarea completa con su bitácora |
| `GET` | `/saldo` | Saldo y movimientos del trabajador |
| `PUT` | `/retiros/banco` · `POST /retiros` | Cuenta bancaria y pedido de retiro |
| `GET` | `/deudas` · `POST /deudas/pagar` | Comisión adeudada por trabajos en efectivo |
| `GET` | `/soporte/bandeja` | Disputas, documentos y matrículas esperando decisión |
| `POST` | `/soporte/disputas/:id/resolver` | Resuelve un reclamo (completo, parcial o a favor del cliente) |
| `GET` | `/soporte/retiros` | Cola de transferencias pendientes |

## Ponerlo en internet

```bash
cp .env.servidor.example .env     # completar dominio, claves y credenciales
docker compose -f docker-compose.prod.yml up -d --build
```

Cuatro contenedores: Postgres, la API, el reloj y Caddy, que saca el certificado
HTTPS solo y lo renueva solo. El paso a paso —incluida la copia de seguridad,
que no es opcional— está en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Lo que hay que leer antes de tocar el código

- [`docs/DECISIONES.md`](docs/DECISIONES.md) — por qué las cosas son así.
- [`docs/PAGOS.md`](docs/PAGOS.md) — cómo se mueve el dinero y cómo encender la pasarela.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — qué falta para salir a la calle.
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — cómo se pone en un servidor.
