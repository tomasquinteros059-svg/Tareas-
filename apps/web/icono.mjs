/**
 * Genera los íconos de la app.
 *
 * Un PNG a mano, sin librerías: los íconos del manifiesto tienen que ser PNG
 * —Chrome no acepta SVG de forma confiable— y no vale la pena una dependencia
 * de imágenes para dibujar un cuadrado con una marca adentro.
 *
 * El dibujo es el mismo de la app: fondo verde y una "T" blanca, que es lo que
 * se va a ver en la pantalla de inicio de un teléfono.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const VERDE = [0x2f, 0x9e, 0x3e];
const BLANCO = [0xff, 0xff, 0xff];

function dibujar(lado) {
  // Una "T": el palo horizontal arriba y el vertical en el medio.
  const u = lado / 16;
  const pixeles = Buffer.alloc(lado * lado * 3);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const enPalo = y >= 4 * u && y < 6 * u && x >= 3.5 * u && x < 12.5 * u;
      const enTronco = y >= 4 * u && y < 12 * u && x >= 7 * u && x < 9 * u;
      const color = enPalo || enTronco ? BLANCO : VERDE;
      pixeles.set(color, (y * lado + x) * 3);
    }
  }
  return pixeles;
}

function png(lado) {
  const datos = dibujar(lado);
  // PNG guarda cada fila precedida por un byte de filtro; 0 es "sin filtro".
  const conFiltro = Buffer.alloc(lado * (lado * 3 + 1));
  for (let y = 0; y < lado; y++) {
    conFiltro[y * (lado * 3 + 1)] = 0;
    datos.copy(conFiltro, y * (lado * 3 + 1) + 1, y * lado * 3, (y + 1) * lado * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // color verdadero (RGB)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(conFiltro, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

const TABLA = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function escribirIconos(destino) {
  for (const lado of [192, 512]) {
    writeFileSync(`${destino}/icono-${lado}.png`, png(lado));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  escribirIconos(process.argv[2] ?? '.');
  console.log('íconos escritos');
}
