import { createHash, randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { normalizarTelefono } from '@tareas/domain';
import { conflicto, invalido } from '../../lib/errores.js';

const VIGENCIA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 5;
/** No se pueden pedir más de N códigos por teléfono en esta ventana. */
const MAX_ENVIOS_POR_HORA = 5;

export interface Enviador {
  enviarSms(telefono: string, texto: string): Promise<void>;
}

/** En desarrollo el "SMS" va al log del servidor. */
export class EnviadorConsola implements Enviador {
  readonly enviados: Array<{ telefono: string; texto: string }> = [];
  async enviarSms(telefono: string, texto: string): Promise<void> {
    this.enviados.push({ telefono, texto });
    console.log(`[sms] ${telefono}: ${texto}`);
  }
}

export function hashCodigo(codigo: string, telefono: string): string {
  return createHash('sha256').update(`${telefono}:${codigo}`).digest('hex');
}

export class ServicioOtp {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly enviador: Enviador,
    private readonly paisPorDefecto = 'CL',
  ) {}

  /**
   * El número se lleva a formato internacional antes de tocar nada. Es lo que
   * hace que "912345678" y "+56 9 1234 5678" sean la misma cuenta y no dos, y
   * lo que evita mandar un SMS a un número que no puede recibirlo y dejar a
   * alguien esperando un código que nunca va a llegar.
   */
  normalizar(entrada: string): string {
    const numero = normalizarTelefono(entrada, this.paisPorDefecto);
    if (!numero) throw invalido('TELEFONO_INVALIDO', 'Ese número no parece válido. Revisalo.');
    if (!numero.esMovil) {
      throw invalido('TELEFONO_NO_MOVIL', 'El código llega por SMS: hace falta un celular');
    }
    return numero.e164;
  }

  async enviar(entrada: string): Promise<{ expiraEn: Date; telefono: string }> {
    const telefono = this.normalizar(entrada);
    const desde = new Date(Date.now() - 60 * 60 * 1000);
    const recientes = await this.prisma.codigoOtp.count({ where: { telefono, creadoEn: { gt: desde } } });
    if (recientes >= MAX_ENVIOS_POR_HORA) {
      throw conflicto('DEMASIADOS_CODIGOS', 'Pediste muchos códigos. Probá de nuevo en un rato.');
    }

    const codigo = String(randomInt(100000, 1000000));
    const expiraEn = new Date(Date.now() + VIGENCIA_MS);
    await this.prisma.codigoOtp.create({
      data: { telefono, codigoHash: hashCodigo(codigo, telefono), expiraEn },
    });
    await this.enviador.enviarSms(telefono, `Tu código de Tareas es ${codigo}. Vence en 5 minutos.`);
    return { expiraEn, telefono };
  }

  /** Devuelve true si el código es correcto; consume el código en el intento. */
  async verificar(entrada: string, codigo: string): Promise<boolean> {
    const telefono = this.normalizar(entrada);
    const registro = await this.prisma.codigoOtp.findFirst({
      where: { telefono, usado: false, expiraEn: { gt: new Date() } },
      orderBy: { creadoEn: 'desc' },
    });
    if (!registro) throw invalido('CODIGO_VENCIDO', 'El código venció o no existe. Pedí uno nuevo.');
    if (registro.intentos >= MAX_INTENTOS) {
      throw conflicto('DEMASIADOS_INTENTOS', 'Demasiados intentos fallidos. Pedí un código nuevo.');
    }

    const coincide = registro.codigoHash === hashCodigo(codigo, telefono);
    await this.prisma.codigoOtp.update({
      where: { id: registro.id },
      data: { intentos: { increment: 1 }, usado: coincide },
    });
    return coincide;
  }
}
