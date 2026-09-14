import { PrismaClient } from '@prisma/client';
import { cargarEnv, type Env } from '../lib/env.js';
import { crearContexto, type Contexto } from '../contexto.js';
import { PasarelaSandbox } from '../modulos/pagos/pasarela.js';
import { EnviadorConsola } from '../modulos/auth/otp.js';
import { URL_TEST } from './preparar-db.js';

export const prisma = new PrismaClient({ datasources: { db: { url: URL_TEST } } });

export const env: Env = cargarEnv({
  DATABASE_URL: URL_TEST,
  JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres',
  KYC_ENCRYPTION_KEY: 'a'.repeat(64),
  NODE_ENV: 'test',
} as NodeJS.ProcessEnv);

export function contextoDePrueba(): Contexto & { pasarela: PasarelaSandbox; enviador: EnviadorConsola } {
  const pasarela = new PasarelaSandbox();
  const enviador = new EnviadorConsola();
  return { ...crearContexto(prisma, env, { pasarela, enviador }), pasarela, enviador };
}

export async function limpiar() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Alerta", "Retiro", "MovimientoSaldo", "Calificacion", "Mensaje", "Pregunta", "EventoTarea",
      "Pago", "Tarea", "Habilidad", "PerfilTrabajador", "Direccion", "Identidad",
      "CuentaOAuth", "CodigoOtp", "Usuario" RESTART IDENTITY CASCADE;
  `);
}

let contador = 0;

export interface OpcionesTrabajador {
  nivel?: 'NUEVO' | 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';
  rubros?: string[];
  licencias?: string[];
  saldo?: number;
  aceptaEfectivo?: boolean;
  antecedentes?: boolean;
  lat?: number;
  lng?: number;
  identidadVerificada?: boolean;
}

/** Cliente listo para publicar: teléfono verificado, que es lo que exige el flujo. */
export async function crearCliente(nombre = 'Ana') {
  contador++;
  return prisma.usuario.create({
    data: { nombre, apellido: 'Pérez', telefono: `+5491100000${contador.toString().padStart(3, '0')}`, telefonoOk: true },
  });
}

export async function crearTrabajador(nombre = 'Beto', opciones: OpcionesTrabajador = {}) {
  contador++;
  const rubros = opciones.rubros ?? ['jardineria-corte-pasto'];
  const usuario = await prisma.usuario.create({
    data: {
      nombre,
      apellido: 'Gómez',
      telefono: `+5491100000${contador.toString().padStart(3, '0')}`,
      telefonoOk: true,
      roles: ['CLIENTE', 'TRABAJADOR'],
      perfil: {
        create: {
          nivel: opciones.nivel ?? 'ORO',
          calificacion: 4.8,
          trabajosCompletados: 60,
          trabajosAceptados: 62,
          antecedentes: opciones.antecedentes ? 'VERIFICADO' : 'PENDIENTE',
          aceptaEfectivo: opciones.aceptaEfectivo ?? true,
          radioKm: 25,
          lat: opciones.lat ?? -34.61,
          lng: opciones.lng ?? -58.39,
          saldo: opciones.saldo ?? 0,
          habilidades: {
            create: rubros.map((rubroSlug) => ({
              rubroSlug,
              licenciaEstado: (opciones.licencias ?? []).includes(rubroSlug) ? 'VERIFICADO' : 'PENDIENTE',
            })),
          },
        },
      },
    },
  });

  if (opciones.identidadVerificada !== false) {
    await prisma.identidad.create({
      data: {
        usuarioId: usuario.id,
        tipoDocumento: 'CEDULA',
        paisEmision: 'AR',
        numeroCifrado: 'x',
        numeroHash: `hash-${usuario.id}`,
        ultimos4: '1234',
        nombreLegal: `${nombre} Gómez`,
        fechaNacimiento: new Date('1990-01-01'),
        estado: 'VERIFICADO',
        verificadoEn: new Date(),
      },
    });
  }
  return usuario;
}

export const TAREA_BASE = {
  rubroSlug: 'jardineria-corte-pasto',
  titulo: 'Cortar el pasto del fondo',
  descripcion: 'Son unos 80 m2, con máquina propia. Hay canilla y enchufe.',
  unidades: 3,
  dificultad: 'BASICA' as const,
  urgencia: 'PROGRAMADA' as const,
  nivelMinimo: 'NUEVO' as const,
  presupuesto: 3000,
  metodoPago: 'TARJETA' as const,
  metodoPagoToken: 'tok_ok_4242',
  lat: -34.6037,
  lng: -58.3816,
};
