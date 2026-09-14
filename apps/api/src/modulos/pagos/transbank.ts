import { llamar } from './http.js';
import {
  ErrorPasarela,
  type Captura,
  type Pasarela,
  type Retencion,
  type RetencionEntrada,
  type TransferenciaEntrada,
} from './pasarela.js';

/**
 * Transbank Webpay Plus, en modalidad diferida.
 *
 * Es el medio con el que se paga casi todo en Chile, porque incluye Redcompra
 * —la tarjeta de débito— y no sólo crédito. A cambio funciona distinto de
 * Stripe o Mercado Pago: no recibe un token de tarjeta, manda al cliente al
 * sitio del banco. Por eso la retención devuelve una URL y la tarea queda en
 * borrador hasta que el cliente vuelve y se confirma el pago.
 *
 * El diferido (autorizar ahora, capturar después) requiere tenerlo habilitado
 * en el contrato con Transbank, y la autorización caduca a los 7 días: si una
 * tarea no se confirma en ese plazo, hay que liberar la reserva.
 *
 * Webpay tampoco paga a terceros: el dinero de todas las ventas llega a la
 * cuenta del comercio, y a cada trabajador se le transfiere por fuera. Por eso
 * el neto queda en su saldo dentro de la app.
 */
export interface ConfigTransbank {
  codigoComercio: string;
  claveApi: string;
  /** Falso mientras se prueba contra el ambiente de integración. */
  produccion: boolean;
  urlRetorno: string;
}

const BASE_INTEGRACION = 'https://webpay3gint.transbank.cl';
const BASE_PRODUCCION = 'https://webpay3g.transbank.cl';
const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions';

interface RespuestaCreacion {
  token: string;
  url: string;
}

interface EstadoWebpay {
  status: string;
  response_code?: number;
  amount: number;
  buy_order: string;
  authorization_code?: string;
  card_detail?: { card_number?: string };
  payment_type_code?: string;
}

export class PasarelaTransbank implements Pasarela {
  readonly nombre = 'transbank';
  readonly capacidades = { transferencias: false, cobroDirecto: false };

  constructor(private readonly config: ConfigTransbank) {
    if (!config.codigoComercio || !config.claveApi) {
      throw new Error('Faltan TRANSBANK_COMMERCE_CODE y TRANSBANK_API_KEY');
    }
  }

  private get base(): string {
    return this.config.produccion ? BASE_PRODUCCION : BASE_INTEGRACION;
  }

  private get cabeceras(): Record<string, string> {
    return {
      'Tbk-Api-Key-Id': this.config.codigoComercio,
      'Tbk-Api-Key-Secret': this.config.claveApi,
      'content-type': 'application/json',
    };
  }

  /**
   * Crea la transacción y devuelve a dónde hay que mandar al cliente. Todavía
   * no hay plata reservada: eso pasa cuando vuelve del banco y se confirma.
   */
  async retener(entrada: RetencionEntrada): Promise<Retencion> {
    // El folio de la tarea es el identificador de la compra: así una
    // conciliación con Transbank se lee sin traducir nada.
    const orden = entrada.idempotencia.slice(0, 26);
    const r = await llamar<RespuestaCreacion>({
      metodo: 'POST',
      url: `${this.base}${RUTA}`,
      cabeceras: this.cabeceras,
      cuerpo: JSON.stringify({
        buy_order: orden,
        session_id: orden,
        // Webpay trabaja en pesos enteros, que es nuestra unidad mínima en CLP.
        amount: entrada.monto,
        return_url: this.config.urlRetorno,
      }),
    });
    return {
      referencia: r.token,
      urlRedireccion: `${r.url}?token_ws=${r.token}`,
      requiereConfirmacion: true,
    };
  }

  /** El cliente volvió del banco: acá se confirma que la reserva quedó hecha. */
  async confirmar(referencia: string): Promise<Retencion> {
    const estado = await llamar<EstadoWebpay>({
      metodo: 'PUT',
      url: `${this.base}${RUTA}/${referencia}`,
      cabeceras: this.cabeceras,
      cuerpo: '',
    });

    if (estado.response_code !== 0 || estado.status !== 'AUTHORIZED') {
      throw new ErrorPasarela(
        'PAGO_RECHAZADO',
        `El banco rechazó el pago (código ${estado.response_code ?? 'desconocido'})`,
      );
    }
    return {
      referencia,
      marca: estado.payment_type_code === 'VD' ? 'redcompra' : 'credito',
      ultimos4: estado.card_detail?.card_number?.slice(-4),
    };
  }

  /**
   * Captura lo autorizado. Webpay necesita la orden y el código de autorización
   * que devolvió el banco, así que primero se relee el estado de la transacción.
   */
  async capturar(referencia: string, monto: number): Promise<Captura> {
    const estado = await this.estado(referencia);
    if (!estado.authorization_code) {
      throw new ErrorPasarela('SIN_AUTORIZACION', 'La transacción no tiene código de autorización');
    }
    const r = await llamar<{ authorization_code: string; captured_amount: number }>({
      metodo: 'PUT',
      url: `${this.base}${RUTA}/${referencia}/capture`,
      cabeceras: this.cabeceras,
      cuerpo: JSON.stringify({
        buy_order: estado.buy_order,
        authorization_code: estado.authorization_code,
        capture_amount: monto,
      }),
    });
    return { referencia, capturado: r.captured_amount ?? monto };
  }

  /**
   * Webpay no tiene "cancelar": una autorización que no se captura vence sola a
   * los 7 días. Para no dejarla colgada, se anula con un reembolso por el total,
   * que en una transacción sin capturar es exactamente eso.
   */
  async liberar(referencia: string): Promise<void> {
    const estado = await this.estado(referencia);
    await llamar({
      metodo: 'POST',
      url: `${this.base}${RUTA}/${referencia}/refunds`,
      cabeceras: this.cabeceras,
      cuerpo: JSON.stringify({ amount: estado.amount }),
    });
  }

  async reembolsar(referencia: string, monto?: number): Promise<{ referencia: string; monto: number }> {
    const estado = await this.estado(referencia);
    const aDevolver = monto ?? estado.amount;
    await llamar({
      metodo: 'POST',
      url: `${this.base}${RUTA}/${referencia}/refunds`,
      cabeceras: this.cabeceras,
      cuerpo: JSON.stringify({ amount: aDevolver }),
    });
    return { referencia, monto: aDevolver };
  }

  async transferir(_entrada: TransferenciaEntrada): Promise<{ referencia: string }> {
    throw new ErrorPasarela(
      'TRANSFERENCIAS_NO_SOPORTADAS',
      'Webpay deposita todo en la cuenta del comercio: al trabajador se le transfiere por fuera',
    );
  }

  private estado(referencia: string): Promise<EstadoWebpay> {
    return llamar<EstadoWebpay>({
      metodo: 'GET',
      url: `${this.base}${RUTA}/${referencia}`,
      cabeceras: this.cabeceras,
    });
  }
}
