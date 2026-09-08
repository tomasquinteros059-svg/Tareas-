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

export function formatear(monto: Centavos, moneda = 'USD'): string {
  return new Intl.NumberFormat('es', { style: 'currency', currency: moneda }).format(monto / 100);
}
