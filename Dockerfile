# Imagen de la API.
#
# Dos decisiones que parecen de gusto y no lo son:
#
#  - **Debian y no Alpine.** Alpine pesa menos, pero Prisma necesita OpenSSL y
#    un motor compilado para musl, y esa combinación es de las que fallan recién
#    el día del despliegue. Acá pesa más y arranca.
#  - **Una sola etapa.** Separar compilación de ejecución obliga a rearmar los
#    enlaces del store de pnpm entre etapas: otra cosa que se rompe justo cuando
#    no hay que perder tiempo. Así se lee de arriba abajo.
FROM node:22-slim

# Prisma habla con Postgres por TLS y necesita OpenSSL del sistema.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Primero los manifiestos: mientras no cambien, Docker reusa las dependencias ya
# bajadas y reconstruir tarda segundos en vez de minutos.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm --filter @tareas/api exec prisma generate \
  && pnpm --filter @tareas/domain build \
  && pnpm --filter @tareas/api build \
  && pnpm store prune

ENV NODE_ENV=production
# Nada de esto corre como root: si alguien consigue ejecutar algo adentro del
# contenedor, que sea con los permisos mínimos.
USER node
EXPOSE 3000

# El mismo latido que mira el proxy. Si la API no puede leer la base, el
# contenedor se marca enfermo en vez de seguir recibiendo gente.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
