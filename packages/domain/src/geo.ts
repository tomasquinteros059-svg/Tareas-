import type { Ubicacion } from './tipos.js';

const RADIO_TIERRA_KM = 6371;

/** Distancia en km entre dos puntos (haversine). Suficiente para radios urbanos. */
export function distanciaKm(a: Ubicacion, b: Ubicacion): number {
  const dLat = radianes(b.lat - a.lat);
  const dLng = radianes(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radianes(a.lat)) * Math.cos(radianes(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Number((2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h))).toFixed(3));
}

function radianes(grados: number): number {
  return (grados * Math.PI) / 180;
}
