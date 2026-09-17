import { afterEach, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

/** Los avisos que "salieron", sin tocar la red. */
let enviados: Array<{ endpoint: string; aviso: { titulo: string; cuerpo: string; etiqueta?: string } }>;

beforeEach(async () => {
  await limpiar();
  enviados = [];
  vi.spyOn(webpush, 'sendNotification').mockImplementation(
    async (suscripcion: { endpoint: string }, carga?: string | Buffer) => {
      enviados.push({ endpoint: suscripcion.endpoint, aviso: JSON.parse(String(carga)) });
      return { statusCode: 201, body: '', headers: {} };
    },
  );
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.$disconnect();
});

const SUSCRIPCION = (n: number) => ({
  endpoint: `https://push.ejemplo.cl/d/${n}`,
  claves: { p256dh: 'BPa'.padEnd(20, 'x'), auth: 'auth1234' },
});

describe('suscribirse a los avisos', () => {
  it('guarda el dispositivo y volver a suscribirse no lo duplica', async () => {
    const trabajador = await crearTrabajador();

    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(1));
    await ctx.avisos.suscribir(trabajador.id, { ...SUSCRIPCION(1), agente: 'Android' });

    const guardadas = await prisma.suscripcionPush.findMany({ where: { usuarioId: trabajador.id } });
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]!.agente).toBe('Android');
  });

  it('una persona puede tener el teléfono y la computadora', async () => {
    const trabajador = await crearTrabajador();
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(1));
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(2));

    expect(await ctx.avisos.enviar(trabajador.id, { titulo: 'Hola', cuerpo: 'Che' })).toBe(2);
    expect(enviados).toHaveLength(2);
  });

  it('darse de baja saca ese dispositivo y deja los otros', async () => {
    const trabajador = await crearTrabajador();
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(1));
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(2));

    await ctx.avisos.desuscribir(trabajador.id, SUSCRIPCION(1).endpoint);

    expect(await prisma.suscripcionPush.count({ where: { usuarioId: trabajador.id } })).toBe(1);
  });
});

