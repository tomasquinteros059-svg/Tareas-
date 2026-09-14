-- AlterTable
ALTER TABLE "PerfilTrabajador" ADD COLUMN     "cobroIntentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cobroPendienteMonto" INTEGER,
ADD COLUMN     "cobroPendienteRef" TEXT,
ADD COLUMN     "cobroProximoIntento" TIMESTAMP(3),
ADD COLUMN     "cobroUltimoError" TEXT,
ADD COLUMN     "medioPagoMarca" TEXT,
ADD COLUMN     "medioPagoToken" TEXT,
ADD COLUMN     "medioPagoUltimos4" TEXT;

-- CreateIndex
CREATE INDEX "PerfilTrabajador_saldo_idx" ON "PerfilTrabajador"("saldo");
