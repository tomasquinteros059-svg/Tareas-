import { multiplicar, redondearArriba, type Centavos } from './dinero.js';
import { rubroObligatorio, type Rubro } from './catalogo.js';
import type { Dificultad, Nivel, Urgencia } from './tipos.js';

/**
 * Multiplicadores de la fórmula de presupuesto. Son datos, no código: se pueden
 * mover por país o por temporada sin tocar la lógica.
 */
export interface ConfiguracionPrecios {
  moneda: string;
  /** Ajuste de poder adquisitivo por país sobre los pisos del catálogo. */
  factorPais: number;
  dificultad: Record<Dificultad, number>;
  urgencia: Record<Urgencia, number>;
  /** Cuánto más cuesta exigir un nivel mínimo de reputación. */
  nivelMinimo: Record<Nivel, number>;
  /** Recargo por noche (22-06) o fin de semana. */
  recargoFueraDeHorario: number;
  /** Costo por km más allá de los primeros 10 km. */
  costoPorKmExtra: Centavos;
  kmSinCargo: number;
  /** Redondeo del presupuesto final (100 = al entero de la moneda). */
  paso: Centavos;
  /** Sobre el mínimo, cuánto se sugiere para que la tarea se tome rápido. */
  margenSugerido: number;
  /** Techo de la banda sugerida. */
  margenSugeridoAlto: number;
}

export const PRECIOS_POR_DEFECTO: ConfiguracionPrecios = {
  moneda: 'USD',
  factorPais: 1,
  dificultad: { BASICA: 1, MEDIA: 1.35, ALTA: 1.8, EXPERTA: 2.5 },
  urgencia: { PROGRAMADA: 1, HOY: 1.15, INMEDIATA: 1.35 },
  nivelMinimo: { NUEVO: 1, BRONCE: 1.05, PLATA: 1.15, ORO: 1.35, PLATINO: 1.6 },
  recargoFueraDeHorario: 1.25,
  costoPorKmExtra: 60,
  kmSinCargo: 10,
  paso: 50,
  margenSugerido: 1.2,
  margenSugeridoAlto: 1.5,
};

/**
 * Chile. El peso no tiene centavos, así que la unidad mínima es el peso entero:
 * un piso de 800 (US$8) pasa a 8.000 pesos con factorPais 10, y el redondeo
 * salta de a $500 porque nadie cotiza un trabajo en $8.437.
 */
export const PRECIOS_CHILE: ConfiguracionPrecios = {
  ...PRECIOS_POR_DEFECTO,
  moneda: 'CLP',
  factorPais: 10,
  costoPorKmExtra: 600,
  paso: 500,
};

export interface SolicitudCotizacion {
  rubroSlug: string;
  unidades: number;
  dificultad: Dificultad;
  urgencia: Urgencia;
  nivelMinimo: Nivel;
  fueraDeHorario?: boolean;
  distanciaKm?: number;
  /** Materiales que pone el trabajador y se le reembolsan; no pagan comisión. */
  materiales?: Centavos;
}

export interface Cotizacion {
  rubro: Rubro;
  moneda: string;
  unidadesFacturadas: number;
  /** Piso absoluto: publicar por debajo de esto se rechaza. */
  minimo: Centavos;
  /** Lo que recomendamos ofrecer para que la tome alguien rápido. */
  sugerido: Centavos;
  /** Techo de la banda sugerida (arriba de esto ya es sobreprecio). */
  sugeridoAlto: Centavos;
  materiales: Centavos;
  desglose: LineaDesglose[];
}

export interface LineaDesglose {
  concepto: string;
  detalle: string;
  factor?: number;
  monto?: Centavos;
}

/**
 * Calcula el presupuesto mínimo de una tarea.
 *
 * base = piso del rubro x unidades facturables (nunca menos que las mínimas)
 * y sobre eso se aplican, en orden, dificultad, urgencia, nivel exigido y
 * horario. Al final se suma el traslado y los materiales, que no se multiplican
 * por nada porque no son trabajo.
 */
