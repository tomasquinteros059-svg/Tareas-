/**
 * RUT chileno.
 *
 * Va acá y no en un formulario porque es una regla de negocio: el RUT es la
 * llave con la que el banco identifica a una persona. Si está mal escrito, la
 * transferencia del retiro rebota días después —cuando el trabajador ya contaba
 * con esa plata— y alguien tiene que perseguir el error a mano.
 *
 * El dígito verificador se calcula con módulo 11 sobre el número, ponderando de
 * derecha a izquierda con la serie 2,3,4,5,6,7 y volviendo a empezar.
 */

/** Deja sólo dígitos y el verificador, en mayúscula: "12.345.678-k" → "12345678K". */
export function normalizarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

/** El verificador que le corresponde a un número de RUT. */
export function digitoVerificador(numero: string): string {
  let suma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    suma += Number(numero[i]) * peso;
    peso = peso === 7 ? 2 : peso + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export function rutValido(rut: string): boolean {
  const limpio = normalizarRut(rut);
  // Menos de 7 dígitos más verificador no es un RUT de una persona real.
  if (limpio.length < 8 || limpio.length > 9) return false;
  const numero = limpio.slice(0, -1);
  const verificador = limpio.slice(-1);
  if (!/^\d+$/.test(numero)) return false;
  return digitoVerificador(numero) === verificador;
}

/** Para mostrarlo: "123456785" → "12.345.678-5". */
export function formatearRut(rut: string): string {
  const limpio = normalizarRut(rut);
  if (limpio.length < 2) return limpio;
  const numero = limpio.slice(0, -1);
  const verificador = limpio.slice(-1);
  return `${numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${verificador}`;
}
