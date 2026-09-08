import type { Nivel } from './tipos.js';

/**
 * Calificación por estrellas con promedio bayesiano.
 *
 * El problema del promedio simple: alguien con una sola reseña de 5 estrellas
 * aparecería arriba de alguien con 200 trabajos y 4.8. Acá cada perfil arranca
 * con un "prior" de reseñas imaginarias en el promedio de la plataforma, así
 * que la reputación se gana con volumen, no con suerte.
 */
export const PRIOR_CALIFICACION = 4.3;
export const PESO_PRIOR = 5;

export interface ResumenCalificaciones {
  cantidad: number;
  suma: number;
}

export function calificacionBayesiana(
  resumen: ResumenCalificaciones,
  prior = PRIOR_CALIFICACION,
  peso = PESO_PRIOR,
): number {
  const total = resumen.cantidad + peso;
  if (total === 0) return prior;
  return Number(((resumen.suma + prior * peso) / total).toFixed(2));
}

export interface MetricasTrabajador {
  calificacion: number;
  trabajosCompletados: number;
  /** Tareas aceptadas y después canceladas por el trabajador, sobre el total aceptado. */
  tasaCancelacion: number;
  /** Llegadas a horario sobre el total. */
  tasaPuntualidad: number;
  identidadVerificada: boolean;
  antecedentesVerificados: boolean;
}

interface RequisitoNivel {
  nivel: Nivel;
  trabajosMinimos: number;
  calificacionMinima: number;
  cancelacionMaxima: number;
  puntualidadMinima: number;
  exigeIdentidad: boolean;
}

/**
 * Escalera de niveles. Sube por trabajo hecho y baja si el servicio se cae:
 * el nivel se recalcula después de cada tarea cerrada, no es un sello permanente.
 */
export const REQUISITOS: readonly RequisitoNivel[] = [
  {
    nivel: 'PLATINO',
    trabajosMinimos: 100,
    calificacionMinima: 4.8,
    cancelacionMaxima: 0.03,
    puntualidadMinima: 0.95,
    exigeIdentidad: true,
  },
  {
    nivel: 'ORO',
    trabajosMinimos: 40,
    calificacionMinima: 4.6,
    cancelacionMaxima: 0.06,
    puntualidadMinima: 0.9,
    exigeIdentidad: true,
  },
  {
    nivel: 'PLATA',
    trabajosMinimos: 15,
    calificacionMinima: 4.4,
    cancelacionMaxima: 0.1,
    puntualidadMinima: 0.85,
    exigeIdentidad: true,
  },
  {
    nivel: 'BRONCE',
    trabajosMinimos: 3,
    calificacionMinima: 4.0,
    cancelacionMaxima: 0.2,
    puntualidadMinima: 0.7,
    exigeIdentidad: true,
  },
];

export function calcularNivel(m: MetricasTrabajador): Nivel {
  for (const req of REQUISITOS) {
    if (
      m.trabajosCompletados >= req.trabajosMinimos &&
      m.calificacion >= req.calificacionMinima &&
      m.tasaCancelacion <= req.cancelacionMaxima &&
      m.tasaPuntualidad >= req.puntualidadMinima &&
      (!req.exigeIdentidad || m.identidadVerificada)
    ) {
      return req.nivel;
    }
  }
  return 'NUEVO';
}

/** Qué le falta al trabajador para el siguiente nivel: se muestra en su perfil. */
export function siguienteNivel(m: MetricasTrabajador): { nivel: Nivel; faltantes: string[] } | null {
  const actual = calcularNivel(m);
  const idx = REQUISITOS.findIndex((x) => x.nivel === actual);
  const objetivo = idx === -1 ? REQUISITOS[REQUISITOS.length - 1] : REQUISITOS[idx - 1];
  if (!objetivo) return null;

  const faltantes: string[] = [];
  if (m.trabajosCompletados < objetivo.trabajosMinimos) {
    faltantes.push(`${objetivo.trabajosMinimos - m.trabajosCompletados} trabajos más`);
  }
  if (m.calificacion < objetivo.calificacionMinima) {
    faltantes.push(`calificación ${objetivo.calificacionMinima}+ (tenés ${m.calificacion})`);
  }
  if (m.tasaCancelacion > objetivo.cancelacionMaxima) {
    faltantes.push(`bajar cancelaciones a ${(objetivo.cancelacionMaxima * 100).toFixed(0)}%`);
  }
  if (m.tasaPuntualidad < objetivo.puntualidadMinima) {
    faltantes.push(`puntualidad ${(objetivo.puntualidadMinima * 100).toFixed(0)}%+`);
  }
  if (objetivo.exigeIdentidad && !m.identidadVerificada) {
    faltantes.push('verificar identidad');
  }
  return { nivel: objetivo.nivel, faltantes };
}
