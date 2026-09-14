import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorApi } from '../lib/errores.js';
import { TAREA_BASE, contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

/** Deja una tarea entregada y con el reclamo abierto por el cliente. */
async function tareaEnDisputa() {
  const cliente = await crearCliente();
  const trabajador = await crearTrabajador();
  const soporte = await crearCliente('Soporte');
  const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
  await ctx.tareas.aceptar(tarea.id, trabajador.id);
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_CAMINO');
  const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tarea.id } });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'EN_PROGRESO', { codigoInicio: t.codigoInicio! });
  await ctx.tareas.cambiarEstado(tarea.id, trabajador.id, 'ENTREGADA');
  await ctx.tareas.cambiarEstado(tarea.id, cliente.id, 'EN_DISPUTA', { nota: 'Quedó a medio hacer' });
  return { cliente, trabajador, soporte, tareaId: tarea.id };
}

describe('bandeja de soporte', () => {
  it('junta lo que está esperando decisión', async () => {
    const { tareaId } = await tareaEnDisputa();
    const usuario = await crearCliente('Pendiente');
    await ctx.identidad.registrar(usuario.id, {
      tipoDocumento: 'CEDULA',
      numero: '99887766',
      paisEmision: 'CL',
      nombreLegal: 'Pendiente Pérez',
      fechaNacimiento: new Date('1991-02-03'),
    });

    const bandeja = await ctx.soporte.bandeja();

    expect(bandeja.disputas).toHaveLength(1);
    expect(bandeja.disputas[0]!.id).toBe(tareaId);
    expect(bandeja.identidades).toHaveLength(1);
    expect(bandeja.total).toBe(2);
  });
});

describe('resolver un reclamo', () => {
  it('a favor del trabajador: se paga el trabajo completo', async () => {
    const { trabajador, soporte, tareaId } = await tareaEnDisputa();

    await ctx.soporte.resolverDisputa({
      tareaId,
      resolucion: 'TRABAJADOR',
      revisorId: soporte.id,
      nota: 'Las fotos muestran el trabajo terminado',
    });

    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
    expect(t.estado).toBe('PAGADA');
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(2610);
  });

  it('a favor del cliente: se cancela y se le devuelve la reserva', async () => {
    const { trabajador, soporte, tareaId } = await tareaEnDisputa();
    const pago = await prisma.pago.findUniqueOrThrow({ where: { tareaId } });

    await ctx.soporte.resolverDisputa({
      tareaId,
      resolucion: 'CLIENTE',
      revisorId: soporte.id,
      nota: 'El trabajador nunca llegó al domicilio',
    });

    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
    expect(t.estado).toBe('CANCELADA');
    expect(ctx.pasarela.retenciones.get(pago.referencia!)?.estado).toBe('LIBERADO');
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(0);
  });

  it('parcial: paga lo acordado y guarda el monto original', async () => {
    const { trabajador, soporte, tareaId } = await tareaEnDisputa();

    await ctx.soporte.resolverDisputa({
      tareaId,
      resolucion: 'PARCIAL',
      revisorId: soporte.id,
      nota: 'Hizo la mitad del trabajo, se acuerda la mitad del precio',
      montoAcordado: 1500,
    });

    const t = await prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
    expect(t.estado).toBe('PAGADA');
    expect(t.presupuesto).toBe(1500);
    // La historia no se pierde: el recibo original sigue siendo demostrable.
    expect(t.presupuestoOriginal).toBe(3000);

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(1500 - 195); // 13% de comisión sobre lo acordado
  });

  it('no acepta un monto parcial mayor que el presupuesto', async () => {
    const { soporte, tareaId } = await tareaEnDisputa();
    const error = await ctx.soporte
      .resolverDisputa({
        tareaId,
        resolucion: 'PARCIAL',
        revisorId: soporte.id,
        nota: 'Intento de cobrar de más',
        montoAcordado: 9999,
      })
      .catch((e: ErrorApi) => e);
    expect((error as ErrorApi).codigo).toBe('MONTO_INVALIDO');
  });

  it('exige fundamento: la resolución queda registrada', async () => {
    const { soporte, tareaId } = await tareaEnDisputa();
    await expect(
      ctx.soporte.resolverDisputa({ tareaId, resolucion: 'TRABAJADOR', revisorId: soporte.id, nota: '   ' }),
    ).rejects.toThrow(/por qué/);
  });

  it('deja en la bitácora quién resolvió y con qué argumento', async () => {
    const { soporte, tareaId } = await tareaEnDisputa();
    await ctx.soporte.resolverDisputa({
      tareaId,
      resolucion: 'TRABAJADOR',
      revisorId: soporte.id,
      nota: 'El cliente confirmó por chat que estaba conforme',
    });

    const evento = await prisma.eventoTarea.findFirstOrThrow({
      where: { tareaId, actorRol: 'SOPORTE' },
    });
    expect(evento.actorId).toBe(soporte.id);
    expect(evento.nota).toMatch(/conforme/);
  });
});

describe('ajustes de saldo', () => {
  it('mueve el saldo y deja el motivo firmado', async () => {
    const trabajador = await crearTrabajador();
    const soporte = await crearCliente('Soporte');

    const movimiento = await ctx.soporte.ajustarSaldo({
      usuarioId: trabajador.id,
      monto: 5000,
      motivo: 'Compensación por un error nuestro en la liquidación de marzo',
      revisorId: soporte.id,
    });

    expect(movimiento.tipo).toBe('AJUSTE_SOPORTE');
    expect(movimiento.saldoResultante).toBe(5000);
    expect(movimiento.detalle).toContain(soporte.id);
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId: trabajador.id } });
    expect(perfil.saldo).toBe(5000);
  });

  it('no deja mover plata sin explicar por qué', async () => {
    const trabajador = await crearTrabajador();
    const soporte = await crearCliente('Soporte');
    await expect(
      ctx.soporte.ajustarSaldo({ usuarioId: trabajador.id, monto: 5000, motivo: 'porque', revisorId: soporte.id }),
    ).rejects.toThrow(/Explicá/);
  });
});

describe('suspensiones', () => {
  it('suspende con motivo y lo deja sin poder tomar trabajos', async () => {
    const cliente = await crearCliente();
    const trabajador = await crearTrabajador();
    const soporte = await crearCliente('Soporte');
    await ctx.soporte.suspender(trabajador.id, 'Tres reclamos por no presentarse', soporte.id);

    const tarea = await ctx.tareas.publicar(cliente.id, TAREA_BASE);
    await expect(ctx.tareas.aceptar(tarea.id, trabajador.id)).rejects.toThrow(/suspendida|CUENTA_SUSPENDIDA/);

    await ctx.soporte.levantarSuspension(trabajador.id);
    const tomada = await ctx.tareas.aceptar(tarea.id, trabajador.id);
    expect(tomada.trabajadorId).toBe(trabajador.id);
  });
});
