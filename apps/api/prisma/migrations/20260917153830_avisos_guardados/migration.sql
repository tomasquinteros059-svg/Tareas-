-- CreateTable
CREATE TABLE "Aviso" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "tareaId" TEXT,
    "url" TEXT,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aviso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Aviso_usuarioId_creadoEn_idx" ON "Aviso"("usuarioId", "creadoEn");

-- AddForeignKey
ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
