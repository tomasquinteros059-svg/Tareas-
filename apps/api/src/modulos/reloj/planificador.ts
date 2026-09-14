import type { PrismaClient } from '@prisma/client';
import { exigirTransicion } from '@tareas/domain';
import type { ServicioTareas } from '../tareas/servicio.js';
import type { ServicioCalificaciones } from '../calificaciones/servicio.js';
import type { Pasarela } from '../pagos/pasarela.js';

/**
 * El reloj del sistema.
 *
 * Todo lo que en la app pasa "solo" pasa acá. Sin esto quedan agujeros que no
 * se ven en una demostración pero arruinan el producto en la calle:
 *
 *  - un cliente recibe el trabajo, se olvida de confirmar, y el trabajador no
 *    cobra nunca porque la plata queda retenida para siempre;
 *  - tareas que nadie tomó siguen apareciendo en el radar semanas después;
 *  - las calificaciones a ciegas nunca se publican si una de las partes no
 *    califica;
 *  - con Webpay, la reserva caduca a los 7 días y nadie la libera: el cliente
 *    ve plata bloqueada en su tarjeta sin explicación.
 *
 * Cada trabajo es idempotente y usa condiciones en el UPDATE, así que si el
 * reloj corre en dos servidores a la vez ninguna tarea se procesa dos veces.
 */

export const HORAS_PARA_CONFIRMAR = 24;
/** Webpay caduca a los 7 días: liberamos antes para no llegar justo. */
export const DIAS_RESERVA_MAXIMA = 6;

export interface ResumenReloj {
  expiradas: number;
  confirmadas: number;
  calificacionesLiberadas: number;
  reservasLiberadas: number;
  errores: string[];
}

