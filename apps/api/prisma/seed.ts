/**
 * Datos de ejemplo para levantar la app y poder tocarla.
 *
 *   pnpm db:seed              una clienta, cuatro trabajadores y dos tareas
 *   pnpm db:seed -- --cien    además, los cien trabajos de ejemplo
 *
 * Los cien salen del mismo archivo que usa la app (`apps/web/ejemplos.mjs`):
 * si estuvieran escritos dos veces se separarían solos, y el muro de la app
 * terminaría mostrando cosas que el servidor no tiene.
 */
import { PrismaClient } from '@prisma/client';
import { cotizar, generarFolio, PRECIOS_CHILE } from '@tareas/domain';
// @ts-expect-error -- el archivo de ejemplos es JavaScript suelto, a propósito:
// también lo lee el generador que escribe la app de un archivo.
import { TRABAJOS } from '../../web/ejemplos.mjs';

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

  let cien = 0;
  if (process.argv.includes('--cien')) {
    cien = await sembrarCien(cliente.id, cliente.direcciones[0]!.id);
  }

  console.log(
    `Listo: 1 cliente, ${trabajadores.length} trabajadores y ${2 + cien} tareas publicadas, ` +
      'en Santiago y en pesos.',
  );
  console.log('Teléfonos para entrar desde la app: +56955550001 (clienta) a +56955550005.');
}

/**
 * Los cien trabajos de ejemplo, repartidos por comuna, urgencia y antigüedad.
 * Las fechas se escalonan a propósito: así el radar muestra sus cuatro olas
 * conviviendo en el mismo muro, que es lo que hay que poder ver.
 */
async function sembrarCien(autorId: string, direccionId: string) {
  const comunas = [
    { nombre: 'Santiago Centro', lat: -33.4372, lng: -70.6506 },
    { nombre: 'Providencia', lat: -33.4256, lng: -70.6169 },
    { nombre: 'Ñuñoa', lat: -33.4569, lng: -70.5975 },
    { nombre: 'Las Condes', lat: -33.4103, lng: -70.568 },
    { nombre: 'Maipú', lat: -33.511, lng: -70.758 },
    { nombre: 'Puente Alto', lat: -33.6112, lng: -70.5758 },
  ];
  const urgencias = ['PROGRAMADA', 'PROGRAMADA', 'HOY', 'HOY', 'INMEDIATA'] as const;
  const niveles = ['NUEVO', 'NUEVO', 'NUEVO', 'BRONCE', 'PLATA', 'ORO'] as const;
  const pagos = ['TARJETA', 'TARJETA', 'EFECTIVO'] as const;
  const antiguedades = [8, 45, 120, 400, 900, 2400, 5400, 14400, 43200, 72000];

  const filas = TRABAJOS as Array<[string, string, string, number, 'BASICA' | 'MEDIA' | 'ALTA' | 'EXPERTA']>;
  for (const [i, fila] of filas.entries()) {
    const comuna = comunas[i % comunas.length]!;
    const publicadaEn = new Date(Date.now() - antiguedades[i % antiguedades.length]! * 1000);
    await publicar(
      autorId,
      direccionId,
      {
        rubroSlug: fila[0],
        titulo: fila[1],
        descripcion: fila[2],
        unidades: fila[3],
        dificultad: fila[4],
        urgencia: urgencias[i % urgencias.length]!,
        nivelMinimo: niveles[i % niveles.length]!,
        metodoPago: pagos[i % pagos.length]!,
      },
      { lat: comuna.lat, lng: comuna.lng, publicadaEn },
    );
  }
  return filas.length;
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
  donde: { lat: number; lng: number; publicadaEn?: Date } = { lat: -33.4372, lng: -70.6506 },
) {
  // Los mismos precios que muestra la app: pesos chilenos, no dólares.
  const cotizacion = cotizar(datos, PRECIOS_CHILE);
  const ahora = donde.publicadaEn ?? new Date();
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
      lat: donde.lat,
      lng: donde.lng,
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
