import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('preguntas antes de asignar', () => {
  it('no deja pasar un teléfono: ahí empieza el trabajo por fuera', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await expect(
      ctx.tareas.preguntar(tarea.id, trabajador.id, 'Escribime al 9 1234 5678 y lo vemos'),
    ).rejects.toMatchObject({ codigo: 'CONTACTO_POR_FUERA' });

    expect(await prisma.pregunta.count({ where: { tareaId: tarea.id } })).toBe(0);
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { usuarioId: trabajador.id } });
    expect(alerta.nivel).toBe('ALTO');
  });

  it('una pregunta normal pasa sin ruido', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿Hay enchufe cerca del fondo?');

    expect(await prisma.pregunta.count({ where: { tareaId: tarea.id } })).toBe(1);
    expect(await prisma.alerta.count()).toBe(0);
  });
});

describe('el chat de una tarea en curso', () => {
  it('anota el teléfono pero no corta la conversación', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Llamame al 912345678 cuando llegues');

    expect(await prisma.mensaje.count({ where: { tareaId: tarea.id } })).toBe(1);
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { usuarioId: trabajador.id } });
    expect(alerta.estado).toBe('ABIERTA');
    expect(alerta.nivel).toBe('BAJO');
  });

  it('proponer arreglar por fuera pesa más que un número suelto', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    await ctx.tareas.mensajear(
      tarea.id,
      trabajador.id,
      'La próxima lo arreglamos por whatsapp y nos evitamos la comisión',
    );

    const alerta = await prisma.alerta.findFirstOrThrow({ where: { usuarioId: trabajador.id } });
    expect(alerta.puntaje).toBeGreaterThanOrEqual(45);
  });

  it('dos mensajes sospechosos en la misma tarea no hacen dos alertas', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Mi numero es 912345678');
    await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Mejor te transfiero directo a tu cuenta');

    const alertas = await prisma.alerta.findMany({ where: { usuarioId: trabajador.id } });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]!.puntaje).toBeGreaterThan(45);
  });
});

describe('cuentas que se usan entre sí', () => {
  it('levanta la alerta cuando dos cuentas se publican trabajos de ida y vuelta', async () => {
    const ana = await crearTrabajador('Ana');
    const beto = await crearTrabajador('Beto');

    // Diez trabajos entre los dos, cinco con los roles invertidos.
    for (let i = 0; i < 10; i++) {
      const cliente = i % 2 === 0 ? ana : beto;
      const trabajador = i % 2 === 0 ? beto : ana;
      await cerrarTarea(cliente.id, trabajador.id);
    }

    const alertas = await prisma.alerta.findMany({ where: { estado: 'ABIERTA' } });
    const senales = alertas.flatMap((a) => (a.senales as Array<{ senal: string }>).map((s) => s.senal));
    expect(senales).toContain('PAR_RECIPROCO');
    expect(senales).toContain('CLIENTE_UNICO');
  });

  it('un cliente que vuelve a llamar al mismo trabajador no es sospechoso', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();

    await cerrarTarea(cliente.id, trabajador.id);
    await cerrarTarea(cliente.id, trabajador.id);

    expect(await prisma.alerta.count()).toBe(0);
  });
});

describe('la cola de soporte', () => {
  it('ordena por gravedad y se cierra con nombre y fundamento', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const soporte = await crearCliente('Soporte');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Te paso mi numero: 912345678');

    const cola = await ctx.antifraude.pendientes();
    expect(cola.total).toBe(1);

    const resuelta = await ctx.antifraude.resolver(
      cola.alertas[0]!.id,
      soporte.id,
      false,
      'Era para coordinar la llegada, nada raro',
    );

    expect(resuelta.estado).toBe('DESCARTADA');
    expect(resuelta.revisadoPor).toBe(soporte.id);
    expect((await ctx.antifraude.pendientes()).total).toBe(0);
  });

  it('cerrar una alerta sin explicar no se puede', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const soporte = await crearCliente('Soporte');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Mi numero: 912345678');
    const cola = await ctx.antifraude.pendientes();

    await expect(
      ctx.antifraude.resolver(cola.alertas[0]!.id, soporte.id, true, 'sí'),
    ).rejects.toMatchObject({ codigo: 'SIN_FUNDAMENTO' });
  });
});

/**
 * Publica, toma, entrega y confirma una tarea entre dos cuentas, con tiempos
 * creíbles: si se cierra en milisegundos, lo que salta es la tarea relámpago y
 * no lo que este test quiere mirar.
 */
async function cerrarTarea(clienteId: string, trabajadorId: string) {
  const tarea = await ctx.tareas.publicar(clienteId, { ...TAREA_BASE, metodoPago: 'EFECTIVO' });
  await ctx.tareas.aceptar(tarea.id, trabajadorId);
  const ahora = Date.now();
  await prisma.tarea.update({
    where: { id: tarea.id },
    data: {
      publicadaEn: new Date(ahora - 5 * 3600_000),
      asignadaEn: new Date(ahora - 4 * 3600_000),
    },
  });
  await ctx.tareas.cambiarEstado(tarea.id, trabajadorId, 'EN_CAMINO');
  const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
  await ctx.tareas.cambiarEstado(tarea.id, trabajadorId, 'EN_PROGRESO', { codigoInicio: t.codigoInicio! });
  await ctx.tareas.cambiarEstado(tarea.id, trabajadorId, 'ENTREGADA');
  await ctx.tareas.cambiarEstado(tarea.id, clienteId, 'CONFIRMADA');
  return tarea;
}
