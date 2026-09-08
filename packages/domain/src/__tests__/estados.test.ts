import { describe, expect, it } from 'vitest';
import { esFinal, exigirTransicion, puedeTransicionar, transicionesDisponibles } from '../estados.js';

describe('máquina de estados', () => {
  it('el trabajador toma la tarea, el cliente no se la puede autoasignar', () => {
    expect(puedeTransicionar('PUBLICADA', 'ASIGNADA', 'TRABAJADOR')).toBe(true);
    expect(puedeTransicionar('PUBLICADA', 'ASIGNADA', 'CLIENTE')).toBe(false);
  });

  it('no se puede saltar del anuncio al pago', () => {
    expect(puedeTransicionar('PUBLICADA', 'PAGADA', 'SISTEMA')).toBe(false);
    expect(() => exigirTransicion('PUBLICADA', 'PAGADA', 'SISTEMA')).toThrow(/No se puede pasar/);
  });

  it('si el trabajador se baja, la tarea vuelve a la fila', () => {
    expect(puedeTransicionar('ASIGNADA', 'PUBLICADA', 'TRABAJADOR')).toBe(true);
    expect(puedeTransicionar('EN_CAMINO', 'PUBLICADA', 'TRABAJADOR')).toBe(true);
  });

  it('la confirmación automática la hace el sistema, no el trabajador', () => {
    expect(puedeTransicionar('ENTREGADA', 'CONFIRMADA', 'SISTEMA')).toBe(true);
    expect(puedeTransicionar('ENTREGADA', 'CONFIRMADA', 'TRABAJADOR')).toBe(false);
  });

  it('sólo soporte resuelve disputas', () => {
    expect(transicionesDisponibles('EN_DISPUTA', 'SOPORTE').sort()).toEqual(['CANCELADA', 'CONFIRMADA']);
    expect(transicionesDisponibles('EN_DISPUTA', 'CLIENTE')).toEqual([]);
  });

  it('los estados finales no tienen salida', () => {
    for (const estado of ['PAGADA', 'CANCELADA', 'EXPIRADA'] as const) {
      expect(esFinal(estado)).toBe(true);
      expect(transicionesDisponibles(estado, 'SOPORTE')).toEqual([]);
    }
  });
});
