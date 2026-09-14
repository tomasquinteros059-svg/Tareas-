import type { PerfilTrabajador, PrismaClient } from '@prisma/client';
import {
  DEUDAS_POR_DEFECTO,
  decidirCobro,
  deudaDe,
  proximoIntento,
  type ConfiguracionDeudas,
} from '@tareas/domain';
import { conflicto, invalido, noEncontrado } from '../../lib/errores.js';
import { ErrorPasarela, type Pasarela } from '../pagos/pasarela.js';

/**
 * Cobro de las deudas de comisión.
 *
 * El que trabaja en efectivo se lleva el 100% en la mano y queda debiendo la
 * comisión. Hoy esa deuda se compensa sola si después hace un trabajo con
 * tarjeta, porque crédito y deuda viven en el mismo saldo; pero el que trabaja
 * siempre en efectivo no la paga nunca: acumula hasta el límite, deja de poder
 * tomar trabajos y se va sin que nadie le haya pedido nada.
 *
 * Acá se cierra ese agujero, por dos caminos:
 *
 *  - el trabajador deja una tarjeta guardada y el reloj le cobra solo cuando la
 *    deuda pasa el mínimo. Es lo que hace Uber, y es lo que menos molesta;
 *  - si el proveedor no sabe cobrar sin la persona delante —Webpay manda siempre
 *    al sitio del banco—, el cobro automático no existe y hay que pagar a mano
 *    desde la app. El flujo queda igual: se retiene, vuelve, se confirma.
 *
 * Las esperas entre reintentos y el mínimo cobrable son reglas puras y viven en
 * el dominio (`deudas.ts`). Acá está el cómo: la tarjeta, el saldo y el libro.
 */
export interface ResultadoCobro {
  pagado: boolean;
  monto: number;
  saldo: number;
  /** Si el banco pidió que el trabajador vaya a su sitio, adónde mandarlo. */
  urlRedireccion?: string;
  referencia?: string;
}

export interface ResumenCobros {
  intentados: number;
  cobrados: number;
  monto: number;
  fallidos: number;
}

