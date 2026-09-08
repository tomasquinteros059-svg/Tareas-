import type { EstadoTarea } from './tipos.js';

export type Actor = 'CLIENTE' | 'TRABAJADOR' | 'SISTEMA' | 'SOPORTE';

export interface Transicion {
  desde: EstadoTarea;
  hacia: EstadoTarea;
  actores: readonly Actor[];
  descripcion: string;
}

/**
 * Máquina de estados de la tarea. Es la columna vertebral de la app: cada
 * pantalla, notificación y movimiento de plata cuelga de una de estas
 * transiciones, y nada cambia de estado por fuera de esta tabla.
 */
export const TRANSICIONES: readonly Transicion[] = [
  { desde: 'BORRADOR', hacia: 'PUBLICADA', actores: ['CLIENTE'], descripcion: 'Se publica con precio cerrado y fondos retenidos' },
  { desde: 'BORRADOR', hacia: 'CANCELADA', actores: ['CLIENTE'], descripcion: 'Se descarta el borrador' },
  { desde: 'PUBLICADA', hacia: 'ASIGNADA', actores: ['TRABAJADOR'], descripcion: 'La toma el primero que llega' },
  { desde: 'PUBLICADA', hacia: 'CANCELADA', actores: ['CLIENTE', 'SOPORTE'], descripcion: 'Se baja antes de que la tomen (sin costo)' },
  { desde: 'PUBLICADA', hacia: 'EXPIRADA', actores: ['SISTEMA'], descripcion: 'Nadie la tomó dentro de la ventana' },
  { desde: 'ASIGNADA', hacia: 'EN_CAMINO', actores: ['TRABAJADOR'], descripcion: 'El trabajador sale hacia el domicilio' },
  { desde: 'ASIGNADA', hacia: 'PUBLICADA', actores: ['TRABAJADOR', 'SOPORTE'], descripcion: 'El trabajador se baja: vuelve a la fila con penalización' },
  { desde: 'ASIGNADA', hacia: 'CANCELADA', actores: ['CLIENTE', 'SOPORTE'], descripcion: 'Cancela el cliente (puede tener cargo)' },
  { desde: 'EN_CAMINO', hacia: 'EN_PROGRESO', actores: ['TRABAJADOR'], descripcion: 'Llegó y arranca (código de inicio del cliente)' },
  { desde: 'EN_CAMINO', hacia: 'PUBLICADA', actores: ['TRABAJADOR', 'SOPORTE'], descripcion: 'Se baja en camino: vuelve a la fila' },
  { desde: 'EN_CAMINO', hacia: 'CANCELADA', actores: ['CLIENTE', 'SOPORTE'], descripcion: 'Cancelación tardía del cliente' },
  { desde: 'EN_PROGRESO', hacia: 'ENTREGADA', actores: ['TRABAJADOR'], descripcion: 'Marca el trabajo como terminado' },
  { desde: 'EN_PROGRESO', hacia: 'EN_DISPUTA', actores: ['CLIENTE', 'TRABAJADOR'], descripcion: 'Se abre un reclamo' },
  { desde: 'ENTREGADA', hacia: 'CONFIRMADA', actores: ['CLIENTE', 'SISTEMA'], descripcion: 'El cliente confirma, o se confirma solo a las 24 h' },
  { desde: 'ENTREGADA', hacia: 'EN_DISPUTA', actores: ['CLIENTE'], descripcion: 'El cliente reclama antes de la confirmación automática' },
  { desde: 'CONFIRMADA', hacia: 'PAGADA', actores: ['SISTEMA'], descripcion: 'Se cobra al cliente y se liquida al trabajador' },
  { desde: 'EN_DISPUTA', hacia: 'CONFIRMADA', actores: ['SOPORTE'], descripcion: 'Soporte falla a favor del trabajador' },
  { desde: 'EN_DISPUTA', hacia: 'CANCELADA', actores: ['SOPORTE'], descripcion: 'Soporte falla a favor del cliente' },
];

const MAPA = new Map<string, Transicion>(TRANSICIONES.map((t) => [`${t.desde}>${t.hacia}`, t]));

export const ESTADOS_FINALES: readonly EstadoTarea[] = ['PAGADA', 'CANCELADA', 'EXPIRADA'];

export function esFinal(estado: EstadoTarea): boolean {
  return ESTADOS_FINALES.includes(estado);
}

export function puedeTransicionar(desde: EstadoTarea, hacia: EstadoTarea, actor: Actor): boolean {
  const t = MAPA.get(`${desde}>${hacia}`);
  return !!t && t.actores.includes(actor);
}

export function transicionesDisponibles(desde: EstadoTarea, actor: Actor): EstadoTarea[] {
  return TRANSICIONES.filter((t) => t.desde === desde && t.actores.includes(actor)).map((t) => t.hacia);
}

export class TransicionInvalida extends Error {
  constructor(
    readonly desde: EstadoTarea,
    readonly hacia: EstadoTarea,
    readonly actor: Actor,
  ) {
    super(`No se puede pasar de ${desde} a ${hacia} como ${actor}`);
    this.name = 'TransicionInvalida';
  }
}

export function exigirTransicion(desde: EstadoTarea, hacia: EstadoTarea, actor: Actor): void {
  if (!puedeTransicionar(desde, hacia, actor)) throw new TransicionInvalida(desde, hacia, actor);
}
