-- CreateEnum
CREATE TYPE "NivelRiesgo" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "EstadoAlerta" AS ENUM ('ABIERTA', 'REVISADA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "Alerta" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "tareaId" TEXT,
    "senales" JSONB NOT NULL,
    "puntaje" INTEGER NOT NULL,
    "nivel" "NivelRiesgo" NOT NULL,
    "estado" "EstadoAlerta" NOT NULL DEFAULT 'ABIERTA',
    "nota" TEXT,
    "revisadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "Alerta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alerta_estado_puntaje_idx" ON "Alerta"("estado", "puntaje");

-- CreateIndex
CREATE INDEX "Alerta_usuarioId_idx" ON "Alerta"("usuarioId");

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
