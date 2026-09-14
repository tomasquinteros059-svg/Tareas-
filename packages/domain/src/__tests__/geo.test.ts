import { describe, expect, it } from 'vitest';
import { cajaDeBusqueda, distanciaKm } from '../geo.js';
import { RADIO_MAXIMO_OLA, radioDeBusqueda } from '../despacho.js';

const SANTIAGO = { lat: -33.4489, lng: -70.6693 };

describe('distancia', () => {
  it('mide en kilómetros entre dos puntos', () => {
    // Santiago - Valparaíso, unos 100 km.
    expect(distanciaKm(SANTIAGO, { lat: -33.0472, lng: -71.6127 })).toBeGreaterThan(95);
    expect(distanciaKm(SANTIAGO, { lat: -33.0472, lng: -71.6127 })).toBeLessThan(105);
    expect(distanciaKm(SANTIAGO, SANTIAGO)).toBe(0);
  });
});

describe('la caja de búsqueda', () => {
  it('contiene todo el círculo: ningún punto dentro del radio queda afuera', () => {
    const radio = 15;
    const caja = cajaDeBusqueda(SANTIAGO, radio);

    // Los cuatro extremos del círculo tienen que caer dentro de la caja.
    for (const rumbo of [0, 90, 180, 270]) {
      const punto = mover(SANTIAGO, radio, rumbo);
      expect(punto.lat).toBeGreaterThanOrEqual(caja.latMin);
      expect(punto.lat).toBeLessThanOrEqual(caja.latMax);
      expect(punto.lng).toBeGreaterThanOrEqual(caja.lngMin);
      expect(punto.lng).toBeLessThanOrEqual(caja.lngMax);
    }
  });

  it('deja afuera lo que está claramente lejos', () => {
    const caja = cajaDeBusqueda(SANTIAGO, 15);
    const arica = { lat: -18.4783, lng: -70.3126 };

    expect(arica.lat > caja.latMax || arica.lat < caja.latMin).toBe(true);
  });

  it('es más ancha en longitud que en latitud, porque el meridiano se angosta', () => {
    const caja = cajaDeBusqueda(SANTIAGO, 20);
    const altoLat = caja.latMax - caja.latMin;
    const anchoLng = caja.lngMax - caja.lngMin;

    expect(anchoLng).toBeGreaterThan(altoLat);
  });

  it('cerca del polo se abre entera en vez de quedarse corta', () => {
    const caja = cajaDeBusqueda({ lat: -89.9, lng: 0 }, 40);
    expect(caja.lngMin).toBe(-180);
    expect(caja.lngMax).toBe(180);
  });

  it('si cruzaría el antimeridiano también se abre entera', () => {
    const caja = cajaDeBusqueda({ lat: 0, lng: 179.9 }, 40);
    expect(caja.lngMin).toBe(-180);
    expect(caja.lngMax).toBe(180);
  });
});

describe('el radio con el que se busca', () => {
  it('deja margen sobre el radio del trabajador, para mostrar lo que está cerca', () => {
    expect(radioDeBusqueda(10)).toBeGreaterThan(10);
  });

  it('no pasa del radio de la última ola: nadie ve el otro extremo del país', () => {
    expect(radioDeBusqueda(5000)).toBe(RADIO_MAXIMO_OLA * 1.5);
  });
});

/** Mueve un punto `km` en la dirección `rumbo` (0 = norte, 90 = este). */
function mover(centro: { lat: number; lng: number }, km: number, rumbo: number) {
  const rad = (g: number) => (g * Math.PI) / 180;
  const gradosLat = (km * Math.cos(rad(rumbo))) / 111.32;
  const gradosLng = (km * Math.sin(rad(rumbo))) / (111.32 * Math.cos(rad(centro.lat)));
  return { lat: centro.lat + gradosLat, lng: centro.lng + gradosLng };
}
