import type { PrismaClient, TipoDocumento } from '@prisma/client';
import { cifrar, descifrar, huella, normalizarDocumento } from '../../lib/cifrado.js';
import { conflicto, invalido, noEncontrado } from '../../lib/errores.js';

export interface DatosIdentidad {
  tipoDocumento: TipoDocumento;
  numero: string;
  paisEmision: string;
  nombreLegal: string;
  fechaNacimiento: Date;
  frenteUrl?: string;
  dorsoUrl?: string;
  selfieUrl?: string;
}

const EDAD_MINIMA = 18;

/**
 * Verificación de identidad. Es lo que hace que un desconocido pueda entrar a tu
 * casa: sin documento verificado nadie toma trabajos, y el documento queda
 * cifrado y atado a una sola cuenta.
 */
export class ServicioIdentidad {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly claveCifrado: string,
  ) {}

  async registrar(usuarioId: string, datos: DatosIdentidad) {
    const numero = normalizarDocumento(datos.numero);
    if (numero.length < 5) throw invalido('DOCUMENTO_INVALIDO', 'El número de documento es muy corto');
    if (edad(datos.fechaNacimiento) < EDAD_MINIMA) {
      throw invalido('MENOR_DE_EDAD', `Hay que tener ${EDAD_MINIMA} años para usar la plataforma`);
    }

    const numeroHash = huella(numero, this.claveCifrado);
    const duplicado = await this.prisma.identidad.findUnique({ where: { numeroHash } });
    if (duplicado && duplicado.usuarioId !== usuarioId) {
      throw conflicto('DOCUMENTO_EN_USO', 'Ese documento ya está registrado en otra cuenta');
    }

    const comun = {
      tipoDocumento: datos.tipoDocumento,
      paisEmision: datos.paisEmision.toUpperCase(),
      numeroCifrado: cifrar(numero, this.claveCifrado),
      numeroHash,
      ultimos4: numero.slice(-4),
      nombreLegal: datos.nombreLegal.trim(),
      fechaNacimiento: datos.fechaNacimiento,
      frenteUrl: datos.frenteUrl ?? null,
      dorsoUrl: datos.dorsoUrl ?? null,
      selfieUrl: datos.selfieUrl ?? null,
      estado: 'EN_REVISION' as const,
      motivoRechazo: null,
    };

    return this.prisma.identidad.upsert({
      where: { usuarioId },
      create: { usuarioId, ...comun },
      update: comun,
    });
  }

  /** Resolución de la revisión (manual o del proveedor de KYC). */
  async resolver(usuarioId: string, aprobado: boolean, revisorId: string, motivo?: string) {
    const identidad = await this.prisma.identidad.findUnique({ where: { usuarioId } });
    if (!identidad) throw noEncontrado('La identidad');
    return this.prisma.identidad.update({
      where: { usuarioId },
      data: {
        estado: aprobado ? 'VERIFICADO' : 'RECHAZADO',
        motivoRechazo: aprobado ? null : (motivo ?? 'No se pudo validar el documento'),
        revisadoPor: revisorId,
        verificadoEn: aprobado ? new Date() : null,
      },
    });
  }

  /** Vista pública: nunca devuelve el número completo. */
  async ver(usuarioId: string) {
    const identidad = await this.prisma.identidad.findUnique({ where: { usuarioId } });
    if (!identidad) return null;
    return {
      estado: identidad.estado,
      tipoDocumento: identidad.tipoDocumento,
      paisEmision: identidad.paisEmision,
      documento: `••••${identidad.ultimos4}`,
      nombreLegal: identidad.nombreLegal,
      motivoRechazo: identidad.motivoRechazo,
      verificadoEn: identidad.verificadoEn,
    };
  }

  /** Sólo para soporte/legales, con auditoría del lado del que llama. */
  async revelarNumero(usuarioId: string): Promise<string> {
    const identidad = await this.prisma.identidad.findUnique({ where: { usuarioId } });
    if (!identidad) throw noEncontrado('La identidad');
    return descifrar(identidad.numeroCifrado, this.claveCifrado);
  }
}

function edad(fechaNacimiento: Date, ahora = new Date()): number {
  let años = ahora.getFullYear() - fechaNacimiento.getFullYear();
  const mes = ahora.getMonth() - fechaNacimiento.getMonth();
  if (mes < 0 || (mes === 0 && ahora.getDate() < fechaNacimiento.getDate())) años--;
  return años;
}
