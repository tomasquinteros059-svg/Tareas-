import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cotizar } from '@tareas/domain';
import { ErrorApi } from '../lib/errores.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('publicar una tarea', () => {
  it('rechaza un presupuesto por debajo del mínimo del rubro', async () => {
    const cliente = await crearCliente();
    const error = await ctx.tareas
      .publicar(cliente.id, { ...TAREA_BASE, presupuesto: 500 })
      .catch((e: ErrorApi) => e);

    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).codigo).toBe('PRESUPUESTO_INSUFICIENTE');
    expect((error as ErrorApi).detalle).toMatchObject({ minimo: 2400 });
    expect(await prisma.tarea.count()).toBe(0);
  });

  it('retiene los fondos del cliente antes de mostrar la tarea', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    expect(tarea.estado).toBe('PUBLICADA');
    expect(tarea.folio).toMatch(/^TQ-\d{6}-[A-Z0-9]{4}$/);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('RETENIDO');
    // 3000 de la tarea + 5% de cargo de servicio.
    expect(pago.totalCliente).toBe(3150);
    expect(ctx.pasarela.retenciones.get(pago.referencia!)).toMatchObject({ estado: 'RETENIDO' });
  });

  it('no publica nada si la tarjeta se rechaza', async () => {
    const cliente = await crearCliente();
    await expect(
      ctx.tareas.publicar(cliente.id, { ...TAREA_BASE, metodoPagoToken: 'tok_rechazada' }),
    ).rejects.toThrow(/rechazada/);
    expect(await prisma.tarea.count()).toBe(0);
  });

  it('en efectivo no retiene nada: el pago va en la mano', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, {
      ...TAREA_BASE,
      metodoPago: 'EFECTIVO',
      metodoPagoToken: undefined,
    });
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('PENDIENTE');
    expect(pago.referencia).toBeNull();
  });

  it('guarda el mínimo calculado como prueba de que el precio era legítimo', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const esperado = cotizar({
      rubroSlug: TAREA_BASE.rubroSlug,
      unidades: TAREA_BASE.unidades,
      dificultad: TAREA_BASE.dificultad,
      urgencia: TAREA_BASE.urgencia,
      nivelMinimo: TAREA_BASE.nivelMinimo,
    }).minimo;
    expect(tarea.minimoCalculado).toBe(esperado);
  });
});

describe('tomar la tarea (primero que llega, se la lleva)', () => {
  it('cuando dos aceptan a la vez, gana uno solo', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const trabajadores = await Promise.all([
      crearTrabajador('Uno'),
      crearTrabajador('Dos'),
      crearTrabajador('Tres'),
      crearTrabajador('Cuatro'),
    ]);

    const resultados = await Promise.allSettled(
      trabajadores.map((t) => ctx.tareas.aceptar(tarea.id, t.id)),
    );
    const ganadores = resultados.filter((r) => r.status === 'fulfilled');
    const perdedores = resultados.filter((r) => r.status === 'rejected');

    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(3);
    for (const p of perdedores) {
      expect((p as PromiseRejectedResult).reason.codigo).toBe('TAREA_YA_TOMADA');
    }

    const final = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    expect(final.estado).toBe('ASIGNADA');
    expect(trabajadores.map((t) => t.id)).toContain(final.trabajadorId);
  });

  it('deja rastro de la ola y la distancia con la que se tomó', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const trabajador = await crearTrabajador();
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    const evento = await prisma.eventoTarea.findFirstOrThrow({
      where: { tareaId: tarea.id, hacia: 'ASIGNADA' },
    });
    expect(evento.actorRol).toBe('TRABAJADOR');
    expect(evento.datos).toMatchObject({ ola: 0 });
  });

  it('no deja tomarla a quien no tiene la matrícula del rubro', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, {
      ...TAREA_BASE,
      rubroSlug: 'electricidad',
      unidades: 2,
      dificultad: 'ALTA',
      presupuesto: 10000,
    });
    const sinMatricula = await crearTrabajador('Sin matrícula', { rubros: ['electricidad'] });
    await expect(ctx.tareas.aceptar(tarea.id, sinMatricula.id)).rejects.toThrow(/matrícula/);

    const conMatricula = await crearTrabajador('Con matrícula', {
      rubros: ['electricidad'],
      licencias: ['electricidad'],
    });
    const tomada = await ctx.tareas.aceptar(tarea.id, conMatricula.id);
    expect(tomada.trabajadorId).toBe(conMatricula.id);
  });

  it('no deja tomar trabajos a quien debe comisiones de efectivo', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const endeudado = await crearTrabajador('Endeudado', { saldo: -6000 });
    await expect(ctx.tareas.aceptar(tarea.id, endeudado.id)).rejects.toThrow(/comisiones/);
  });

  it('el autor no puede tomar su propia tarea', async () => {
    const cliente = await crearTrabajador('Vivo');
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await expect(ctx.tareas.aceptar(tarea.id, cliente.id)).rejects.toThrow(/AUTOR_NO_PUEDE_TOMAR/);
  });
});

