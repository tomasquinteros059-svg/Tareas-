/**
 * Todo el dinero se maneja en unidades menores (centavos) con enteros.
 * Nunca usamos floats para plata: 0.1 + 0.2 !== 0.3 y eso en un marketplace
 * termina en descuadres de caja.
 */
export type Centavos = number;

export function redondearArriba(monto: Centavos, paso: number): Centavos {
  if (paso <= 0) return Math.ceil(monto);
  return Math.ceil(monto / paso) * paso;
}

/** Porcentaje aplicado con redondeo bancario hacia abajo (favorece al trabajador). */
export function porcentaje(monto: Centavos, tasa: number): Centavos {
  return Math.floor(monto * tasa);
}

export function multiplicar(monto: Centavos, factor: number): Centavos {
  return Math.round(monto * factor);
}

/**
 * No todas las monedas tienen centavos. El peso chileno y el yen no se parten:
 * su unidad mínima es la moneda entera. Como acá siempre trabajamos en unidades
 * mínimas, hay que saber cuántos decimales tiene cada una para hablar con los
 * proveedores de pago y para mostrar los montos.
 *
 * Equivocarse en esto no es un detalle estético: se cobra cien veces de más o
 * cien veces de menos.
 */
const SIN_DECIMALES = new Set(['CLP', 'JPY', 'KRW', 'PYG', 'VND', 'ISK', 'COP']);

export function decimalesDe(moneda: string): 0 | 2 {
  return SIN_DECIMALES.has(moneda.toUpperCase()) ? 0 : 2;
}

/** Pasa de unidades mínimas a la unidad que espera un proveedor (3150 → 31.5 en USD, 8000 → 8000 en CLP). */
export function aUnidades(monto: Centavos, moneda: string): number {
  return decimalesDe(moneda) === 0 ? monto : Number((monto / 100).toFixed(2));
}

/** El camino inverso: lo que devuelve el proveedor vuelve a unidades mínimas. */
export function aMinimas(monto: number, moneda: string): Centavos {
  return decimalesDe(moneda) === 0 ? Math.round(monto) : Math.round(monto * 100);
}

export function formatear(monto: Centavos, moneda = 'USD'): string {
  const decimales = decimalesDe(moneda);
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(aUnidades(monto, moneda));
}
