import { describe, expect, it } from 'vitest';
import { calcularNivel, calificacionBayesiana, siguienteNivel, type MetricasTrabajador } from '../reputacion.js';

const metricas = (extra: Partial<MetricasTrabajador> = {}): MetricasTrabajador => ({
  calificacion: 4.9,
  trabajosCompletados: 200,
  tasaCancelacion: 0.01,
  tasaPuntualidad: 0.99,
  identidadVerificada: true,
  antecedentesVerificados: true,
  ...extra,
});

describe('calificacionBayesiana', () => {
  it('una sola reseña perfecta no da 5 estrellas', () => {
    const c = calificacionBayesiana({ cantidad: 1, suma: 5 });
    expect(c).toBeLessThan(4.5);
    expect(c).toBeGreaterThan(4.3);
  });

  it('con volumen se acerca al promedio real', () => {
    expect(calificacionBayesiana({ cantidad: 500, suma: 500 * 4.9 })).toBeGreaterThan(4.85);
  });

  it('sin reseñas devuelve el prior de la plataforma', () => {
    expect(calificacionBayesiana({ cantidad: 0, suma: 0 })).toBe(4.3);
  });
});

describe('calcularNivel', () => {
  it('un perfil sin historial es NUEVO', () => {
    expect(calcularNivel(metricas({ trabajosCompletados: 0, calificacion: 4.3 }))).toBe('NUEVO');
  });

  it('sube de nivel con trabajos y calificación', () => {
    expect(calcularNivel(metricas({ trabajosCompletados: 5, calificacion: 4.2 }))).toBe('BRONCE');
    expect(calcularNivel(metricas({ trabajosCompletados: 20, calificacion: 4.5, tasaPuntualidad: 0.88 }))).toBe('PLATA');
    expect(calcularNivel(metricas({ trabajosCompletados: 50, calificacion: 4.7 }))).toBe('ORO');
    expect(calcularNivel(metricas())).toBe('PLATINO');
  });

  it('las cancelaciones tiran el nivel abajo aunque tenga buenas estrellas', () => {
    expect(calcularNivel(metricas({ tasaCancelacion: 0.25 }))).toBe('NUEVO');
  });

  it('sin identidad verificada no se sube de NUEVO', () => {
    expect(calcularNivel(metricas({ identidadVerificada: false }))).toBe('NUEVO');
  });
});

describe('siguienteNivel', () => {
  it('dice exactamente qué falta para el próximo escalón', () => {
    const r = siguienteNivel(metricas({ trabajosCompletados: 10, calificacion: 4.2, tasaPuntualidad: 0.8 }));
    expect(r?.nivel).toBe('PLATA');
    expect(r?.faltantes).toEqual(
      expect.arrayContaining([expect.stringMatching(/5 trabajos más/), expect.stringMatching(/4.4/)]),
    );
  });

  it('en el tope no hay siguiente nivel', () => {
    expect(siguienteNivel(metricas())).toBeNull();
  });
});
