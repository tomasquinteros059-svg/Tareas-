import { describe, expect, it } from 'vitest';
import { esFolioValido, generarFolio, normalizarFolio } from '../folio.js';

describe('folio', () => {
  it('genera un código legible con la fecha adentro', () => {
    const folio = generarFolio(new Date('2026-09-08T10:00:00Z'), () => 0);
    expect(folio).toMatch(/^TQ-260908-2{4}$/);
    expect(esFolioValido(folio)).toBe(true);
  });

  it('no usa caracteres que se confunden al dictarlo', () => {
    for (let i = 0; i < 200; i++) {
      const sufijo = generarFolio().split('-')[2]!;
      expect(sufijo).not.toMatch(/[01OI]/);
    }
  });

  it('normaliza lo que escribe el usuario', () => {
    expect(normalizarFolio(' tq-260908-4f7k ')).toBe('TQ-260908-4F7K');
    expect(esFolioValido('tq-260908-4f7k')).toBe(true);
    expect(esFolioValido('TQ-2609-4F7K')).toBe(false);
  });
});
