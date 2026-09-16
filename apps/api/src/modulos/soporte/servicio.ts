import type { PrismaClient } from '@prisma/client';
import { liquidar, PAIS_REFERENCIA, type ConfiguracionPais } from '@tareas/domain';
import { conflicto, invalido, noEncontrado } from '../../lib/errores.js';
import type { Pasarela } from '../pagos/pasarela.js';
import type { ServicioTareas } from '../tareas/servicio.js';

/**
 * Soporte.
 *
 * Sin esto, cada reclamo termina siendo alguien tocando la base de datos a mano
 * un domingo a la noche. Todo lo que pasa acá queda asentado con quién lo hizo:
 * cuando se mueve plata de otros, no alcanza con que el resultado esté bien,
 * tiene que poder explicarse después.
 */
export type Resolucion = 'TRABAJADOR' | 'CLIENTE' | 'PARCIAL';

export class ServicioSoporte {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tareas: ServicioTareas,
    private readonly pasarela: Pasarela,
    private readonly pais: ConfiguracionPais = PAIS_REFERENCIA,
  ) {}

  /** La cola de trabajo: lo más viejo primero, que es lo que más duele. */
  async bandeja() {
    const [disputas, identidades, matriculas, alertas, retiros] = await Promise.all([
      this.prisma.tarea.findMany({
        where: { estado: 'EN_DISPUTA' },
        orderBy: { actualizadoEn: 'asc' },
        include: {
          autor: { select: { id: true, nombre: true, telefono: true } },
          trabajador: { select: { id: true, nombre: true, telefono: true } },
          pago: true,
          eventos: { orderBy: { creadoEn: 'desc' }, take: 5 },
        },
      }),
      this.prisma.identidad.findMany({
        where: { estado: 'EN_REVISION' },
        orderBy: { actualizadoEn: 'asc' },
        select: {
          usuarioId: true,
          tipoDocumento: true,
          paisEmision: true,
          ultimos4: true,
          nombreLegal: true,
          frenteUrl: true,
          selfieUrl: true,
          actualizadoEn: true,
        },
      }),
      this.prisma.habilidad.findMany({
        where: { licenciaEstado: 'EN_REVISION' },
        include: { perfil: { include: { usuario: { select: { id: true, nombre: true } } } } },
      }),
      this.prisma.alerta.count({ where: { estado: 'ABIERTA' } }),
      this.prisma.retiro.count({ where: { estado: 'SOLICITADO' } }),
    ]);

    return {
      disputas,
      identidades,
      matriculas,
      alertasAbiertas: alertas,
      retirosPendientes: retiros,
      total: disputas.length + identidades.length + matriculas.length + alertas + retiros,
    };
  }

  /**
   * Resuelve un reclamo. Tres salidas:
   *  - a favor del trabajador: el trabajo se paga completo;
   *  - a favor del cliente: se cancela y se devuelve todo;
   *  - parcial: se paga el monto acordado y se devuelve la diferencia.
   *
   * El monto original no se pierde: queda en `presupuestoOriginal` y en la
   * bitácora, porque un recibo que cambia sin dejar rastro es un problema.
   */
  async resolverDisputa(entrada: {
    tareaId: string;
    resolucion: Resolucion;
    revisorId: string;
    nota: string;
    montoAcordado?: number;
  }) {
    const tarea = await this.prisma.tarea.findUnique({
      where: { id: entrada.tareaId },
      include: { pago: true, trabajador: { include: { perfil: true } } },
    });
    if (!tarea) throw noEncontrado('La tarea');
    if (tarea.estado !== 'EN_DISPUTA') throw conflicto('SIN_DISPUTA', 'Esta tarea no tiene un reclamo abierto');
    if (!entrada.nota.trim()) throw invalido('SIN_FUNDAMENTO', 'Escribí por qué resolvés así');

    if (entrada.resolucion === 'PARCIAL') {
      const monto = entrada.montoAcordado ?? 0;
      if (monto <= 0 || monto >= tarea.presupuesto) {
        throw invalido(
          'MONTO_INVALIDO',
          'El monto acordado tiene que ser mayor que cero y menor que el presupuesto original',
        );
      }
      await this.prisma.tarea.update({
        where: { id: tarea.id },
        data: { presupuestoOriginal: tarea.presupuesto, presupuesto: monto },
      });
    }

    const aFavorDelTrabajador = entrada.resolucion !== 'CLIENTE';
    const ahora = new Date();

    await this.prisma.$transaction([
      this.prisma.tarea.update({
        where: { id: tarea.id },
        data: {
          estado: aFavorDelTrabajador ? 'CONFIRMADA' : 'CANCELADA',
          confirmadaEn: aFavorDelTrabajador ? ahora : null,
          cerradaEn: aFavorDelTrabajador ? null : ahora,
        },
      }),
      this.prisma.eventoTarea.create({
        data: {
          tareaId: tarea.id,
          desde: 'EN_DISPUTA',
          hacia: aFavorDelTrabajador ? 'CONFIRMADA' : 'CANCELADA',
          actorId: entrada.revisorId,
          actorRol: 'SOPORTE',
          nota: entrada.nota.trim(),
          datos: {
            resolucion: entrada.resolucion,
            presupuestoOriginal: tarea.presupuesto,
            montoAcordado: entrada.montoAcordado ?? null,
          },
        },
      }),
    ]);

    if (aFavorDelTrabajador) {
      await this.tareas.liquidarTarea(tarea.id);
      // En una resolución parcial hay que devolverle al cliente la diferencia
      // que ya estaba reservada.
      if (entrada.resolucion === 'PARCIAL' && tarea.metodoPago === 'TARJETA' && tarea.pago?.referencia) {
        const acordado = entrada.montoAcordado!;
        const cuenta = liquidar(
          {
            rubroSlug: tarea.rubroSlug,
            presupuesto: acordado,
            materiales: tarea.materiales,
            metodoPago: 'TARJETA',
            nivelTrabajador: tarea.trabajador?.perfil?.nivel ?? 'NUEVO',
          },
          this.pais.comisiones,
        );
        const reservadoOriginal =
          tarea.pago.totalCliente > 0 ? tarea.pago.totalCliente : tarea.presupuesto;
        const diferencia = reservadoOriginal - cuenta.cobroAlCliente;
        if (diferencia > 0) await this.pasarela.reembolsar(tarea.pago.referencia, diferencia);
      }
      return this.prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    }

    // A favor del cliente: se devuelve lo que se haya movido.
    if (tarea.metodoPago === 'TARJETA' && tarea.pago?.referencia) {
      if (tarea.pago.estado === 'RETENIDO') await this.pasarela.liberar(tarea.pago.referencia);
      else await this.pasarela.reembolsar(tarea.pago.referencia);
      await this.prisma.pago.update({
        where: { tareaId: tarea.id },
        data: { estado: 'REEMBOLSADO' },
      });
    }
    return this.prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
  }

  /**
   * Mueve el saldo de alguien a mano. Es la puerta de atrás que a veces hace
   * falta —una compensación, un error nuestro— y justamente por eso exige
   * motivo y queda firmada por quien la hizo.
   */
  async ajustarSaldo(entrada: { usuarioId: string; monto: number; motivo: string; revisorId: string }) {
    if (!Number.isInteger(entrada.monto) || entrada.monto === 0) {
      throw invalido('MONTO_INVALIDO', 'El ajuste tiene que ser un monto entero distinto de cero');
    }
    if (entrada.motivo.trim().length < 10) {
      throw invalido('SIN_FUNDAMENTO', 'Explicá el ajuste: queda registrado con tu nombre');
    }

    const perfil = await this.prisma.perfilTrabajador.findUnique({
      where: { usuarioId: entrada.usuarioId },
    });
    if (!perfil) throw noEncontrado('El perfil de trabajador');

    const saldoResultante = perfil.saldo + entrada.monto;
    const [, movimiento] = await this.prisma.$transaction([
      this.prisma.perfilTrabajador.update({
        where: { usuarioId: entrada.usuarioId },
        data: { saldo: saldoResultante },
      }),
      this.prisma.movimientoSaldo.create({
        data: {
          usuarioId: entrada.usuarioId,
          tipo: 'AJUSTE_SOPORTE',
          monto: entrada.monto,
          saldoResultante,
          detalle: `${entrada.motivo.trim()} (soporte: ${entrada.revisorId})`,
        },
      }),
    ]);
    return movimiento;
  }

  /** Todo lo que soporte necesita saber de alguien, en una sola pantalla. */
  async ficha(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: {
        perfil: { include: { habilidades: true } },
        identidad: { select: { estado: true, ultimos4: true, nombreLegal: true, verificadoEn: true } },
      },
    });
    if (!usuario) throw noEncontrado('El usuario');

    const [publicadas, trabajadas, movimientos, disputas, alertas] = await Promise.all([
      this.prisma.tarea.count({ where: { autorId: usuarioId } }),
      this.prisma.tarea.count({ where: { trabajadorId: usuarioId } }),
      this.prisma.movimientoSaldo.findMany({
        where: { usuarioId },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
      this.prisma.tarea.count({
        where: { estado: 'EN_DISPUTA', OR: [{ autorId: usuarioId }, { trabajadorId: usuarioId }] },
      }),
      this.prisma.alerta.findMany({
        where: { usuarioId },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
    ]);

    return { usuario, publicadas, trabajadas, movimientos, disputasAbiertas: disputas, alertas };
  }

  /** Suspender corta el acceso sin borrar nada: el historial se conserva. */
  async suspender(usuarioId: string, motivo: string, revisorId: string) {
    if (motivo.trim().length < 10) throw invalido('SIN_FUNDAMENTO', 'Escribí por qué se suspende');
    return this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { suspendido: true, motivoSuspension: `${motivo.trim()} (soporte: ${revisorId})` },
    });
  }

  async levantarSuspension(usuarioId: string) {
    return this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { suspendido: false, motivoSuspension: null },
    });
  }
}
