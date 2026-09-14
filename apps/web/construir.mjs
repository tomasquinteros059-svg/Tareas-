/**
 * Arma la versión instalable de la app.
 *
 * `apps/demo-app.html` sigue siendo un archivo suelto que se abre con doble
 * clic, sin servidor y sin conexión: eso no se toca, porque es lo que permite
 * mostrarla en cualquier lado. Esto agrega encima lo que hace falta para que
 * además se pueda instalar en un teléfono y reciba avisos: el manifiesto, el
 * trabajador de servicio y los íconos.
 *
 *   node apps/web/construir.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escribirIconos } from './icono.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '../..');
const destino = join(aqui, 'dist');

mkdirSync(destino, { recursive: true });

let html = readFileSync(join(raiz, 'apps/demo-app.html'), 'utf8');

const cabeza = `<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icono-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Tareas">
<meta name="mobile-web-app-capable" content="yes">
</head>`;

if (!html.includes('</head>')) throw new Error('El HTML no tiene </head>: no sé dónde poner el manifiesto');
html = html.replace('</head>', cabeza);

if (!html.includes('</body>')) throw new Error('El HTML no tiene </body>: no sé dónde poner el registro');
html = html.replace('</body>', '<script src="/instalar.js"></script>\n</body>');

writeFileSync(join(destino, 'index.html'), html);
for (const archivo of ['sw.js', 'manifest.webmanifest', 'instalar.js']) {
  copyFileSync(join(aqui, archivo), join(destino, archivo));
}
escribirIconos(destino);

console.log(`app instalable en ${destino}`);
