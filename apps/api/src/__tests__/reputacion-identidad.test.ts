import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { descifrar } from '../lib/cifrado.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, env, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

/** Deja una tarea entregada, lista para que las dos partes se califiquen. */
async function tareaEntregada(nivelTrabajador: 'NUEVO' | 'ORO' = 'ORO') {
  const cliente = await crearCliente();
  const trabajador = await crearTrabajador('Trabajador', { nivel: nivelTrabajador });
  const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
  await prisma.tarea.update({
    where: { id: tarea.id },
    data: { publicadaEn: new Date(Date.now() - 20 * 60 * 1000) },
  });
  await ctx.tareas.aceptar(tarea.id, trabajador.id);
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
  const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', { codigoInicio: t.codigoInicio! });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
  return { cliente, trabajador, tarea };
}

describe('calificaciones', () => {
  it('no se puede calificar un trabajo que todavía no se entregó', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await expect(ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 5 })).rejects.toThrow(
      /entregado/,
    );
  });

  it('la nota queda oculta hasta que la otra parte también califica', async () => {
    const { cliente, trabajador, tarea } = await tareaEntregada();

    await ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 5, puntual: true });
    let notas = await prisma.calificacion.findMany({ where: { tareaId: tarea.id } });
    expect(notas).toHaveLength(1);
    expect(notas[0]!.visible).toBe(false);

    await ctx.calificaciones.calificar(tarea.id, trabajador.id, { estrellas: 4 });
    notas = await prisma.calificacion.findMany({ where: { tareaId: tarea.id } });
    expect(notas).toHaveLength(2);
    expect(notas.every((n) => n.visible)).toBe(true);
  });

  it('nadie califica dos veces la misma tarea', async () => {
    const { cliente, tarea } = await tareaEntregada();
    await ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 5 });
    await expect(ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 1 })).rejects.toThrow(
      /Ya calificaste/,
    );
  });

  it('una sola nota perfecta no dispara la reputación', async () => {
    const { cliente, trabajador, tarea } = await tareaEntregada('NUEVO');
    await ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 5, puntual: true });

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.cantidadCalificaciones).toBe(1);
    expect(perfil.calificacion).toBeLessThan(4.5);
  });

  it('publica las notas que quedaron esperando más de una semana', async () => {
    const { cliente, tarea } = await tareaEntregada();
    const nota = await ctx.calificaciones.calificar(tarea.id, cliente.id, { estrellas: 5 });
    await prisma.calificacion.update({
      where: { id: nota.id },
      data: { creadoEn: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    expect(await ctx.calificaciones.liberarVencidas()).toBe(1);
    const actualizada = await prisma.calificacion.findUniqueOrThrow({ where: { id: nota.id } });
    expect(actualizada.visible).toBe(true);
  });
});

describe('verificación de identidad', () => {
  const documento = {
    tipoDocumento: 'CEDULA' as const,
    numero: '12.345.678',
    paisEmision: 'ar',
    nombreLegal: 'Ana Pérez',
    fechaNacimiento: new Date('1990-05-20'),
  };

  it('guarda el documento cifrado y sólo muestra los últimos 4 dígitos', async () => {
    const usuario = await crearCliente();
    const vista = await ctx.identidad.registrar(usuario.id, documento).then(() => ctx.identidad.ver(usuario.id));

    expect(vista).toMatchObject({ estado: 'EN_REVISION', documento: '••••5678', paisEmision: 'AR' });
    const fila = await prisma.identidad.findUniqueOrThrow({ where: { usuarioId: usuario.id } });
    expect(fila.numeroCifrado).not.toContain('12345678');
    expect(descifrar(fila.numeroCifrado, env.KYC_ENCRYPTION_KEY)).toBe('12345678');
  });

  it('no deja usar el mismo documento en dos cuentas', async () => {
    const uno = await crearCliente('Ana');
    const otro = await crearCliente('Clon');
    await ctx.identidad.registrar(uno.id, documento);
    // El mismo número escrito distinto tiene que chocar igual.
    await expect(ctx.identidad.registrar(otro.id, { ...documento, numero: '12345678' })).rejects.toThrow(
      /ya está registrado/,
    );
  });

  it('rechaza menores de edad', async () => {
    const usuario = await crearCliente();
    await expect(
      ctx.identidad.registrar(usuario.id, { ...documento, fechaNacimiento: new Date() }),
    ).rejects.toThrow(/18 años/);
  });

  it('sin identidad verificada no se pueden tomar trabajos', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador('Sin verificar', { identidadVerificada: false });
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await expect(ctx.tareas.aceptar(tarea.id, trabajador.id)).rejects.toThrow(/documento de identidad/);
  });

  it('soporte aprueba y el trabajador queda habilitado', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador('Recién llegado', { identidadVerificada: false });
    const soporte = await crearCliente('Soporte');
    await ctx.identidad.registrar(trabajador.id, { ...documento, numero: '98765432' });
    await ctx.identidad.resolver(trabajador.id, true, soporte.id);

    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const tomada = await ctx.tareas.aceptar(tarea.id, trabajador.id);
    expect(tomada.trabajadorId).toBe(trabajador.id);
  });
});

describe('verificación de teléfono', () => {
  it('el código llega, se usa una sola vez y no sirve dos veces', async () => {
    const telefono = '+5491155667788';
    await ctx.otp.enviar(telefono);
    const codigo = ctx.enviador.enviados.at(-1)!.texto.match(/\d{6}/)![0];

    expect(await ctx.otp.verificar(telefono, '000000')).toBe(false);
    expect(await ctx.otp.verificar(telefono, codigo)).toBe(true);
    await expect(ctx.otp.verificar(telefono, codigo)).rejects.toThrow(/venció/);
  });

  it('corta el envío en cadena de códigos', async () => {
    const telefono = '+5491155667799';
    for (let i = 0; i < 5; i++) await ctx.otp.enviar(telefono);
    await expect(ctx.otp.enviar(telefono)).rejects.toThrow(/muchos códigos/);
  });
});
