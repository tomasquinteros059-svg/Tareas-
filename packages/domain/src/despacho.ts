import { distanciaKm } from './geo.js';
import { rubroObligatorio } from './catalogo.js';
import { nivelAlcanza, rangoNivel, type Nivel, type PerfilTrabajador, type Ubicacion } from './tipos.js';
import type { Centavos } from './dinero.js';

/**
 * Despacho tipo Uber: la tarea NO se negocia en comentarios. Se publica con
 * precio cerrado y se la lleva el primero que la acepta.
 *
 * El único matiz es el radar por olas: durante los primeros segundos la tarea
 * sólo la ven los mejor calificados, y después se va abriendo. Así la
 * reputación vale algo (los buenos ven primero) sin romper la regla de
 * "primero que llega, se la lleva" dentro de cada ola.
 */
export interface Ola {
  indice: number;
  desdeSegundos: number;
  hastaSegundos: number | null;
  nivelMinimo: Nivel;
  radioKm: number;
}

export const OLAS: readonly Ola[] = [
  { indice: 0, desdeSegundos: 0, hastaSegundos: 90, nivelMinimo: 'ORO', radioKm: 8 },
  { indice: 1, desdeSegundos: 90, hastaSegundos: 300, nivelMinimo: 'PLATA', radioKm: 15 },
  { indice: 2, desdeSegundos: 300, hastaSegundos: 900, nivelMinimo: 'BRONCE', radioKm: 25 },
  { indice: 3, desdeSegundos: 900, hastaSegundos: null, nivelMinimo: 'NUEVO', radioKm: 40 },
];

/** El radio de la última ola: más lejos que esto no llega ninguna tarea. */
export const RADIO_MAXIMO_OLA = Math.max(...OLAS.map((o) => o.radioKm));

/**
 * Con qué radio se le piden tareas a la base.
 *
 * No es el radio del trabajador: el feed también muestra lo que está un poco
 * más lejos —marcado como fuera de radio, para que sepa que existe y pueda
 * ampliar su zona—. Pero "un poco más lejos" tiene que tener un límite, o el de
 * Punta Arenas termina viendo las tareas de Arica.
 */
export const MARGEN_FEED = 1.5;

export function radioDeBusqueda(radioKmTrabajador: number): number {
  return Math.min(Math.max(radioKmTrabajador, 0), RADIO_MAXIMO_OLA) * MARGEN_FEED;
}

export function olaActual(segundosDesdePublicacion: number): Ola {
  const s = Math.max(0, segundosDesdePublicacion);
  for (const ola of OLAS) {
    if (s >= ola.desdeSegundos && (ola.hastaSegundos === null || s < ola.hastaSegundos)) return ola;
  }
  return OLAS[OLAS.length - 1]!;
}

export interface TareaPublicada {
  id: string;
  folio: string;
  rubroSlug: string;
  autorId: string;
  ubicacion: Ubicacion;
  nivelMinimo: Nivel;
  presupuesto: Centavos;
  metodoPago: 'TARJETA' | 'EFECTIVO';
  publicadaEn: Date;
  /** El cliente puede pedir explícitamente antecedentes aunque el rubro no los exija. */
  exigeAntecedentes?: boolean;
}

export type MotivoRechazo =
  | 'AUTOR_NO_PUEDE_TOMAR'
  | 'CUENTA_SUSPENDIDA'
  | 'IDENTIDAD_NO_VERIFICADA'
  | 'TELEFONO_NO_VERIFICADO'
  | 'RUBRO_NO_HABILITADO'
  | 'LICENCIA_FALTANTE'
  | 'ANTECEDENTES_FALTANTES'
  | 'NIVEL_INSUFICIENTE'
  | 'FUERA_DE_RADIO'
  | 'NO_ACEPTA_EFECTIVO'
  | 'DEUDA_DE_COMISIONES'
  | 'TURNO_NO_ABIERTO';

export interface Elegibilidad {
  elegible: boolean;
  motivo?: MotivoRechazo;
  detalle?: string;
  distanciaKm: number;
  ola: Ola;
}

export interface OpcionesElegibilidad {
  ahora?: Date;
  /** Deuda de comisiones (efectivo) a partir de la cual se bloquea tomar trabajos. */
  limiteDeuda?: Centavos;
}

export const LIMITE_DEUDA_POR_DEFECTO: Centavos = 5000;

/**
 * Única puerta de entrada para "¿este trabajador puede tomar esta tarea?".
 * La usan tanto el feed (para filtrar) como el endpoint de aceptar (para
 * validar), así no hay dos verdades.
 */
