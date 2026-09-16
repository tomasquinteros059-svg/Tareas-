import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import estaticos from '@fastify/static';
import casco from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { RubroDesconocido, TransicionInvalida } from '@tareas/domain';
import { ErrorApi } from './lib/errores.js';
import { ErrorPasarela } from './modulos/pagos/pasarela.js';
import { registrarRutas } from './rutas.js';
import type { Contexto } from './contexto.js';
import type { Env } from './lib/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuarioId(): string;
    roles(): string[];
    cuerpoCrudo?: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; roles: string[] };
    user: { sub: string; roles: string[] };
  }
}

export async function crearServidor(ctx: Contexto, env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    trustProxy: true,
  });

  // La firma del webhook se calcula sobre el cuerpo exacto que llegó: si lo
  // parseamos y lo volvemos a serializar, la firma deja de coincidir.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, cuerpo, listo) => {
    (req as unknown as { cuerpoCrudo?: string }).cuerpoCrudo = cuerpo as string;
    try {
      listo(null, cuerpo ? JSON.parse(cuerpo as string) : {});
    } catch {
      listo(new ErrorApi(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido'), undefined);
    }
  });

  // En producción sólo se deja entrar a los dominios declarados: si cualquiera
  // puede llamar a la API desde su propia página, la sesión de un usuario sirve
  // desde cualquier lado.
  const origenes = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (env.NODE_ENV === 'production' && origenes.length === 0) {
    throw new Error('En producción hay que declarar CORS_ORIGINS con los dominios de la app');
  }
  await app.register(cors, { origin: origenes.length ? origenes : true, credentials: true });

  /*
   * Cabeceras de seguridad.
   *
   * Cada una tapa algo concreto:
   *  - `frame-ancestors 'none'` impide que alguien meta la app en un marco
   *    dentro de otra página y le haga tocar «Aceptar» a la gente sin que lo
   *    sepa;
   *  - `script-src 'self'` prohíbe el código incrustado: si algún día se cuela
   *    HTML en un título o en un mensaje, no puede ejecutar nada. Por eso la
   *    app servida lleva su programa en un archivo aparte;
   *  - `nosniff` evita que el navegador adivine el tipo de un archivo y trate
   *    como programa algo que subió un usuario;
   *  - HSTS obliga a HTTPS en las visitas siguientes, así una red hostil no
   *    puede hacer bajar la conexión a HTTP.
   *
   * El estilo sí admite `unsafe-inline`: la app usa atributos `style` en
   * muchos lados y un estilo incrustado no ejecuta código.
   */
  await app.register(casco, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Las fotos que saca la gente se comprimen en el navegador y viajan
        // como data:; los mapas y avatares pueden venir de cualquier lado.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': env.NODE_ENV === 'production' ? [] : null,
      },
    },
    // Un año, y sólo tiene efecto sobre HTTPS.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '30d' } });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.decorateRequest('usuarioId', function (this: FastifyRequest) {
    const sub = this.user?.sub;
    if (!sub) throw new ErrorApi(401, 'SIN_SESION', 'Iniciá sesión para continuar');
    return sub;
  });
  app.decorateRequest('roles', function (this: FastifyRequest) {
    return this.user?.roles ?? [];
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ErrorApi) {
      return reply.code(error.status).send({
        error: { codigo: error.codigo, mensaje: error.message, detalle: error.detalle },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          codigo: 'DATOS_INVALIDOS',
          mensaje: 'Revisá los datos enviados',
          detalle: error.issues.map((i) => ({ campo: i.path.join('.'), problema: i.message })),
        },
      });
    }
    if (error instanceof TransicionInvalida) {
      return reply.code(409).send({ error: { codigo: 'TRANSICION_INVALIDA', mensaje: error.message } });
    }
    if (error instanceof RubroDesconocido) {
      return reply.code(422).send({ error: { codigo: 'RUBRO_INEXISTENTE', mensaje: error.message } });
    }
    if (error instanceof ErrorPasarela) {
      return reply.code(402).send({ error: { codigo: error.codigo, mensaje: error.message } });
    }
    if ((error as { statusCode?: number }).statusCode === 401) {
      return reply.code(401).send({ error: { codigo: 'SIN_SESION', mensaje: 'Sesión inválida o vencida' } });
    }

    /*
     * Errores que ya vienen con su código: demasiados pedidos, cuerpo
     * gigante, JSON roto. Sin esto todos terminaban como "algo se rompió de
     * nuestro lado", y quien llama no puede distinguir un límite de pedidos
     * —que se resuelve esperando— de una caída de verdad.
     */
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const codigo = status === 429 ? 'DEMASIADOS_PEDIDOS' : (error as { code?: string }).code ?? 'PEDIDO_INVALIDO';
      return reply.code(status).send({
        error: {
          codigo,
          mensaje:
            status === 429
              ? 'Estás yendo muy rápido. Probá de nuevo en un minuto.'
              : (error as Error).message,
        },
      });
    }

    req.log.error(error);
    return reply.code(500).send({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Algo se rompió de nuestro lado' } });
  });

  await registrarRutas(app, ctx);

  /*
   * La app instalable se sirve desde acá, en el mismo dominio que la API.
   *
   * No es un detalle de comodidad: un trabajador de servicio sólo controla su
   * propio origen, y los avisos push se piden y se reciben en ese origen. Con
   * la app en un dominio y la API en otro, la instalación anda pero los avisos
   * no, que es justamente lo que hace falta para el radar por olas.
   */
  if (env.WEB_DIR) {
    const carpeta = resolve(env.WEB_DIR);
    if (!existsSync(carpeta)) {
      throw new Error(`WEB_DIR apunta a ${carpeta}, que no existe. ¿Falta correr apps/web/construir.mjs?`);
    }
    await app.register(estaticos, { root: carpeta, index: ['index.html'] });
    // Cualquier dirección que no sea de la API abre la app: es una sola
    // pantalla que decide qué mostrar, y recargar en /tarea/TQ-... no puede
    // devolver un 404.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.headers.accept?.includes('application/json')) {
        return reply.code(404).send({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'No existe esa ruta' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
