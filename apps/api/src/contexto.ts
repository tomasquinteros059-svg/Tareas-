import type { PrismaClient } from '@prisma/client';
import type { Env } from './lib/env.js';
import { ServicioTareas } from './modulos/tareas/servicio.js';
import { ServicioCalificaciones } from './modulos/calificaciones/servicio.js';
import { ServicioIdentidad } from './modulos/identidad/servicio.js';
import { EnviadorConsola, ServicioOtp, type Enviador } from './modulos/auth/otp.js';
import { ProveedorGoogle, ProveedorLinkedin, type ProveedorOauth } from './modulos/auth/oauth.js';
import { PasarelaSandbox, type Pasarela } from './modulos/pagos/pasarela.js';
import { PasarelaStripe } from './modulos/pagos/stripe.js';
import { PasarelaMercadoPago } from './modulos/pagos/mercadopago.js';

/** Todo lo que las rutas necesitan, armado en un solo lugar y fácil de sustituir en tests. */
export interface Contexto {
  prisma: PrismaClient;
  env: Env;
  tareas: ServicioTareas;
  calificaciones: ServicioCalificaciones;
  identidad: ServicioIdentidad;
  otp: ServicioOtp;
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
    return new PasarelaMercadoPago({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN });
  }
  return new PasarelaSandbox();
}

export function crearContexto(
  prisma: PrismaClient,
  env: Env,
  overrides: { pasarela?: Pasarela; enviador?: Enviador } = {},
): Contexto {
  const pasarela = overrides.pasarela ?? elegirPasarela(env);
  const enviador = overrides.enviador ?? new EnviadorConsola();

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

  return {
    prisma,
    env,
    pasarela,
    tareas: new ServicioTareas(prisma, pasarela),
    calificaciones: new ServicioCalificaciones(prisma),
    identidad: new ServicioIdentidad(prisma, env.KYC_ENCRYPTION_KEY),
    otp: new ServicioOtp(prisma, enviador),
    oauth,
  };
}