describe('el radar avisa por olas', () => {
  /** Tres trabajadores de distinto nivel, todos cerca y todos suscriptos. */
  async function equipo() {
    const cliente = await crearCliente();
    const oro = await crearTrabajador('Oro', { nivel: 'ORO', lat: TAREA_BASE.lat, lng: TAREA_BASE.lng });
    const plata = await crearTrabajador('Plata', {
      nivel: 'PLATA',
      lat: TAREA_BASE.lat,
      lng: TAREA_BASE.lng,
    });
    const nuevo = await crearTrabajador('Nuevo', {
      nivel: 'NUEVO',
      lat: TAREA_BASE.lat,
      lng: TAREA_BASE.lng,
    });
    let n = 0;
    for (const t of [oro, plata, nuevo]) await ctx.avisos.suscribir(t.id, SUSCRIPCION(++n));
    return { cliente, oro, plata, nuevo };
  }

  it('la primera ola despierta sólo a los de nivel alto', async () => {
    const { cliente, oro } = await equipo();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const resumen = await ctx.avisos.anunciarOlas();

    expect(resumen).toMatchObject({ tareas: 1, avisos: 1 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.aviso.titulo).toBe(TAREA_BASE.titulo);
    const suscripcion = await prisma.suscripcionPush.findFirstOrThrow({ where: { usuarioId: oro.id } });
    expect(enviados[0]!.endpoint).toBe(suscripcion.endpoint);
  });

  it('cuando se abre la ola siguiente, avisa a los que recién entran', async () => {
    const { cliente } = await equipo();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.avisos.anunciarOlas();
    enviados = [];

    // Dos minutos después: se abrió la ola de PLATA.
    await ctx.avisos.anunciarOlas(new Date(Date.now() + 120_000));

    expect(enviados).toHaveLength(1);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(t.olaAvisada).toBe(1);
  });

  it('nadie recibe dos avisos de la misma tarea', async () => {
    const { cliente } = await equipo();
    await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.avisos.anunciarOlas();
    await ctx.avisos.anunciarOlas(new Date(Date.now() + 120_000));
    await ctx.avisos.anunciarOlas(new Date(Date.now() + 20 * 60_000));

    const porDestino = new Map<string, number>();
    for (const e of enviados) porDestino.set(e.endpoint, (porDestino.get(e.endpoint) ?? 0) + 1);
    expect([...porDestino.values()].every((n) => n === 1)).toBe(true);
    expect(enviados).toHaveLength(3);
  });

  it('correr el reloj dos veces no avisa dos veces', async () => {
    const { cliente } = await equipo();
    await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.avisos.anunciarOlas();
    const segunda = await ctx.avisos.anunciarOlas();

    expect(segunda).toMatchObject({ tareas: 0, avisos: 0 });
    expect(enviados).toHaveLength(1);
  });

  it('al autor no se le avisa de su propia tarea', async () => {
    const autor = await crearTrabajador('Autor', {
      nivel: 'ORO',
      lat: TAREA_BASE.lat,
      lng: TAREA_BASE.lng,
    });
    await ctx.avisos.suscribir(autor.id, SUSCRIPCION(9));
    await ctx.tareas.publicar(autor.id, TAREA_BASE);

    await ctx.avisos.anunciarOlas();

    expect(enviados).toHaveLength(0);
  });

  it('no despierta al que está lejos hasta que el radio crece', async () => {
    const cliente = await crearCliente();
    // 20 km al norte: fuera de la primera ola (8 km), dentro de la tercera (25).
    const lejos = await crearTrabajador('Lejos', {
      nivel: 'ORO',
      lat: TAREA_BASE.lat + 20 / 111.32,
      lng: TAREA_BASE.lng,
    });
    await ctx.avisos.suscribir(lejos.id, SUSCRIPCION(5));
    await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.avisos.anunciarOlas();
    expect(enviados).toHaveLength(0);

    await ctx.avisos.anunciarOlas(new Date(Date.now() + 10 * 60_000));
    expect(enviados).toHaveLength(1);
  });
});

describe('suscripciones que ya no existen', () => {
  it('el 410 del navegador la borra sola', async () => {
    const trabajador = await crearTrabajador();
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(1));
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );

    expect(await ctx.avisos.enviar(trabajador.id, { titulo: 'x', cuerpo: 'y' })).toBe(0);

    expect(await prisma.suscripcionPush.count({ where: { usuarioId: trabajador.id } })).toBe(0);
  });

  it('un error pasajero no la borra, pero cinco seguidos sí', async () => {
    const trabajador = await crearTrabajador();
    await ctx.avisos.suscribir(trabajador.id, SUSCRIPCION(1));
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      Object.assign(new Error('Service unavailable'), { statusCode: 503 }),
    );

    await ctx.avisos.enviar(trabajador.id, { titulo: 'x', cuerpo: 'y' });
    expect(await prisma.suscripcionPush.count({ where: { usuarioId: trabajador.id } })).toBe(1);

    for (let i = 0; i < 4; i++) await ctx.avisos.enviar(trabajador.id, { titulo: 'x', cuerpo: 'y' });
    expect(await prisma.suscripcionPush.count({ where: { usuarioId: trabajador.id } })).toBe(0);
  });
});

