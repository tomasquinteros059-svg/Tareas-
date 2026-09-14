import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorApi } from '../lib/errores.js';
import { contextoDePrueba, crearCliente, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

const BANCO = {
  bancoNombre: 'Banco Santander',
  tipoCuenta: 'CORRIENTE' as const,
  numero: '0-000-9687533-9',
  titular: 'Beto Gómez',
  rutTitular: '12.345.678-5',
};

/** Un trabajador con plata a cobrar y la cuenta ya cargada. */
async function conSaldo(saldo = 40_000) {
  const trabajador = await crearTrabajador('Beto', { saldo });
  await ctx.retiros.guardarBanco(trabajador.id, BANCO);
  return trabajador;
}

describe('cargar la cuenta bancaria', () => {
  it('guarda el número cifrado y sólo devuelve los últimos cuatro', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 0 });

    const guardado = await ctx.retiros.guardarBanco(trabajador.id, BANCO);

    expect(guardado).toMatchObject({ bancoNombre: 'Banco Santander', ultimos4: '5339' });
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.bancoNumeroCifrado).not.toContain('9687533');
    expect(await ctx.retiros.cuentaCompleta(trabajador.id)).toMatchObject({ numero: '000096875339' });
  });

  it('rechaza un RUT con el dígito cambiado antes de que rebote la transferencia', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 0 });

    await expect(
      ctx.retiros.guardarBanco(trabajador.id, { ...BANCO, rutTitular: '12.345.678-6' }),
    ).rejects.toMatchObject({ codigo: 'RUT_INVALIDO' });
  });

  it('rechaza un número de cuenta que no son dígitos', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 0 });

    await expect(
      ctx.retiros.guardarBanco(trabajador.id, { ...BANCO, numero: 'mi cuenta' }),
    ).rejects.toMatchObject({ codigo: 'CUENTA_INVALIDA' });
  });
});

describe('pedir un retiro', () => {
  it('descuenta el saldo en el momento y deja el movimiento', async () => {
    const trabajador = await conSaldo(40_000);

    const retiro = await ctx.retiros.solicitar(trabajador.id, 30_000);

    expect(retiro).toMatchObject({ estado: 'SOLICITADO', monto: 30_000, bancoUltimos4: '5339' });
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.saldo).toBe(10_000);
    const movimiento = await prisma.movimientoSaldo.findFirstOrThrow({
      where: { usuarioId: trabajador.id, tipo: 'RETIRO' },
    });
    expect(movimiento.monto).toBe(-30_000);
    expect(movimiento.saldoResultante).toBe(10_000);
  });

  it('no deja pedir más de lo que hay', async () => {
    const trabajador = await conSaldo(10_000);

    await expect(ctx.retiros.solicitar(trabajador.id, 20_000)).rejects.toMatchObject({
      codigo: 'SALDO_INSUFICIENTE',
    });
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.saldo).toBe(10_000);
  });

  it('dos pedidos a la vez no vacían el saldo dos veces', async () => {
    const trabajador = await conSaldo(30_000);

    const resultados = await Promise.allSettled([
      ctx.retiros.solicitar(trabajador.id, 30_000),
      ctx.retiros.solicitar(trabajador.id, 30_000),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.saldo).toBe(0);
    expect(await prisma.retiro.count({ where: { usuarioId: trabajador.id } })).toBe(1);
  });

  it('exige la cuenta cargada', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 40_000 });

    await expect(ctx.retiros.solicitar(trabajador.id, 30_000)).rejects.toMatchObject({
      codigo: 'SIN_CUENTA',
    });
  });

  it('exige la identidad verificada: no se transfiere a un desconocido', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 40_000, identidadVerificada: false });
    await ctx.retiros.guardarBanco(trabajador.id, BANCO);

    await expect(ctx.retiros.solicitar(trabajador.id, 30_000)).rejects.toMatchObject({
      codigo: 'IDENTIDAD_PENDIENTE',
    });
  });

  it('rechaza montos por debajo del mínimo', async () => {
    const trabajador = await conSaldo(40_000);

    await expect(ctx.retiros.solicitar(trabajador.id, ctx.retiros.minimo - 1)).rejects.toMatchObject({
      codigo: 'MONTO_MINIMO',
    });
  });

  it('no deja acumular pedidos sin resolver', async () => {
    const trabajador = await conSaldo(40_000);
    await ctx.retiros.solicitar(trabajador.id, 20_000);

    await expect(ctx.retiros.solicitar(trabajador.id, 10_000)).rejects.toMatchObject({
      codigo: 'RETIRO_PENDIENTE',
    });
  });
});

