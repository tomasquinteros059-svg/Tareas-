import type { PrismaClient } from '@prisma/client';
import type { Env } from './lib/env.js';
import { ServicioTareas } from './modulos/tareas/servicio.js';
import { ServicioCalificaciones } from './modulos/calificaciones/servicio.js';
import { ServicioIdentidad } from './modulos/identidad/servicio.js';
import { Planificador } from './modulos/reloj/planificador.js';
import { ServicioSoporte } from './modulos/soporte/servicio.js';
import { ServicioRetiros } from './modulos/retiros/servicio.js';
import { ServicioDeudas } from './modulos/deudas/servicio.js';
import { ServicioAntifraude } from './modulos/antifraude/servicio.js';
import { ServicioAvisos } from './modulos/avisos/servicio.js';
import { EnviadorConsola, ServicioOtp, type Enviador } from './modulos/auth/otp.js';
import { EnviadorTwilio } from './modulos/auth/sms.js';
import { ProveedorGoogle, ProveedorLinkedin, type ProveedorOauth } from './modulos/auth/oauth.js';
import { PasarelaSandbox, type Pasarela } from './modulos/pagos/pasarela.js';
import { PasarelaStripe } from './modulos/pagos/stripe.js';
import { PasarelaMercadoPago } from './modulos/pagos/mercadopago.js';
import { PasarelaTransbank } from './modulos/pagos/transbank.js';

/** Todo lo que las rutas necesitan, armado en un solo lugar y fácil de sustituir en tests. */
export interface Contexto {
  prisma: PrismaClient;
  env: Env;
  tareas: ServicioTareas;
  calificaciones: ServicioCalificaciones;
  identidad: ServicioIdentidad;
  otp: ServicioOtp;
  reloj: Planificador;
  soporte: ServicioSoporte;
  retiros: ServicioRetiros;
  deudas: ServicioDeudas;
  antifraude: ServicioAntifraude;
  avisos: ServicioAvisos;
  pasarela: Pasarela;
  oauth: { google?: ProveedorOauth; linkedin?: ProveedorOauth };
}

/**
 * El proveedor se elige por configuración. Si falta la clave, el arranque falla
 * acá y no cuando alguien intenta publicar una tarea con dinero de verdad.
 */
function elegirPasarela(env: Env): Pasarela {
  if (env.PAYMENTS_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) throw new Error('PAYMENTS_PROVIDER=stripe pero falta STRIPE_SECRET_KEY');
    return new PasarelaStripe({ claveSecreta: env.STRIPE_SECRET_KEY });
  }
  if (env.PAYMENTS_PROVIDER === 'mercadopago') {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new Error('PAYMENTS_PROVIDER=mercadopago pero falta MERCADOPAGO_ACCESS_TOKEN');
    }
    return new PasarelaMercadoPago({
      accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
      moneda: env.PAYMENTS_CURRENCY,
    });
  }
  if (env.PAYMENTS_PROVIDER === 'transbank') {
    if (!env.TRANSBANK_COMMERCE_CODE || !env.TRANSBANK_API_KEY || !env.TRANSBANK_RETURN_URL) {
      throw new Error(
        'PAYMENTS_PROVIDER=transbank pero faltan TRANSBANK_COMMERCE_CODE, TRANSBANK_API_KEY o TRANSBANK_RETURN_URL',
      );
    }
    return new PasarelaTransbank({
      codigoComercio: env.TRANSBANK_COMMERCE_CODE,
      claveApi: env.TRANSBANK_API_KEY,
      produccion: env.TRANSBANK_PRODUCTION,
      urlRetorno: env.TRANSBANK_RETURN_URL,
    });
  }
  return new PasarelaSandbox();
}

/**
 * El SMS es la puerta de entrada: si no sale, no entra nadie. Igual que con la
 * pasarela, si falta una clave el servidor no arranca, en vez de descubrirlo
 * con la primera persona que intenta registrarse.
 */
function elegirEnviador(env: Env): Enviador {
  if (env.SMS_PROVIDER !== 'twilio') return new EnviadorConsola();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('SMS_PROVIDER=twilio pero faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN');
  }
  if (!env.TWILIO_FROM && !env.TWILIO_MESSAGING_SERVICE_SID) {
    throw new Error('SMS_PROVIDER=twilio pero falta TWILIO_FROM o TWILIO_MESSAGING_SERVICE_SID');
  }
  return new EnviadorTwilio({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    desde: env.TWILIO_FROM ?? '',
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  });
}

export function crearContexto(
  prisma: PrismaClient,
  env: Env,
  overrides: { pasarela?: Pasarela; enviador?: Enviador } = {},
): Contexto {
  const pasarela = overrides.pasarela ?? elegirPasarela(env);
  const enviador = overrides.enviador ?? elegirEnviador(env);

  const oauth: Contexto['oauth'] = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    oauth.google = new ProveedorGoogle({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${env.OAUTH_REDIRECT_BASE}/google/callback`,
    });
  }
  if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
    oauth.linkedin = new ProveedorLinkedin({
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      redirectUri: `${env.OAUTH_REDIRECT_BASE}/linkedin/callback`,
    });
  }

  const antifraude = new ServicioAntifraude(prisma);
  const avisos = new ServicioAvisos(prisma, {
    clavePublica: env.VAPID_PUBLIC_KEY,
    clavePrivada: env.VAPID_PRIVATE_KEY,
    contacto: env.VAPID_SUBJECT,
  });
  const tareas = new ServicioTareas(prisma, pasarela, antifraude);
  const calificaciones = new ServicioCalificaciones(prisma);
  const deudas = new ServicioDeudas(prisma, pasarela, env.PAYMENTS_CURRENCY);

  return {
    prisma,
    env,
    pasarela,
    tareas,
    calificaciones,
    reloj: new Planificador(prisma, tareas, calificaciones, pasarela, deudas, avisos),
    deudas,
    antifraude,
    avisos,
    soporte: new ServicioSoporte(prisma, tareas, pasarela),
    retiros: new ServicioRetiros(prisma, env.KYC_ENCRYPTION_KEY, env.PAYMENTS_CURRENCY),
    identidad: new ServicioIdentidad(prisma, env.KYC_ENCRYPTION_KEY),
    otp: new ServicioOtp(prisma, enviador, env.DEFAULT_COUNTRY),
    oauth,
  };
}
