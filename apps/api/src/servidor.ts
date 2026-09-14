import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import estaticos from '@fastify/static';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { TransicionInvalida } from '@tareas/domain';
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
    if (error instanceof ErrorPasarela) {
      return reply.code(402).send({ error: { codigo: error.codigo, mensaje: error.message } });
    }
    if ((error as { statusCode?: number }).statusCode === 401) {
      return reply.code(401).send({ error: { codigo: 'SIN_SESION', mensaje: 'Sesión inválida o vencida' } });
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
