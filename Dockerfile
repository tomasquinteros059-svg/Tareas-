# Imagen de la API.
#
# Una sola etapa a propósito: con un monorepo de pnpm, separar la compilación
# del tiempo de ejecución obliga a rearmar los enlaces del store y es la clase
# de cosa que se rompe el día del despliegue. La imagen pesa un poco más y se
# entiende de arriba abajo.
FROM node:22-alpine

# tini se encarga de que Ctrl-C y el `docker stop` lleguen al proceso de Node:
# sin él, el contenedor se mata a los 10 segundos sin cerrar nada.
RUN corepack enable && apk add --no-cache tini
WORKDIR /app

# Primero los manifiestos: mientras no cambien, Docker reusa las dependencias
# ya bajadas y el build tarda segundos en vez de minutos.
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
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
