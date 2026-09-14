/**
 * Antifraude.
 *
 * Tres cosas rompen un marketplace de trabajos, y ninguna necesita hackear
 * nada:
 *
 *  - **pactar por fuera**: se conocen por la app, se pasan el teléfono y el
 *    siguiente trabajo lo arreglan por WhatsApp. La app queda con el costo de
 *    haberlos presentado y sin la comisión, y —peor— sin nada que responder si
 *    algo sale mal, porque ese trabajo no existió para nadie;
 *  - **calificarse entre sí**: dos cuentas se publican trabajos una a la otra y
 *    se ponen cinco estrellas hasta llegar a ORO. Después ese ORO entra a la
 *    casa de alguien que confió en la estrella;
 *  - **tareas fantasma**: trabajos que se publican, se toman y se confirman en
 *    dos minutos, sin que nadie haya cortado un pasto. Sirven para inflar nivel
 *    y, con tarjeta, para mover plata.
 *
 * Nada de esto se prueba con una sola señal: un teléfono en un mensaje puede ser
 * "llamame cuando llegues", y dos trabajos entre las mismas personas es que el
 * cliente quedó contento. Por eso acá no se castiga: se suman señales y se
 * levanta una alerta para que una persona mire. La única regla dura es el
 * teléfono en una pregunta pública antes de asignar, donde no hay motivo
 * legítimo para darlo.
 */

export type Senal =
  | 'CONTACTO_POR_FUERA'
  | 'PEDIDO_DE_TRATO_DIRECTO'
  | 'PAR_RECIPROCO'
  | 'CLIENTE_UNICO'
  | 'TAREA_RELAMPAGO'
  | 'CALIFICACION_EXPRESS';

export interface Hallazgo {
  senal: Senal;
  /** Cuánto pesa en el puntaje de riesgo (0-100). */
  peso: number;
  detalle: string;
}

export type NivelRiesgo = 'BAJO' | 'MEDIO' | 'ALTO';

/** Ocho dígitos o más, aunque vengan separados para disimular. */
const TELEFONO = /(?:\+?\d[\s.\-()]*){8,}/g;
const CORREO = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;

interface Frase {
  patron: RegExp;
  detalle: string;
  /**
   * Intercambiar un contacto con la tarea ya asignada es normal —"llamame
   * cuando llegues"— y sólo llama la atención antes de asignar. Proponer
   * saltarse la app, en cambio, es lo mismo en cualquier momento.
   */
  soloAntesDeAsignar?: boolean;
}

/**
 * Frases que sólo tienen un motivo para aparecer. No alcanza con "whatsapp":
 * alguien puede pedir que le manden una foto por ahí. Lo que importa es la
 * intención de sacar el trabajo de la app.
 */
const FRASES: readonly Frase[] = [
  {
    patron: /\b(?:por|en)\s+(?:el\s+)?(?:whats?app|wasap|wsp|telegram|insta(?:gram)?)\b/,
    detalle: 'propone seguir por otra app',
  },
  {
    patron: /\bfuera\s+de\s+(?:la\s+)?(?:app|aplicacion|plataforma)\b/,
    detalle: 'propone arreglar fuera de la app',
  },
  {
    patron: /\bsin\s+(?:la\s+)?(?:app|aplicacion|plataforma|comision)\b/,
    detalle: 'propone evitar la comisión',
  },
  {
    patron: /\b(?:nos\s+)?(?:arreglamos|evitamos|salteamos)\s+(?:la\s+)?comision\b/,
    detalle: 'propone evitar la comisión',
  },
  {
    patron: /\bte\s+(?:transfiero|deposito|pago)\s+(?:directo|por\s+fuera|a\s+tu\s+cuenta)\b/,
    detalle: 'propone pagar por fuera',
  },
  {
    patron: /\bte\s+(?:paso|doy|mando)\s+mi\s+(?:numero|telefono|celular|correo|mail)\b/,
    detalle: 'ofrece su contacto',
    soloAntesDeAsignar: true,
  },
  {
    patron: /\b(?:pasame|mandame|dame)\s+(?:tu|el)\s+(?:numero|telefono|celular|correo|mail)\b/,
    detalle: 'pide contacto',
    soloAntesDeAsignar: true,
  },
  {
    patron: /\b(?:llamame|escribime|contactame)\s+al\b/,
    detalle: 'deja un contacto directo',
    soloAntesDeAsignar: true,
  },
];

