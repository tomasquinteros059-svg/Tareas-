import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOGO } from '@tareas/domain';

/**
 * La app de un archivo lleva su propia copia del catálogo, generada desde el
 * dominio. Este test es el que impide que se separen otra vez: ya pasó una vez
 * —la app ofrecía "jardineria" y el servidor esperaba "jardineria-corte-pasto"—
 * y con la app conectada eso sería una publicación que falla.
 */
const HTML = readFileSync(new URL('../../../demo-app.html', import.meta.url), 'utf8');
const BLOQUE = HTML.slice(HTML.indexOf('/* CATALOGO:INICIO'), HTML.indexOf('/* CATALOGO:FIN */'));

describe('el catálogo de la app y el del servidor', () => {
  it('la app trae el bloque generado, no una lista escrita a mano', () => {
    expect(BLOQUE).toContain('no editar a mano');
    expect(BLOQUE).toContain('var RUBROS = [');
  });

  it('tienen exactamente los mismos oficios', () => {
    const enLaApp = [...BLOQUE.matchAll(/slug: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(enLaApp.sort()).toEqual(CATALOGO.map((r) => r.slug).sort());
  });

  it('los pisos de la app son los del dominio ajustados a pesos chilenos', () => {
    for (const rubro of CATALOGO) {
      const linea = BLOQUE.split('\n').find((l) => l.includes(`slug: "${rubro.slug}"`));
      expect(linea, `falta ${rubro.slug}`).toBeTruthy();
      const piso = Number(/piso: (\d+)/.exec(linea!)?.[1]);
      expect(piso, rubro.slug).toBe(rubro.minimoPorUnidad * 10);
    }
  });

  it('ninguna parte de la app nombra un oficio que el servidor no conoce', () => {
    const fuera = HTML.slice(0, HTML.indexOf('/* CATALOGO:INICIO')) + HTML.slice(HTML.indexOf('/* CATALOGO:FIN */'));
    const nombrados = new Set<string>();
    for (const m of fuera.matchAll(/(?:rubro|slug):\s*"([a-z-]+)"/g)) nombrados.add(m[1]!);
    for (const m of fuera.matchAll(/(?:rubros|licencias):\s*\[([^\]]*)\]/g)) {
      for (const s of m[1]!.matchAll(/"([a-z-]+)"/g)) nombrados.add(s[1]!);
    }
    const conocidos = new Set(CATALOGO.map((r) => r.slug));
    expect([...nombrados].filter((s) => !conocidos.has(s))).toEqual([]);
  });
});
