import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasarelaStripe } from '../modulos/pagos/stripe.js';
import { PasarelaMercadoPago } from '../modulos/pagos/mercadopago.js';
import { ErrorPasarela } from '../modulos/pagos/pasarela.js';
import {
  eventoDeMercadoPago,
  eventoDeStripe,
  verificarFirmaMercadoPago,
  verificarFirmaStripe,
} from '../modulos/pagos/webhooks.js';
import { createHmac } from 'node:crypto';

/** Respuesta falsa del proveedor, para probar sin salir a internet. */
function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Stripe', () => {
  const stripe = new PasarelaStripe({ claveSecreta: 'sk_test_123' });

  it('retiene sin cobrar: crea el intento con captura manual', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      responder({ id: 'pi_1', status: 'requires_capture', amount: 3150, payment_method: { card: { brand: 'visa', last4: '4242' } } }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const r = await stripe.retener({
      monto: 3150, moneda: 'USD', metodoPagoToken: 'pm_card_visa',
      descripcion: 'Tarea TQ-260908-4F7K', idempotencia: 'TQ-260908-4F7K',
    });

    expect(r).toEqual({ referencia: 'pi_1', marca: 'visa', ultimos4: '4242' });
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(opciones.body).toContain('capture_method=manual');
    expect(opciones.body).toContain('amount=3150');
    // La clave de idempotencia evita cobrar dos veces si se reintenta.
    expect(opciones.headers['idempotency-key']).toBe('retener:TQ-260908-4F7K');
  });

  it('no da por buena una retención que la tarjeta no confirmó', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responder({ id: 'pi_2', status: 'requires_action' })));
    await expect(
      stripe.retener({ monto: 100, moneda: 'USD', metodoPagoToken: 'pm_x', descripcion: 'x', idempotencia: 'x' }),
    ).rejects.toThrow(/requires_action/);
  });

  it('traduce el rechazo del emisor a un error con código', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      responder({ error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Fondos insuficientes' } }, 402),
    ));
    const error = await stripe
      .retener({ monto: 100, moneda: 'USD', metodoPagoToken: 'pm_x', descripcion: 'x', idempotencia: 'x' })
      .catch((e: ErrorPasarela) => e);
    expect(error).toBeInstanceOf(ErrorPasarela);
    expect((error as ErrorPasarela).codigo).toBe('INSUFFICIENT_FUNDS');
  });

  it('no reintenta un rechazo, pero sí un proveedor caído', async () => {
    const rechazo = vi.fn().mockResolvedValue(responder({ error: { code: 'card_declined', message: 'no' } }, 402));
    vi.stubGlobal('fetch', rechazo);
    await expect(stripe.capturar('pi_1', 100)).rejects.toThrow();
    expect(rechazo).toHaveBeenCalledTimes(1);

    const caido = vi
      .fn()
      .mockResolvedValueOnce(responder({}, 503))
      .mockResolvedValueOnce(responder({ id: 'pi_1', amount: 100 }));
    vi.stubGlobal('fetch', caido);
    await expect(stripe.capturar('pi_1', 100)).resolves.toEqual({ referencia: 'pi_1', capturado: 100 });
    expect(caido).toHaveBeenCalledTimes(2);
  });

  it('transferir exige que el trabajador haya conectado su cuenta', async () => {
    await expect(
      stripe.transferir({ usuarioId: 'u1', monto: 2610, moneda: 'USD', concepto: 'Tarea' }),
    ).rejects.toThrow(/no conectó su cuenta/);
  });
});

describe('Mercado Pago', () => {
  const mp = new PasarelaMercadoPago({ accessToken: 'APP_USR-123' });

  it('manda el monto en unidades, no en centavos', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      responder({ id: 987, status: 'authorized', transaction_amount: 31.5, payment_method_id: 'visa', card: { last_four_digits: '4242' } }),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const r = await mp.retener({
      monto: 3150, moneda: 'ARS', metodoPagoToken: 'tok_1', descripcion: 'Tarea', idempotencia: 'TQ-1',
    });

    expect(r.referencia).toBe('987');
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toMatchObject({ transaction_amount: 31.5, capture: false });
  });

  it('avisa que no puede girarle plata al trabajador por API', async () => {
    expect(mp.capacidades.transferencias).toBe(false);
    await expect(
      mp.transferir({ usuarioId: 'u1', monto: 100, moneda: 'ARS', concepto: 'x' }),
    ).rejects.toThrow(/saldo del trabajador/);
  });
});

describe('firmas de los avisos', () => {
  it('acepta la firma correcta de Stripe y rechaza la ajena', () => {
    const secreto = 'whsec_prueba';
    const cuerpo = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
    const ts = Math.floor(Date.now() / 1000);
    const firma = createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex');

    expect(verificarFirmaStripe(cuerpo, `t=${ts},v1=${firma}`, secreto)).toBe(true);
    expect(verificarFirmaStripe(cuerpo, `t=${ts},v1=${'0'.repeat(64)}`, secreto)).toBe(false);
    // Un aviso viejo reenviado no vale, aunque la firma sea válida.
    const viejo = ts - 3600;
    const firmaVieja = createHmac('sha256', secreto).update(`${viejo}.${cuerpo}`).digest('hex');
    expect(verificarFirmaStripe(cuerpo, `t=${viejo},v1=${firmaVieja}`, secreto)).toBe(false);
  });

  it('acepta la firma correcta de Mercado Pago', () => {
    const secreto = 'mp_prueba';
    const ts = String(Math.floor(Date.now() / 1000));
    const firma = createHmac('sha256', secreto).update(`id:987;request-id:abc;ts:${ts};`).digest('hex');
    expect(verificarFirmaMercadoPago('987', 'abc', `ts=${ts},v1=${firma}`, secreto)).toBe(true);
    expect(verificarFirmaMercadoPago('otro', 'abc', `ts=${ts},v1=${firma}`, secreto)).toBe(false);
  });

  it('saca la referencia del pago de cada formato de evento', () => {
    expect(eventoDeStripe({ id: 'evt_1', type: 'charge.refunded', data: { object: { payment_intent: 'pi_9' } } }))
      .toEqual({ id: 'evt_1', tipo: 'charge.refunded', referencia: 'pi_9' });
    expect(eventoDeMercadoPago({ id: 12, action: 'payment.updated', data: { id: '987' } }))
      .toEqual({ id: '12', tipo: 'payment.updated', referencia: '987' });
  });
});
