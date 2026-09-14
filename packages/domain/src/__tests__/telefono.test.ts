import { describe, expect, it } from 'vitest';
import { formatearTelefono, normalizarTelefono } from '../telefono.js';

describe('normalizar un teléfono chileno', () => {
  it('lleva al mismo número las cuatro formas de escribirlo', () => {
    const formas = ['912345678', '9 1234 5678', '+56 9 1234 5678', '0056912345678'];
    for (const forma of formas) {
      expect(normalizarTelefono(forma)?.e164).toBe('+56912345678');
    }
  });

  it('saca el cero de larga distancia que algunos siguen escribiendo', () => {
    expect(normalizarTelefono('0912345678')?.e164).toBe('+56912345678');
  });

  it('marca el celular, que es lo único que recibe SMS', () => {
    expect(normalizarTelefono('912345678')?.esMovil).toBe(true);
    // Un fijo de Santiago empieza con 2.
    expect(normalizarTelefono('223456789')?.esMovil).toBe(false);
  });

  it('rechaza lo que no puede ser un número', () => {
    expect(normalizarTelefono('12345')).toBeNull();
    expect(normalizarTelefono('9123456789012')).toBeNull();
    expect(normalizarTelefono('hola')).toBeNull();
    expect(normalizarTelefono('')).toBeNull();
  });
});

describe('otros países', () => {
  it('reconoce el código internacional aunque el país no sea el de casa', () => {
    expect(normalizarTelefono('+5491155667788')?.pais).toBe('AR');
    expect(normalizarTelefono('+51987654321')?.pais).toBe('PE');
  });

  it('no confunde un código largo con uno corto', () => {
    // 56… es Chile, no Estados Unidos con un 1 imaginario.
    expect(normalizarTelefono('+56912345678')?.pais).toBe('CL');
    expect(normalizarTelefono('+14155552671')?.pais).toBe('US');
  });

  it('acepta un país que todavía no está en la tabla', () => {
    const uruguayo = normalizarTelefono('+59899123456');
    expect(uruguayo?.e164).toBe('+59899123456');
  });

  it('un número local se interpreta con el país que se le diga', () => {
    expect(normalizarTelefono('1155667788', 'AR')?.e164).toBe('+541155667788');
  });
});

describe('mostrarlo', () => {
  it('separa el chileno para que se pueda leer', () => {
    expect(formatearTelefono('+56912345678')).toBe('+56 9 1234 5678');
  });
});