describe('ciclo completo con tarjeta', () => {
  it('de publicada a pagada, acreditando el neto al trabajador', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');

    const conCodigo = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    await expect(
      ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', { codigoInicio: '0000' }),
    ).rejects.toThrow(/código de inicio/);

    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', {
      codigoInicio: conCodigo.codigoInicio!,
    });
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
    const pagada = await ctx.tareas.cambiarEstado(tarea.id, cliente.id, 'CONFIRMADA');

    expect(pagada.estado).toBe('PAGADA');
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('CAPTURADO');
    // Trabajador ORO en jardinería: 15% - 2% = 13% de comisión sobre 3000.
    expect(pago.comision).toBe(390);
    expect(pago.netoTrabajador).toBe(2610);

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(2610);
    expect(perfil.trabajosCompletados).toBe(61);

    const movimiento = await prisma.movimientoSaldo.findFirstOrThrow({ where: { tareaId: tarea.id } });
    expect(movimiento.tipo).toBe('ACREDITACION_TRABAJO');
    expect(movimiento.saldoResultante).toBe(2610);
  });

  it('libera la retención si el cliente cancela antes de que salga el trabajador', async () => {
    const cliente = await crearCliente();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    const pagoInicial = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });

    await ctx.tareas.cambiarEstado(tarea.id, cliente.id, 'CANCELADA', { nota: 'Ya no lo necesito' });

    expect(ctx.pasarela.retenciones.get(pagoInicial.referencia!)?.estado).toBe('LIBERADO');
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('REEMBOLSADO');
  });

  it('si el trabajador se baja, la tarea vuelve a la fila y le queda la cancelación', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    const devuelta = await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'PUBLICADA');
    expect(devuelta.estado).toBe('PUBLICADA');
    expect(devuelta.trabajadorId).toBeNull();

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.trabajosCancelados).toBe(1);

    // Y otro la puede tomar.
    const otro = await crearTrabajador('Suplente');
    const retomada = await ctx.tareas.aceptar(tarea.id, otro.id);
    expect(retomada.trabajadorId).toBe(otro.id);
  });

  it('nadie puede saltarse la máquina de estados', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await ctx.tareas.aceptar(tarea.id, trabajador.id);

    // El trabajador no puede darse por confirmado a sí mismo.
    await expect(ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'CONFIRMADA')).rejects.toThrow(
      /No se puede pasar/,
    );
    // Un tercero no participa de la tarea.
    const ajeno = await crearTrabajador('Ajeno');
    await expect(ctx.tareas.cambiarEstado(tarea.id, ajeno.id, 'EN_CAMINO')).rejects.toThrow(/No participás/);
  });
});

describe('ciclo en efectivo', () => {
  it('el trabajador cobra en la mano y le queda la comisión como deuda', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador('Efectivo', { nivel: 'BRONCE' });
    const tarea = await ctx.tareas.publicar(cliente.id, {
      ...TAREA_BASE,
      presupuesto: 4000,
      metodoPago: 'EFECTIVO',
      metodoPagoToken: undefined,
    });
    // Un BRONCE no la ve en la primera ola: recién se le abre pasados los minutos.
    await expect(ctx.tareas.aceptar(tarea.id, trabajador.id)).rejects.toThrow(/Se abre para tu nivel/);
    await prisma.tarea.update({
      where: { id: tarea.id },
      data: { publicadaEn: new Date(Date.now() - 10 * 60 * 1000) },
    });

    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', { codigoInicio: t.codigoInicio! });
    await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
    await ctx.tareas.cambiarEstado(tarea.id, cliente.id, 'CONFIRMADA');

    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId: tarea.id } });
    expect(pago.estado).toBe('EN_MANO');
    expect(pago.totalCliente).toBe(0);

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    // 15% de comisión + 5% de cargo de servicio sobre 4000.
    expect(perfil.saldo).toBe(-800);

    const movimiento = await prisma.movimientoSaldo.findFirstOrThrow({ where: { tareaId: tarea.id } });
    expect(movimiento.tipo).toBe('DEUDA_COMISION_EFECTIVO');
  });
});

describe('preguntas y chat', () => {
  it('limita las preguntas por trabajador para que no se arme un hilo', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿Hay que llevar bolsas para los residuos?');
    await ctx.tareas.preguntar(tarea.id, trabajador.id, '¿El portón entra la máquina grande?');
    await expect(ctx.tareas.preguntar(tarea.id, trabajador.id, '¿Y a qué hora?')).rejects.toThrow(
      /hasta 2 preguntas/,
    );
  });

  it('el chat recién se abre cuando hay alguien asignado y sólo entre las dos partes', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);

    await expect(ctx.tareas.mensajear(tarea.id, cliente.id, 'Hola')).rejects.toThrow(/en curso/);

    await ctx.tareas.aceptar(tarea.id, trabajador.id);
    const mensaje = await ctx.tareas.mensajear(tarea.id, trabajador.id, 'Salgo en 10 minutos');
    expect(mensaje.tareaId).toBe(tarea.id);

    const ajeno = await crearTrabajador('Curioso');
    await expect(ctx.tareas.mensajear(tarea.id, ajeno.id, '¿Cuánto pagan?')).rejects.toThrow(/sólo entre/);
  });
});
