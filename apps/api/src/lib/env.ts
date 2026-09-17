import { z } from 'zod';

const esquema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  KYC_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'KYC_ENCRYPTION_KEY debe ser 32 bytes en hexadecimal'),
  PAYMENTS_PROVIDER: z.enum(['sandbox', 'stripe', 'mercadopago', 'transbank']).default('sandbox'),
  /*
   * La moneda no tiene valor por defecto a propósito.
   *
   * Con un `USD` supuesto, una instalación chilena que se olvida de la variable
   * arranca igual y aplica precios y topes de otro país: los pisos por oficio
   * quedan diez veces más bajos y el tope de deuda deja al trabajador sin muro
   * después de dos trabajos en efectivo. Todo eso sin un solo error en el
   * registro. Ya pasó dos veces.
   *
   * Es mejor que el servidor no arranque.
   */
  PAYMENTS_CURRENCY: z
    .string()
    .length(3, 'PAYMENTS_CURRENCY tiene que ser el código de tres letras de la moneda, por ejemplo CLP')
    .transform((m) => m.toUpperCase()),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  TRANSBANK_COMMERCE_CODE: z.string().optional(),
  TRANSBANK_API_KEY: z.string().optional(),
  TRANSBANK_PRODUCTION: z.coerce.boolean().default(false),
  TRANSBANK_RETURN_URL: z.string().optional(),
  SMS_PROVIDER: z.enum(['consola', 'twilio']).default('consola'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  // País con el que se interpretan los teléfonos escritos sin código.
  DEFAULT_COUNTRY: z.string().length(2).default('CL'),
  // Claves de los avisos push. Se generan una sola vez con:
  //   node -e "console.log(require('web-push').generateVAPIDKeys())"
  // Si cambian, todos los teléfonos suscriptos dejan de recibir avisos.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:soporte@tareas.cl'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_BASE: z.string().default('http://localhost:3000/auth'),
  // Dominios que pueden llamar a la API desde un navegador, separados por coma.
  // Vacío deja pasar a cualquiera: sirve en desarrollo, no en producción.
  CORS_ORIGINS: z.string().default(''),
  // Carpeta con la app instalable (apps/web/dist). Vacío: no se sirve nada y
  // la API queda sólo como API.
  WEB_DIR: z.string().default(''),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof esquema>;

export function cargarEnv(fuente: NodeJS.ProcessEnv = process.env): Env {
  const r = esquema.safeParse(fuente);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  return r.data;
}
