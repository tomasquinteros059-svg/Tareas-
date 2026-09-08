/**
 * Identificador corto y legible de la tarea. Es lo que reemplaza al hilo de
 * comentarios: en vez de "el post de la señora del perro", cada solicitud es
 * TQ-260908-4F7K y todo (chat, soporte, recibo, reclamo) se refiere a ese folio.
 */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin 0/O ni 1/I: se dictan por teléfono

export function generarFolio(fecha: Date = new Date(), aleatorio: () => number = Math.random): string {
  const yy = String(fecha.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getUTCDate()).padStart(2, '0');
  let sufijo = '';
  for (let i = 0; i < 4; i++) {
    sufijo += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
  }
  return `TQ-${yy}${mm}${dd}-${sufijo}`;
}

const FORMATO = /^TQ-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

export function esFolioValido(folio: string): boolean {
  return FORMATO.test(folio.trim().toUpperCase());
}

export function normalizarFolio(folio: string): string {
  return folio.trim().toUpperCase().replace(/\s+/g, '');
}
