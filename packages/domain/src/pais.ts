import { COMISIONES_POR_DEFECTO, type ConfiguracionComisiones } from './comisiones.js';
import { DEUDAS_CHILE, DEUDAS_POR_DEFECTO, type ConfiguracionDeudas } from './deudas.js';
import { LIMITE_DEUDA_POR_DEFECTO } from './despacho.js';
import { PRECIOS_CHILE, PRECIOS_POR_DEFECTO, type ConfiguracionPrecios } from './precios.js';
import type { Centavos } from './dinero.js';

/**
 * Todo lo que cambia al operar en un país.
 *
 * Existe porque los números del dominio están en centavos de dólar de
 * referencia y se ajustan con un factor. Eso funciona mientras cada uno de
 * esos números se ajuste: si uno queda sin ajustar, no se nota en una
 * demostración y rompe el producto en la calle.
 *
 * Ya pasó dos veces. El piso por oficio se validaba en dólares y una tarea
 * chilena pasaba el mínimo con la décima parte de lo que vale. Y el límite de
 * deuda —cinco mil, o sea cincuenta dólares— se leía como cinco mil pesos:
 * un trabajador que hacía dos trabajos en efectivo quedaba bloqueado para
 * siempre, porque la comisión de un solo trabajo ya pasaba ese tope.
 *
 * Por eso ahora están todos juntos y se eligen de una sola vez.
 */
export interface ConfiguracionPais {
  moneda: string;
  precios: ConfiguracionPrecios;
  comisiones: ConfiguracionComisiones;
  deudas: ConfiguracionDeudas;
  /**
   * Deuda de comisiones a partir de la cual no se pueden tomar más trabajos.
   * Tiene que ser varias veces la comisión de un trabajo típico: si es menos,
   * el primer trabajo en efectivo deja al trabajador afuera.
   */
  limiteDeuda: Centavos;
}

/** Dólares de referencia: es lo que usa el dominio cuando no se dice otra cosa. */
export const PAIS_REFERENCIA: ConfiguracionPais = {
  moneda: PRECIOS_POR_DEFECTO.moneda,
  precios: PRECIOS_POR_DEFECTO,
  comisiones: COMISIONES_POR_DEFECTO,
  deudas: DEUDAS_POR_DEFECTO,
  limiteDeuda: LIMITE_DEUDA_POR_DEFECTO,
};

/** Chile: el peso no tiene centavos y todo va multiplicado por el factor de país. */
export const CHILE: ConfiguracionPais = {
  moneda: PRECIOS_CHILE.moneda,
  precios: PRECIOS_CHILE,
  comisiones: {
    ...COMISIONES_POR_DEFECTO,
    // Comisión mínima por trabajo y costo fijo de procesar una tarjeta,
    // ajustados con el mismo factor que los pisos.
    comisionMinima: COMISIONES_POR_DEFECTO.comisionMinima * PRECIOS_CHILE.factorPais,
    procesamientoTarjeta: {
      ...COMISIONES_POR_DEFECTO.procesamientoTarjeta,
      fijo: COMISIONES_POR_DEFECTO.procesamientoTarjeta.fijo * PRECIOS_CHILE.factorPais,
    },
  },
  deudas: DEUDAS_CHILE,
  limiteDeuda: LIMITE_DEUDA_POR_DEFECTO * PRECIOS_CHILE.factorPais,
};

export function paisDe(moneda: string): ConfiguracionPais {
  return moneda.toUpperCase() === CHILE.moneda ? CHILE : PAIS_REFERENCIA;
}
