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
  /**
   * Las tres solapas del muro. No es lo mismo que `familia`: la familia dice de
   * qué se trata el trabajo y la categoría dice a quién se le muestra.
   *  - UNO: una persona, unas horas, sin herramienta especial.
   *  - VARIOS: oficios con herramienta y experiencia.
   *  - ESPECIALIZADOS: carrera universitaria o matrícula.
   */
  categoria: Categoria;
  /** Pide título universitario, no sólo matrícula. Marca la solapa de especializados. */
  requiereTitulo: boolean;
}

export type Categoria = 'UNO' | 'VARIOS' | 'ESPECIALIZADOS';

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
  extra: Partial<
    Pick<Rubro, 'requiereLicencia' | 'requiereAntecedentes' | 'comisionBase' | 'categoria' | 'requiereTitulo'>
  > = {},
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
  categoria: extra.categoria ?? 'VARIOS',
  requiereTitulo: extra.requiereTitulo ?? false,
});

/**
 * Catálogo semilla. Va de cortar el pasto a un abogado por el día: el piso
 * cambia por oficio, el resto de la fórmula (dificultad, urgencia, nivel) es igual
 * para todos.
 */
export const CATALOGO: readonly Rubro[] = [
  // --- Para uno: una persona, unas horas, sin herramienta especial. ---
  r('jardineria-corte-pasto', 'Corte de pasto y jardinería', 'HOGAR', 'HORA', 800, 2, { categoria: 'UNO' }),
  r('limpieza-hogar', 'Limpieza de hogar', 'HOGAR', 'HORA', 700, 3, { categoria: 'UNO' }),
  r('limpieza-profunda', 'Limpieza profunda / fin de obra', 'HOGAR', 'HORA', 1000, 4, { categoria: 'UNO' }),
  r('armado-muebles', 'Armado de muebles', 'HOGAR', 'HORA', 900, 2, { categoria: 'UNO' }),
  r('mensajeria', 'Mensajería y trámites', 'LOGISTICA', 'TRABAJO', 600, 1, { categoria: 'UNO' }),
  r('paseo-mascotas', 'Paseo y cuidado de mascotas', 'CUIDADOS', 'HORA', 700, 1, {
    requiereAntecedentes: true,
    categoria: 'UNO',
  }),
  r('cuidado-ninos', 'Cuidado de niños', 'CUIDADOS', 'HORA', 900, 3, {
    requiereAntecedentes: true,
    categoria: 'UNO',
  }),
  r('cuidado-adultos', 'Acompañamiento de adultos mayores', 'CUIDADOS', 'HORA', 1000, 3, {
    requiereAntecedentes: true,
    categoria: 'UNO',
  }),
  r('mozo-evento', 'Mozo / personal de evento', 'EVENTOS', 'HORA', 800, 4, { categoria: 'UNO' }),

  // --- Varios: oficios con herramienta y experiencia. ---
  r('pintura', 'Pintura de interiores y exteriores', 'MANTENIMIENTO', 'M2', 350, 20),
  r('plomeria', 'Plomería', 'MANTENIMIENTO', 'HORA', 1600, 1, { requiereLicencia: true }),
  r('electricidad', 'Electricidad', 'MANTENIMIENTO', 'HORA', 1800, 1, { requiereLicencia: true }),
  r('aire-acondicionado', 'Aire acondicionado y refrigeración', 'MANTENIMIENTO', 'HORA', 2000, 1, {
    requiereLicencia: true,
  }),
  r('carpinteria', 'Carpintería', 'MANTENIMIENTO', 'HORA', 1400, 2),
  r('albanileria', 'Albañilería', 'MANTENIMIENTO', 'DIA', 6000, 1),
  r('mudanza-flete', 'Mudanzas y fletes', 'LOGISTICA', 'HORA', 1500, 2),
  r('cocinero-evento', 'Cocinero a domicilio', 'EVENTOS', 'HORA', 1500, 3),
  r('fotografia', 'Fotografía y video', 'EVENTOS', 'HORA', 2500, 2, { comisionBase: 0.12 }),
  r('clases-particulares', 'Clases particulares', 'EDUCACION', 'HORA', 1200, 1, { comisionBase: 0.12 }),
  r('soporte-tecnico', 'Soporte técnico e informática', 'TECNOLOGIA', 'HORA', 1800, 1, {
    comisionBase: 0.12,
  }),
  r('traduccion', 'Traducción y redacción', 'PROFESIONAL', 'TRABAJO', 2500, 1, { comisionBase: 0.12 }),

  // --- Especializados: carrera universitaria o matrícula. ---
  r('desarrollo-software', 'Desarrollo de software', 'TECNOLOGIA', 'HORA', 3500, 2, {
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
  }),
  r('diseno-grafico', 'Diseño gráfico', 'TECNOLOGIA', 'TRABAJO', 5000, 1, {
    comisionBase: 0.12,
    categoria: 'ESPECIALIZADOS',
  }),
  r('contabilidad', 'Contabilidad e impuestos', 'PROFESIONAL', 'HORA', 3000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('abogado-dia', 'Abogado por el día', 'PROFESIONAL', 'DIA', 25000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('abogado-consulta', 'Consulta legal', 'PROFESIONAL', 'HORA', 5000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('ingenieria-civil', 'Ingeniería civil · cálculo y planos', 'PROFESIONAL', 'DIA', 30000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('ingenieria-electrica', 'Ingeniería eléctrica · proyecto y certificación', 'PROFESIONAL', 'HORA', 4000, 2, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('arquitectura', 'Arquitectura · proyecto y dirección de obra', 'PROFESIONAL', 'HORA', 3800, 2, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('topografia', 'Topografía y mensura', 'PROFESIONAL', 'DIA', 20000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('peritaje', 'Peritaje técnico y tasación', 'PROFESIONAL', 'TRABAJO', 15000, 1, {
    requiereLicencia: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('enfermeria', 'Enfermería a domicilio', 'SALUD', 'HORA', 2200, 2, {
    requiereLicencia: true,
    requiereAntecedentes: true,
    comisionBase: 0.1,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
  r('kinesiologia', 'Kinesiología y masajes', 'SALUD', 'HORA', 2500, 1, {
    requiereLicencia: true,
    categoria: 'ESPECIALIZADOS',
    requiereTitulo: true,
  }),
];

const PORSLUG = new Map(CATALOGO.map((x) => [x.slug, x]));

export function buscarRubro(slug: string): Rubro | undefined {
  return PORSLUG.get(slug);
}

/**
 * Pedir un oficio que no existe es un error de quien llama, no una falla del
 * sistema. Tiene su propio tipo para que la API pueda contestar "ese oficio no
 * existe" en vez de "algo se rompió de nuestro lado".
 */
export class RubroDesconocido extends Error {
  constructor(readonly slug: string) {
    super(`No conocemos el oficio "${slug}"`);
    this.name = 'RubroDesconocido';
  }
}

export function rubroObligatorio(slug: string): Rubro {
  const rubro = PORSLUG.get(slug);
  if (!rubro) throw new RubroDesconocido(slug);
  return rubro;
}
