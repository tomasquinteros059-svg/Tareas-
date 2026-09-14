-- CreateEnum
CREATE TYPE "EstadoRetiro" AS ENUM ('SOLICITADO', 'PAGADO', 'RECHAZADO');

-- AlterTable
ALTER TABLE "PerfilTrabajador" ADD COLUMN     "bancoNombre" TEXT,
ADD COLUMN     "bancoNumeroCifrado" TEXT,
ADD COLUMN     "bancoRutTitular" TEXT,
ADD COLUMN     "bancoTipoCuenta" TEXT,
ADD COLUMN     "bancoTitular" TEXT,
ADD COLUMN     "bancoUltimos4" TEXT;

-- CreateTable
CREATE TABLE "Retiro" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "estado" "EstadoRetiro" NOT NULL DEFAULT 'SOLICITADO',
    "bancoNombre" TEXT NOT NULL,
    "bancoUltimos4" TEXT NOT NULL,
    "referencia" TEXT,
    "motivo" TEXT,
    "revisadoPor" TEXT,
    "solicitadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "Retiro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Retiro_estado_solicitadoEn_idx" ON "Retiro"("estado", "solicitadoEn");

-- CreateIndex
CREATE INDEX "Retiro_usuarioId_idx" ON "Retiro"("usuarioId");

-- AddForeignKey
ALTER TABLE "Retiro" ADD CONSTRAINT "Retiro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
