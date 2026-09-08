import type { PrismaClient } from '@prisma/client';
import { calcularNivel, calificacionBayesiana, siguienteNivel } from '@tareas/domain';
import { conflicto, invalido, noEncontrado, sinPermiso } from '../../lib/errores.js';

/** Días tras los que una calificación se hace visible aunque la otra parte no haya calificado. */
const DIAS_DOBLE_CIEGO = 7;

export interface DatosCalificacion {
  estrellas: number;
  comentario?: string;
  etiquetas?: string[];
  puntual?: boolean;
}

export class ServicioCalificaciones {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Calificación de doble vía y doble ciego: ninguna de las dos partes ve la
   * nota de la otra hasta que ambas calificaron (o pasan 7 días). Sin esto, las
   * notas se vuelven represalias y todo el mundo termina con 5 estrellas.
   */
  async calificar(tareaId: string, autorId: string, datos: DatosCalificacion) {
    if (!Number.isInteger(datos.estrellas) || datos.estrellas < 1 || datos.estrellas > 5) {
      throw invalido('ESTRELLAS_INVALIDAS', 'La calificación va de 1 a 5 estrellas');
    }
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea) throw noEncontrado('La tarea');
    if (!tarea.trabajadorId) throw conflicto('SIN_TRABAJADOR', 'La tarea no llegó a asignarse');
    if (!['ENTREGADA', 'CONFIRMADA', 'PAGADA'].includes(tarea.estado)) {
      throw conflicto('TAREA_ABIERTA', 'Se califica cuando el trabajo está entregado');
    }

    const destinatarioId =
      autorId === tarea.autorId
        ? tarea.trabajadorId
        : autorId === tarea.trabajadorId
          ? tarea.autorId
          : null;
    if (!destinatarioId) throw sinPermiso('No participaste de esta tarea');

    const yaCalifico = await this.prisma.calificacion.findUnique({
      where: { tareaId_autorId: { tareaId, autorId } },
    });
    if (yaCalifico) throw conflicto('YA_CALIFICADA', 'Ya calificaste esta tarea');

    const calificacion = await this.prisma.calificacion.create({
      data: {
        tareaId,
        autorId,
        destinatarioId,
        estrellas: datos.estrellas,
        comentario: datos.comentario ?? null,
        etiquetas: datos.etiquetas ?? [],
        puntual: datos.puntual ?? null,
      },
    });

    const contraparte = await this.prisma.calificacion.findFirst({
      where: { tareaId, autorId: destinatarioId },
    });
    if (contraparte) {
      await this.prisma.calificacion.updateMany({ where: { tareaId }, data: { visible: true } });
    }

    if (destinatarioId === tarea.trabajadorId) {
      await this.recalcularPerfil(destinatarioId);
    }
    return calificacion;
  }

  /** Recalcula estrellas y nivel del trabajador. Se corre después de cada nota. */
  async recalcularPerfil(usuarioId: string) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil');

    const agregado = await this.prisma.calificacion.aggregate({
      where: { destinatarioId: usuarioId },
      _sum: { estrellas: true },
      _count: { _all: true },
    });
    const puntuales = await this.prisma.calificacion.count({
      where: { destinatarioId: usuarioId, puntual: true },
    });

    const cantidad = agregado._count._all;
    const suma = agregado._sum.estrellas ?? 0;
    const calificacion = calificacionBayesiana({ cantidad, suma });

    const aceptados = Math.max(perfil.trabajosAceptados, 1);
    const metricas = {
      calificacion,
      trabajosCompletados: perfil.trabajosCompletados,
      tasaCancelacion: perfil.trabajosCancelados / aceptados,
      tasaPuntualidad: cantidad === 0 ? 1 : puntuales / cantidad,
      identidadVerificada: await this.identidadVerificada(usuarioId),
      antecedentesVerificados: perfil.antecedentes === 'VERIFICADO',
    };

    const nivel = calcularNivel(metricas);
    const actualizado = await this.prisma.perfilTrabajador.update({
      where: { usuarioId },
      data: {
        calificacion,
        sumaEstrellas: suma,
        cantidadCalificaciones: cantidad,
        llegadasPuntuales: puntuales,
        nivel,
      },
    });
    return { perfil: actualizado, progreso: siguienteNivel(metricas) };
  }

  /** Publica las calificaciones viejas que quedaron esperando a la contraparte. */
  async liberarVencidas(ahora = new Date()) {
    const limite = new Date(ahora.getTime() - DIAS_DOBLE_CIEGO * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.calificacion.updateMany({
      where: { visible: false, creadoEn: { lt: limite } },
      data: { visible: true },
    });
    return count;
  }

  private async identidadVerificada(usuarioId: string): Promise<boolean> {
    const identidad = await this.prisma.identidad.findUnique({
      where: { usuarioId },
      select: { estado: true },
    });
    return identidad?.estado === 'VERIFICADO';
  }
}
