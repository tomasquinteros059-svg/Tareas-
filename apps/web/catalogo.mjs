/**
 * Un solo catálogo para toda la app.
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
 *   node apps/web/catalogo.mjs          escribe la lista en apps/demo-app.html
 *   node apps/web/catalogo.mjs --check  sólo avisa si quedó vieja
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGO, PRECIOS_CHILE, PRECIOS_POR_DEFECTO } from '../../packages/domain/dist/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(aqui, '../demo-app.html');
const INICIO = '/* CATALOGO:INICIO — generado por apps/web/catalogo.mjs, no editar a mano */';
const FIN = '/* CATALOGO:FIN */';

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

function reemplazar(html, bloque) {
  const desde = html.indexOf(INICIO);
  const hasta = html.indexOf(FIN);
  if (desde < 0 || hasta < 0) {
    throw new Error(`No encuentro las marcas del catálogo en ${ARCHIVO}. ¿Se borraron?`);
  }
  return html.slice(0, desde) + bloque + html.slice(hasta + FIN.length);
}

const html = readFileSync(ARCHIVO, 'utf8');
const esperado = reemplazar(html, generar());

if (process.argv.includes('--check')) {
  if (html !== esperado) {
    console.error('El catálogo de la app quedó viejo. Corré: pnpm catalogo');
    process.exit(1);
  }
  console.log('el catálogo de la app está al día');
} else {
  writeFileSync(ARCHIVO, esperado);
  console.log(`catálogo escrito: ${CATALOGO.length} oficios`);
}
