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

/** Rectángulo de coordenadas que se le pide a la base antes de medir distancias. */
export interface Caja {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Un grado de latitud mide casi lo mismo en todas partes. */
const KM_POR_GRADO_LAT = 111.32;

/**
 * La caja más chica que contiene al círculo de radio `radioKm` alrededor de un
 * punto.
 *
 * Existe porque una base de datos no sabe buscar en círculos, pero sí sabe
 * buscar rangos con un índice. Traer la caja y después medir la distancia
 * exacta sobre esas pocas filas es la diferencia entre mirar las tareas del
 * barrio y arrastrar las de todo el país.
 *
 * La caja siempre sobra un poco —las esquinas quedan fuera del círculo—, y eso
 * está bien: lo que sobra lo descarta el cálculo exacto. Lo que nunca puede
 * pasar es que falte.
 */
export function cajaDeBusqueda(centro: Ubicacion, radioKm: number): Caja {
  const gradosLat = Math.abs(radioKm) / KM_POR_GRADO_LAT;
  const latMin = centro.lat - gradosLat;
  const latMax = centro.lat + gradosLat;

  // Hacia los polos un grado de longitud mide cada vez menos, así que la caja
  // tiene que ser más ancha. Si el círculo toca un polo, el meridiano deja de
  // significar algo y se abre entera: prefiero traer de más que perder tareas.
  const cosLat = Math.cos(radianes(Math.max(Math.abs(latMin), Math.abs(latMax))));
  const abierta = latMax >= 90 || latMin <= -90 || cosLat < 0.01;
  const gradosLng = abierta ? 180 : gradosLat / cosLat;

  const lngMin = centro.lng - gradosLng;
  const lngMax = centro.lng + gradosLng;
  // Si la caja cruza el antimeridiano dejaría de ser un rango contiguo y la
  // consulta no daría nada. En ese caso también se abre entera.
  const cruza = lngMin < -180 || lngMax > 180;

  return {
    latMin: Math.max(-90, latMin),
    latMax: Math.min(90, latMax),
    lngMin: cruza ? -180 : lngMin,
    lngMax: cruza ? 180 : lngMax,
  };
}
