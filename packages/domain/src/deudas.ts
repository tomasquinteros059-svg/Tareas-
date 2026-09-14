import type { Centavos } from './dinero.js';

/**
 * Cobro de las deudas de comisión.
 *
 * Cuando el trabajo se paga en efectivo, el trabajador se lleva el 100% en la
 * mano y la comisión le queda como deuda (ver `comisiones.ts`). Esa deuda hoy se
 * salda sola si después hace un trabajo con tarjeta —el crédito y la deuda viven
 * en el mismo saldo—, pero el que trabaja siempre en efectivo nunca la paga: se
 * queda con la deuda hasta el límite, deja de poder tomar trabajos, y se va.
 *
 * Lo que decide acá es cuándo intentar cobrarle a su tarjeta. Las tres reglas
 * que importan:
 *
 *  - por debajo de cierto monto no vale la pena: la operación de tarjeta cuesta
 *    y un cobro de centavos molesta más de lo que recauda;
 *  - un cobro rechazado no se reintenta al rato. Se espera, y cada vez más:
 *    insistir sobre una tarjeta sin fondos la hace ver como fraude al emisor;
 *  - después de unos intentos se deja de insistir y pasa a ser un problema de
 *    personas, no del reloj.
 *
 * Es una regla pura a propósito: el cuándo se prueba en milisegundos y el cómo
 * (cobrar de verdad) queda del lado de la API.
 */
export interface ConfiguracionDeudas {
  /** Por debajo de esto no se intenta: no paga el costo de la operación. */
  minimoCobrable: Centavos;
  /** Horas a esperar antes del intento número 1, 2, 3... tras cada rechazo. */
  esperaHoras: number[];
  /** Cuántos rechazos seguidos antes de dejar de insistir. */
  maxIntentos: number;
}

/** En centavos de dólar de referencia, igual que el resto del dominio. */
export const DEUDAS_POR_DEFECTO: ConfiguracionDeudas = {
  minimoCobrable: 500,
  esperaHoras: [24, 72, 168],
  maxIntentos: 4,
};

/** Chile: el peso no tiene centavos y el mínimo se mueve con el factor de país. */
export const DEUDAS_CHILE: ConfiguracionDeudas = {
  ...DEUDAS_POR_DEFECTO,
  minimoCobrable: 5_000,
};

export interface EstadoDeuda {
  /** Saldo del trabajador: negativo es deuda. */
  saldo: Centavos;
  /** Rechazos seguidos hasta ahora. */
  intentos: number;
  /** Cuándo se puede volver a intentar, si ya hubo un rechazo. */
  proximoIntento?: Date | null;
  tieneMedioDePago: boolean;
}

export type MotivoSinCobro =
  | 'SIN_DEUDA'
  | 'MONTO_CHICO'
  | 'SIN_MEDIO_DE_PAGO'
  | 'ESPERANDO'
  | 'INTENTOS_AGOTADOS';

export type DecisionCobro =
  | { cobrar: true; monto: Centavos }
  | { cobrar: false; motivo: MotivoSinCobro };

export function deudaDe(saldo: Centavos): Centavos {
  return saldo < 0 ? -saldo : 0;
}

export function decidirCobro(
  estado: EstadoDeuda,
  ahora: Date = new Date(),
  config: ConfiguracionDeudas = DEUDAS_POR_DEFECTO,
): DecisionCobro {
  const deuda = deudaDe(estado.saldo);
  if (deuda === 0) return { cobrar: false, motivo: 'SIN_DEUDA' };
  if (deuda < config.minimoCobrable) return { cobrar: false, motivo: 'MONTO_CHICO' };
  if (!estado.tieneMedioDePago) return { cobrar: false, motivo: 'SIN_MEDIO_DE_PAGO' };
  if (estado.intentos >= config.maxIntentos) return { cobrar: false, motivo: 'INTENTOS_AGOTADOS' };
  if (estado.proximoIntento && estado.proximoIntento.getTime() > ahora.getTime()) {
    return { cobrar: false, motivo: 'ESPERANDO' };
  }
  return { cobrar: true, monto: deuda };
}

/**
 * Cuándo volver a intentar después de un rechazo. La espera crece con cada
 * intento y se queda en la última de la lista.
 */
export function proximoIntento(
  intentosTrasElFallo: number,
  ahora: Date = new Date(),
  config: ConfiguracionDeudas = DEUDAS_POR_DEFECTO,
): Date {
  const indice = Math.min(Math.max(intentosTrasElFallo, 1), config.esperaHoras.length) - 1;
  const horas = config.esperaHoras[indice]!;
  return new Date(ahora.getTime() + horas * 60 * 60 * 1000);
}
