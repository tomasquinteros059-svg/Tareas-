-- AlterTable
ALTER TABLE "Tarea" ADD COLUMN     "olaAvisada" INTEGER NOT NULL DEFAULT -1;

-- CreateTable
CREATE TABLE "SuscripcionPush" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "agente" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoEnvio" TIMESTAMP(3),
    "fallos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SuscripcionPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuscripcionPush_endpoint_key" ON "SuscripcionPush"("endpoint");

-- CreateIndex
CREATE INDEX "SuscripcionPush_usuarioId_idx" ON "SuscripcionPush"("usuarioId");

-- CreateIndex
CREATE INDEX "PerfilTrabajador_disponible_lat_lng_idx" ON "PerfilTrabajador"("disponible", "lat", "lng");

-- AddForeignKey
ALTER TABLE "SuscripcionPush" ADD CONSTRAINT "SuscripcionPush_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