export function cotizar(
  solicitud: SolicitudCotizacion,
  config: ConfiguracionPrecios = PRECIOS_POR_DEFECTO,
): Cotizacion {
  const rubro = rubroObligatorio(solicitud.rubroSlug);
  if (!Number.isFinite(solicitud.unidades) || solicitud.unidades <= 0) {
    throw new Error('Las unidades deben ser un número positivo');
  }

  const unidades = Math.max(solicitud.unidades, rubro.unidadesMinimas);
  const desglose: LineaDesglose[] = [];

  const pisoAjustado = multiplicar(rubro.minimoPorUnidad, config.factorPais);
  let monto = pisoAjustado * unidades;
  desglose.push({
    concepto: 'Tarifa base',
    detalle: `${unidades} ${etiquetaUnidad(rubro.unidad, unidades)} x piso del rubro`,
    monto,
  });

  const fDificultad = config.dificultad[solicitud.dificultad];
  monto = multiplicar(monto, fDificultad);
  desglose.push({ concepto: 'Dificultad', detalle: solicitud.dificultad, factor: fDificultad, monto });

  const fUrgencia = config.urgencia[solicitud.urgencia];
  if (fUrgencia !== 1) {
    monto = multiplicar(monto, fUrgencia);
    desglose.push({ concepto: 'Urgencia', detalle: solicitud.urgencia, factor: fUrgencia, monto });
  }

  const fNivel = config.nivelMinimo[solicitud.nivelMinimo];
  if (fNivel !== 1) {
    monto = multiplicar(monto, fNivel);
    desglose.push({
      concepto: 'Nivel exigido',
      detalle: `mínimo ${solicitud.nivelMinimo}`,
      factor: fNivel,
      monto,
    });
  }

  if (solicitud.fueraDeHorario) {
    monto = multiplicar(monto, config.recargoFueraDeHorario);
    desglose.push({
      concepto: 'Fuera de horario',
      detalle: 'noche o fin de semana',
      factor: config.recargoFueraDeHorario,
      monto,
    });
  }

  const kmExtra = Math.max(0, (solicitud.distanciaKm ?? 0) - config.kmSinCargo);
  if (kmExtra > 0) {
    const traslado = Math.round(kmExtra * config.costoPorKmExtra);
    monto += traslado;
    desglose.push({
      concepto: 'Traslado',
      detalle: `${kmExtra.toFixed(1)} km fuera del radio sin cargo`,
      monto: traslado,
    });
  }

  const materiales = Math.max(0, solicitud.materiales ?? 0);
  const minimo = redondearArriba(monto, config.paso) + materiales;

  return {
    rubro,
    moneda: config.moneda,
    unidadesFacturadas: unidades,
    minimo,
    sugerido: redondearArriba(multiplicar(minimo, config.margenSugerido), config.paso),
    sugeridoAlto: redondearArriba(multiplicar(minimo, config.margenSugeridoAlto), config.paso),
    materiales,
    desglose,
  };
}

export interface ResultadoValidacion {
  valido: boolean;
  minimo: Centavos;
  motivo?: string;
}

/** Puerta de entrada: ninguna tarea se publica por debajo del mínimo de su rubro. */
export function validarPresupuesto(
  ofrecido: Centavos,
  solicitud: SolicitudCotizacion,
  config: ConfiguracionPrecios = PRECIOS_POR_DEFECTO,
): ResultadoValidacion {
  const { minimo } = cotizar(solicitud, config);
  if (!Number.isInteger(ofrecido) || ofrecido <= 0) {
    return { valido: false, minimo, motivo: 'El presupuesto debe ser un monto entero en centavos' };
  }
  if (ofrecido < minimo) {
    return {
      valido: false,
      minimo,
      motivo: `El presupuesto ofrecido está por debajo del mínimo del rubro para esta dificultad`,
    };
  }
  return { valido: true, minimo };
}

function etiquetaUnidad(unidad: Rubro['unidad'], cantidad: number): string {
  const plural = cantidad === 1 ? '' : 's';
  switch (unidad) {
    case 'HORA':
      return `hora${plural}`;
    case 'DIA':
      return `día${plural}`;
    case 'M2':
      return 'm²';
    case 'KM':
      return 'km';
    case 'TRABAJO':
      return `trabajo${plural}`;
  }
}
