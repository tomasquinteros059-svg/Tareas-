import { aMinimas, aUnidades } from '@tareas/domain';
import { llamar } from './http.js';
import { ErrorPasarela, type Captura, type Pasarela, type Retencion, type RetencionEntrada, type TransferenciaEntrada } from './pasarela.js';

/**
 * Mercado Pago, con reserva en dos tiempos.
 *
 * Soporta el mismo esquema que usamos: se crea el pago con `capture: false`
 * (queda autorizado, no cobrado) y después se captura o se cancela.
 *
 * Lo que NO tiene es una API simple para girarle plata a un tercero: en el
 * modelo marketplace el dinero se reparte en el momento del cobro con
 * `application_fee`, y el trabajador retira desde su propia cuenta. Por eso
 * acá `transferencias` es falso: el neto queda en el saldo del trabajador
 * dentro de la app y el retiro se resuelve por fuera.
 */
export interface ConfigMercadoPago {
  accessToken: string;
  /** Moneda de la cuenta: define si los montos llevan centavos o no. */
  moneda: string;
  /** Comisión de la plataforma, si se cobra en nombre del trabajador. */
  comision?: number;
}

const BASE = 'https://api.mercadopago.com';

interface PagoMp {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  payment_method_id?: string;
  card?: { last_four_digits?: string };
}

export class PasarelaMercadoPago implements Pasarela {
  readonly nombre = 'mercadopago';
  readonly capacidades = { transferencias: false, cobroDirecto: true };

  constructor(private readonly config: ConfigMercadoPago) {
    if (!config.accessToken) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
  }

  private cabeceras(idempotencia?: string): Record<string, string> {
    const c: Record<string, string> = {
      authorization: `Bearer ${this.config.accessToken}`,
      'content-type': 'application/json',
    };
    if (idempotencia) c['x-idempotency-key'] = idempotencia;
    return c;
  }

  async retener(entrada: RetencionEntrada): Promise<Retencion> {
    const pago = await llamar<PagoMp>({
      metodo: 'POST',
      url: `${BASE}/v1/payments`,
      cabeceras: this.cabeceras(`retener:${entrada.idempotencia}`),
      cuerpo: JSON.stringify({
        // Mercado Pago trabaja en unidades. En pesos chilenos no hay centavos,
        // así que la conversión depende de la moneda: dividir siempre por 100
        // cobraría cien veces menos en Chile.
        transaction_amount: aUnidades(entrada.monto, entrada.moneda),
        token: entrada.metodoPagoToken,
        description: entrada.descripcion,
        installments: 1,
        capture: false,
        application_fee: this.config.comision ? aUnidades(this.config.comision, entrada.moneda) : undefined,
        external_reference: entrada.idempotencia,
      }),
    });

    if (pago.status !== 'authorized') {
      throw new ErrorPasarela(
        (pago.status_detail ?? 'RETENCION_RECHAZADA').toUpperCase(),
        `La tarjeta quedó en estado ${pago.status}`,
      );
    }
    return {
      referencia: String(pago.id),
      marca: pago.payment_method_id,
      ultimos4: pago.card?.last_four_digits,
    };
  }

  async capturar(referencia: string, monto: number): Promise<Captura> {
    const pago = await llamar<PagoMp>({
      metodo: 'PUT',
      url: `${BASE}/v1/payments/${referencia}`,
      cabeceras: this.cabeceras(`capturar:${referencia}:${monto}`),
      cuerpo: JSON.stringify({ capture: true, transaction_amount: aUnidades(monto, this.config.moneda) }),
    });
    return { referencia: String(pago.id), capturado: aMinimas(pago.transaction_amount, this.config.moneda) };
  }

  async liberar(referencia: string): Promise<void> {
    await llamar({
      metodo: 'PUT',
      url: `${BASE}/v1/payments/${referencia}`,
      cabeceras: this.cabeceras(`liberar:${referencia}`),
      cuerpo: JSON.stringify({ status: 'cancelled' }),
    });
  }

  async reembolsar(referencia: string, monto?: number): Promise<{ referencia: string; monto: number }> {
    const r = await llamar<{ id: number; amount: number }>({
      metodo: 'POST',
      url: `${BASE}/v1/payments/${referencia}/refunds`,
      cabeceras: this.cabeceras(`reembolsar:${referencia}:${monto ?? 'total'}`),
      cuerpo: JSON.stringify(monto ? { amount: aUnidades(monto, this.config.moneda) } : {}),
    });
    return { referencia: String(r.id), monto: aMinimas(r.amount ?? 0, this.config.moneda) };
  }

  async transferir(_entrada: TransferenciaEntrada): Promise<{ referencia: string }> {
    throw new ErrorPasarela(
      'TRANSFERENCIAS_NO_SOPORTADAS',
      'Con Mercado Pago el neto queda en el saldo del trabajador: el retiro se hace por fuera de esta API',
    );
  }
}