export class Planificador {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tareas: ServicioTareas,
    private readonly calificaciones: ServicioCalificaciones,
    private readonly pasarela: Pasarela,
  ) {}

  /** Una pasada completa. Devuelve qué hizo, para poder registrarlo. */
  async correr(ahora = new Date()): Promise<ResumenReloj> {
    const resumen: ResumenReloj = {
      expiradas: 0,
      confirmadas: 0,
      calificacionesLiberadas: 0,
      reservasLiberadas: 0,
      errores: [],
    };

    resumen.expiradas = await this.protegido(() => this.expirarPublicadas(ahora), resumen);
    resumen.confirmadas = await this.protegido(() => this.confirmarEntregadas(ahora), resumen);
    resumen.calificacionesLiberadas = await this.protegido(
      () => this.calificaciones.liberarVencidas(ahora),
      resumen,
    );
    resumen.reservasLiberadas = await this.protegido(() => this.liberarReservasViejas(ahora), resumen);
    return resumen;
  }

  /**
   * Nadie la tomó dentro de la ventana: se cierra y se libera la reserva.
   * El cliente no puede quedar con plata bloqueada por una tarea muerta.
   */
  private async expirarPublicadas(ahora: Date): Promise<number> {
    const vencidas = await this.prisma.tarea.findMany({
      where: { estado: 'PUBLICADA', expiraEn: { lt: ahora } },
      select: { id: true, estado: true, metodoPago: true },
      take: 200,
    });

    let hechas = 0;
    for (const tarea of vencidas) {
      exigirTransicion(tarea.estado, 'EXPIRADA', 'SISTEMA');
      // La condición en el WHERE es el candado: si otro proceso la tomó
      // primero, este UPDATE afecta cero filas y seguimos de largo.
      const { count } = await this.prisma.tarea.updateMany({
        where: { id: tarea.id, estado: 'PUBLICADA' },
        data: { estado: 'EXPIRADA', cerradaEn: ahora },
      });
      if (count === 0) continue;

      await this.prisma.eventoTarea.create({
        data: {
          tareaId: tarea.id,
          desde: 'PUBLICADA',
          hacia: 'EXPIRADA',
          actorRol: 'SISTEMA',
          nota: 'Nadie la tomó dentro de la ventana',
        },
      });
      if (tarea.metodoPago === 'TARJETA') await this.liberarPago(tarea.id);
      hechas++;
    }
    return hechas;
  }

  /**
   * El trabajo está entregado y el cliente no dijo nada en 24 horas. Se da por
   * confirmado y se le paga al trabajador: el silencio del cliente no puede
   * dejar a alguien sin cobrar lo que ya hizo.
   */
  private async confirmarEntregadas(ahora: Date): Promise<number> {
    const limite = new Date(ahora.getTime() - HORAS_PARA_CONFIRMAR * 60 * 60 * 1000);
    const entregadas = await this.prisma.tarea.findMany({
      where: { estado: 'ENTREGADA', entregadaEn: { lt: limite } },
      select: { id: true, estado: true },
      take: 100,
    });

    let hechas = 0;
    for (const tarea of entregadas) {
      exigirTransicion(tarea.estado, 'CONFIRMADA', 'SISTEMA');
      const { count } = await this.prisma.tarea.updateMany({
        where: { id: tarea.id, estado: 'ENTREGADA' },
        data: { estado: 'CONFIRMADA', confirmadaEn: ahora },
      });
      if (count === 0) continue;

      await this.prisma.eventoTarea.create({
        data: {
          tareaId: tarea.id,
          desde: 'ENTREGADA',
          hacia: 'CONFIRMADA',
          actorRol: 'SISTEMA',
          nota: `Confirmada automáticamente tras ${HORAS_PARA_CONFIRMAR} horas sin respuesta`,
        },
      });
      await this.tareas.liquidarTarea(tarea.id);
      hechas++;
    }
    return hechas;
  }

  /**
   * Reservas que llevan demasiado tiempo sin capturarse. Pasa cuando una tarea
   * queda asignada y el trabajo se posterga: antes de que el banco la caduque
   * solo, la liberamos nosotros y avisamos con la tarea cancelada.
   */
  private async liberarReservasViejas(ahora: Date): Promise<number> {
    const limite = new Date(ahora.getTime() - DIAS_RESERVA_MAXIMA * 24 * 60 * 60 * 1000);
    const viejas = await this.prisma.pago.findMany({
      where: {
        estado: 'RETENIDO',
        retenidoEn: { lt: limite },
        tarea: { estado: { in: ['PUBLICADA', 'ASIGNADA', 'EN_CAMINO'] } },
      },
      select: { id: true, tareaId: true, referencia: true },
      take: 100,
    });

    let hechas = 0;
    for (const pago of viejas) {
      const { count } = await this.prisma.pago.updateMany({
        where: { id: pago.id, estado: 'RETENIDO' },
        data: { estado: 'REEMBOLSADO' },
      });
      if (count === 0) continue;

      if (pago.referencia) await this.pasarela.liberar(pago.referencia);
      await this.prisma.$transaction([
        this.prisma.tarea.update({
          where: { id: pago.tareaId },
          data: { estado: 'CANCELADA', cerradaEn: ahora },
        }),
        this.prisma.eventoTarea.create({
          data: {
            tareaId: pago.tareaId,
            hacia: 'CANCELADA',
            actorRol: 'SISTEMA',
            nota: `La reserva del pago llevaba más de ${DIAS_RESERVA_MAXIMA} días sin capturarse`,
          },
        }),
      ]);
      hechas++;
    }
    return hechas;
  }

  private async liberarPago(tareaId: string) {
    const pago = await this.prisma.pago.findUnique({ where: { tareaId } });
    if (!pago?.referencia || pago.estado !== 'RETENIDO') return;
    await this.pasarela.liberar(pago.referencia);
    await this.prisma.pago.update({ where: { tareaId }, data: { estado: 'REEMBOLSADO' } });
  }

  /**
   * Un trabajo que falla no puede frenar a los demás: se anota el error y el
   * reloj sigue. Si el que falló era el que paga, se reintenta en la vuelta
   * siguiente, porque todos son idempotentes.
   */
  private async protegido(trabajo: () => Promise<number>, resumen: ResumenReloj): Promise<number> {
    try {
      return await trabajo();
    } catch (error) {
      resumen.errores.push(error instanceof Error ? error.message : String(error));
      return 0;
    }
  }
}
