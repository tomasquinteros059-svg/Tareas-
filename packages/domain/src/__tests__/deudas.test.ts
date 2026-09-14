import { describe, expect, it } from 'vitest';
import {
  DEUDAS_CHILE,
  DEUDAS_POR_DEFECTO,
  decidirCobro,
  deudaDe,
  proximoIntento,
} from '../deudas.js';

const AHORA = new Date('2026-09-14T12:00:00Z');
const base = { saldo: -2000, intentos: 0, proximoIntento: null, tieneMedioDePago: true };

describe('cuánto se debe', () => {
  it('sólo el saldo negativo es deuda', () => {
    expect(deudaDe(-2500)).toBe(2500);
    expect(deudaDe(0)).toBe(0);
    expect(deudaDe(9000)).toBe(0);
  });
});

describe('decidir si se cobra', () => {
  it('cobra la deuda entera cuando pasa el mínimo', () => {
    expect(decidirCobro(base, AHORA)).toEqual({ cobrar: true, monto: 2000 });
  });

  it('no le cobra a quien no debe nada', () => {
    expect(decidirCobro({ ...base, saldo: 4000 }, AHORA)).toEqual({
      cobrar: false,
      motivo: 'SIN_DEUDA',
    });
  });

  it('no gasta una operación de tarjeta en una deuda chica', () => {
    expect(decidirCobro({ ...base, saldo: -100 }, AHORA)).toEqual({
      cobrar: false,
      motivo: 'MONTO_CHICO',
    });
  });

  it('sin tarjeta guardada no hay nada que intentar', () => {
    expect(decidirCobro({ ...base, tieneMedioDePago: false }, AHORA)).toEqual({
      cobrar: false,
      motivo: 'SIN_MEDIO_DE_PAGO',
    });
  });

  it('respeta la espera después de un rechazo', () => {
    const esperando = {
      ...base,
      intentos: 1,
      proximoIntento: new Date(AHORA.getTime() + 60 * 60 * 1000),
    };
    expect(decidirCobro(esperando, AHORA)).toEqual({ cobrar: false, motivo: 'ESPERANDO' });

    const cumplida = { ...esperando, proximoIntento: new Date(AHORA.getTime() - 1000) };
    expect(decidirCobro(cumplida, AHORA)).toEqual({ cobrar: true, monto: 2000 });
  });

  it('deja de insistir: una tarjeta golpeada de más la marca el emisor', () => {
    const agotado = { ...base, intentos: DEUDAS_POR_DEFECTO.maxIntentos, proximoIntento: null };
    expect(decidirCobro(agotado, AHORA)).toEqual({ cobrar: false, motivo: 'INTENTOS_AGOTADOS' });
  });

  it('el mínimo chileno es más alto que el de referencia', () => {
    const chica = { ...base, saldo: -2000 };
    expect(decidirCobro(chica, AHORA, DEUDAS_CHILE)).toEqual({
      cobrar: false,
      motivo: 'MONTO_CHICO',
    });
    expect(decidirCobro({ ...base, saldo: -12_000 }, AHORA, DEUDAS_CHILE)).toEqual({
      cobrar: true,
      monto: 12_000,
    });
  });
});

describe('la espera entre intentos', () => {
  it('crece con cada rechazo', () => {
    const uno = proximoIntento(1, AHORA);
    const dos = proximoIntento(2, AHORA);
    const tres = proximoIntento(3, AHORA);
    expect((uno.getTime() - AHORA.getTime()) / 3_600_000).toBe(24);
    expect((dos.getTime() - AHORA.getTime()) / 3_600_000).toBe(72);
    expect((tres.getTime() - AHORA.getTime()) / 3_600_000).toBe(168);
  });

  it('se queda en la última espera y no se desborda', () => {
    expect(proximoIntento(9, AHORA)).toEqual(proximoIntento(3, AHORA));
    expect(proximoIntento(0, AHORA)).toEqual(proximoIntento(1, AHORA));
  });
});
