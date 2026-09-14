import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { crearServidor } from '../servidor.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, env, limpiar, prisma } from './ayuda.js';

/**
 * Lo que la API le tiene que dar a un cliente para que pueda dibujar una
 * pantalla. Sin esto el muro sale con tarjetas sin nombre y sin calificación,
 * o el cliente termina pidiendo una consulta por tarjeta.
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

describe('el muro', () => {
  it('cada tarjeta trae quién publica, con su nivel y calificación', async () => {
    const cliente = await crearCliente('Ana');
    const trabajador = await crearTrabajador('Beto');
    await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const r = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: sesion(trabajador.id) },
    });

    expect(r.statusCode).toBe(200);
    const { tareas } = JSON.parse(r.body);
    expect(tareas).toHaveLength(1);
    expect(tareas[0].autor).toMatchObject({ nombre: 'Ana', inicial: 'P.' });
    expect(tareas[0]).toMatchObject({ elegible: true, aproximada: true });
    expect(typeof tareas[0].distanciaKm).toBe('number');
    expect(typeof tareas[0].ola).toBe('number');
  });

  it('antes de asignar, la ubicación va corrida: nadie se para en la puerta de nadie', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const r = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: sesion(trabajador.id) },
    });
    const enElMuro = JSON.parse(r.body).tareas[0];

    expect(enElMuro.lat).not.toBe(tarea.lat);
    expect(enElMuro.direccionId).toBeNull();
    // Pero sigue sirviendo para saber si queda cerca: menos de un kilómetro.
    expect(Math.abs(enElMuro.lat - tarea.lat)).toBeLessThan(0.01);
  });

  it('no expone el código de inicio de una tarea ajena', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const r = await app.inject({
      method: 'GET',
      url: '/feed',
      headers: { authorization: sesion(trabajador.id) },
    });
    const enElMuro = JSON.parse(r.body).tareas[0];
    // El código lo dicta el cliente en la puerta: en el muro no tiene nada que hacer.
    expect(enElMuro.codigoInicio).toBeFalsy();
  });
});

describe('mis tareas', () => {
  it('junta las que publiqué y las que estoy haciendo, y dice de qué lado estoy', async () => {
    const cliente = await crearCliente('Ana');
    const trabajador = await crearTrabajador('Beto');
    const propia = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const ajena = await ctx.tareas.publicar(trabajador.id, { ...TAREA_BASE, titulo: 'Pintar el living' });
    await ctx.tareas.aceptar(ajena.id, cliente.id).catch(() => undefined);

    const r = await app.inject({
      method: 'GET',
      url: '/tareas/mias',
      headers: { authorization: sesion(cliente.id) },
    });

    const { tareas } = JSON.parse(r.body);
    const folios = tareas.map((t: { folio: string }) => t.folio);
    expect(folios).toContain(propia.folio);
    const mia = tareas.find((t: { folio: string }) => t.folio === propia.folio);
    expect(mia.miRol).toBe('CLIENTE');
    expect(mia.autor).toMatchObject({ nombre: 'Ana' });
  });

  it('en lo mío sí va la dirección exacta: hay que poder llegar', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const r = await app.inject({
      method: 'GET',
      url: '/tareas/mias',
      headers: { authorization: sesion(cliente.id) },
    });
    const mia = JSON.parse(r.body).tareas.find((t: { folio: string }) => t.folio === tarea.folio);

    expect(mia.lat).toBe(tarea.lat);
    expect(mia.aproximada).toBeUndefined();
  });

  it('"mias" no se confunde con un folio', async () => {
    const cliente = await crearCliente();
    const r = await app.inject({
      method: 'GET',
      url: '/tareas/mias',
      headers: { authorization: sesion(cliente.id) },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toHaveProperty('tareas');
  });

  it('sin sesión no se ve nada', async () => {
    const r = await app.inject({ method: 'GET', url: '/tareas/mias' });
    expect(r.statusCode).toBe(401);
  });
});

describe('el catálogo que consume la app', () => {
  it('trae la categoría y si pide título, para armar las tres solapas', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo' });
    const { rubros } = JSON.parse(r.body);

    const jardin = rubros.find((x: { slug: string }) => x.slug === 'jardineria-corte-pasto');
    expect(jardin).toMatchObject({ categoria: 'UNO', requiereTitulo: false, comisionBase: 0.15 });
    const ingenieria = rubros.find((x: { slug: string }) => x.slug === 'ingenieria-civil');
    expect(ingenieria).toMatchObject({ categoria: 'ESPECIALIZADOS', requiereTitulo: true });
  });
});

describe('mirar una tarea por su folio', () => {
  it('las partes ven la dirección y el código; un tercero no', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const curioso = await crearTrabajador('Curioso');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    const comoParte = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/tareas/${tarea.folio}`,
        headers: { authorization: sesion(trabajador.id) },
      })).body,
    );
    expect(comoParte.codigoInicio).toMatch(/^\d{4}$/);
    expect(comoParte.lat).toBe(tarea.lat);

    const comoTercero = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/tareas/${tarea.folio}`,
        headers: { authorization: sesion(curioso.id) },
      })).body,
    );
    expect(comoTercero.codigoInicio).toBeNull();
    expect(comoTercero.lat).not.toBe(tarea.lat);
    expect(comoTercero.aproximada).toBe(true);
  });

  it('soporte ve todo: para eso está', async () => {
    const cliente = await crearCliente();
    const soporte = await crearCliente('Soporte');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const r = await app.inject({
      method: 'GET',
      url: `/tareas/${tarea.folio}`,
      headers: { authorization: sesion(soporte.id, ['CLIENTE', 'SOPORTE']) },
    });
    expect(JSON.parse(r.body).codigoInicio).toMatch(/^\d{4}$/);
  });
});

describe('las puertas', () => {
  /**
   * Una ruta privada que se escapa del bloque con sesión no se nota escribiendo
   * la funcionalidad: se nota el día que alguien la encuentra. Esta lista es el
   * candado, y crece cada vez que se agrega una ruta.
   */
  const PRIVADAS: Array<[string, string]> = [
    ['GET', '/yo'],
    ['GET', '/feed'],
    ['GET', '/tareas/mias'],
    ['GET', '/saldo'],
    ['GET', '/retiros'],
    ['GET', '/deudas'],
    ['GET', '/soporte/bandeja'],
    ['GET', '/soporte/alertas'],
    ['GET', '/soporte/retiros'],
    ['POST', '/tareas'],
    ['POST', '/identidad'],
    ['POST', '/avisos/suscribir'],
    ['POST', '/avisos/baja'],
    ['POST', '/deudas/pagar'],
    ['POST', '/retiros'],
    ['PUT', '/retiros/banco'],
    ['PUT', '/deudas/tarjeta'],
    ['GET', '/perfil'],
    ['PUT', '/perfil'],
    ['POST', '/perfil/disponibilidad'],
  ];

  it.each(PRIVADAS)('sin sesión, %s %s responde 401', async (metodo, url) => {
    const r = await app.inject({ method: metodo as 'GET', url, payload: metodo === 'GET' ? undefined : {} });
    expect(r.statusCode).toBe(401);
  });

  const PUBLICAS: Array<[string, string]> = [
    ['GET', '/salud'],
    ['GET', '/catalogo'],
    ['GET', '/avisos/clave'],
  ];

  it.each(PUBLICAS)('sin sesión, %s %s se puede ver', async (metodo, url) => {
    const r = await app.inject({ method: metodo as 'GET', url });
    expect(r.statusCode).toBe(200);
  });

  it('soporte no se abre con una sesión cualquiera', async () => {
    const cualquiera = await crearCliente();
    const r = await app.inject({
      method: 'GET',
      url: '/soporte/bandeja',
      headers: { authorization: sesion(cualquiera.id, ['CLIENTE']) },
    });
    expect(r.statusCode).toBe(403);
  });
});
