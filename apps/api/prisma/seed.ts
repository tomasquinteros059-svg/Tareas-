/**
 * Datos de ejemplo para levantar la app y poder tocarla: un cliente, tres
 * trabajadores de distinto nivel y un par de tareas publicadas.
 *
 *   pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { cotizar, generarFolio, PRECIOS_CHILE } from '@tareas/domain';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "SuscripcionPush", "Alerta", "Retiro", "MovimientoSaldo", "Calificacion",
      "Mensaje", "Pregunta", "EventoTarea", "Pago", "Tarea", "Habilidad", "PerfilTrabajador",
      "Direccion", "Identidad", "CuentaOAuth", "CodigoOtp", "Usuario" RESTART IDENTITY CASCADE;
  `);

  const cliente = await prisma.usuario.create({
    data: {
      nombre: 'Ana',
      apellido: 'Rivas',
      telefono: '+56955550001',
      telefonoOk: true,
      email: 'ana@ejemplo.com',
      direcciones: {
        create: {
          etiqueta: 'Casa',
          calle: 'Av. Providencia',
          numero: '1650',
          ciudad: 'Santiago',
          provincia: 'Región Metropolitana',
          pais: 'CL',
          lat: -33.4372,
          lng: -70.6506,
          principal: true,
        },
      },
    },
    include: { direcciones: true },
  });

  const trabajadores = await Promise.all([
    crearTrabajador('Beto', 'Suárez', '+56955550002', 'PLATINO', [
      'jardineria-corte-pasto',
      'limpieza-hogar',
    ]),
    crearTrabajador('Carla', 'Núñez', '+56955550003', 'PLATA', ['electricidad'], ['electricidad']),
    crearTrabajador('Diego', 'Ferrer', '+56955550004', 'NUEVO', ['mudanza-flete']),
    crearTrabajador('Elena', 'Ortiz', '+56955550005', 'ORO', ['abogado-dia', 'abogado-consulta'], [
      'abogado-dia',
      'abogado-consulta',
    ]),
  ]);

  await publicar(cliente.id, cliente.direcciones[0]!.id, {
    rubroSlug: 'jardineria-corte-pasto',
    titulo: 'Cortar el pasto del fondo',
    descripcion: 'Unos 80 m². Hay canilla y enchufe. Traer máquina.',
    unidades: 3,
    dificultad: 'BASICA',
    urgencia: 'HOY',
    nivelMinimo: 'NUEVO',
    metodoPago: 'EFECTIVO',
  });

  await publicar(cliente.id, cliente.direcciones[0]!.id, {
    rubroSlug: 'abogado-dia',
    titulo: 'Abogado para audiencia laboral',
    descripcion: 'Audiencia de conciliación, media jornada en tribunales. Se envía el expediente.',
    unidades: 1,
    dificultad: 'ALTA',
    urgencia: 'PROGRAMADA',
    nivelMinimo: 'ORO',
    metodoPago: 'TARJETA',
  });

  console.log(
    `Listo: 1 cliente, ${trabajadores.length} trabajadores y 2 tareas publicadas, en Santiago y en pesos.`,
  );
  console.log('Teléfonos para entrar desde la app: +56955550001 (clienta) a +56955550005.');
}

async function crearTrabajador(
  nombre: string,
  apellido: string,
  telefono: string,
  nivel: 'NUEVO' | 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO',
  rubros: string[],
  conLicencia: string[] = [],
) {
  const usuario = await prisma.usuario.create({
    data: {
      nombre,
      apellido,
      telefono,
      telefonoOk: true,
      roles: ['CLIENTE', 'TRABAJADOR'],
      perfil: {
        create: {
          nivel,
          calificacion: nivel === 'NUEVO' ? 4.3 : 4.8,
          trabajosCompletados: { NUEVO: 0, BRONCE: 5, PLATA: 20, ORO: 55, PLATINO: 140 }[nivel],
          trabajosAceptados: { NUEVO: 0, BRONCE: 6, PLATA: 22, ORO: 57, PLATINO: 143 }[nivel],
          disponible: true,
          lat: -33.4372,
          lng: -70.6506,
          radioKm: 20,
          habilidades: {
            create: rubros.map((rubroSlug) => ({
              rubroSlug,
              aniosExperiencia: 3,
              licenciaEstado: conLicencia.includes(rubroSlug) ? 'VERIFICADO' : 'PENDIENTE',
              licenciaNumero: conLicencia.includes(rubroSlug) ? 'MAT-12345' : null,
            })),
          },
        },
      },
      identidad: {
        create: {
          tipoDocumento: 'CEDULA',
          paisEmision: 'CL',
          numeroCifrado: 'semilla-no-cifrada',
          numeroHash: `semilla-${telefono}`,
          ultimos4: telefono.slice(-4),
          nombreLegal: `${nombre} ${apellido}`,
          fechaNacimiento: new Date('1988-03-12'),
          estado: 'VERIFICADO',
          verificadoEn: new Date(),
        },
      },
    },
  });
  return usuario;
}

async function publicar(
  autorId: string,
  direccionId: string,
  datos: {
    rubroSlug: string;
    titulo: string;
    descripcion: string;
    unidades: number;
    dificultad: 'BASICA' | 'MEDIA' | 'ALTA' | 'EXPERTA';
    urgencia: 'PROGRAMADA' | 'HOY' | 'INMEDIATA';
    nivelMinimo: 'NUEVO' | 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';
    metodoPago: 'TARJETA' | 'EFECTIVO';
  },
) {
  // Los mismos precios que muestra la app: pesos chilenos, no dólares.
  const cotizacion = cotizar(datos, PRECIOS_CHILE);
  const ahora = new Date();
  return prisma.tarea.create({
    data: {
      folio: generarFolio(ahora),
      autorId,
      direccionId,
      ...datos,
      minimoCalculado: cotizacion.minimo,
      presupuesto: cotizacion.sugerido,
      moneda: PRECIOS_CHILE.moneda,
      estado: 'PUBLICADA',
      lat: -33.4372,
      lng: -70.6506,
      codigoInicio: '4821',
      publicadaEn: ahora,
      expiraEn: new Date(ahora.getTime() + 24 * 60 * 60 * 1000),
      pago: {
        create: {
          metodo: datos.metodoPago,
          estado: datos.metodoPago === 'TARJETA' ? 'RETENIDO' : 'PENDIENTE',
          moneda: PRECIOS_CHILE.moneda,
          montoTarea: cotizacion.sugerido,
          totalCliente: datos.metodoPago === 'TARJETA' ? Math.round(cotizacion.sugerido * 1.05) : 0,
          referencia: datos.metodoPago === 'TARJETA' ? 'hold_semilla' : null,
        },
      },
      eventos: { create: { hacia: 'PUBLICADA', actorId: autorId, actorRol: 'CLIENTE' } },
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
