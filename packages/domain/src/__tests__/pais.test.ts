import { describe, expect, it } from 'vitest';
import { CHILE, PAIS_REFERENCIA, paisDe } from '../pais.js';
import { cotizar } from '../precios.js';
import { liquidar } from '../comisiones.js';
import { evaluarElegibilidad } from '../despacho.js';
import type { PerfilTrabajador } from '../tipos.js';

describe('elegir país por moneda', () => {
  it('CLP trae la configuración chilena entera', () => {
    const chile = paisDe('CLP');
    expect(chile.precios.moneda).toBe('CLP');
    expect(chile.deudas.minimoCobrable).toBe(CHILE.deudas.minimoCobrable);
    expect(chile.limiteDeuda).toBe(CHILE.limiteDeuda);
  });

  it('cualquier otra cosa cae en los dólares de referencia', () => {
    expect(paisDe('USD')).toBe(PAIS_REFERENCIA);
    expect(paisDe('EUR')).toBe(PAIS_REFERENCIA);
  });
});

/**
 * El caso que rompió el producto: en Chile, un trabajador que hacía dos
 * trabajos en efectivo quedaba bloqueado, porque el límite de deuda estaba en
 * dólares —cinco mil, o sea US$50— y se leía como cinco mil pesos.
 */
describe('el límite de deuda aguanta trabajos de verdad', () => {
  const comision = (presupuesto: number) =>
    liquidar(
      {
        rubroSlug: 'jardineria-corte-pasto',
        presupuesto,
        metodoPago: 'EFECTIVO',
        nivelTrabajador: 'ORO',
      },
      CHILE.comisiones,
    ).movimientoSaldo;

  it('la comisión de un trabajo típico no llega ni cerca del tope', () => {
    // Tres horas de jardinería a precio sugerido: unos $30.000.
    const deuda = -comision(30_000);
    expect(deuda).toBeLessThan(CHILE.limiteDeuda / 5);
  });

  it('hacen falta muchos trabajos en efectivo para quedar bloqueado', () => {
    const porTrabajo = -comision(30_000);
    const cuantos = Math.ceil(CHILE.limiteDeuda / porTrabajo);
    expect(cuantos).toBeGreaterThanOrEqual(8);
  });

  it('con el tope en dólares, dos trabajos ya bloqueaban', () => {
    // Esta es la comprobación de la regresión: con el límite de referencia
    // —5.000, pensado en centavos de dólar— dos trabajos chilenos lo pasan.
    expect(2 * -comision(30_000)).toBeGreaterThan(PAIS_REFERENCIA.limiteDeuda);
  });
});

describe('el límite de deuda llega hasta el despacho', () => {
  const perfil = (saldo: number): PerfilTrabajador => ({
    id: 'trabajador',
    nivel: 'ORO',
    calificacion: 4.8,
    trabajosCompletados: 40,
    identidadVerificada: true,
    telefonoVerificado: true,
    antecedentesVerificados: true,
    rubros: ['jardineria-corte-pasto'],
    licencias: [],
    ubicacion: { lat: -33.4372, lng: -70.6506 },
    radioKm: 20,
    deudaComisiones: saldo < 0 ? -saldo : 0,
    aceptaEfectivo: true,
    suspendido: false,
  });

  const tarea = {
    id: 't',
    folio: 'TQ-260916-A1B2',
    rubroSlug: 'jardineria-corte-pasto',
    autorId: 'cliente',
    ubicacion: { lat: -33.4372, lng: -70.6506 },
    nivelMinimo: 'NUEVO' as const,
    presupuesto: 30_000,
    metodoPago: 'EFECTIVO' as const,
    publicadaEn: new Date(Date.now() - 20 * 60 * 1000),
  };

  it('con la deuda de dos trabajos chilenos sigue pudiendo trabajar', () => {
    const conDeuda = evaluarElegibilidad(tarea, perfil(-7_200), { limiteDeuda: CHILE.limiteDeuda });
    expect(conDeuda.elegible).toBe(true);
  });

  it('pasado el tope chileno sí se le corta', () => {
    const pasado = evaluarElegibilidad(tarea, perfil(-CHILE.limiteDeuda - 1), {
      limiteDeuda: CHILE.limiteDeuda,
    });
    expect(pasado).toMatchObject({ elegible: false, motivo: 'DEUDA_DE_COMISIONES' });
  });
});

describe('los precios de cada país', () => {
  it('el piso chileno es diez veces el de referencia', () => {
    const solicitud = {
      rubroSlug: 'jardineria-corte-pasto',
      unidades: 3,
      dificultad: 'BASICA' as const,
      urgencia: 'PROGRAMADA' as const,
      nivelMinimo: 'NUEVO' as const,
    };
    const chile = cotizar(solicitud, CHILE.precios);
    const referencia = cotizar(solicitud, PAIS_REFERENCIA.precios);
    expect(chile.minimo).toBeGreaterThanOrEqual(referencia.minimo * 10);
    expect(chile.moneda).toBe('CLP');
  });
});
