/**
 * Teléfonos.
 *
 * El teléfono es la llave de la cuenta: es único, es por donde llega el código
 * de verificación y es el contacto real entre dos personas que se van a
 * encontrar en una casa. Si el mismo número se guarda de tres formas distintas
 * —"912345678", "9 1234 5678", "+56 9 1234 5678"— deja de ser único: la misma
 * persona puede abrir tres cuentas, y la que tiene una mala calificación se
 * abandona y se abre otra.
 *
 * Por eso todo número se guarda en formato internacional, sin espacios ni
 * signos: `+56912345678`. La normalización pasa acá, una sola vez, antes de
 * tocar la base.
 */

export interface ReglaPais {
  /** Código internacional, sin el "+". */
  codigo: string;
  /** Largos posibles del número sin el código de país. */
  largos: number[];
  /** Con qué empieza un celular. Sólo los celulares reciben SMS. */
  prefijoMovil?: string;
  /** Prefijo que se marca dentro del país y sobra en el formato internacional. */
  troncal?: string;
}

export const PAISES: Record<string, ReglaPais> = {
  // Chile: 9 dígitos, los celulares empiezan con 9. El "0" de larga distancia
  // ya no se usa, pero hay quien lo sigue escribiendo.
  CL: { codigo: '56', largos: [9], prefijoMovil: '9', troncal: '0' },
  // Argentina: los celulares llevan un 9 extra después del código de país
  // (+54 9 11 …), así que el número internacional tiene un dígito más.
  AR: { codigo: '54', largos: [10, 11], prefijoMovil: '9', troncal: '0' },
  PE: { codigo: '51', largos: [9], prefijoMovil: '9' },
  CO: { codigo: '57', largos: [10], prefijoMovil: '3' },
  MX: { codigo: '52', largos: [10] },
  ES: { codigo: '34', largos: [9], prefijoMovil: '6' },
  US: { codigo: '1', largos: [10] },
};

export interface TelefonoNormalizado {
  /** Listo para guardar y para mandarle un SMS: `+56912345678`. */
  e164: string;
  pais: string;
  /** Si el número puede recibir SMS. Un fijo no sirve para verificar. */
  esMovil: boolean;
}

/**
 * Lleva lo que escribió una persona a formato internacional. Devuelve `null` si
 * no es un número posible: es preferible pedirlo de nuevo que mandar un SMS al
 * vacío y dejar a alguien esperando un código que no va a llegar.
 */
export function normalizarTelefono(entrada: string, paisPorDefecto = 'CL'): TelefonoNormalizado | null {
  const limpio = entrada.replace(/[\s.\-()]/g, '');
  const internacional = limpio.startsWith('+') || limpio.startsWith('00');
  const digitos = limpio.replace(/\D/g, '');
  if (!digitos) return null;

  if (internacional) {
    const sinPrefijo = limpio.startsWith('00') ? digitos.slice(2) : digitos;
    // Los códigos de país se prueban de más largo a más corto: 1 (US) no puede
    // ganarle a 56 (CL) por haber mirado un dígito menos.
    const candidatos = Object.entries(PAISES).sort((a, b) => b[1].codigo.length - a[1].codigo.length);
    for (const [pais, regla] of candidatos) {
      if (!sinPrefijo.startsWith(regla.codigo)) continue;
      const nacional = sinPrefijo.slice(regla.codigo.length);
      const armado = armar(pais, regla, nacional);
      if (armado) return armado;
    }
    // Un país que no está en la tabla igual se acepta si tiene largo razonable:
    // no queremos rechazar a alguien por no haber escrito su regla todavía.
    if (sinPrefijo.length >= 8 && sinPrefijo.length <= 15) {
      return { e164: `+${sinPrefijo}`, pais: '', esMovil: true };
    }
    return null;
  }

  const regla = PAISES[paisPorDefecto.toUpperCase()];
  if (!regla) return null;
  return armar(paisPorDefecto.toUpperCase(), regla, digitos);
}

function armar(pais: string, regla: ReglaPais, nacional: string): TelefonoNormalizado | null {
  let numero = nacional;
  const maximo = Math.max(...regla.largos);
  if (regla.troncal && numero.length > maximo && numero.startsWith(regla.troncal)) {
    numero = numero.slice(regla.troncal.length);
  }
  if (!regla.largos.includes(numero.length)) return null;
  return {
    e164: `+${regla.codigo}${numero}`,
    pais,
    esMovil: regla.prefijoMovil ? numero.startsWith(regla.prefijoMovil) : true,
  };
}

/** Para mostrarlo en pantalla: `+56912345678` → `+56 9 1234 5678`. */
export function formatearTelefono(e164: string): string {
  const m = /^\+(56)(9)(\d{4})(\d{4})$/.exec(e164);
  if (m) return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return e164;
}
