import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HORAS_PARA_CONFIRMAR, DIAS_RESERVA_MAXIMA } from '../modulos/reloj/planificador.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

/** Lleva una tarea hasta entregada, que es donde empieza a correr el reloj. */
async function tareaEntregada() {
  const cliente = await crearCliente();
  const trabajador = await crearTrabajador();
  const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
  await ctx.tareas.aceptar(tarea.id, trabajador.id);
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
  const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', { codigoInicio: t.codigoInicio! });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
  return { cliente, trabajador, tareaId: tarea.id };
}

describe('el silencio del cliente no deja a nadie sin cobrar', () => {
  it('a las 24 horas confirma sola y le paga al trabajador', async () => {
    const { trabajador, tareaId } = await tareaEntregada();
    await prisma.tarea.update({
      where: { id: tareaId },
      data: { entregadaEn: new Date(Date.now() - (HORAS_PARA_CONFIRMAR + 1) * 3600_000) },
    });

    const resumen = await ctx.reloj.correr();

    expect(resumen.confirmadas).toBe(1);
    expect(resumen.errores).toEqual([]);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
    expect(t.estado).toBe('PAGADA');
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(2610);
  });

  it('antes de las 24 horas no toca nada', async () => {
    const { tareaId } = await tareaEntregada();
    await prisma.tarea.update({
      where: { id: tareaId },
      data: { entregadaEn: new Date(Date.now() - 2 * 3600_000) },
    });

    const resumen = await ctx.reloj.correr();

    expect(resumen.confirmadas).toBe(0);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
    expect(t.estado).toBe('ENTREGADA');
  });

  it('correr el reloj dos veces no paga dos veces', async () => {
    const { tareaId } = await tareaEntregada();
    await prisma.tarea.update({
      where: { id: tareaId },
      data: { entregadaEn: new Date(Date.now() - 48 * 3600_000) },
    });

    await ctx.reloj.correr();
    const segunda = await ctx.reloj.correr();

    expect(segunda.confirmadas).toBe(0);
    expect(await prisma.movimientoSaldo.count({ where: { tareaId } })).toBe(1);
  });
});

describe('tareas que nadie tomó', () => {
  it('se cierran y le devuelven la reserva al cliente', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const pagoInicial = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    await prisma.tarea.update({
      where: { id: tarea.id },
      data: { expiraEn: new Date(Date.now() - 60_000) },
    });

    const resumen = await ctx.reloj.correr();

    expect(resumen.expiradas).toBe(1);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(t.estado).toBe('EXPIRADA');
    // La plata del cliente no puede quedar bloqueada por una tarea muerta.
    expect(ctx.pasarela.retenciones.get(pagoInicial.referencia!)?.estado).toBe('LIBERADO');
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('REEMBOLSADO');
  });

  it('una tarea vigente sigue en el radar', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    const resumen = await ctx.reloj.correr();

    expect(resumen.expiradas).toBe(0);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(t.estado).toBe('PUBLICADA');
  });
});

describe('reservas que el banco va a caducar', () => {
  it('se liberan antes de que venzan y la tarea se cancela', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await prisma.pago.update({
      where: { tareaId: tarea.id },
      data: { retenidoEn: new Date(Date.now() - (DIAS_RESERVA_MAXIMA + 1) * 24 * 3600_000) },
    });

    const resumen = await ctx.reloj.correr();

    expect(resumen.reservasLiberadas).toBe(1);
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(t.estado).toBe('CANCELADA');
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('REEMBOLSADO');
  });
});

describe('calificaciones a ciegas', () => {
  it('se publican solas cuando la otra parte nunca califica', async () => {
    const { cliente, tareaId } = await tareaEntregada();
    const nota = await ctx.calificaciones.calificar(tareaId, cliente.id, { estrellas: 5 });
    expect(nota.visible).toBe(false);

    await prisma.calificacion.update({
      where: { id: nota.id },
      data: { creadoEn: new Date(Date.now() - 8 * 24 * 3600_000) },
    });
    const resumen = await ctx.reloj.correr();

    expect(resumen.calificacionesLiberadas).toBe(1);
    const actualizada = await prisma.calificacion.findUniqueOrThrow({ where: { id: nota.id } });
    expect(actualizada.visible).toBe(true);
  });
});

describe('deuda de comisiones en efectivo', () => {
  it('el reloj le cobra al que trabajó en efectivo y dejó tarjeta', async () => {
    const trabajador = await crearTrabajador('Deudor', { saldo: -4_000 });
    await prisma.perfilTrabajador.update({
      where: { usuarioId: trabajador.id },
      data: { medioPagoToken: 'tok_ok_4242' },
    });

    const resumen = await ctx.reloj.correr();

    expect(resumen.deudasCobradas).toBe(1);
    expect(resumen.deudasCobradasMonto).toBe(4_000);
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.saldo).toBe(0);
  });
});
