import type { Centavos } from './dinero.js';
import type { Unidad } from './tipos.js';

/**
 * Un rubro es la unidad de catálogo. Cada uno trae su piso de tarifa, para que
 * ninguna tarea se publique por debajo de lo que el oficio vale. Los montos
 * están en centavos de la moneda base (USD por defecto) y se ajustan por país
 * con `factorPais` en la configuración de precios.
 */
export interface Rubro {
  slug: string;
  nombre: string;
  familia: Familia;
  unidad: Unidad;
  /** Piso por unidad. La tarifa final nunca baja de acá. */
  minimoPorUnidad: Centavos;
  /** Mínimo facturable: aunque el trabajo dure 20 minutos, se cobran N unidades. */
  unidadesMinimas: number;
  /** Requiere matrícula/licencia validada para poder tomar la tarea. */
  requiereLicencia: boolean;
  /** Requiere verificación de antecedentes (menores, adultos mayores, llaves de casa). */
  requiereAntecedentes: boolean;
  /** Comisión de la plataforma para este rubro (los oficios de alto ticket pagan menos). */
  comisionBase: number;
}

export type Familia =
  | 'HOGAR'
  | 'MANTENIMIENTO'
  | 'LOGISTICA'
  | 'CUIDADOS'
  | 'EVENTOS'
  | 'EDUCACION'
  | 'TECNOLOGIA'
  | 'PROFESIONAL'
  | 'SALUD';

const r = (
  slug: string,
  nombre: string,
  familia: Familia,
  unidad: Unidad,
  minimoPorUnidad: Centavos,
  unidadesMinimas: number,
  extra: Partial<Pick<Rubro, 'requiereLicencia' | 'requiereAntecedentes' | 'comisionBase'>> = {},
): Rubro => ({
  slug,
  nombre,
  familia,
  unidad,
  minimoPorUnidad,
  unidadesMinimas,
  requiereLicencia: extra.requiereLicencia ?? false,
  requiereAntecedentes: extra.requiereAntecedentes ?? false,
  comisionBase: extra.comisionBase ?? 0.15,
});

/**
 * Catálogo semilla. Va de cortar el pasto a un abogado por el día: el piso
 * cambia por oficio, el resto de la fórmula (dificultad, urgencia, nivel) es igual
 * para todos.
 */
export const CATALOGO: readonly Rubro[] = [
  r('jardineria-corte-pasto', 'Corte de pasto y jardinería', 'HOGAR', 'HORA', 800, 2),
  r('limpieza-hogar', 'Limpieza de hogar', 'HOGAR', 'HORA', 700, 3),
  r('limpieza-profunda', 'Limpieza profunda / fin de obra', 'HOGAR', 'HORA', 1000, 4),
  r('armado-muebles', 'Armado de muebles', 'HOGAR', 'HORA', 900, 2),
  r('pintura', 'Pintura de interiores y exteriores', 'MANTENIMIENTO', 'M2', 350, 20),
  r('plomeria', 'Plomería', 'MANTENIMIENTO', 'HORA', 1600, 1, { requiereLicencia: true }),
  r('electricidad', 'Electricidad', 'MANTENIMIENTO', 'HORA', 1800, 1, { requiereLicencia: true }),
  r('aire-acondicionado', 'Aire acondicionado y refrigeración', 'MANTENIMIENTO', 'HORA', 2000, 1, {
    requiereLicencia: true,
  }),
  r('carpinteria', 'Carpintería', 'MANTENIMIENTO', 'HORA', 1400, 2),
  r('albanileria', 'Albañilería', 'MANTENIMIENTO', 'DIA', 6000, 1),
  r('mudanza-flete', 'Mudanzas y fletes', 'LOGISTICA', 'HORA', 1500, 2),
  r('mensajeria', 'Mensajería y trámites', 'LOGISTICA', 'TRABAJO', 600, 1),
  r('paseo-mascotas', 'Paseo y cuidado de mascotas', 'CUIDADOS', 'HORA', 700, 1, {
    requiereAntecedentes: true,
  }),
  r('cuidado-ninos', 'Cuidado de niños', 'CUIDADOS', 'HORA', 900, 3, { requiereAntecedentes: true }),
  r('cuidado-adultos', 'Acompañamiento de adultos mayores', 'CUIDADOS', 'HORA', 1000, 3, {
    requiereAntecedentes: true,
  }),
  r('mozo-evento', 'Mozo / personal de evento', 'EVENTOS', 'HORA', 800, 4),
  r('cocinero-evento', 'Cocinero a domicilio', 'EVENTOS', 'HORA', 1500, 3),
  r('fotografia', 'Fotografía y video', 'EVENTOS', 'HORA', 2500, 2, { comisionBase: 0.12 }),
  r('clases-particulares', 'Clases particulares', 'EDUCACION', 'HORA', 1200, 1, { comisionBase: 0.12 }),
  r('soporte-tecnico', 'Soporte técnico e informática', 'TECNOLOGIA', 'HORA', 1800, 1, {
    comisionBase: 0.12,
  }),
  r('desarrollo-software', 'Desarrollo de software', 'TECNOLOGIA', 'HORA', 3500, 2, {
    comisionBase: 0.1,
  }),
  r('diseno-grafico', 'Diseño gráfico', 'TECNOLOGIA', 'TRABAJO', 5000, 1, { comisionBase: 0.12 }),
  r('contabilidad', 'Contabilidad e impuestos', 'PROFESIONAL', 'HORA', 3000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
  }),
  r('abogado-dia', 'Abogado por el día', 'PROFESIONAL', 'DIA', 25000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
  }),
  r('abogado-consulta', 'Consulta legal', 'PROFESIONAL', 'HORA', 5000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
  }),
  r('traduccion', 'Traducción y redacción', 'PROFESIONAL', 'TRABAJO', 2500, 1, { comisionBase: 0.12 }),
  r('enfermeria', 'Enfermería a domicilio', 'SALUD', 'HORA', 2200, 2, {
    requiereLicencia: true,
    requiereAntecedentes: true,
    comisionBase: 0.1,
  }),
  r('kinesiologia', 'Kinesiología y masajes', 'SALUD', 'HORA', 2500, 1, { requiereLicencia: true }),
];

const PORSLUG = new Map(CATALOGO.map((x) => [x.slug, x]));

export function buscarRubro(slug: string): Rubro | undefined {
  return PORSLUG.get(slug);
}

export function rubroObligatorio(slug: string): Rubro {
  const rubro = PORSLUG.get(slug);
  if (!rubro) throw new Error(`Rubro desconocido: ${slug}`);
  return rubro;
}
