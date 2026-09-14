import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
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
  return app;
}
