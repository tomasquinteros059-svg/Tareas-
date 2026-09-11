import { randomUUID } from 'node:crypto';

/**
 * La app no toca datos de tarjeta: la pasarela devuelve un token y nosotros
 * guardamos sólo referencia, marca y últimos 4. Esta interfaz existe para poder
 * cambiar de proveedor (Stripe, Mercado Pago, dLocal) sin tocar el flujo de la
 * tarea, y para poder testear todo el ciclo sin red.
 */
export interface Pasarela {
  readonly nombre: string;
  /**
   * Qué sabe hacer este proveedor. No todos pagan a terceros por API: cuando
   * `transferencias` es falso, el neto queda en el saldo del trabajador y el
   * retiro se resuelve por fuera (split en el cobro o transferencia bancaria).
   */
  readonly capacidades: { transferencias: boolean };
  /** Retiene los fondos al publicar la tarea (nadie cobra todavía). */
  retener(entrada: RetencionEntrada): Promise<Retencion>;
  /** Captura la retención cuando el trabajo se confirma. */
  capturar(referencia: string, monto: number): Promise<Captura>;
  /** Libera la retención si la tarea se cancela o expira. */
  liberar(referencia: string): Promise<void>;
  /** Devuelve plata ya capturada (disputas, resoluciones de soporte). */
  reembolsar(referencia: string, monto?: number): Promise<{ referencia: string; monto: number }>;
  /** Envía el neto al trabajador, si el proveedor lo permite. */
  transferir(entrada: TransferenciaEntrada): Promise<{ referencia: string }>;
  /** Cierra una retención que necesitó que el cliente fuera al sitio del banco. */
  confirmar?(referencia: string): Promise<Retencion>;
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
  /**
   * Algunos medios (Webpay en Chile) no aceptan un token de tarjeta: mandan al
   * cliente al sitio del banco. En ese caso la tarea queda en borrador hasta
   * que vuelve y se confirma el pago.
   */
  urlRedireccion?: string;
  requiereConfirmacion?: boolean;
}

export interface Captura {
  referencia: string;
  capturado: number;
}

export interface TransferenciaEntrada {
  usuarioId: string;
  /** Cuenta del trabajador en el proveedor (Stripe Connect, CBU, CVU...). */
  cuentaDestino?: string | null;
  monto: number;
  moneda: string;
  concepto: string;
  idempotencia?: string;
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
  readonly nombre = 'sandbox';
  readonly capacidades = { transferencias: true };
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

  async reembolsar(referencia: string, monto?: number): Promise<{ referencia: string; monto: number }> {
    const hold = this.retenciones.get(referencia);
    if (!hold) throw new ErrorPasarela('PAGO_INEXISTENTE', 'No existe el pago');
    if (hold.estado !== 'CAPTURADO') {
      throw new ErrorPasarela('PAGO_NO_REEMBOLSABLE', `El pago está ${hold.estado}`);
    }
    return { referencia: `re_${randomUUID()}`, monto: monto ?? hold.monto };
  }

  async transferir(entrada: TransferenciaEntrada): Promise<{ referencia: string }> {
    if (entrada.monto <= 0) throw new ErrorPasarela('MONTO_INVALIDO', 'El monto debe ser positivo');
    return { referencia: `payout_${randomUUID()}` };
  }
}
