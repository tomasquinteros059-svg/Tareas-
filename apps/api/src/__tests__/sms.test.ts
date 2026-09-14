import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnviadorTwilio, ErrorSms } from '../modulos/auth/sms.js';

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

const twilio = new EnviadorTwilio({
  accountSid: 'AC123',
  authToken: 'token-secreto',
  desde: '+56221234567',
  reintentos: 2,
});

afterEach(() => vi.unstubAllGlobals());

describe('mandar el código por SMS', () => {
  it('llama a Twilio con el número, el texto y la cuenta', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(responder({ sid: 'SM1', status: 'queued' }));
    vi.stubGlobal('fetch', fetchFalso);

    await twilio.enviarSms('+56912345678', 'Tu código de Tareas es 123456.');

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(opciones.body).toContain('To=%2B56912345678');
    expect(opciones.body).toContain('From=%2B56221234567');
    expect(opciones.headers.authorization).toBe(
      `Basic ${Buffer.from('AC123:token-secreto').toString('base64')}`,
    );
  });

  it('usa el Messaging Service cuando está configurado', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(responder({ sid: 'SM2' }));
    vi.stubGlobal('fetch', fetchFalso);
    const conServicio = new EnviadorTwilio({
      accountSid: 'AC123',
      authToken: 't',
      desde: '+56221234567',
      messagingServiceSid: 'MG999',
    });

    await conServicio.enviarSms('+56912345678', 'hola');

    const [, opciones] = fetchFalso.mock.calls[0];
    expect(opciones.body).toContain('MessagingServiceSid=MG999');
    expect(opciones.body).not.toContain('From=');
  });

  it('un número inválido no se reintenta: repetirlo cuesta y no lo arregla', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(responder({ code: 21211, message: "Invalid 'To' phone number" }, 400));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(twilio.enviarSms('+5699', 'hola')).rejects.toMatchObject({
      codigo: 'TWILIO_21211',
    });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('una caída del proveedor sí se reintenta', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(responder({ message: 'Service unavailable' }, 503))
      .mockResolvedValueOnce(responder({ sid: 'SM3' }));
    vi.stubGlobal('fetch', fetchFalso);

    await twilio.enviarSms('+56912345678', 'hola');

    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('si la red nunca responde, avisa en vez de quedarse colgado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));

    await expect(twilio.enviarSms('+56912345678', 'hola')).rejects.toBeInstanceOf(ErrorSms);
  });
});
