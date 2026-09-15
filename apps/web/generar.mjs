/**
 * Lo que la app lleva escrito adentro y no debería escribirse dos veces.
 *
 * Los oficios, sus pisos y sus comisiones son reglas de negocio y viven en el
 * dominio (`packages/domain/src/catalogo.ts`). La app de un archivo también los
 * necesita, y tenerlos escritos dos veces ya se notó: los identificadores se
 * fueron separando —"jardineria" contra "jardineria-corte-pasto"— y había
 * oficios que la app ofrecía y el servidor no sabía cotizar.
 *
 * Así que el archivo suelto sigue siendo suelto, pero su lista se genera desde
 * el dominio y queda escrita entre marcas. Si alguien la edita a mano, el test
 * `catalogo-app.test.ts` lo encuentra.
 *
 * Son dos bloques: el catálogo de oficios, que sale del dominio, y los cien
 * trabajos de ejemplo con los que se muestra el producto, que salen de
 * `ejemplos.mjs` y también siembran un servidor de prueba.
 *
 *   node apps/web/generar.mjs          los escribe en apps/demo-app.html
 *   node apps/web/generar.mjs --check  sólo avisa si quedaron viejos
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGO, PRECIOS_CHILE, PRECIOS_POR_DEFECTO } from '../../packages/domain/dist/index.js';
import { TRABAJOS } from './ejemplos.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(aqui, '../demo-app.html');
const INICIO = '/* CATALOGO:INICIO — generado por apps/web/generar.mjs, no editar a mano */';
const FIN = '/* CATALOGO:FIN */';
const INICIO_EJEMPLOS = '/* EJEMPLOS:INICIO — generado por apps/web/generar.mjs, no editar a mano */';
const FIN_EJEMPLOS = '/* EJEMPLOS:FIN */';

/** La app está en pesos chilenos: el piso del dominio va en dólares de referencia. */
const FACTOR = PRECIOS_CHILE.factorPais / PRECIOS_POR_DEFECTO.factorPais;

/** El muro de la app usa ESPECIAL donde el dominio dice ESPECIALIZADOS. */
const CATEGORIA = { UNO: 'UNO', VARIOS: 'VARIOS', ESPECIALIZADOS: 'ESPECIAL' };

export function generar() {
  const lineas = CATALOGO.map((r) => {
    const campos = [
      `slug: ${JSON.stringify(r.slug)}`,
      `nombre: ${JSON.stringify(r.nombre)}`,
      `unidad: ${JSON.stringify(r.unidad)}`,
      `piso: ${r.minimoPorUnidad * FACTOR}`,
      `min: ${r.unidadesMinimas}`,
      `com: ${r.comisionBase}`,
    ];
    if (r.requiereLicencia) campos.push('licencia: true');
    if (r.requiereAntecedentes) campos.push('antecedentes: true');
    campos.push(`cat: ${JSON.stringify(CATEGORIA[r.categoria])}`);
    if (r.requiereTitulo) campos.push('titulo: true');
    return `  { ${campos.join(', ')} }`;
  });
  return `${INICIO}\nvar RUBROS = [\n${lineas.join(',\n')}\n];\n${FIN}`;
}

export function generarEjemplos() {
  const filas = TRABAJOS.map((t) => `  [${t.map((x) => JSON.stringify(x)).join(', ')}]`);
  return (
    `${INICIO_EJEMPLOS}\n` +
    '/* [oficio, título, descripción, cantidad, dificultad] */\n' +
    `var CIEN = [\n${filas.join(',\n')}\n];\n${FIN_EJEMPLOS}`
  );
}

function reemplazar(html, desdeMarca, hastaMarca, bloque) {
  const desde = html.indexOf(desdeMarca);
  const hasta = html.indexOf(hastaMarca);
  if (desde < 0 || hasta < 0) {
    throw new Error(`No encuentro las marcas ${desdeMarca} en ${ARCHIVO}. ¿Se borraron?`);
  }
  return html.slice(0, desde) + bloque + html.slice(hasta + hastaMarca.length);
}

const html = readFileSync(ARCHIVO, 'utf8');
let esperado = reemplazar(html, INICIO, FIN, generar());
esperado = reemplazar(esperado, INICIO_EJEMPLOS, FIN_EJEMPLOS, generarEjemplos());

if (process.argv.includes('--check')) {
  if (html !== esperado) {
    console.error('Lo que la app lleva escrito quedó viejo. Corré: pnpm generar');
    process.exit(1);
  }
  console.log('el catálogo y los ejemplos de la app están al día');
} else {
  writeFileSync(ARCHIVO, esperado);
  console.log(`escritos: ${CATALOGO.length} oficios y ${TRABAJOS.length} trabajos de ejemplo`);
}
