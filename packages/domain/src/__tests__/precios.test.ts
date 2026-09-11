import { describe, expect, it } from 'vitest';
import { cotizar, validarPresupuesto, PRECIOS_POR_DEFECTO, PRECIOS_CHILE } from '../precios.js';
import { aMinimas, aUnidades, decimalesDe, formatear } from '../dinero.js';

describe('cotizar', () => {
  it('respeta las unidades mínimas facturables del rubro', () => {
    const media = cotizar({
      rubroSlug: 'jardineria-corte-pasto',
      unidades: 0.5,
      dificultad: 'BASICA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    });
    expect(media.unidadesFacturadas).toBe(2);
    expect(media.minimo).toBe(1600);
  });

  it('sube el mínimo con la dificultad', () => {
    const base = { rubroSlug: 'pintura', unidades: 40, urgencia: 'PROGRAMADA', nivelMinimo: 'NUEVO' } as const;
    const basica = cotizar({ ...base, dificultad: 'BASICA' }).minimo;
    const alta = cotizar({ ...base, dificultad: 'ALTA' }).minimo;
    const experta = cotizar({ ...base, dificultad: 'EXPERTA' }).minimo;
    expect(alta).toBeGreaterThan(basica);
    expect(experta).toBeGreaterThan(alta);
    expect(alta / basica).toBeCloseTo(1.8, 1);
  });

  it('cobra más por urgencia y por exigir mejor nivel', () => {
    const base = {
      rubroSlug: 'plomeria',
      unidades: 2,
      dificultad: 'MEDIA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    } as const;
    const tranqui = cotizar(base).minimo;
    const urgente = cotizar({ ...base, urgencia: 'INMEDIATA' }).minimo;
    const conPlatino = cotizar({ ...base, nivelMinimo: 'PLATINO' }).minimo;
    expect(urgente).toBeGreaterThan(tranqui);
    expect(conPlatino).toBeGreaterThan(tranqui);
  });

  it('un abogado por el día arranca muy por encima de cortar el pasto', () => {
    const pasto = cotizar({
      rubroSlug: 'jardineria-corte-pasto',
      unidades: 8,
      dificultad: 'BASICA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    });
    const abogado = cotizar({
      rubroSlug: 'abogado-dia',
      unidades: 1,
      dificultad: 'BASICA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    });
    expect(abogado.minimo).toBeGreaterThan(pasto.minimo * 3);
  });

  it('suma traslado sólo por los km fuera del radio sin cargo', () => {
    const base = {
      rubroSlug: 'mudanza-flete',
      unidades: 3,
      dificultad: 'MEDIA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    } as const;
    const cerca = cotizar({ ...base, distanciaKm: 8 }).minimo;
    const lejos = cotizar({ ...base, distanciaKm: 30 }).minimo;
    expect(lejos - cerca).toBe(Math.round(20 * PRECIOS_POR_DEFECTO.costoPorKmExtra));
  });

  it('los materiales se suman sin multiplicarse por los factores', () => {
    const sin = cotizar({
      rubroSlug: 'electricidad',
      unidades: 2,
      dificultad: 'ALTA',
      urgencia: 'HOY',
      nivelMinimo: 'ORO',
    });
    const con = cotizar({
      rubroSlug: 'electricidad',
      unidades: 2,
      dificultad: 'ALTA',
      urgencia: 'HOY',
      nivelMinimo: 'ORO',
      materiales: 4000,
    });
    expect(con.minimo - sin.minimo).toBe(4000);
  });

  it('sugiere una banda por encima del mínimo', () => {
    const q = cotizar({
      rubroSlug: 'limpieza-hogar',
      unidades: 4,
      dificultad: 'MEDIA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'PLATA',
    });
    expect(q.sugerido).toBeGreaterThan(q.minimo);
    expect(q.sugeridoAlto).toBeGreaterThan(q.sugerido);
  });

  it('rechaza rubros inexistentes y unidades inválidas', () => {
    expect(() =>
      cotizar({
        rubroSlug: 'teletransportacion',
        unidades: 1,
        dificultad: 'BASICA',
        urgencia: 'PROGRAMADA',
        nivelMinimo: 'NUEVO',
      }),
    ).toThrow(/Rubro desconocido/);
    expect(() =>
      cotizar({
        rubroSlug: 'limpieza-hogar',
        unidades: 0,
        dificultad: 'BASICA',
        urgencia: 'PROGRAMADA',
        nivelMinimo: 'NUEVO',
      }),
    ).toThrow(/positivo/);
  });
});

describe('validarPresupuesto', () => {
  const solicitud = {
    rubroSlug: 'limpieza-hogar',
    unidades: 4,
    dificultad: 'MEDIA',
    urgencia: 'PROGRAMADA',
    nivelMinimo: 'NUEVO',
  } as const;

  it('acepta el monto exacto del mínimo', () => {
    const { minimo } = cotizar(solicitud);
    expect(validarPresupuesto(minimo, solicitud).valido).toBe(true);
  });

  it('rechaza un peso por debajo del mínimo', () => {
    const { minimo } = cotizar(solicitud);
    const r = validarPresupuesto(minimo - 1, solicitud);
    expect(r.valido).toBe(false);
    expect(r.minimo).toBe(minimo);
  });

  it('rechaza montos no enteros o negativos', () => {
    expect(validarPresupuesto(1500.5, solicitud).valido).toBe(false);
    expect(validarPresupuesto(-100, solicitud).valido).toBe(false);
  });
});

describe('monedas sin centavos', () => {
  it('el peso chileno no se parte: la unidad mínima es el peso entero', () => {
    expect(decimalesDe('CLP')).toBe(0);
    expect(decimalesDe('USD')).toBe(2);
    // 8000 unidades mínimas: en dólares son 80, en pesos chilenos son 8000.
    expect(aUnidades(8000, 'USD')).toBe(80);
    expect(aUnidades(8000, 'CLP')).toBe(8000);
    expect(aMinimas(31.5, 'USD')).toBe(3150);
    expect(aMinimas(8000, 'CLP')).toBe(8000);
  });

  it('cotiza en pesos chilenos con montos que un chileno reconoce', () => {
    const q = cotizar(
      {
        rubroSlug: 'jardineria-corte-pasto',
        unidades: 3,
        dificultad: 'BASICA',
        urgencia: 'HOY',
        nivelMinimo: 'NUEVO',
      },
      PRECIOS_CHILE,
    );
    // 8.000/hora x 3 x 1,15 de urgencia = 27.600 → redondeado a $500
    expect(q.minimo).toBe(28000);
    expect(q.moneda).toBe('CLP');
    expect(formatear(q.minimo, 'CLP')).not.toMatch(/,\d\d/);
  });

  it('el mismo trabajo en dólares y en pesos guarda la proporción', () => {
    const solicitud = {
      rubroSlug: 'plomeria',
      unidades: 2,
      dificultad: 'ALTA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
    } as const;
    const usd = cotizar(solicitud).minimo;
    const clp = cotizar(solicitud, PRECIOS_CHILE).minimo;
    expect(clp / usd).toBeCloseTo(10, 0);
  });
});