export function evaluarElegibilidad(
  tarea: TareaPublicada,
  trabajador: PerfilTrabajador,
  opciones: OpcionesElegibilidad = {},
): Elegibilidad {
  const ahora = opciones.ahora ?? new Date();
  const limiteDeuda = opciones.limiteDeuda ?? LIMITE_DEUDA_POR_DEFECTO;
  const segundos = (ahora.getTime() - tarea.publicadaEn.getTime()) / 1000;
  const ola = olaActual(segundos);
  const distancia = distanciaKm(tarea.ubicacion, trabajador.ubicacion);
  const base = { distanciaKm: distancia, ola };

  const rubro = rubroObligatorio(tarea.rubroSlug);

  if (tarea.autorId === trabajador.id) {
    return { ...base, elegible: false, motivo: 'AUTOR_NO_PUEDE_TOMAR' };
  }
  if (trabajador.suspendido) {
    return { ...base, elegible: false, motivo: 'CUENTA_SUSPENDIDA' };
  }
  if (!trabajador.identidadVerificada) {
    return {
      ...base,
      elegible: false,
      motivo: 'IDENTIDAD_NO_VERIFICADA',
      detalle: 'Verificá tu documento de identidad para tomar trabajos',
    };
  }
  if (!trabajador.telefonoVerificado) {
    return { ...base, elegible: false, motivo: 'TELEFONO_NO_VERIFICADO' };
  }
  if (!trabajador.rubros.includes(tarea.rubroSlug)) {
    return { ...base, elegible: false, motivo: 'RUBRO_NO_HABILITADO', detalle: rubro.nombre };
  }
  if (rubro.requiereLicencia && !trabajador.licencias.includes(tarea.rubroSlug)) {
    return {
      ...base,
      elegible: false,
      motivo: 'LICENCIA_FALTANTE',
      detalle: `${rubro.nombre} requiere matrícula validada`,
    };
  }
  if ((rubro.requiereAntecedentes || tarea.exigeAntecedentes) && !trabajador.antecedentesVerificados) {
    return { ...base, elegible: false, motivo: 'ANTECEDENTES_FALTANTES' };
  }
  if (!nivelAlcanza(trabajador.nivel, tarea.nivelMinimo)) {
    return {
      ...base,
      elegible: false,
      motivo: 'NIVEL_INSUFICIENTE',
      detalle: `Esta tarea pide nivel ${tarea.nivelMinimo} o superior`,
    };
  }
  if (tarea.metodoPago === 'EFECTIVO' && !trabajador.aceptaEfectivo) {
    return { ...base, elegible: false, motivo: 'NO_ACEPTA_EFECTIVO' };
  }
  if (trabajador.deudaComisiones >= limiteDeuda) {
    return {
      ...base,
      elegible: false,
      motivo: 'DEUDA_DE_COMISIONES',
      detalle: 'Saldá tus comisiones pendientes de trabajos en efectivo',
    };
  }
  if (distancia > Math.min(trabajador.radioKm, ola.radioKm)) {
    return { ...base, elegible: false, motivo: 'FUERA_DE_RADIO' };
  }
  if (!nivelAlcanza(trabajador.nivel, ola.nivelMinimo)) {
    const faltan = segundosParaVer(trabajador.nivel, segundos);
    return {
      ...base,
      elegible: false,
      motivo: 'TURNO_NO_ABIERTO',
      detalle:
        faltan === null
          ? 'Todavía no se abrió para tu nivel'
          : `Se abre para tu nivel en ${Math.ceil(faltan)} s`,
    };
  }
  return { ...base, elegible: true };
}

/** Cuántos segundos faltan para que la tarea se abra al nivel del trabajador. */
export function segundosParaVer(nivel: Nivel, segundosTranscurridos: number): number | null {
  for (const ola of OLAS) {
    if (rangoNivel(nivel) >= rangoNivel(ola.nivelMinimo)) {
      return Math.max(0, ola.desdeSegundos - segundosTranscurridos);
    }
  }
  return null;
}

/**
 * Orden del feed para un trabajador: primero lo que puede tomar ya, y dentro de
 * eso lo más cercano y mejor pago. No hay puja ni comentarios: es una fila.
 */
export function ordenarFeed(
  tareas: readonly TareaPublicada[],
  trabajador: PerfilTrabajador,
  opciones: OpcionesElegibilidad = {},
): Array<{ tarea: TareaPublicada; elegibilidad: Elegibilidad }> {
  return tareas
    .map((tarea) => ({ tarea, elegibilidad: evaluarElegibilidad(tarea, trabajador, opciones) }))
    .filter(
      (x) =>
        x.elegibilidad.elegible ||
        x.elegibilidad.motivo === 'TURNO_NO_ABIERTO' ||
        x.elegibilidad.motivo === 'FUERA_DE_RADIO',
    )
    .sort((a, b) => {
      if (a.elegibilidad.elegible !== b.elegibilidad.elegible) return a.elegibilidad.elegible ? -1 : 1;
      const porDistancia = a.elegibilidad.distanciaKm - b.elegibilidad.distanciaKm;
      if (Math.abs(porDistancia) > 1) return porDistancia;
      return b.tarea.presupuesto - a.tarea.presupuesto;
    });
}
