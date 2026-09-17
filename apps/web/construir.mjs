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
/*
 * El cliente de la API va ANTES que el programa de la app, y no después.
 *
 * Puesto después, la app dibujaba su primera pantalla sin saber todavía que
 * había un servidor detrás: la portada mostraba los botones de la demostración
 * y nunca se volvía a dibujar. La app parecía andar y llevaba a todos a una
 * cuenta de mentira. El orden de dos líneas era la diferencia.
 */
html = html.replace('</head>', '<script src="/api.js"></script>\n</head>');
html = html.replace('</body>', '<script src="/instalar.js"></script>\n</body>');

/*
 * El estilo y el programa salen a archivos aparte.
 *
 * El archivo suelto los lleva adentro —tiene que abrirse con doble clic— pero
 * la versión servida no los necesita ahí, y sacarlos permite prohibir el
 * código incrustado por cabecera (`script-src 'self'`). Con eso, una inyección
 * de HTML en cualquier texto de la app no puede ejecutar nada.
 */
const estilo = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!estilo) throw new Error('No encuentro el <style> de la app');
html = html.replace(estilo[0], '<link rel="stylesheet" href="/estilos.css">');
writeFileSync(join(destino, 'estilos.css'), estilo[1]);

const programa = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!programa) throw new Error('No encuentro el <script> de la app');
html = html.replace(programa[0], '<script src="/app.js"></script>');
writeFileSync(join(destino, 'app.js'), programa[1]);

writeFileSync(join(destino, 'index.html'), html);
for (const archivo of ['sw.js', 'manifest.webmanifest', 'instalar.js', 'api.js']) {
  copyFileSync(join(aqui, archivo), join(destino, archivo));
}
escribirIconos(destino);

console.log(`app instalable en ${destino}`);
