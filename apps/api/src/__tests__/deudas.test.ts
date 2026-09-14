import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { contextoDePrueba, crearTrabajador, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

/** Un trabajador que debe comisiones de trabajos cobrados en efectivo. */
async function deudor(deuda = 3_000, tarjeta: string | null = 'tok_ok_4242') {
  const trabajador = await crearTrabajador('Beto', { saldo: -deuda });
  if (tarjeta) {
    await prisma.perfilTrabajador.update({
      where: { usuarioId: trabajador.id },
      data: { medioPagoToken: tarjeta, medioPagoMarca: 'visa', medioPagoUltimos4: '4242' },
    });
  }
  return trabajador;
}

const saldoDe = async (usuarioId: string) =>
  (await prisma.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId } })).saldo;

describe('guardar la tarjeta con la que se paga la deuda', () => {
  it('la prueba antes de guardarla y sólo deja marca y últimos cuatro', async () => {
    const trabajador = await deudor(3_000, null);

    const estado = await ctx.deudas.guardarMedioDePago(trabajador.id, 'tok_ok_4242');

    expect(estado.tarjeta).toMatchObject({ marca: 'visa', ultimos4: '4242' });
    expect(estado.cobroAutomatico).toBe(true);
    // La verificación no le dejó plata retenida.
    const retenciones = [...ctx.pasarela.retenciones.values()];
    expect(retenciones.every((r) => r.estado !== 'RETENIDO')).toBe(true);
  });

  it('una tarjeta rechazada no se guarda: si no, falla el día que hace falta', async () => {
    const trabajador = await deudor(3_000, null);

    await expect(
      ctx.deudas.guardarMedioDePago(trabajador.id, 'tok_rechazada'),
    ).rejects.toMatchObject({ codigo: 'TARJETA_RECHAZADA' });

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.medioPagoToken).toBeNull();
  });
});

describe('pagar la deuda a mano', () => {
  it('cobra todo lo que se debe y lo asienta en el libro', async () => {
    const trabajador = await deudor(3_000);

    const resultado = await ctx.deudas.pagar(trabajador.id);

    expect(resultado).toMatchObject({ pagado: true, monto: 3_000, saldo: 0 });
    expect(await saldoDe(trabajador.id)).toBe(0);
    const movimiento = await prisma.movimientoSaldo.findFirstOrThrow({
      where: { usuarioId: trabajador.id, tipo: 'PAGO_DE_DEUDA' },
    });
    expect(movimiento.monto).toBe(3_000);
    expect(movimiento.saldoResultante).toBe(0);
  });

  it('no cobra si no se debe nada', async () => {
    const trabajador = await crearTrabajador('Beto', { saldo: 5_000 });

    await expect(ctx.deudas.pagar(trabajador.id, 'tok_ok_4242')).rejects.toMatchObject({
      codigo: 'SIN_DEUDA',
    });
  });

  it('un rechazo no toca el saldo y aleja el siguiente intento', async () => {
    const trabajador = await deudor(3_000, 'tok_rechazada');

    await expect(ctx.deudas.pagar(trabajador.id)).rejects.toMatchObject({
      codigo: 'COBRO_RECHAZADO',
    });

    expect(await saldoDe(trabajador.id)).toBe(-3_000);
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.cobroIntentos).toBe(1);
    expect(perfil.cobroProximoIntento!.getTime()).toBeGreaterThan(Date.now());
    expect(perfil.cobroUltimoError).toContain('rechazada');
  });
});

describe('el cobro automático del reloj', () => {
  it('le cobra al que debe y tiene tarjeta', async () => {
    const trabajador = await deudor(4_000);

    const resumen = await ctx.deudas.cobrarPendientes();

    expect(resumen).toMatchObject({ intentados: 1, cobrados: 1, monto: 4_000, fallidos: 0 });
    expect(await saldoDe(trabajador.id)).toBe(0);
  });

  it('no toca al que no llega al mínimo ni al que no dejó tarjeta', async () => {
    const chico = await deudor(100);
    const sinTarjeta = await deudor(9_000, null);

    const resumen = await ctx.deudas.cobrarPendientes();

    expect(resumen.intentados).toBe(0);
    expect(await saldoDe(chico.id)).toBe(-100);
    expect(await saldoDe(sinTarjeta.id)).toBe(-9_000);
  });

  it('respeta la espera tras un rechazo y no insiste el mismo día', async () => {
    const trabajador = await deudor(4_000, 'tok_rechazada');

    const primera = await ctx.deudas.cobrarPendientes();
    const segunda = await ctx.deudas.cobrarPendientes();

    expect(primera.fallidos).toBe(1);
    expect(segunda.intentados).toBe(0);
    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.cobroIntentos).toBe(1);
  });

  it('deja de insistir después de los intentos previstos', async () => {
    const trabajador = await deudor(4_000, 'tok_rechazada');
    let ahora = new Date();

    for (let i = 0; i < 6; i++) {
      await ctx.deudas.cobrarPendientes(ahora);
      ahora = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const perfil = await prisma.perfilTrabajador.findUniqueOrThrow({
      where: { usuarioId: trabajador.id },
    });
    expect(perfil.cobroIntentos).toBe(4);
    expect(await saldoDe(trabajador.id)).toBe(-4_000);
  });

  it('un rechazo no frena la fila: al siguiente se le cobra igual', async () => {
    const malo = await deudor(4_000, 'tok_rechazada');
    const bueno = await deudor(6_000);

    const resumen = await ctx.deudas.cobrarPendientes();

    expect(resumen).toMatchObject({ intentados: 2, cobrados: 1, fallidos: 1, monto: 6_000 });
    expect(await saldoDe(malo.id)).toBe(-4_000);
    expect(await saldoDe(bueno.id)).toBe(0);
  });

  it('cobrado una vez, la segunda pasada no vuelve a cobrar', async () => {
    const trabajador = await deudor(4_000);

    await ctx.deudas.cobrarPendientes();
    const segunda = await ctx.deudas.cobrarPendientes();

    expect(segunda).toMatchObject({ intentados: 0, cobrados: 0 });
    expect(await saldoDe(trabajador.id)).toBe(0);
  });
});

describe('el estado que ve el trabajador', () => {
  it('muestra la deuda, la tarjeta y por qué no se cobró', async () => {
    const trabajador = await deudor(3_000, 'tok_rechazada');
    await ctx.deudas.pagar(trabajador.id).catch(() => undefined);

    const estado = await ctx.deudas.estado(trabajador.id);

    expect(estado.deuda).toBe(3_000);
    expect(estado.intentosFallidos).toBe(1);
    expect(estado.ultimoError).toContain('rechazada');
    expect(estado.proximoIntento).toBeInstanceOf(Date);
  });
});
