import { randomUUID } from 'node:crypto';

/**
 * La app no toca datos de tarjeta: la pasarela devuelve un token y nosotros
 * guardamos sólo referencia, marca y últimos 4. Esta interfaz existe para poder
 * cambiar de proveedor (Stripe, Mercado Pago, dLocal) sin tocar el flujo de la
 * tarea, y para poder testear todo el ciclo sin red.
 */
export interface Pasarela {
  /** Retiene los fondos al publicar la tarea (nadie cobra todavía). */
  retener(entrada: RetencionEntrada): Promise<Retencion>;
  /** Captura la retención cuando el trabajo se confirma. */
  capturar(referencia: string, monto: number): Promise<Captura>;
  /** Libera la retención si la tarea se cancela o expira. */
  liberar(referencia: string): Promise<void>;
  /** Envía el neto al trabajador. */
  transferir(entrada: TransferenciaEntrada): Promise<{ referencia: string }>;
}

export interface RetencionEntrada {
  monto: number;
  moneda: string;
  metodoPagoToken: string;
  descripcion: string;
  idempotencia: string;
}

export interface Retencion {
  referencia: string;
  marca?: string;
  ultimos4?: string;
}

export interface Captura {
  referencia: string;
  capturado: number;
}

export interface TransferenciaEntrada {
  usuarioId: string;
  monto: number;
  moneda: string;
  concepto: string;
}

export class ErrorPasarela extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorPasarela';
  }
}

/**
 * Pasarela de mentira para desarrollo y tests. Acepta tokens con formato
 * `tok_ok_1234` y rechaza `tok_rechazada` para poder probar el camino triste.
 */
export class PasarelaSandbox implements Pasarela {
  readonly retenciones = new Map<string, { monto: number; estado: 'RETENIDO' | 'CAPTURADO' | 'LIBERADO' }>();

  async retener(entrada: RetencionEntrada): Promise<Retencion> {
    if (entrada.metodoPagoToken.startsWith('tok_rechazada')) {
      throw new ErrorPasarela('TARJETA_RECHAZADA', 'La tarjeta fue rechazada por el emisor');
    }
    if (entrada.monto <= 0) throw new ErrorPasarela('MONTO_INVALIDO', 'El monto debe ser positivo');
    const referencia = `hold_${randomUUID()}`;
    this.retenciones.set(referencia, { monto: entrada.monto, estado: 'RETENIDO' });
    return { referencia, marca: 'visa', ultimos4: entrada.metodoPagoToken.slice(-4) };
  }

  async capturar(referencia: string, monto: number): Promise<Captura> {
    const hold = this.retenciones.get(referencia);
    if (!hold) throw new ErrorPasarela('RETENCION_INEXISTENTE', 'No existe la retención');
    if (hold.estado !== 'RETENIDO') {
      throw new ErrorPasarela('RETENCION_NO_CAPTURABLE', `La retención está ${hold.estado}`);
    }
    if (monto > hold.monto) {
      throw new ErrorPasarela('MONTO_MAYOR_A_RETENIDO', 'No se puede capturar más de lo retenido');
    }
    hold.estado = 'CAPTURADO';
    return { referencia, capturado: monto };
  }

  async liberar(referencia: string): Promise<void> {
    const hold = this.retenciones.get(referencia);
    if (hold && hold.estado === 'RETENIDO') hold.estado = 'LIBERADO';
  }

  async transferir(entrada: TransferenciaEntrada): Promise<{ referencia: string }> {
    if (entrada.monto <= 0) throw new ErrorPasarela('MONTO_INVALIDO', 'El monto debe ser positivo');
    return { referencia: `payout_${randomUUID()}` };
  }
}