export class ServicioDeudas {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pasarela: Pasarela,
    private readonly moneda: string,
    private readonly config: ConfiguracionDeudas = DEUDAS_POR_DEFECTO,
  ) {}

  /**
   * Guarda la tarjeta con la que se va a saldar la deuda. Se valida cobrando y
   * liberando de inmediato: una tarjeta que se guarda sin probar es una tarjeta
   * que falla recién el día que hace falta.
   */
  async guardarMedioDePago(usuarioId: string, token: string) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    if (!this.pasarela.capacidades.cobroDirecto) {
      throw conflicto(
        'COBRO_NO_AUTOMATICO',
        `${this.pasarela.nombre} no permite guardar una tarjeta: la deuda se paga desde la app`,
      );
    }

    let marca: string | undefined;
    let ultimos4: string | undefined;
    try {
      const prueba = await this.pasarela.retener({
        monto: 100,
        moneda: this.moneda,
        metodoPagoToken: token,
        descripcion: 'Verificación de la tarjeta',
        idempotencia: `verif:${usuarioId}:${Date.now()}`,
      });
      marca = prueba.marca;
      ultimos4 = prueba.ultimos4;
      await this.pasarela.liberar(prueba.referencia);
    } catch (error) {
      throw invalido('TARJETA_RECHAZADA', mensajeDe(error));
    }

    await this.prisma.perfilTrabajador.update({
      where: { usuarioId },
      data: {
        medioPagoToken: token,
        medioPagoMarca: marca ?? null,
        medioPagoUltimos4: ultimos4 ?? null,
        // Una tarjeta nueva merece un intento limpio.
        cobroIntentos: 0,
        cobroProximoIntento: null,
        cobroUltimoError: null,
      },
    });
    return this.estado(usuarioId);
  }

  /** Lo que la app le muestra al trabajador sobre lo que debe. */
  async estado(usuarioId: string) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    const deuda = deudaDe(perfil.saldo);
    return {
      saldo: perfil.saldo,
      deuda,
      minimoCobrable: this.config.minimoCobrable,
      cobroAutomatico: this.pasarela.capacidades.cobroDirecto && Boolean(perfil.medioPagoToken),
      tarjeta: perfil.medioPagoToken
        ? { marca: perfil.medioPagoMarca, ultimos4: perfil.medioPagoUltimos4 }
        : null,
      intentosFallidos: perfil.cobroIntentos,
      proximoIntento: perfil.cobroProximoIntento,
      ultimoError: perfil.cobroUltimoError,
    };
  }

  /**
   * Pagar la deuda ahora. Lo usa el trabajador desde la app —con la tarjeta
   * guardada o con una nueva— y es el único camino cuando el proveedor no cobra
   * solo.
   */
  async pagar(usuarioId: string, metodoPagoToken?: string): Promise<ResultadoCobro> {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    const deuda = deudaDe(perfil.saldo);
    if (deuda === 0) throw conflicto('SIN_DEUDA', 'No tenés comisiones pendientes');

    const token = metodoPagoToken ?? perfil.medioPagoToken;
    if (!token) throw invalido('SIN_MEDIO_DE_PAGO', 'Elegí con qué tarjeta pagar');

    return this.cobrar(perfil, deuda, token, new Date());
  }

  /**
   * Vuelta del banco: el trabajador fue a pagar al sitio del proveedor y
   * volvió. Recién acá sabemos si el cobro salió.
   */
  async confirmarPago(usuarioId: string): Promise<ResultadoCobro> {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    if (!perfil.cobroPendienteRef || !perfil.cobroPendienteMonto) {
      throw conflicto('SIN_COBRO_PENDIENTE', 'No hay ningún pago de comisiones esperando confirmación');
    }
    if (!this.pasarela.confirmar) {
      throw conflicto('SIN_CONFIRMACION', `${this.pasarela.nombre} no necesita confirmar el pago`);
    }

    const monto = perfil.cobroPendienteMonto;
    try {
      await this.pasarela.confirmar(perfil.cobroPendienteRef);
      await this.pasarela.capturar(perfil.cobroPendienteRef, monto);
    } catch (error) {
      await this.registrarFallo(usuarioId, perfil.cobroIntentos, mensajeDe(error), new Date());
      throw invalido('COBRO_RECHAZADO', mensajeDe(error));
    }
    return this.acreditar(usuarioId, monto, perfil.cobroPendienteRef);
  }

  /**
   * Una pasada del reloj: le cobra a todos los que deben, tienen tarjeta y ya
   * cumplieron la espera. Cada uno se resuelve aparte, así un rechazo no frena
   * la fila.
   */
  async cobrarPendientes(ahora = new Date(), limite = 100): Promise<ResumenCobros> {
    const resumen: ResumenCobros = { intentados: 0, cobrados: 0, monto: 0, fallidos: 0 };
    if (!this.pasarela.capacidades.cobroDirecto) return resumen;

    const deudores = await this.prisma.perfilTrabajador.findMany({
      where: {
        saldo: { lte: -this.config.minimoCobrable },
        medioPagoToken: { not: null },
        cobroIntentos: { lt: this.config.maxIntentos },
        OR: [{ cobroProximoIntento: null }, { cobroProximoIntento: { lte: ahora } }],
      },
      orderBy: { saldo: 'asc' },
      take: limite,
    });

    for (const perfil of deudores) {
      const decision = decidirCobro(
        {
          saldo: perfil.saldo,
          intentos: perfil.cobroIntentos,
          proximoIntento: perfil.cobroProximoIntento,
          tieneMedioDePago: Boolean(perfil.medioPagoToken),
        },
        ahora,
        this.config,
      );
      if (!decision.cobrar) continue;

      resumen.intentados++;
      try {
        const hecho = await this.cobrar(perfil, decision.monto, perfil.medioPagoToken!, ahora);
        if (hecho.pagado) {
          resumen.cobrados++;
          resumen.monto += hecho.monto;
        } else {
          // Quedó esperando al trabajador: no es un fallo, pero tampoco cobrado.
          resumen.fallidos++;
        }
      } catch {
        // `cobrar` ya dejó anotado el rechazo y cuándo reintentar.
        resumen.fallidos++;
      }
    }
    return resumen;
  }

  /**
   * El cobro en sí. Se retiene y se captura: un rechazo del emisor aparece en la
   * retención, así no se captura nada a medias.
   *
   * La carrera posible: entre que se leyó el saldo y se cobra, el trabajador
   * puede cerrar un trabajo con tarjeta y quedar sin deuda. No se le cobra de
   * más —el monto es el que debía al leer— y la plata le queda como saldo a
   * favor, que puede retirar. El libro mayor lo muestra en dos líneas.
   */
  private async cobrar(
    perfil: PerfilTrabajador,
    monto: number,
    token: string,
    ahora: Date,
  ): Promise<ResultadoCobro> {
    let retencion;
    try {
      retencion = await this.pasarela.retener({
        monto,
        moneda: this.moneda,
        metodoPagoToken: token,
        descripcion: 'Comisiones de trabajos cobrados en efectivo',
        idempotencia: `deuda:${perfil.usuarioId}:${perfil.cobroIntentos}:${monto}`,
      });
    } catch (error) {
      await this.registrarFallo(perfil.usuarioId, perfil.cobroIntentos, mensajeDe(error), ahora);
      throw error instanceof ErrorPasarela ? invalido('COBRO_RECHAZADO', error.message) : error;
    }

    // Webpay y parecidos: hay que mandar al trabajador al sitio del banco y
    // esperar a que vuelva. Se guarda la referencia para poder cerrarlo.
    if (retencion.requiereConfirmacion || retencion.urlRedireccion) {
      await this.prisma.perfilTrabajador.update({
        where: { usuarioId: perfil.usuarioId },
        data: { cobroPendienteRef: retencion.referencia, cobroPendienteMonto: monto },
      });
      return {
        pagado: false,
        monto,
        saldo: perfil.saldo,
        urlRedireccion: retencion.urlRedireccion,
        referencia: retencion.referencia,
      };
    }

    try {
      await this.pasarela.capturar(retencion.referencia, monto);
    } catch (error) {
      // La retención quedó viva: liberarla evita dejarle plata bloqueada.
      await this.pasarela.liberar(retencion.referencia).catch(() => undefined);
      await this.registrarFallo(perfil.usuarioId, perfil.cobroIntentos, mensajeDe(error), ahora);
      throw error instanceof ErrorPasarela ? invalido('COBRO_RECHAZADO', error.message) : error;
    }

    return this.acreditar(perfil.usuarioId, monto, retencion.referencia);
  }

  /** Cobrado: sube el saldo, lo asienta en el libro y limpia los reintentos. */
  private async acreditar(usuarioId: string, monto: number, referencia: string): Promise<ResultadoCobro> {
    const perfil = await this.prisma.perfilTrabajador.update({
      where: { usuarioId },
      data: {
        saldo: { increment: monto },
        cobroIntentos: 0,
        cobroProximoIntento: null,
        cobroUltimoError: null,
        cobroPendienteRef: null,
        cobroPendienteMonto: null,
      },
    });
    await this.prisma.movimientoSaldo.create({
      data: {
        usuarioId,
        tipo: 'PAGO_DE_DEUDA',
        monto,
        saldoResultante: perfil.saldo,
        detalle: `Comisiones en efectivo pagadas con tarjeta (${referencia})`,
      },
    });
    return { pagado: true, monto, saldo: perfil.saldo, referencia };
  }

  /** Rechazado: se cuenta el intento y se aleja el siguiente. */
  private async registrarFallo(usuarioId: string, intentos: number, error: string, ahora: Date) {
    const siguiente = intentos + 1;
    await this.prisma.perfilTrabajador.update({
      where: { usuarioId },
      data: {
        cobroIntentos: siguiente,
        cobroProximoIntento: proximoIntento(siguiente, ahora, this.config),
        cobroUltimoError: error.slice(0, 300),
        cobroPendienteRef: null,
        cobroPendienteMonto: null,
      },
    });
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
