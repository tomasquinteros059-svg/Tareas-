import { formulario, llamar } from './http.js';
import { ErrorPasarela, type Captura, type Pasarela, type Retencion, type RetencionEntrada, type TransferenciaEntrada } from './pasarela.js';

/**
 * Stripe, con retención en dos tiempos.
 *
 * El flujo de la app calza con el de Stripe casi uno a uno: se crea un
 * PaymentIntent con `capture_method: manual` cuando se publica la tarea (el
 * dinero queda reservado en la tarjeta del cliente pero no se cobra), y se
 * captura cuando el cliente confirma el trabajo. Si se cancela antes, se
 * libera la reserva y al cliente nunca se le cobró nada.
 *
 * Para pagarle al trabajador hace falta Stripe Connect: cada trabajador tiene
 * su cuenta conectada y le transferimos el neto a esa cuenta.
 */
export interface ConfigStripe {
  claveSecreta: string;
  /** Cuenta de la plataforma; sólo hace falta si se usan cobros indirectos. */
  cuentaPlataforma?: string;
}

const BASE = 'https://api.stripe.com/v1';

interface IntentoStripe {
  id: string;
  status: string;
  amount: number;
  charges?: { data?: Array<{ payment_method_details?: { card?: { brand?: string; last4?: string } } }> };
  latest_charge?: string;
  payment_method?: { card?: { brand?: string; last4?: string } };
}

export class PasarelaStripe implements Pasarela {
  readonly nombre = 'stripe';
  readonly capacidades = { transferencias: true, cobroDirecto: true };

  constructor(private readonly config: ConfigStripe) {
    if (!config.claveSecreta) throw new Error('Falta STRIPE_SECRET_KEY');
  }

  private cabeceras(idempotencia?: string): Record<string, string> {
    const c: Record<string, string> = {
      authorization: `Bearer ${this.config.claveSecreta}`,
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (idempotencia) c['idempotency-key'] = idempotencia;
    return c;
  }

  async retener(entrada: RetencionEntrada): Promise<Retencion> {
    const intento = await llamar<IntentoStripe>({
      metodo: 'POST',
      url: `${BASE}/payment_intents`,
      cabeceras: this.cabeceras(`retener:${entrada.idempotencia}`),
      cuerpo: formulario({
        amount: entrada.monto,
        currency: entrada.moneda.toLowerCase(),
        payment_method: entrada.metodoPagoToken,
        confirm: 'true',
        capture_method: 'manual',
        description: entrada.descripcion,
        'automatic_payment_methods[enabled]': 'true',
        'automatic_payment_methods[allow_redirects]': 'never',
        'expand[]': 'payment_method',
      }),
    });

    if (intento.status !== 'requires_capture') {
      throw new ErrorPasarela('RETENCION_NO_CONFIRMADA', `La tarjeta quedó en estado ${intento.status}`);
    }
    const tarjeta = intento.payment_method?.card;
    return { referencia: intento.id, marca: tarjeta?.brand, ultimos4: tarjeta?.last4 };
  }

  async capturar(referencia: string, monto: number): Promise<Captura> {
    const intento = await llamar<IntentoStripe>({
      metodo: 'POST',
      url: `${BASE}/payment_intents/${referencia}/capture`,
      cabeceras: this.cabeceras(`capturar:${referencia}:${monto}`),
      cuerpo: formulario({ amount_to_capture: monto }),
    });
    return { referencia: intento.id, capturado: intento.amount };
  }

  async liberar(referencia: string): Promise<void> {
    await llamar({
      metodo: 'POST',
      url: `${BASE}/payment_intents/${referencia}/cancel`,
      cabeceras: this.cabeceras(`liberar:${referencia}`),
      cuerpo: formulario({ cancellation_reason: 'requested_by_customer' }),
    });
  }

  async reembolsar(referencia: string, monto?: number): Promise<{ referencia: string; monto: number }> {
    const r = await llamar<{ id: string; amount: number }>({
      metodo: 'POST',
      url: `${BASE}/refunds`,
      cabeceras: this.cabeceras(`reembolsar:${referencia}:${monto ?? 'total'}`),
      cuerpo: formulario({ payment_intent: referencia, amount: monto }),
    });
    return { referencia: r.id, monto: r.amount };
  }

  async transferir(entrada: TransferenciaEntrada): Promise<{ referencia: string }> {
    if (!entrada.cuentaDestino) {
      throw new ErrorPasarela(
        'SIN_CUENTA_DE_COBRO',
        'El trabajador todavía no conectó su cuenta para recibir pagos',
      );
    }
    const r = await llamar<{ id: string }>({
      metodo: 'POST',
      url: `${BASE}/transfers`,
      cabeceras: this.cabeceras(`transferir:${entrada.idempotencia ?? entrada.usuarioId}`),
      cuerpo: formulario({
        amount: entrada.monto,
        currency: entrada.moneda.toLowerCase(),
        destination: entrada.cuentaDestino,
        description: entrada.concepto,
      }),
    });
    return { referencia: r.id };
  }
}