/** Sin tildes y en minúsculas, que es como se comparan las frases. */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Revisa un texto escrito por alguien. `publico` es el caso de una pregunta
 * antes de asignar: ahí un teléfono no tiene explicación posible, mientras que
 * en el chat de una tarea en curso puede ser legítimo.
 */
export function revisarTexto(texto: string, publico = false): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const plano = normalizarTexto(texto);

  const telefonos = texto.match(TELEFONO)?.filter((t) => digitos(t) >= 8) ?? [];
  const correos = texto.match(CORREO) ?? [];
  if (telefonos.length || correos.length) {
    hallazgos.push({
      senal: 'CONTACTO_POR_FUERA',
      peso: publico ? 60 : 25,
      detalle: telefonos.length ? 'comparte un número de teléfono' : 'comparte un correo',
    });
  }

  for (const frase of FRASES) {
    if (frase.soloAntesDeAsignar && !publico) continue;
    if (frase.patron.test(plano)) {
      hallazgos.push({ senal: 'PEDIDO_DE_TRATO_DIRECTO', peso: 45, detalle: frase.detalle });
      break;
    }
  }
  return hallazgos;
}

export interface RelacionEntreCuentas {
  /** Trabajos que este cliente le dio a este trabajador. */
  tareasConEsteCliente: number;
  /** Trabajos en los que los roles están invertidos: el cliente trabajó para él. */
  tareasInvertidas: number;
  /** Trabajos totales del trabajador, con quien sea. */
  tareasDelTrabajador: number;
}

/**
 * Dos cuentas que sólo trabajan entre sí no son clientes fieles: son una sola
 * persona con dos teléfonos.
 */
export function revisarRelacion(relacion: RelacionEntreCuentas): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const juntos = relacion.tareasConEsteCliente + relacion.tareasInvertidas;

  if (relacion.tareasInvertidas >= 2 && juntos >= 3) {
    hallazgos.push({
      senal: 'PAR_RECIPROCO',
      peso: 50,
      detalle: `se publican trabajos entre sí (${relacion.tareasInvertidas} con los roles invertidos)`,
    });
  }
  if (
    relacion.tareasDelTrabajador >= 5 &&
    relacion.tareasConEsteCliente / relacion.tareasDelTrabajador >= 0.8
  ) {
    hallazgos.push({
      senal: 'CLIENTE_UNICO',
      peso: 35,
      detalle: `${relacion.tareasConEsteCliente} de sus ${relacion.tareasDelTrabajador} trabajos son del mismo cliente`,
    });
  }
  return hallazgos;
}

export interface RitmoDeTarea {
  segundosHastaAceptar: number;
  /** Desde que se tomó hasta que el cliente la dio por terminada. */
  segundosDeTrabajo: number;
  /** Duración que se cotizó, en horas. */
  horasCotizadas?: number;
  segundosHastaCalificar?: number;
}

/** Un trabajo de tres horas no se entrega en noventa segundos. */
export function revisarRitmo(ritmo: RitmoDeTarea): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const esperado = (ritmo.horasCotizadas ?? 1) * 3600;
  if (ritmo.segundosDeTrabajo < Math.min(300, esperado * 0.1)) {
    hallazgos.push({
      senal: 'TAREA_RELAMPAGO',
      peso: 40,
      detalle: `entregada en ${Math.round(ritmo.segundosDeTrabajo)} s para un trabajo de ${(esperado / 3600).toFixed(1)} h`,
    });
  }
  if (ritmo.segundosHastaAceptar < 10 && ritmo.segundosDeTrabajo < 600) {
    hallazgos.push({
      senal: 'CALIFICACION_EXPRESS',
      peso: 30,
      detalle: 'tomada y terminada casi al instante de publicarse',
    });
  }
  return hallazgos;
}

/**
 * El puntaje no suma sin techo: tres señales flojas no son una fuerte. Se toma
 * la más pesada y el resto aporta la mitad.
 */
export function riesgo(hallazgos: readonly Hallazgo[]): { puntaje: number; nivel: NivelRiesgo } {
  if (hallazgos.length === 0) return { puntaje: 0, nivel: 'BAJO' };
  const ordenados = [...hallazgos].sort((a, b) => b.peso - a.peso);
  const puntaje = Math.min(
    100,
    Math.round(ordenados[0]!.peso + ordenados.slice(1).reduce((s, h) => s + h.peso / 2, 0)),
  );
  return { puntaje, nivel: puntaje >= 70 ? 'ALTO' : puntaje >= 40 ? 'MEDIO' : 'BAJO' };
}

function digitos(texto: string): number {
  return (texto.match(/\d/g) ?? []).length;
}
