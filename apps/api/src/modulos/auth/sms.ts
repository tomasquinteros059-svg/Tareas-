import type { Enviador } from './otp.js';

/**
 * Envío real de SMS.
 *
 * El código por SMS es la puerta de entrada de toda la app: si no sale, no
 * entra nadie. Por eso acá importan tres cosas más que la elegancia del
 * adaptador:
 *
 *  - **timeout y reintento**: una red que tarda no puede dejar a alguien
 *    mirando una pantalla que dice "te mandamos un código";
 *  - **no reintentar un rechazo**: si el número es inválido o la cuenta no tiene
 *    saldo, repetirlo tres veces es pagar tres veces el mismo error;
 *  - **no escribir el código en ningún log**: el mensaje entero se manda, pero
 *    lo que se registra es "salió" o "falló", nunca el contenido.
 */
export class ErrorSms extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    /** Si tiene sentido volver a intentar (caída del proveedor, red). */
    readonly reintentable = false,
  ) {
    super(mensaje);
    this.name = 'ErrorSms';
  }
}

export interface OpcionesTwilio {
  accountSid: string;
  authToken: string;
  /** Número o alfanumérico desde el que sale el mensaje. */
  desde: string;
  /** Si se usa un Messaging Service, su SID reemplaza al `desde`. */
  messagingServiceSid?: string;
  timeoutMs?: number;
  reintentos?: number;
}

export class EnviadorTwilio implements Enviador {
  constructor(private readonly opciones: OpcionesTwilio) {}

  async enviarSms(telefono: string, texto: string): Promise<void> {
    const cuerpo = new URLSearchParams({ To: telefono, Body: texto });
    if (this.opciones.messagingServiceSid) {
      cuerpo.set('MessagingServiceSid', this.opciones.messagingServiceSid);
    } else {
      cuerpo.set('From', this.opciones.desde);
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.opciones.accountSid}/Messages.json`;
    const autorizacion = Buffer.from(
      `${this.opciones.accountSid}:${this.opciones.authToken}`,
    ).toString('base64');
    const reintentos = this.opciones.reintentos ?? 2;

    let ultimo: ErrorSms | undefined;
    for (let intento = 0; intento <= reintentos; intento++) {
      try {
        await this.pedir(url, autorizacion, cuerpo.toString());
        return;
      } catch (error) {
        const fallo = error instanceof ErrorSms ? error : new ErrorSms('RED', String(error), true);
        if (!fallo.reintentable) throw fallo;
        ultimo = fallo;
      }
      if (intento < reintentos) await esperar(300 * 2 ** intento);
    }
    throw ultimo ?? new ErrorSms('SIN_RESPUESTA', 'No pudimos mandar el código');
  }

  private async pedir(url: string, autorizacion: string, cuerpo: string): Promise<void> {
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${autorizacion}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: cuerpo,
        signal: AbortSignal.timeout(this.opciones.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new ErrorSms('RED', `No se pudo alcanzar a Twilio: ${mensajeDe(error)}`, true);
    }

    if (respuesta.ok) return;

    const datos = (await respuesta.json().catch(() => ({}))) as { code?: number; message?: string };
    // 5xx y 429 son del lado de ellos o de la cadencia: se reintenta. Un 400 es
    // el número o la cuenta: reintentar no lo arregla y cuesta plata.
    const reintentable = respuesta.status >= 500 || respuesta.status === 429;
    throw new ErrorSms(
      datos.code ? `TWILIO_${datos.code}` : `HTTP_${respuesta.status}`,
      datos.message ?? `Twilio respondió ${respuesta.status}`,
      reintentable,
    );
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
