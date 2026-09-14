# Poner Tareas en internet

Qué hace falta y en qué orden para que la app deje de correr en una
computadora y pase a estar en línea, con dominio propio y candado verde.

Esto es lo último que se hace: antes tiene que estar la empresa registrada y
las cuentas de pago y de SMS aprobadas (ver [`ROADMAP.md`](ROADMAP.md)).

---

## Lo que hace falta comprar

| Qué | Para qué | Cuánto, más o menos |
| --- | --- | --- |
| Un servidor (VPS) | Donde corre todo | 2 GB de memoria alcanzan para empezar |
| Un dominio | `tareas.cl` | El registro `.cl` se hace en NIC Chile |

No hace falta nada más: el certificado HTTPS es gratis y se renueva solo.

## El orden

### 1. Apuntar el dominio al servidor

En el panel donde se compró el dominio, crear un registro **A** que apunte a la
IP del servidor. Antes de seguir, comprobar que resuelve:

```bash
ping tareas.cl     # tiene que responder la IP del servidor
```

Si el dominio todavía no apunta, Let's Encrypt no va a poder emitir el
certificado y el sitio queda sin HTTPS. Es el error más común.

### 2. Preparar el servidor

```bash
ssh usuario@IP-DEL-SERVIDOR
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && exit      # salir y volver a entrar
```

### 3. Bajar el código y configurarlo

```bash
git clone https://github.com/TU-USUARIO/Tareas-.git
cd Tareas-
cp .env.servidor.example .env
nano .env                                  # completar todo
```

Las tres claves que hay que generar (una distinta cada una):

```bash
openssl rand -hex 32     # para JWT_SECRET
openssl rand -hex 32     # para KYC_ENCRYPTION_KEY
openssl rand -hex 16     # para POSTGRES_PASSWORD
```

`KYC_ENCRYPTION_KEY` es con lo que se cifran los documentos de identidad y los
números de cuenta. **Si se pierde, esos datos no se pueden volver a leer**, y si
se cambia, los que ya estaban guardados quedan ilegibles. Guardarla en un
administrador de contraseñas antes de seguir.

`DATABASE_URL` tiene que llevar la misma contraseña que `POSTGRES_PASSWORD`, y
el host es `db` —el nombre del servicio dentro de Docker—, no `localhost`.

### 4. Levantarlo

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

La primera vez tarda unos minutos: compila el código y baja las imágenes. El
orden lo resuelve Docker solo: espera a que la base esté lista, corre las
migraciones, y recién entonces arranca la API y el reloj.

```bash
curl https://tareas.cl/salud      # {"ok":true,...}
```

### 5. Mirar que esté vivo

```bash
docker compose -f docker-compose.prod.yml ps        # todo "running"/"healthy"
docker compose -f docker-compose.prod.yml logs -f api
```

## Qué es cada pieza

- **db** — Postgres. No se asoma a internet: sólo la ven los otros
  contenedores. Sus datos viven en un volumen de Docker, así que sobreviven a
  reiniciar o reconstruir.
- **migraciones** — corre una vez y se va. Si el esquema no queda al día, la API
  no arranca: es preferible eso a arrancar contra una base que no coincide.
- **api** — el servidor. No expone puertos hacia afuera; sólo el proxy la ve.
- **reloj** — una pasada por minuto de lo que tiene que pasar solo: expirar
  tareas, confirmar a las 24 h, publicar calificaciones, liberar reservas,
  cobrar comisiones. Cada trabajo es idempotente, así que no importa si una
  pasada se superpone con la anterior.
- **proxy** — Caddy. Pide el certificado a Let's Encrypt la primera vez y lo
  renueva solo. Es lo único que escucha en los puertos 80 y 443.

## Actualizar a una versión nueva

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Las migraciones se aplican solas antes de que arranque la API.

## La copia de seguridad, que no es opcional

Sin esto, un disco que falla se lleva las cuentas, los trabajos y el libro de
saldos. Una copia diaria:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U tareas tareas | gzip > respaldo-$(date +%F).sql.gz
```

Ponerlo en un `cron` y **copiarlo fuera del servidor**: un respaldo guardado en
el mismo disco que se rompe no es un respaldo. Y probar una restauración una
vez, antes de necesitarla:

```bash
gunzip -c respaldo-2026-09-14.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U tareas tareas
```

## Cosas que no van en el servidor

- **El número de cuenta bancaria de la empresa** va en el portal de Transbank,
  no acá.
- **Las claves de API** van en `.env`, que no está en el repositorio y no debe
  subirse nunca. Si una se filtra, se rota en el portal del proveedor y se
  cambia acá.
- **Los documentos de identidad** se guardan cifrados en la base. Quien tenga
  acceso al servidor tiene acceso a la base: la lista de personas con llave del
  servidor tiene que ser corta y conocida.