describe('la app instalable', () => {
  it('se sirve desde el mismo dominio que la API, que es lo que exige el push', async () => {
    const { crearServidor } = await import('../servidor.js');
    const { env } = await import('./ayuda.js');
    const app = await crearServidor(ctx, { ...env, WEB_DIR: '../../apps/web/dist' });
    try {
      const portada = await app.inject({ method: 'GET', url: '/' });
      expect(portada.statusCode).toBe(200);
      expect(portada.body).toContain('manifest.webmanifest');

      const manifiesto = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
      expect(JSON.parse(manifiesto.body)).toMatchObject({ name: 'Tareas', display: 'standalone' });

      const sw = await app.inject({ method: 'GET', url: '/sw.js' });
      expect(sw.statusCode).toBe(200);
      expect(sw.body).toContain("addEventListener('push'");

      // Una dirección de la app recarga la app, no un 404.
      const adentro = await app.inject({ method: 'GET', url: '/tarea/TQ-260914-A1B2' });
      expect(adentro.statusCode).toBe(200);
      expect(adentro.body).toContain('<title>Tareas</title>');

      // Pero un endpoint que no existe sigue siendo un 404 con su código.
      const inexistente = await app.inject({
        method: 'GET',
        url: '/no-existe',
        headers: { accept: 'application/json' },
      });
      expect(inexistente.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('la clave de los avisos es pública: el navegador la necesita', async () => {
    const { crearServidor } = await import('../servidor.js');
    const { env, VAPID_PRUEBA } = await import('./ayuda.js');
    const app = await crearServidor(ctx, env);
    try {
      const r = await app.inject({ method: 'GET', url: '/avisos/clave' });
      expect(JSON.parse(r.body)).toEqual({ activo: true, clavePublica: VAPID_PRUEBA.publicKey });
    } finally {
      await app.close();
    }
  });
});

/**
 * La campana.
 *
 * El push llega sólo a los teléfonos suscriptos. Quien no dio permiso —o entra
 * desde otro aparato— no se enteraba nunca de nada: ni de que le tomaron el
 * trabajo, ni de que el otro iba en camino. La app tenía una campana y la
 * campana estaba siempre vacía.
 */
describe('los avisos quedan guardados, no sólo empujados', () => {
  it('se anotan aunque no haya ningún teléfono suscripto', async () => {
    const cliente = await crearCliente('Ana');
    await ctx.avisos.enviar(cliente.id, { titulo: 'Hola', cuerpo: 'Un aviso' });

    const { avisos, sinLeer } = await ctx.avisos.mios(cliente.id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ titulo: 'Hola', cuerpo: 'Un aviso', leido: false });
    expect(sinLeer).toBe(1);
  });

  it('abrir la campana los marca leídos', async () => {
    const cliente = await crearCliente();
    await ctx.avisos.enviar(cliente.id, { titulo: 'Uno', cuerpo: 'a' });
    await ctx.avisos.enviar(cliente.id, { titulo: 'Dos', cuerpo: 'b' });

    expect((await ctx.avisos.mios(cliente.id)).sinLeer).toBe(2);
    expect(await ctx.avisos.marcarLeidos(cliente.id)).toEqual({ leidos: 2 });
    expect((await ctx.avisos.mios(cliente.id)).sinLeer).toBe(0);
  });

  it('cada uno ve los suyos', async () => {
    const uno = await crearCliente('Ana');
    const otro = await crearCliente('Berta');
    await ctx.avisos.enviar(uno.id, { titulo: 'Para Ana', cuerpo: 'x' });

    expect((await ctx.avisos.mios(otro.id)).avisos).toHaveLength(0);
  });
});

describe('cuando algo se mueve, la otra parte se entera', () => {
  it('al cliente le avisan que le tomaron el trabajo, con el código', async () => {
    const cliente = await crearCliente('Ana');
    const trabajador = await crearTrabajador('Beto');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    // El aviso se dispara sin esperar, para no trabar la operación.
    await new Promise((listo) => setTimeout(listo, 50));

    const { avisos } = await ctx.avisos.mios(cliente.id);
    expect(avisos[0]?.titulo).toBe('Te tomaron el trabajo');
    expect(avisos[0]?.cuerpo).toContain('Beto');
    expect(avisos[0]?.cuerpo).toContain(tarea.codigoInicio);
    expect(avisos[0]?.tareaId).toBe(tarea.id);
  });

  it('el aviso va a quien no apretó el botón', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.avisos.marcarLeidos(cliente.id);

    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
    await new Promise((listo) => setTimeout(listo, 50));

    expect((await ctx.avisos.mios(cliente.id)).avisos[0]?.titulo).toBe('Van en camino');
    // Y el que lo apretó no se avisa a sí mismo.
    expect((await ctx.avisos.mios(trabajador.id)).avisos).toHaveLength(0);
  });

  it('el trabajador se entera de que le confirmaron el trabajo', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', {
      codigoInicio: tarea.codigoInicio,
    });
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
    await ctx.tareas.cambiarEstado(tarea.id, cliente.id, 'CONFIRMADA');
    await new Promise((listo) => setTimeout(listo, 50));

    const titulos = (await ctx.avisos.mios(trabajador.id)).avisos.map((a) => a.titulo);
    expect(titulos).toContain('Confirmaron el trabajo');
  });
});
