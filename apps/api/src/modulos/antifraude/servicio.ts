import type { PrismaClient } from '@prisma/client';
import {
  revisarRelacion,
  revisarRitmo,
  revisarTexto,
  riesgo,
  type Hallazgo,
} from '@tareas/domain';
import { invalido, noEncontrado } from '../../lib/errores.js';

/**
 * Antifraude.
 *
 * Las reglas —qué es sospechoso y cuánto pesa— están en el dominio. Acá está lo
 * que hay que ir a buscar a la base para poder aplicarlas, y qué se hace con el
 * resultado.
 *
 * La postura es deliberada: **no se bloquea a nadie por una sospecha**. Una
 * cuenta cerrada por un falso positivo es una persona que se queda sin trabajar
 * por un error nuestro, y eso no se arregla con una disculpa. Lo único que se
 * corta en el momento es un teléfono en una pregunta pública antes de asignar,
 * donde no hay motivo legítimo para darlo y el daño es inmediato. Todo lo demás
 * levanta una alerta y la mira una persona.
 */
export class ServicioAntifraude {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Una pregunta pública, antes de que la tarea tenga dueño. Acá el teléfono se
   * rechaza: no hay razón para dar un contacto a alguien que todavía no tomó el
   * trabajo, y si se cuela, el trabajo se hace por fuera y sin respaldo.
   */
  async revisarPregunta(tareaId: string, autorId: string, texto: string) {
    const hallazgos = revisarTexto(texto, true);
    if (hallazgos.length === 0) return;

    await this.registrar(autorId, tareaId, hallazgos);
    throw invalido(
      'CONTACTO_POR_FUERA',
      'Las preguntas son sobre el trabajo. El teléfono y el chat se abren cuando tomás la tarea.',
    );
  }

  /**
   * El chat privado de una tarea en curso. Un teléfono acá puede ser
   * "llamame cuando llegues": se anota, no se corta.
   */
  async revisarMensaje(tareaId: string, autorId: string, texto: string) {
    const hallazgos = revisarTexto(texto, false);
    if (hallazgos.length) await this.registrar(autorId, tareaId, hallazgos);
  }

  /**
   * Cierre de una tarea: es el momento en que se puede mirar la relación entre
   * las dos cuentas y el ritmo del trabajo, que por separado no dicen nada.
   */
  async revisarTareaCerrada(tareaId: string) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea?.trabajadorId || !tarea.publicadaEn || !tarea.asignadaEn) return null;

    const fin = tarea.confirmadaEn ?? tarea.entregadaEn ?? tarea.cerradaEn;
    if (!fin) return null;

    const [tareasConEsteCliente, tareasInvertidas, tareasDelTrabajador] = await Promise.all([
      this.prisma.tarea.count({
        where: { autorId: tarea.autorId, trabajadorId: tarea.trabajadorId },
      }),
      this.prisma.tarea.count({
        where: { autorId: tarea.trabajadorId, trabajadorId: tarea.autorId },
      }),
      this.prisma.tarea.count({ where: { trabajadorId: tarea.trabajadorId } }),
    ]);

    const hallazgos = [
      ...revisarRelacion({ tareasConEsteCliente, tareasInvertidas, tareasDelTrabajador }),
      ...revisarRitmo({
        segundosHastaAceptar: segundos(tarea.publicadaEn, tarea.asignadaEn),
        segundosDeTrabajo: segundos(tarea.asignadaEn, fin),
        horasCotizadas: tarea.unidades,
      }),
    ];
    if (hallazgos.length === 0) return null;
    return this.registrar(tarea.trabajadorId, tareaId, hallazgos);
  }

  /** La cola de soporte: lo más grave primero. */
  async pendientes(limite = 50) {
    const alertas = await this.prisma.alerta.findMany({
      where: { estado: 'ABIERTA' },
      orderBy: [{ puntaje: 'desc' }, { creadoEn: 'asc' }],
      take: limite,
      include: {
        usuario: { select: { id: true, nombre: true, apellido: true, telefono: true } },
        tarea: { select: { id: true, folio: true, rubroSlug: true, estado: true } },
      },
    });
    return { alertas, total: alertas.length };
  }

  /** Alguien la miró: queda con nombre y con lo que decidió. */
  async resolver(alertaId: string, revisorId: string, confirmada: boolean, nota: string) {
    if (nota.trim().length < 10) throw invalido('SIN_FUNDAMENTO', 'Escribí qué encontraste');
    const alerta = await this.prisma.alerta.findUnique({ where: { id: alertaId } });
    if (!alerta) throw noEncontrado('La alerta');

    return this.prisma.alerta.update({
      where: { id: alertaId },
      data: {
        estado: confirmada ? 'REVISADA' : 'DESCARTADA',
        nota: nota.trim(),
        revisadoPor: revisorId,
        resueltoEn: new Date(),
      },
    });
  }

  /** Todo lo que se levantó sobre una cuenta, para la ficha de soporte. */
  async deUsuario(usuarioId: string) {
    return this.prisma.alerta.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
      take: 20,
    });
  }

  /**
   * Una alerta abierta por las mismas señales sobre la misma tarea se actualiza
   * en vez de duplicarse: la cola de soporte tiene que ser corta para que
   * alguien la mire de verdad.
   */
  private async registrar(usuarioId: string, tareaId: string, hallazgos: Hallazgo[]) {
    const { puntaje, nivel } = riesgo(hallazgos);
    const abierta = await this.prisma.alerta.findFirst({
      where: { usuarioId, tareaId, estado: 'ABIERTA' },
    });

    const datos = { senales: hallazgos as unknown as object, puntaje, nivel };
    if (abierta) {
      const unidas = unir(abierta.senales as unknown as Hallazgo[], hallazgos);
      const total = riesgo(unidas);
      return this.prisma.alerta.update({
        where: { id: abierta.id },
        data: { senales: unidas as unknown as object, puntaje: total.puntaje, nivel: total.nivel },
      });
    }
    return this.prisma.alerta.create({ data: { usuarioId, tareaId, ...datos } });
  }
}

function segundos(desde: Date, hasta: Date): number {
  return Math.max(0, (hasta.getTime() - desde.getTime()) / 1000);
}

/** Una misma señal no cuenta dos veces: se queda la de mayor peso. */
function unir(previos: Hallazgo[], nuevos: Hallazgo[]): Hallazgo[] {
  const porSenal = new Map<string, Hallazgo>();
  for (const h of [...previos, ...nuevos]) {
    const actual = porSenal.get(h.senal);
    if (!actual || h.peso > actual.peso) porSenal.set(h.senal, h);
  }
  return [...porSenal.values()];
}
