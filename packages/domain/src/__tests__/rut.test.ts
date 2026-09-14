import { describe, expect, it } from 'vitest';
import { digitoVerificador, formatearRut, normalizarRut, rutValido } from '../rut.js';

describe('RUT chileno', () => {
  it('calcula el dígito verificador', () => {
    expect(digitoVerificador('12345678')).toBe('5');
    expect(digitoVerificador('78081011')).toBe('4');
  });

  it('acepta un RUT bien escrito, con o sin puntos', () => {
    expect(rutValido('12.345.678-5')).toBe(true);
    expect(rutValido('123456785')).toBe(true);
    expect(rutValido('78.081.011-4')).toBe(true);
  });

  it('reconoce el verificador K', () => {
    // 11 - (suma % 11) === 10 cae en K.
    const numero = '20000003';
    expect(digitoVerificador(numero)).toBe('K');
    expect(rutValido(`${numero}k`)).toBe(true);
  });

  it('rechaza un dígito cambiado, que es el error que cuesta plata', () => {
    expect(rutValido('12.345.678-6')).toBe(false);
    expect(rutValido('78.081.011-3')).toBe(false);
  });

  it('rechaza lo que directamente no es un RUT', () => {
    expect(rutValido('')).toBe(false);
    expect(rutValido('123')).toBe(false);
    expect(rutValido('1234567890123')).toBe(false);
  });

  it('normaliza y formatea', () => {
    expect(normalizarRut(' 12.345.678-k ')).toBe('12345678K');
    expect(formatearRut('123456785')).toBe('12.345.678-5');
  });
});
