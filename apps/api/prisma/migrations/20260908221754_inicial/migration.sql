-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('CLIENTE', 'TRABAJADOR', 'SOPORTE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Proveedor" AS ENUM ('GOOGLE', 'LINKEDIN', 'TELEFONO');

-- CreateEnum
CREATE TYPE "EstadoVerificacion" AS ENUM ('PENDIENTE', 'EN_REVISION', 'VERIFICADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('CEDULA', 'DNI', 'PASAPORTE', 'LICENCIA_CONDUCIR');

-- CreateEnum
CREATE TYPE "Nivel" AS ENUM ('NUEVO', 'BRONCE', 'PLATA', 'ORO', 'PLATINO');

-- CreateEnum
CREATE TYPE "Dificultad" AS ENUM ('BASICA', 'MEDIA', 'ALTA', 'EXPERTA');

-- CreateEnum
CREATE TYPE "Urgencia" AS ENUM ('PROGRAMADA', 'HOY', 'INMEDIATA');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('TARJETA', 'EFECTIVO');

-- CreateEnum
CREATE TYPE "EstadoTarea" AS ENUM ('BORRADOR', 'PUBLICADA', 'ASIGNADA', 'EN_CAMINO', 'EN_PROGRESO', 'ENTREGADA', 'CONFIRMADA', 'PAGADA', 'CANCELADA', 'EXPIRADA', 'EN_DISPUTA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'RETENIDO', 'CAPTURADO', 'LIQUIDADO', 'REEMBOLSADO', 'FALLIDO', 'EN_MANO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ACREDITACION_TRABAJO', 'DEUDA_COMISION_EFECTIVO', 'PAGO_DE_DEUDA', 'RETIRO', 'COMPENSACION_CANCELACION', 'AJUSTE_SOPORTE', 'PROPINA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT NOT NULL,
    "telefonoOk" BOOLEAN NOT NULL DEFAULT false,
    "emailOk" BOOLEAN NOT NULL DEFAULT false,
    "fotoUrl" TEXT,
    "roles" "Rol"[] DEFAULT ARRAY['CLIENTE']::"Rol"[],
    "suspendido" BOOLEAN NOT NULL DEFAULT false,
    "motivoSuspension" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaOAuth" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "proveedor" "Proveedor" NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "email" TEXT,
    "perfilUrl" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identidad" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipoDocumento" "TipoDocumento" NOT NULL,
    "paisEmision" TEXT NOT NULL,
    "numeroCifrado" TEXT NOT NULL,
    "numeroHash" TEXT NOT NULL,
    "ultimos4" TEXT NOT NULL,
    "nombreLegal" TEXT NOT NULL,
    "fechaNacimiento" TIMESTAMP(3) NOT NULL,
    "frenteUrl" TEXT,
    "dorsoUrl" TEXT,
    "selfieUrl" TEXT,
    "estado" "EstadoVerificacion" NOT NULL DEFAULT 'PENDIENTE',
    "motivoRechazo" TEXT,
    "revisadoPor" TEXT,
    "verificadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Direccion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL DEFAULT 'Casa',
    "calle" TEXT NOT NULL,
    "numero" TEXT,
    "piso" TEXT,
    "ciudad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "pais" TEXT NOT NULL,
    "codigoPostal" TEXT,
    "referencias" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilTrabajador" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "bio" TEXT,
    "nivel" "Nivel" NOT NULL DEFAULT 'NUEVO',
    "calificacion" DOUBLE PRECISION NOT NULL DEFAULT 4.3,
    "sumaEstrellas" INTEGER NOT NULL DEFAULT 0,
    "cantidadCalificaciones" INTEGER NOT NULL DEFAULT 0,
    "trabajosCompletados" INTEGER NOT NULL DEFAULT 0,
    "trabajosAceptados" INTEGER NOT NULL DEFAULT 0,
    "trabajosCancelados" INTEGER NOT NULL DEFAULT 0,
    "llegadasPuntuales" INTEGER NOT NULL DEFAULT 0,
    "antecedentes" "EstadoVerificacion" NOT NULL DEFAULT 'PENDIENTE',
    "disponible" BOOLEAN NOT NULL DEFAULT false,
    "aceptaEfectivo" BOOLEAN NOT NULL DEFAULT true,
    "radioKm" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "saldo" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilTrabajador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Habilidad" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "rubroSlug" TEXT NOT NULL,
    "aniosExperiencia" INTEGER NOT NULL DEFAULT 0,
    "licenciaNumero" TEXT,
    "licenciaEstado" "EstadoVerificacion" NOT NULL DEFAULT 'PENDIENTE',
    "licenciaVence" TIMESTAMP(3),

    CONSTRAINT "Habilidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarea" (
    "folio" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "trabajadorId" TEXT,
    "rubroSlug" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unidades" DOUBLE PRECISION NOT NULL,
    "dificultad" "Dificultad" NOT NULL,
    "urgencia" "Urgencia" NOT NULL,
    "nivelMinimo" "Nivel" NOT NULL DEFAULT 'NUEVO',
    "exigeAntecedentes" BOOLEAN NOT NULL DEFAULT false,
    "minimoCalculado" INTEGER NOT NULL,
    "presupuesto" INTEGER NOT NULL,
    "materiales" INTEGER NOT NULL DEFAULT 0,
    "propina" INTEGER NOT NULL DEFAULT 0,
    "metodoPago" "MetodoPago" NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'USD',
    "estado" "EstadoTarea" NOT NULL DEFAULT 'BORRADOR',
    "direccionId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "codigoInicio" TEXT,
    "programadaPara" TIMESTAMP(3),
    "publicadaEn" TIMESTAMP(3),
    "expiraEn" TIMESTAMP(3),
    "asignadaEn" TIMESTAMP(3),
    "iniciadaEn" TIMESTAMP(3),
    "entregadaEn" TIMESTAMP(3),
    "confirmadaEn" TIMESTAMP(3),
    "cerradaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoTarea" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "desde" "EstadoTarea",
    "hacia" "EstadoTarea" NOT NULL,
    "actorId" TEXT,
    "actorRol" TEXT NOT NULL,
    "nota" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoTarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pregunta" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "respuesta" TEXT,
    "respondidaEn" TIMESTAMP(3),
    "publica" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pregunta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mensaje" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "adjuntoUrl" TEXT,
    "leidoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calificacion" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "destinatarioId" TEXT NOT NULL,
    "estrellas" INTEGER NOT NULL,
    "comentario" TEXT,
    "etiquetas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "puntual" BOOLEAN,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Calificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "metodo" "MetodoPago" NOT NULL,
    "estado" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "moneda" TEXT NOT NULL DEFAULT 'USD',
    "montoTarea" INTEGER NOT NULL,
    "cargoServicio" INTEGER NOT NULL DEFAULT 0,
    "propina" INTEGER NOT NULL DEFAULT 0,
    "totalCliente" INTEGER NOT NULL DEFAULT 0,
    "comision" INTEGER NOT NULL DEFAULT 0,
    "tasaComision" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoProcesamiento" INTEGER NOT NULL DEFAULT 0,
    "netoTrabajador" INTEGER NOT NULL DEFAULT 0,
    "referencia" TEXT,
    "ultimos4Tarjeta" TEXT,
    "marca" TEXT,
    "retenidoEn" TIMESTAMP(3),
    "capturadoEn" TIMESTAMP(3),
    "liquidadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoSaldo" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tareaId" TEXT,
    "tipo" "TipoMovimiento" NOT NULL,
    "monto" INTEGER NOT NULL,
    "saldoResultante" INTEGER NOT NULL,
    "detalle" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoSaldo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoOtp" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "telefono" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_telefono_key" ON "Usuario"("telefono");

-- CreateIndex
CREATE INDEX "Usuario_telefono_idx" ON "Usuario"("telefono");

-- CreateIndex
CREATE INDEX "CuentaOAuth_usuarioId_idx" ON "CuentaOAuth"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaOAuth_proveedor_proveedorId_key" ON "CuentaOAuth"("proveedor", "proveedorId");

-- CreateIndex
CREATE UNIQUE INDEX "Identidad_usuarioId_key" ON "Identidad"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Identidad_numeroHash_key" ON "Identidad"("numeroHash");

-- CreateIndex
CREATE INDEX "Identidad_estado_idx" ON "Identidad"("estado");

-- CreateIndex
CREATE INDEX "Direccion_usuarioId_idx" ON "Direccion"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilTrabajador_usuarioId_key" ON "PerfilTrabajador"("usuarioId");

-- CreateIndex
CREATE INDEX "PerfilTrabajador_nivel_idx" ON "PerfilTrabajador"("nivel");

-- CreateIndex
CREATE INDEX "PerfilTrabajador_disponible_idx" ON "PerfilTrabajador"("disponible");

-- CreateIndex
CREATE INDEX "Habilidad_rubroSlug_idx" ON "Habilidad"("rubroSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Habilidad_perfilId_rubroSlug_key" ON "Habilidad"("perfilId", "rubroSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Tarea_folio_key" ON "Tarea"("folio");

-- CreateIndex
CREATE INDEX "Tarea_estado_publicadaEn_idx" ON "Tarea"("estado", "publicadaEn");

-- CreateIndex
CREATE INDEX "Tarea_rubroSlug_estado_idx" ON "Tarea"("rubroSlug", "estado");

-- CreateIndex
CREATE INDEX "Tarea_autorId_idx" ON "Tarea"("autorId");

-- CreateIndex
CREATE INDEX "Tarea_trabajadorId_idx" ON "Tarea"("trabajadorId");

-- CreateIndex
CREATE INDEX "EventoTarea_tareaId_creadoEn_idx" ON "EventoTarea"("tareaId", "creadoEn");

-- CreateIndex
CREATE INDEX "Pregunta_tareaId_idx" ON "Pregunta"("tareaId");

-- CreateIndex
CREATE INDEX "Mensaje_tareaId_creadoEn_idx" ON "Mensaje"("tareaId", "creadoEn");

-- CreateIndex
CREATE INDEX "Calificacion_destinatarioId_idx" ON "Calificacion"("destinatarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Calificacion_tareaId_autorId_key" ON "Calificacion"("tareaId", "autorId");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_tareaId_key" ON "Pago"("tareaId");

-- CreateIndex
CREATE INDEX "Pago_estado_idx" ON "Pago"("estado");

-- CreateIndex
CREATE INDEX "MovimientoSaldo_usuarioId_creadoEn_idx" ON "MovimientoSaldo"("usuarioId", "creadoEn");

-- CreateIndex
CREATE INDEX "CodigoOtp_telefono_creadoEn_idx" ON "CodigoOtp"("telefono", "creadoEn");

-- AddForeignKey
ALTER TABLE "CuentaOAuth" ADD CONSTRAINT "CuentaOAuth_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identidad" ADD CONSTRAINT "Identidad_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direccion" ADD CONSTRAINT "Direccion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilTrabajador" ADD CONSTRAINT "PerfilTrabajador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Habilidad" ADD CONSTRAINT "Habilidad_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "PerfilTrabajador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_trabajadorId_fkey" FOREIGN KEY ("trabajadorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_direccionId_fkey" FOREIGN KEY ("direccionId") REFERENCES "Direccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoTarea" ADD CONSTRAINT "EventoTarea_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calificacion" ADD CONSTRAINT "Calificacion_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoOtp" ADD CONSTRAINT "CodigoOtp_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
