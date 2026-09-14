import { describe, expect, it } from 'vitest';
import { CATALOGO, buscarRubro, rubroObligatorio } from '../catalogo.js';

describe('el catálogo', () => {
  it('no tiene dos oficios con el mismo identificador', () => {
    const slugs = CATALOGO.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('cubre las tres solapas del muro', () => {
    const categorias = new Set(CATALOGO.map((r) => r.categoria));
    expect([...categorias].sort()).toEqual(['ESPECIALIZADOS', 'UNO', 'VARIOS']);
  });

  it('todo lo que pide título es especializado', () => {
    for (const rubro of CATALOGO.filter((r) => r.requiereTitulo)) {
      expect(rubro.categoria).toBe('ESPECIALIZADOS');
      // Un título sin matrícula validada no acredita nada.
      expect(rubro.requiereLicencia).toBe(true);
    }
  });

  it('ningún piso es cero: un oficio sin mínimo es un oficio regalado', () => {
    for (const rubro of CATALOGO) {
      expect(rubro.minimoPorUnidad).toBeGreaterThan(0);
      expect(rubro.unidadesMinimas).toBeGreaterThanOrEqual(1);
    }
  });

  it('la comisión está entre el 10% y el 15%', () => {
    for (const rubro of CATALOGO) {
      expect(rubro.comisionBase).toBeGreaterThanOrEqual(0.1);
      expect(rubro.comisionBase).toBeLessThanOrEqual(0.15);
    }
  });

  it('están los oficios con carrera que pide el producto', () => {
    for (const slug of ['ingenieria-civil', 'arquitectura', 'topografia', 'peritaje', 'abogado-dia']) {
      expect(buscarRubro(slug)?.categoria).toBe('ESPECIALIZADOS');
    }
  });

  it('un rubro que no existe se rechaza con nombre y apellido', () => {
    expect(buscarRubro('no-existe')).toBeUndefined();
    expect(() => rubroObligatorio('no-existe')).toThrow(/no-existe/);
  });
});