describe('la cola de soporte', () => {
  it('muestra el pendiente con la cuenta lista para transferir', async () => {
    const trabajador = await conSaldo(40_000);
    await ctx.retiros.solicitar(trabajador.id, 30_000);

    const cola = await ctx.retiros.pendientes();

    expect(cola.total).toBe(1);
    expect(cola.monto).toBe(30_000);
    expect(cola.retiros[0]!.cuenta).toMatchObject({ numero: '000096875339', titular: 'Beto Gómez' });
  });

  it('marcar pagado guarda el comprobante y no se puede repetir', async () => {
    const trabajador = await conSaldo(40_000);
    const soporte = await crearCliente('Soporte');
    const retiro = await ctx.retiros.solicitar(trabajador.id, 30_000);

    const pagado = await ctx.retiros.marcarPagado(retiro.id, soporte.id, 'TRF-77321');

    expect(pagado).toMatchObject({ estado: 'PAGADO', referencia: 'TRF-77321', revisadoPor: soporte.id });
    expect(pagado.resueltoEn).toBeInstanceOf(Date);
    await expect(ctx.retiros.marcarPagado(retiro.id, soporte.id, 'TRF-77321')).rejects.toMatchObject({
      codigo: 'RETIRO_YA_RESUELTO',
    });
    expect((await ctx.retiros.pendientes()).total).toBe(0);
  });

  it('rechazar devuelve la plata al saldo, una sola vez', async () => {
    const trabajador = await conSaldo(40_000);
    const soporte = await crearCliente('Soporte');
    const retiro = await ctx.retiros.solicitar(trabajador.id, 30_000);

    await ctx.retiros.rechazar(retiro.id, soporte.id, 'El titular de la cuenta no coincide con el RUT');

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.saldo).toBe(40_000);
    await expect(
      ctx.retiros.rechazar(retiro.id, soporte.id, 'El titular de la cuenta no coincide con el RUT'),
    ).rejects.toMatchObject({ codigo: 'RETIRO_YA_RESUELTO' });

    const movimientos = await prisma.movimientoSaldo.findMany({
      where: { usuarioId: trabajador.id, tipo: 'RETIRO' },
    });
    expect(movimientos).toHaveLength(2);
    expect(movimientos.reduce((s, m) => s + m.monto, 0)).toBe(0);
  });

  it('rechazar sin explicación no se puede: el trabajador lo va a leer', async () => {
    const trabajador = await conSaldo(40_000);
    const soporte = await crearCliente('Soporte');
    const retiro = await ctx.retiros.solicitar(trabajador.id, 30_000);

    await expect(ctx.retiros.rechazar(retiro.id, soporte.id, 'no')).rejects.toBeInstanceOf(ErrorApi);
  });
});

describe('la pantalla del trabajador', () => {
  it('resume saldo, mínimo y si puede retirar', async () => {
    const trabajador = await conSaldo(40_000);
    await ctx.retiros.solicitar(trabajador.id, 30_000);

    const vista = await ctx.retiros.mios(trabajador.id);

    expect(vista.saldo).toBe(10_000);
    expect(vista.minimo).toBe(ctx.retiros.minimo);
    expect(vista.banco).toMatchObject({ nombre: 'Banco Santander', ultimos4: '5339' });
    expect(vista.retiros).toHaveLength(1);
  });

  it('sin cuenta cargada avisa que no puede retirar', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 40_000 });

    const vista = await ctx.retiros.mios(trabajador.id);

    expect(vista.puedeRetirar).toBe(false);
    expect(vista.banco).toBeNull();
  });
});
