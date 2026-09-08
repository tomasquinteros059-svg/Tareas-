import { porcentaje, type Centavos } from './dinero.js';
import { rubroObligatorio } from './catalogo.js';
import type { MetodoPago, Nivel } from './tipos.js';

/**
 * Reglas de plata. Dos caminos, misma matemática:
 *
 * - TARJETA: el cliente paga en la app. Al publicar se retiene (hold) el monto;
 *   al confirmarse el trabajo se captura, se descuenta la comisión y el resto
 *   va al saldo del trabajador.
 * - EFECTIVO: el trabajador cobra el 100% en la mano, y la comisión le queda
 *   como deuda en su saldo (igual que Uber). Si la deuda pasa el límite, no
 *   puede tomar más trabajos hasta saldarla.
 */
export interface ConfiguracionComisiones {
  /** Descuento sobre la comisión según nivel: premiar al que sostiene el servicio. */
  descuentoPorNivel: Record<Nivel, number>;
  /** Cargo de servicio al cliente sobre el presupuesto. */
  cargoServicioCliente: number;
  /** Costo de procesamiento de tarjeta: porcentaje + fijo. */
  procesamientoTarjeta: { tasa: number; fijo: Centavos };
  /** Comisión mínima por trabajo, para que los tickets chicos no den pérdida. */
  comisionMinima: Centavos;
  /** Retención por cancelación tardía del cliente (sobre el presupuesto). */
  cargoCancelacionTardia: number;
}

export const COMISIONES_POR_DEFECTO: ConfiguracionComisiones = {
  descuentoPorNivel: { NUEVO: 0, BRONCE: 0, PLATA: 0.01, ORO: 0.02, PLATINO: 0.04 },
  cargoServicioCliente: 0.05,
  procesamientoTarjeta: { tasa: 0.029, fijo: 30 },
  comisionMinima: 50,
  cargoCancelacionTardia: 0.2,
};

export interface EntradaLiquidacion {
  rubroSlug: string;
  presupuesto: Centavos;
  /** Materiales reembolsados al trabajador: no pagan comisión. */
  materiales?: Centavos;
  /** Propina que deja el cliente: va entera al trabajador. */
  propina?: Centavos;
  metodoPago: MetodoPago;
  nivelTrabajador: Nivel;
}

export interface Liquidacion {
  metodoPago: MetodoPago;
  /** Lo que se le cobra al cliente (0 en efectivo: paga en la mano). */
  cobroAlCliente: Centavos;
  /** Lo que el trabajador recibe en la mano (sólo efectivo). */
  cobroEnMano: Centavos;
  tasaComision: number;
  comision: Centavos;
  cargoServicio: Centavos;
  costoProcesamiento: Centavos;
  materiales: Centavos;
  propina: Centavos;
  /** Neto que le queda al trabajador por el trabajo. */
  netoTrabajador: Centavos;
  /** Movimiento en el saldo del trabajador: positivo acredita, negativo es deuda. */
  movimientoSaldo: Centavos;
  /** Lo que queda para la plataforma después de costos de procesamiento. */
  margenPlataforma: Centavos;
}

export function tasaComision(
  rubroSlug: string,
  nivel: Nivel,
  config: ConfiguracionComisiones = COMISIONES_POR_DEFECTO,
): number {
  const base = rubroObligatorio(rubroSlug).comisionBase;
  const descuento = config.descuentoPorNivel[nivel];
  return Number(Math.max(0.05, base - descuento).toFixed(4));
}

export function liquidar(
  entrada: EntradaLiquidacion,
  config: ConfiguracionComisiones = COMISIONES_POR_DEFECTO,
): Liquidacion {
  const materiales = Math.max(0, entrada.materiales ?? 0);
  const propina = Math.max(0, entrada.propina ?? 0);
  const manoDeObra = Math.max(0, entrada.presupuesto - materiales);

  const tasa = tasaComision(entrada.rubroSlug, entrada.nivelTrabajador, config);
  const comision = Math.max(porcentaje(manoDeObra, tasa), Math.min(config.comisionMinima, manoDeObra));
  const cargoServicio = porcentaje(entrada.presupuesto, config.cargoServicioCliente);
  const netoTrabajador = manoDeObra - comision + materiales + propina;

  if (entrada.metodoPago === 'TARJETA') {
    const cobroAlCliente = entrada.presupuesto + cargoServicio + propina;
    const costoProcesamiento =
      porcentaje(cobroAlCliente, config.procesamientoTarjeta.tasa) + config.procesamientoTarjeta.fijo;
    return {
      metodoPago: 'TARJETA',
      cobroAlCliente,
      cobroEnMano: 0,
      tasaComision: tasa,
      comision,
      cargoServicio,
      costoProcesamiento,
      materiales,
      propina,
      netoTrabajador,
      movimientoSaldo: netoTrabajador,
      margenPlataforma: comision + cargoServicio - costoProcesamiento,
    };
  }

  // Efectivo: el trabajador cobra todo en la mano y queda debiendo la comisión
  // más el cargo de servicio que el cliente no pudo pagar por la app.
  const cobroEnMano = entrada.presupuesto + propina;
  const deuda = comision + cargoServicio;
  return {
    metodoPago: 'EFECTIVO',
    cobroAlCliente: 0,
    cobroEnMano,
    tasaComision: tasa,
    comision,
    cargoServicio,
    costoProcesamiento: 0,
    materiales,
    propina,
    netoTrabajador: cobroEnMano - deuda,
    movimientoSaldo: -deuda,
    margenPlataforma: deuda,
  };
}

/** Cargo cuando el cliente cancela con el trabajador ya asignado o en camino. */
export function cargoPorCancelacion(
  entrada: EntradaLiquidacion,
  estado: 'ASIGNADA' | 'EN_CAMINO',
  config: ConfiguracionComisiones = COMISIONES_POR_DEFECTO,
): { cargoAlCliente: Centavos; compensacionTrabajador: Centavos } {
  if (estado === 'ASIGNADA') return { cargoAlCliente: 0, compensacionTrabajador: 0 };
  const cargo = porcentaje(entrada.presupuesto, config.cargoCancelacionTardia);
  // El trabajador ya salió: se lleva la mayor parte de la retención.
  const compensacion = porcentaje(cargo, 0.8);
  return { cargoAlCliente: cargo, compensacionTrabajador: compensacion };
}
