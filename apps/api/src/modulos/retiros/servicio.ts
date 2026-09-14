import type { PrismaClient } from '@prisma/client';
import { aMinimas, normalizarRut, rutValido } from '@tareas/domain';
import { cifrar, descifrar } from '../../lib/cifrado.js';
import { conflicto, invalido, noEncontrado } from '../../lib/errores.js';

/**
 * Retiros.
 *
 * Con Webpay —y con cualquier pasarela que no transfiera por API— el banco
 * deposita todo el dinero en la cuenta de la empresa. El neto de cada trabajo se
 * le acredita al trabajador como saldo, pero ese saldo es una promesa hasta que
 * alguien le hace la transferencia. Esto es lo que convierte la promesa en plata:
 * el trabajador pide, el saldo se descuenta en el momento, y queda una fila en la
 * cola de soporte con el monto y los últimos cuatro dígitos de la cuenta.
 *
 * Dos decisiones que parecen detalles y no lo son:
 *
 *  - el saldo se descuenta al pedir, no al pagar. Si se descontara al pagar,
 *    entre el pedido y la transferencia el trabajador podría tomar más trabajos
 *    y pedir de nuevo la misma plata;
 *  - si el retiro se rechaza, la plata vuelve al saldo con su propio movimiento.
 *    El estado de cuenta tiene que poder leerse de arriba abajo y cerrar.
 *
 * El número de cuenta se guarda cifrado igual que el documento. En la app, y en
 * la pantalla de soporte, sólo se ven los últimos cuatro dígitos.
 */

export interface DatosBanco {
  bancoNombre: string;
  tipoCuenta: 'CORRIENTE' | 'VISTA' | 'AHORRO' | 'RUT';
  numero: string;
  titular: string;
  rutTitular: string;
}

/**
 * Cada transferencia le cuesta a la empresa, y el trabajo de revisarla cuesta
 * más todavía: por debajo de este monto conviene esperar y juntar. Va por moneda
 * porque un mínimo en pesos chilenos no significa nada en dólares.
 */
const MINIMOS: Record<string, number> = {
  CLP: 5_000,
  ARS: 20_000,
  USD: 2_000, // 20 dólares, en centavos.
  EUR: 2_000,
};

export function minimoRetiro(moneda: string): number {
  return MINIMOS[moneda.toUpperCase()] ?? aMinimas(20, moneda);
}

