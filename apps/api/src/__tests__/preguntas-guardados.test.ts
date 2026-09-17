import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServidor } from '../servidor.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, env, limpiar, prisma } from './ayuda.js';

/**
 * Tres agujeros que la app tapaba fingiendo.
 *
 *  - se podía preguntar y nadie podía responder: el campo estaba en la base y
 *    no había por dónde escribirlo;
 *  - la estrella de "guardar para después" vivía en el teléfono, así que
 *    cambiar de aparato la perdía;
 *  - el detalle de una tarea no traía ni las preguntas, ni el chat, ni quién la
 *    había tomado, y la app se caía al dibujar el nombre de ese trabajador.
 */
const ctx = contextoDePrueba();
let app: FastifyInstance;

beforeEach(async () => {
  await limpiar();
  if (!app) app = await crearServidor(ctx, env);
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const sesion = (usuarioId: string, roles: string[] = ['CLIENTE', 'TRABAJADOR']) =>
  `Bearer ${app.jwt.sign({ sub: usuarioId, roles })}`;

describe('responder una pregunta', () => {
  it('quien publicó responde y la respuesta queda con el trabajo', async () => {
    const cliente = await crearCliente('Ana');
    const trabajador = await crearTrabajador('Beto');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const pregunta = await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿Llevo herramienta?');

    const r = await app.inject({
      method: 'POST',
      url: `/tareas/${tarea.id}/preguntas/${pregunta.id}/responder`,
      headers: { authorization: sesion(cliente.id) },
      payload: { texto: 'Sí, traé la tuya.' },
    });

    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ respuesta: 'Sí, traé la tuya.', publica: true });
  });

  it('un tercero no puede contestar por el que publicó', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador('Beto');
    const otro = await crearTrabajador('Carla');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const pregunta = await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿A qué hora?');

    const r = await app.inject({
      method: 'POST',
      url: `/tareas/${tarea.id}/preguntas/${pregunta.id}/responder`,
      headers: { authorization: sesion(otro.id) },
      payload: { texto: 'A las tres' },
    });

    expect(r.statusCode).toBe(403);
  });
});

describe('guardar un trabajo para después', () => {
  it('es un interruptor y vive en la cuenta, no en el teléfono', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const cabecera = { authorization: sesion(trabajador.id) };

    const guardar = () => app.inject({ method: 'POST', url: `/tareas/${tarea.id}/guardar`, headers: cabecera });
    const listar = () => app.inject({ method: 'GET', url: '/tareas/guardadas', headers: cabecera });

    expect(JSON.parse((await guardar()).body)).toEqual({ guardada: true });
    expect(JSON.parse((await listar()).body)).toEqual({ tareas: [tarea.id] });

    expect(JSON.parse((await guardar()).body)).toEqual({ guardada: false });
    expect(JSON.parse((await listar()).body)).toEqual({ tareas: [] });
  });

  it('cada uno ve los suyos', async () => {
    const cliente = await crearCliente();
    const uno = await crearTrabajador('Beto');
    const otro = await crearTrabajador('Carla');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await app.inject({ method: 'POST', url: `/tareas/${tarea.id}/guardar`, headers: { authorization: sesion(uno.id) } });

    const r = await app.inject({ method: 'GET', url: '/tareas/guardadas', headers: { authorization: sesion(otro.id) } });
    expect(JSON.parse(r.body)).toEqual({ tareas: [] });
  });
});

describe('el detalle de un trabajo', () => {
  it('trae las preguntas y a las personas, para que la app pueda dibujarlas', async () => {
    const cliente = await crearCliente('Ana');
    const trabajador = await crearTrabajador('Beto');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿Hay estacionamiento?');
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    const r = await app.inject({
      method: 'GET',
      url: `/tareas/${tarea.folio}`,
      headers: { authorization: sesion(cliente.id) },
    });

    const detalle = JSON.parse(r.body);
    expect(detalle.preguntas).toHaveLength(1);
    expect(detalle.preguntas[0].texto).toBe('¿Hay estacionamiento?');
    expect(detalle.autor).toMatchObject({ nombre: 'Ana' });
    expect(detalle.trabajador).toMatchObject({ nombre: 'Beto' });
  });

  it('el chat privado no se le muestra a un tercero que mira el aviso', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador('Beto');
    const mirón = await crearTrabajador('Carla');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.mensajear(tarea.id, cliente.id, 'Te dejo la llave con el conserje');

    const parte = JSON.parse(
      (await app.inject({ method: 'GET', url: `/tareas/${tarea.folio}`, headers: { authorization: sesion(trabajador.id) } })).body,
    );
    expect(parte.mensajes).toHaveLength(1);

    const ajeno = JSON.parse(
      (await app.inject({ method: 'GET', url: `/tareas/${tarea.folio}`, headers: { authorization: sesion(mirón.id) } })).body,
    );
    expect(ajeno.mensajes).toEqual([]);
    expect(ajeno.codigoInicio).toBeNull();
  });
});
