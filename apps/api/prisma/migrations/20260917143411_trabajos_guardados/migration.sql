-- CreateTable
CREATE TABLE "TareaGuardada" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TareaGuardada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TareaGuardada_usuarioId_idx" ON "TareaGuardada"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "TareaGuardada_usuarioId_tareaId_key" ON "TareaGuardada"("usuarioId", "tareaId");

-- AddForeignKey
ALTER TABLE "TareaGuardada" ADD CONSTRAINT "TareaGuardada_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaGuardada" ADD CONSTRAINT "TareaGuardada_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
