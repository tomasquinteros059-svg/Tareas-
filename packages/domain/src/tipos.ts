import type { Centavos } from './dinero.js';

/** Cómo se cobra el rubro. Define qué significa "unidades" en el presupuesto. */
export type Unidad = 'HORA' | 'DIA' | 'TRABAJO' | 'M2' | 'KM';

/** Dificultad declarada por quien publica; el sistema la puede corregir tras la visita. */
export type Dificultad = 'BASICA' | 'MEDIA' | 'ALTA' | 'EXPERTA';

/** Qué tan rápido se necesita. Afecta el mínimo: nadie deja lo que está haciendo por la tarifa base. */
export type Urgencia = 'PROGRAMADA' | 'HOY' | 'INMEDIATA';

/**
 * Nivel de reputación. Es la palanca principal del cliente: elegir entre
 * "el más barato disponible" y "alguien con historial probado".
 */
export type Nivel = 'NUEVO' | 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';

export const ORDEN_NIVEL: readonly Nivel[] = ['NUEVO', 'BRONCE', 'PLATA', 'ORO', 'PLATINO'] as const;

export function rangoNivel(nivel: Nivel): number {
  return ORDEN_NIVEL.indexOf(nivel);
}

export function nivelAlcanza(nivel: Nivel, minimo: Nivel): boolean {
  return rangoNivel(nivel) >= rangoNivel(minimo);
}

/** Estados por los que pasa una tarea. Ver estados.ts para las transiciones válidas. */
export type EstadoTarea =
  | 'BORRADOR'
  | 'PUBLICADA'
  | 'ASIGNADA'
  | 'EN_CAMINO'
  | 'EN_PROGRESO'
  | 'ENTREGADA'
  | 'CONFIRMADA'
  | 'PAGADA'
  | 'CANCELADA'
  | 'EXPIRADA'
  | 'EN_DISPUTA';

export type MetodoPago = 'TARJETA' | 'EFECTIVO';

export type EstadoVerificacion = 'PENDIENTE' | 'EN_REVISION' | 'VERIFICADO' | 'RECHAZADO';

export interface Ubicacion {
  lat: number;
  lng: number;
}

/** Foto instantánea del trabajador que usan el despacho y el cotizador. */
export interface PerfilTrabajador {
  id: string;
  nivel: Nivel;
  calificacion: number;
  trabajosCompletados: number;
  identidadVerificada: boolean;
  telefonoVerificado: boolean;
  antecedentesVerificados: boolean;
  /** Slugs de rubros habilitados en su perfil. */
  rubros: readonly string[];
  /** Slugs de rubros con licencia/matrícula validada (abogado, electricista, enfermería...). */
  licencias: readonly string[];
  ubicacion: Ubicacion;
  radioKm: number;
  /** Deuda de comisiones por trabajos cobrados en efectivo. */
  deudaComisiones: Centavos;
  aceptaEfectivo: boolean;
  suspendido: boolean;
}
