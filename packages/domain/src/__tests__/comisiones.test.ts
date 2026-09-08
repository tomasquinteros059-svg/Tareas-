import { describe, expect, it } from 'vitest';
import { cargoPorCancelacion, liquidar, tasaComision } from '../comisiones.js';

describe('tasaComision', () => {
  it('baja con el nivel del trabajador', () => {
    expect(tasaComision('limpieza-hogar', 'NUEVO')).toBeCloseTo(0.15);
    expect(tasaComision('limpieza-hogar', 'PLATINO')).toBeCloseTo(0.11);
  });

  it('los rubros profesionales pagan menos comisión', () => {
    expect(tasaComision('abogado-dia', 'NUEVO')).toBeLessThan(tasaComision('limpieza-hogar', 'NUEVO'));
  });
});

describe('liquidar con tarjeta', () => {
  const base = {
    rubroSlug: 'limpieza-hogar',
    presupuesto: 10000,
    metodoPago: 'TARJETA',
    nivelTrabajador: 'ORO',
  } as const;

  it('cobra presupuesto + cargo de servicio al cliente', () => {
    const l = liquidar(base);
    expect(l.cargoServicio).toBe(500);
    expect(l.cobroAlCliente).toBe(10500);
    expect(l.cobroEnMano).toBe(0);
  });

  it('acredita al trabajador el presupuesto menos su comisión', () => {
    const l = liquidar(base);
    expect(l.tasaComision).toBeCloseTo(0.13);
    expect(l.comision).toBe(1300);
    expect(l.netoTrabajador).toBe(8700);
    expect(l.movimientoSaldo).toBe(8700);
  });

  it('la propina va entera al trabajador', () => {
    const l = liquidar({ ...base, propina: 1500 });
    expect(l.netoTrabajador).toBe(8700 + 1500);
    expect(l.cobroAlCliente).toBe(10500 + 1500);
  });

  it('los materiales se devuelven sin comisión', () => {
    const l = liquidar({ ...base, materiales: 3000 });
    expect(l.comision).toBe(910); // 13% sobre los 7000 de mano de obra
    expect(l.netoTrabajador).toBe(7000 - 910 + 3000);
  });

  it('la plataforma queda con margen positivo después del procesamiento', () => {
    const l = liquidar(base);
    expect(l.margenPlataforma).toBeGreaterThan(0);
    expect(l.margenPlataforma).toBe(l.comision + l.cargoServicio - l.costoProcesamiento);
  });
});

describe('liquidar en efectivo', () => {
  const base = {
    rubroSlug: 'jardineria-corte-pasto',
    presupuesto: 4000,
    metodoPago: 'EFECTIVO',
    nivelTrabajador: 'BRONCE',
  } as const;

  it('el trabajador cobra todo en la mano y queda debiendo la comisión', () => {
    const l = liquidar(base);
    expect(l.cobroAlCliente).toBe(0);
    expect(l.cobroEnMano).toBe(4000);
    expect(l.comision).toBe(600);
    expect(l.cargoServicio).toBe(200);
    expect(l.movimientoSaldo).toBe(-800);
    expect(l.netoTrabajador).toBe(3200);
  });

  it('deja a la plataforma el mismo margen que con tarjeta, sin costo de procesamiento', () => {
    const l = liquidar(base);
    expect(l.costoProcesamiento).toBe(0);
    expect(l.margenPlataforma).toBe(800);
  });

  it('cobra una comisión mínima en tickets muy chicos', () => {
    const l = liquidar({ ...base, presupuesto: 200 });
    expect(l.comision).toBe(50);
  });
});

describe('cargoPorCancelacion', () => {
  const entrada = {
    rubroSlug: 'plomeria',
    presupuesto: 10000,
    metodoPago: 'TARJETA',
    nivelTrabajador: 'PLATA',
  } as const;

  it('no cobra si todavía no salió el trabajador', () => {
    expect(cargoPorCancelacion(entrada, 'ASIGNADA').cargoAlCliente).toBe(0);
  });

  it('cobra y compensa al trabajador si ya iba en camino', () => {
    const r = cargoPorCancelacion(entrada, 'EN_CAMINO');
    expect(r.cargoAlCliente).toBe(2000);
    expect(r.compensacionTrabajador).toBe(1600);
  });
});