export class ServicioRetiros {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly claveCifrado: string,
    private readonly moneda: string,
  ) {}

  /** El mínimo es información pública: la app lo muestra antes de que pidan. */
  get minimo(): number {
    return minimoRetiro(this.moneda);
  }

  /**
   * Guarda o reemplaza la cuenta bancaria. El RUT se valida acá: un dígito
   * cambiado hace rebotar la transferencia días después, cuando el trabajador ya
   * contaba con la plata.
   */
  async guardarBanco(usuarioId: string, datos: DatosBanco) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');

    const numero = datos.numero.replace(/[\s.\-]/g, '');
    if (!/^\d{5,20}$/.test(numero)) {
      throw invalido('CUENTA_INVALIDA', 'El número de cuenta tiene que ser de 5 a 20 dígitos');
    }
    if (!rutValido(datos.rutTitular)) {
      throw invalido('RUT_INVALIDO', 'El RUT del titular no es válido: revisá el dígito verificador');
    }
    if (datos.titular.trim().length < 5) {
      throw invalido('TITULAR_INVALIDO', 'Escribí el nombre completo del titular de la cuenta');
    }
    if (datos.bancoNombre.trim().length < 3) {
      throw invalido('BANCO_INVALIDO', 'Elegí el banco');
    }

    await this.prisma.perfilTrabajador.update({
      where: { usuarioId },
      data: {
        bancoNombre: datos.bancoNombre.trim(),
        bancoTipoCuenta: datos.tipoCuenta,
        bancoNumeroCifrado: cifrar(numero, this.claveCifrado),
        bancoUltimos4: numero.slice(-4),
        bancoTitular: datos.titular.trim(),
        bancoRutTitular: normalizarRut(datos.rutTitular),
      },
    });
    return this.verBanco(usuarioId);
  }

  /** Lo que ve el trabajador de su propia cuenta: nunca el número completo. */
  async verBanco(usuarioId: string) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    if (!perfil.bancoNumeroCifrado) return null;
    return {
      bancoNombre: perfil.bancoNombre,
      tipoCuenta: perfil.bancoTipoCuenta,
      ultimos4: perfil.bancoUltimos4,
      titular: perfil.bancoTitular,
      rutTitular: perfil.bancoRutTitular,
    };
  }

  /**
   * El número completo, descifrado. Sólo para el momento de hacer la
   * transferencia: no vuelve por ninguna ruta del trabajador.
   */
  async cuentaCompleta(usuarioId: string) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil?.bancoNumeroCifrado) throw noEncontrado('La cuenta bancaria');
    return {
      bancoNombre: perfil.bancoNombre,
      tipoCuenta: perfil.bancoTipoCuenta,
      numero: descifrar(perfil.bancoNumeroCifrado, this.claveCifrado),
      titular: perfil.bancoTitular,
      rutTitular: perfil.bancoRutTitular,
    };
  }

  /**
   * Pide un retiro. El saldo se descuenta en la misma transacción en que se crea
   * la solicitud, con la condición `saldo >= monto` dentro del UPDATE: si llegan
   * dos pedidos a la vez, la base deja pasar uno solo.
   */
  async solicitar(usuarioId: string, monto: number) {
    if (!Number.isInteger(monto) || monto <= 0) {
      throw invalido('MONTO_INVALIDO', 'El monto tiene que ser un entero positivo');
    }
    if (monto < this.minimo) {
      throw invalido('MONTO_MINIMO', `El retiro mínimo es de ${this.minimo}`);
    }

    const [perfil, identidad, pendiente] = await Promise.all([
      this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } }),
      this.prisma.identidad.findUnique({ where: { usuarioId } }),
      this.prisma.retiro.findFirst({ where: { usuarioId, estado: 'SOLICITADO' } }),
    ]);
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    if (!perfil.bancoNumeroCifrado || !perfil.bancoNombre || !perfil.bancoUltimos4) {
      throw conflicto('SIN_CUENTA', 'Cargá tu cuenta bancaria antes de pedir un retiro');
    }
    // Transferir a una cuenta sin identidad verificada es la puerta por la que
    // se vacía una plataforma: el titular de la cuenta tiene que ser alguien.
    if (identidad?.estado !== 'VERIFICADO') {
      throw conflicto('IDENTIDAD_PENDIENTE', 'Necesitás la identidad verificada para retirar');
    }
    if (pendiente) {
      throw conflicto('RETIRO_PENDIENTE', 'Ya tenés un retiro esperando ser pagado');
    }
    if (perfil.saldo < monto) {
      throw conflicto('SALDO_INSUFICIENTE', 'No te alcanza el saldo para ese retiro');
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.perfilTrabajador.updateMany({
        where: { usuarioId, saldo: { gte: monto } },
        data: { saldo: { decrement: monto } },
      });
      // Cero filas quiere decir que entre la lectura de arriba y este UPDATE
      // alguien más movió el saldo. Se cae la transacción entera.
      if (count === 0) throw conflicto('SALDO_INSUFICIENTE', 'No te alcanza el saldo para ese retiro');

      const actualizado = await tx.perfilTrabajador.findUniqueOrThrow({ where: { usuarioId } });
      await tx.movimientoSaldo.create({
        data: {
          usuarioId,
          tipo: 'RETIRO',
          monto: -monto,
          saldoResultante: actualizado.saldo,
          detalle: `Retiro solicitado a ${perfil.bancoNombre} ****${perfil.bancoUltimos4}`,
        },
      });
      return tx.retiro.create({
        data: {
          usuarioId,
          monto,
          bancoNombre: perfil.bancoNombre!,
          bancoUltimos4: perfil.bancoUltimos4!,
        },
      });
    });
  }

  /** El historial del trabajador, con su saldo disponible al lado. */
  async mios(usuarioId: string) {
    const [perfil, retiros] = await Promise.all([
      this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } }),
      this.prisma.retiro.findMany({ where: { usuarioId }, orderBy: { solicitadoEn: 'desc' }, take: 50 }),
    ]);
    return {
      saldo: perfil?.saldo ?? 0,
      minimo: this.minimo,
      puedeRetirar: (perfil?.saldo ?? 0) >= this.minimo && Boolean(perfil?.bancoNumeroCifrado),
      banco: perfil?.bancoNumeroCifrado
        ? { nombre: perfil.bancoNombre, ultimos4: perfil.bancoUltimos4 }
        : null,
      retiros,
    };
  }

  /** La cola de pagos: lo más viejo primero, con la cuenta lista para copiar. */
  async pendientes() {
    const retiros = await this.prisma.retiro.findMany({
      where: { estado: 'SOLICITADO' },
      orderBy: { solicitadoEn: 'asc' },
      include: { usuario: { select: { id: true, nombre: true, apellido: true, telefono: true } } },
    });

    const conCuenta = await Promise.all(
      retiros.map(async (retiro) => ({
        ...retiro,
        cuenta: await this.cuentaCompleta(retiro.usuarioId).catch(() => null),
      })),
    );
    return { retiros: conCuenta, total: retiros.length, monto: retiros.reduce((s, r) => s + r.monto, 0) };
  }

  /** Ya se transfirió. La referencia es el comprobante del banco. */
  async marcarPagado(retiroId: string, revisorId: string, referencia: string) {
    if (referencia.trim().length < 3) {
      throw invalido('SIN_REFERENCIA', 'Anotá el comprobante de la transferencia');
    }
    const { count } = await this.prisma.retiro.updateMany({
      where: { id: retiroId, estado: 'SOLICITADO' },
      data: {
        estado: 'PAGADO',
        referencia: referencia.trim(),
        revisadoPor: revisorId,
        resueltoEn: new Date(),
      },
    });
    if (count === 0) throw conflicto('RETIRO_YA_RESUELTO', 'Ese retiro ya no está pendiente');
    return this.prisma.retiro.findUniqueOrThrow({ where: { id: retiroId } });
  }

  /**
   * No se pudo transferir (cuenta mal cargada, titular que no coincide). La
   * plata vuelve al saldo con su propio movimiento, así el estado de cuenta
   * cierra sin tener que explicar nada aparte.
   */
  async rechazar(retiroId: string, revisorId: string, motivo: string) {
    if (motivo.trim().length < 10) {
      throw invalido('SIN_FUNDAMENTO', 'Explicá por qué se rechaza: el trabajador lo va a leer');
    }
    const retiro = await this.prisma.retiro.findUnique({ where: { id: retiroId } });
    if (!retiro) throw noEncontrado('El retiro');

    return this.prisma.$transaction(async (tx) => {
      // La condición del estado es lo que evita devolver la plata dos veces.
      const { count } = await tx.retiro.updateMany({
        where: { id: retiroId, estado: 'SOLICITADO' },
        data: {
          estado: 'RECHAZADO',
          motivo: motivo.trim(),
          revisadoPor: revisorId,
          resueltoEn: new Date(),
        },
      });
      if (count === 0) throw conflicto('RETIRO_YA_RESUELTO', 'Ese retiro ya no está pendiente');

      const perfil = await tx.perfilTrabajador.update({
        where: { usuarioId: retiro.usuarioId },
        data: { saldo: { increment: retiro.monto } },
      });
      await tx.movimientoSaldo.create({
        data: {
          usuarioId: retiro.usuarioId,
          tipo: 'RETIRO',
          monto: retiro.monto,
          saldoResultante: perfil.saldo,
          detalle: `Retiro rechazado: ${motivo.trim()}`,
        },
      });
      return tx.retiro.findUniqueOrThrow({ where: { id: retiroId } });
    });
  }
}
