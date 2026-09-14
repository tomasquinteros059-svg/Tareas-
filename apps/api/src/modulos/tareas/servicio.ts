import { randomInt } from 'node:crypto';
import type { PrismaClient, Tarea } from '@prisma/client';
import {
  cajaDeBusqueda,
  cargoPorCancelacion,
  cotizar,
  esFolioValido,
  evaluarElegibilidad,
  exigirTransicion,
  generarFolio,
  liquidar,
  normalizarFolio,
  ordenarFeed,
  radioDeBusqueda,
  rubroObligatorio,
  validarPresupuesto,
  type Actor,
  type EstadoTarea,
} from '@tareas/domain';
import { conflicto, invalido, noEncontrado, sinPermiso } from '../../lib/errores.js';
import { aPerfilDominio, aTareaDominio } from './mapeos.js';
import type { Pasarela } from '../pagos/pasarela.js';
import type { ServicioAntifraude } from '../antifraude/servicio.js';

/** Cuánto vive una tarea publicada antes de expirar si nadie la toma. */
const VENTANA_PUBLICACION_MS = 24 * 60 * 60 * 1000;
/** Preguntas que puede hacer un mismo trabajador sobre una tarea, antes de tomarla. */
export const MAX_PREGUNTAS_POR_TRABAJADOR = 2;

export interface DatosNuevaTarea {
  rubroSlug: string;
  titulo: string;
  descripcion: string;
  unidades: number;
  dificultad: 'BASICA' | 'MEDIA' | 'ALTA' | 'EXPERTA';
  urgencia: 'PROGRAMADA' | 'HOY' | 'INMEDIATA';
  nivelMinimo: 'NUEVO' | 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';
  presupuesto: number;
  materiales?: number;
  metodoPago: 'TARJETA' | 'EFECTIVO';
  direccionId?: string;
  lat: number;
  lng: number;
  exigeAntecedentes?: boolean;
  programadaPara?: Date;
  fotos?: string[];
  /** Token de la tarjeta que devuelve la pasarela. Obligatorio si paga con tarjeta. */
  metodoPagoToken?: string;
}

export class ServicioTareas {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pasarela: Pasarela,
    private readonly antifraude?: ServicioAntifraude,
  ) {}

  /**
   * Publica la tarea con precio cerrado. Si paga con tarjeta, primero se retienen
   * los fondos: sin plata retenida no se publica, así ningún trabajador sale a
   * trabajar contra un presupuesto que no existe.
   */
  async publicar(autorId: string, datos: DatosNuevaTarea): Promise<Tarea & { urlRedireccion?: string }> {
    const rubro = rubroObligatorio(datos.rubroSlug);
    const solicitud = {
      rubroSlug: datos.rubroSlug,
      unidades: datos.unidades,
      dificultad: datos.dificultad,
      urgencia: datos.urgencia,
      nivelMinimo: datos.nivelMinimo,
      materiales: datos.materiales ?? 0,
    };
    const validacion = validarPresupuesto(datos.presupuesto, solicitud);
    if (!validacion.valido) {
      throw invalido('PRESUPUESTO_INSUFICIENTE', validacion.motivo!, {
        minimo: validacion.minimo,
        rubro: rubro.nombre,
        ofrecido: datos.presupuesto,
      });
    }

    const autor = await this.prisma.usuario.findUnique({ where: { id: autorId } });
    if (!autor) throw noEncontrado('El usuario');
    if (autor.suspendido) throw sinPermiso('Tu cuenta está suspendida');
    if (!autor.telefonoOk) {
      throw invalido('TELEFONO_NO_VERIFICADO', 'Verificá tu teléfono antes de publicar una tarea');
    }

    const ahora = new Date();
    const folio = await this.folioUnico(ahora);

    let referenciaPago: string | undefined;
    let marca: string | undefined;
    let ultimos4: string | undefined;
    let urlRedireccion: string | undefined;
    /*
     * Con Webpay el cliente tiene que ir al sitio del banco: la tarea queda en
     * borrador y sólo sale al radar cuando vuelve y el pago se confirma. Sin
     * esto, un trabajador podría salir para una casa con una reserva que nunca
     * se completó.
     */
    let esperandoBanco = false;
    const liquidacion = liquidar({
      rubroSlug: datos.rubroSlug,
      presupuesto: datos.presupuesto,
      materiales: datos.materiales ?? 0,
      metodoPago: datos.metodoPago,
      // Al publicar todavía no sabemos quién la toma: se recalcula al liquidar.
      nivelTrabajador: 'NUEVO',
    });

    if (datos.metodoPago === 'TARJETA') {
      if (!datos.metodoPagoToken) {
        throw invalido('FALTA_METODO_PAGO', 'Elegí una tarjeta para publicar la tarea');
      }
      const hold = await this.pasarela.retener({
        monto: liquidacion.cobroAlCliente,
        moneda: 'USD',
        metodoPagoToken: datos.metodoPagoToken,
        descripcion: `Tarea ${folio} - ${datos.titulo}`,
        idempotencia: folio,
      });
      referenciaPago = hold.referencia;
      marca = hold.marca;
      ultimos4 = hold.ultimos4;
      urlRedireccion = hold.urlRedireccion;
      esperandoBanco = !!hold.requiereConfirmacion;
    }

    return this.prisma.$transaction(async (tx) => {
      const tarea = await tx.tarea.create({
        data: {
          folio,
          autorId,
          rubroSlug: datos.rubroSlug,
          titulo: datos.titulo,
          descripcion: datos.descripcion,
          fotos: datos.fotos ?? [],
          unidades: datos.unidades,
          dificultad: datos.dificultad,
          urgencia: datos.urgencia,
          nivelMinimo: datos.nivelMinimo,
          exigeAntecedentes: datos.exigeAntecedentes ?? false,
          minimoCalculado: validacion.minimo,
          presupuesto: datos.presupuesto,
          materiales: datos.materiales ?? 0,
          metodoPago: datos.metodoPago,
          estado: esperandoBanco ? 'BORRADOR' : 'PUBLICADA',
          direccionId: datos.direccionId ?? null,
          lat: datos.lat,
          lng: datos.lng,
          codigoInicio: String(randomInt(1000, 10000)),
          programadaPara: datos.programadaPara ?? null,
          publicadaEn: esperandoBanco ? null : ahora,
          expiraEn: esperandoBanco ? null : new Date(ahora.getTime() + VENTANA_PUBLICACION_MS),
        },
      });

      await tx.pago.create({
        data: {
          tareaId: tarea.id,
          metodo: datos.metodoPago,
          estado: datos.metodoPago === 'TARJETA' && !esperandoBanco ? 'RETENIDO' : 'PENDIENTE',
          montoTarea: datos.presupuesto,
          cargoServicio: liquidacion.cargoServicio,
          totalCliente: liquidacion.cobroAlCliente,
          referencia: referenciaPago ?? null,
          marca: marca ?? null,
          ultimos4Tarjeta: ultimos4 ?? null,
          retenidoEn: referenciaPago && !esperandoBanco ? ahora : null,
        },
      });

      await tx.eventoTarea.create({
        data: {
          tareaId: tarea.id,
          hacia: esperandoBanco ? 'BORRADOR' : 'PUBLICADA',
          actorId: autorId,
          actorRol: 'CLIENTE',
          nota: esperandoBanco ? 'Esperando que el cliente complete el pago en el banco' : null,
        },
      });

      return { ...tarea, urlRedireccion };
    });
  }

  /**
   * Vuelta del sitio del banco: se confirma con la pasarela y recién ahí la
   * tarea sale al radar. Si el banco rechazó, la tarea se queda en borrador.
   */
  async confirmarPago(tareaId: string, autorId: string) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId }, include: { pago: true } });
    if (!tarea) throw noEncontrado('La tarea');
    if (tarea.autorId !== autorId) throw sinPermiso('No es tu tarea');
    if (tarea.estado !== 'BORRADOR') throw conflicto('TAREA_YA_PUBLICADA', 'Esta tarea ya está publicada');
    if (!tarea.pago?.referencia) throw conflicto('SIN_PAGO', 'Esta tarea no tiene un pago para confirmar');
    if (!this.pasarela.confirmar) {
      throw conflicto('CONFIRMACION_NO_APLICA', 'Este medio de pago no necesita confirmación');
    }

    const confirmado = await this.pasarela.confirmar(tarea.pago.referencia);
    const ahora = new Date();

    const [actualizada] = await this.prisma.$transaction([
      this.prisma.tarea.update({
        where: { id: tareaId },
        data: {
          estado: 'PUBLICADA',
          publicadaEn: ahora,
          expiraEn: new Date(ahora.getTime() + VENTANA_PUBLICACION_MS),
        },
      }),
      this.prisma.pago.update({
        where: { tareaId },
        data: {
          estado: 'RETENIDO',
          retenidoEn: ahora,
          marca: confirmado.marca ?? null,
          ultimos4Tarjeta: confirmado.ultimos4 ?? null,
        },
      }),
      this.prisma.eventoTarea.create({
        data: { tareaId, desde: 'BORRADOR', hacia: 'PUBLICADA', actorId: autorId, actorRol: 'CLIENTE' },
      }),
    ]);
    return actualizada;
  }

  /** Lo que ve un trabajador en su radar, ya filtrado y ordenado. */
  /**
   * El radar del trabajador.
   *
   * La búsqueda por zona se hace en la base, no en memoria: primero se le pide
   * el rectángulo que contiene su radio —que la base resuelve con el índice de
   * lat/lng— y recién sobre esas filas se mide la distancia exacta y se aplican
   * las reglas de despacho. Traer las últimas doscientas tareas del país y
   * filtrarlas acá funcionaba con veinte tareas; con veinte mil, el de Punta
   * Arenas no ve una sola tarea suya.
   */
  async feed(trabajadorId: string) {
    const perfil = await this.perfilDominio(trabajadorId);
    if (perfil.ubicacion.lat === 0 && perfil.ubicacion.lng === 0) {
      throw invalido('SIN_UBICACION', 'Marcá tu zona de trabajo para ver los trabajos cerca tuyo');
    }

    const caja = cajaDeBusqueda(perfil.ubicacion, radioDeBusqueda(perfil.radioKm));
    const candidatas = await this.prisma.tarea.findMany({
      where: {
        estado: 'PUBLICADA',
        expiraEn: { gt: new Date() },
        lat: { gte: caja.latMin, lte: caja.latMax },
        lng: { gte: caja.lngMin, lte: caja.lngMax },
      },
      orderBy: { publicadaEn: 'desc' },
      take: 200,
    });
    return ordenarFeed(candidatas.map(aTareaDominio), perfil).map(({ tarea, elegibilidad }) => ({
      ...candidatas.find((t) => t.id === tarea.id)!,
      elegible: elegibilidad.elegible,
      motivo: elegibilidad.motivo ?? null,
      detalle: elegibilidad.detalle ?? null,
      distanciaKm: elegibilidad.distanciaKm,
    }));
  }

  /**
   * Toma la tarea. Es el punto más caliente de la app: dos trabajadores pueden
   * apretar "Aceptar" en el mismo milisegundo.
   *
   * La carrera la resuelve la base, no el código: el UPDATE condicionado a
   * `estado = PUBLICADA` sólo puede afectar una fila una vez. El segundo que
   * llega recibe 0 filas afectadas y ve "ya la tomaron", sin locks nuestros ni
   * lecturas previas en las que confiar.
   */
  async aceptar(tareaId: string, trabajadorId: string) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea) throw noEncontrado('La tarea');
    if (tarea.estado !== 'PUBLICADA') {
      throw conflicto('TAREA_YA_TOMADA', 'Otro trabajador la tomó primero');
    }

    const perfil = await this.perfilDominio(trabajadorId);
    const elegibilidad = evaluarElegibilidad(aTareaDominio(tarea), perfil);
    if (!elegibilidad.elegible) {
      throw sinPermiso(elegibilidad.detalle ?? `No podés tomar esta tarea (${elegibilidad.motivo})`);
    }

    const ahora = new Date();
    const { count } = await this.prisma.tarea.updateMany({
      where: { id: tareaId, estado: 'PUBLICADA', trabajadorId: null },
      data: { estado: 'ASIGNADA', trabajadorId, asignadaEn: ahora },
    });
    if (count === 0) throw conflicto('TAREA_YA_TOMADA', 'Otro trabajador la tomó primero');

    await this.prisma.$transaction([
      this.prisma.eventoTarea.create({
        data: {
          tareaId,
          desde: 'PUBLICADA',
          hacia: 'ASIGNADA',
          actorId: trabajadorId,
          actorRol: 'TRABAJADOR',
          datos: { ola: elegibilidad.ola.indice, distanciaKm: elegibilidad.distanciaKm },
        },
      }),
      this.prisma.perfilTrabajador.update({
        where: { usuarioId: trabajadorId },
        data: { trabajosAceptados: { increment: 1 } },
      }),
    ]);

    return this.prisma.tarea.findUniqueOrThrow({ where: { id: tareaId } });
  }

  /** Cualquier otro cambio de estado pasa por acá, validado contra la máquina de estados. */
  async cambiarEstado(
    tareaId: string,
    actorId: string,
    hacia: EstadoTarea,
    opciones: { codigoInicio?: string; nota?: string } = {},
  ) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea) throw noEncontrado('La tarea');

    const actor = this.rolEn(tarea, actorId);
    exigirTransicion(tarea.estado, hacia, actor);

    // Arrancar exige el código que el cliente le dicta al trabajador en la puerta.
    if (hacia === 'EN_PROGRESO' && opciones.codigoInicio !== tarea.codigoInicio) {
      throw invalido('CODIGO_INICIO_INVALIDO', 'El código de inicio no coincide');
    }

    const ahora = new Date();
    const datos: Record<string, unknown> = { estado: hacia };
    if (hacia === 'EN_PROGRESO') datos.iniciadaEn = ahora;
    if (hacia === 'ENTREGADA') datos.entregadaEn = ahora;
    if (hacia === 'CONFIRMADA') datos.confirmadaEn = ahora;
    if (hacia === 'PUBLICADA') {
      // El trabajador se bajó: la tarea vuelve a la fila y le queda la cancelación.
      datos.trabajadorId = null;
      datos.asignadaEn = null;
      datos.publicadaEn = ahora;
      datos.expiraEn = new Date(ahora.getTime() + VENTANA_PUBLICACION_MS);
    }
    if (hacia === 'CANCELADA' || hacia === 'EXPIRADA') datos.cerradaEn = ahora;

    const [actualizada] = await this.prisma.$transaction([
      this.prisma.tarea.update({ where: { id: tareaId }, data: datos }),
      this.prisma.eventoTarea.create({
        data: {
          tareaId,
          desde: tarea.estado,
          hacia,
          actorId,
          actorRol: actor,
          nota: opciones.nota ?? null,
        },
      }),
      ...(hacia === 'PUBLICADA' && tarea.trabajadorId
        ? [
            this.prisma.perfilTrabajador.update({
              where: { usuarioId: tarea.trabajadorId },
              data: { trabajosCancelados: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    if (hacia === 'CONFIRMADA') return this.liquidarTarea(tareaId);
    if (hacia === 'CANCELADA') {
      await this.cobrarCancelacion(tarea, actor);
    }
    if ((hacia === 'CANCELADA' || hacia === 'EXPIRADA') && tarea.metodoPago === 'TARJETA') {
      await this.liberarRetencion(tareaId);
    }
    return actualizada;
  }

  /**
   * Cierre de caja de la tarea: captura el pago (o registra la deuda si fue en
   * efectivo), mueve el saldo del trabajador y deja la tarea PAGADA.
   */
  async liquidarTarea(tareaId: string) {
    const tarea = await this.prisma.tarea.findUniqueOrThrow({
      where: { id: tareaId },
      include: { pago: true, trabajador: { include: { perfil: true } } },
    });
    if (!tarea.trabajadorId || !tarea.trabajador?.perfil) {
      throw conflicto('SIN_TRABAJADOR', 'La tarea no tiene trabajador asignado');
    }
    if (tarea.estado !== 'CONFIRMADA') {
      throw conflicto('TAREA_NO_CONFIRMADA', 'La tarea todavía no está confirmada');
    }

    const perfil = tarea.trabajador.perfil;
    const cuenta = liquidar({
      rubroSlug: tarea.rubroSlug,
      presupuesto: tarea.presupuesto,
      materiales: tarea.materiales,
      propina: tarea.propina,
      metodoPago: tarea.metodoPago,
      nivelTrabajador: perfil.nivel,
    });

    if (tarea.metodoPago === 'TARJETA' && tarea.pago?.referencia) {
      await this.pasarela.capturar(tarea.pago.referencia, cuenta.cobroAlCliente);
    }

    /*
     * Si el proveedor sabe girarle plata al trabajador y el trabajador ya
     * conectó su cuenta, el neto sale ahora mismo. Si no, queda en su saldo
     * dentro de la app y lo retira cuando quiere. El libro mayor registra el
     * mismo movimiento en los dos casos: lo que cambia es dónde está la plata.
     */
    let transferencia: string | null = null;
    if (
      tarea.metodoPago === 'TARJETA' &&
      cuenta.movimientoSaldo > 0 &&
      this.pasarela.capacidades.transferencias &&
      perfil.cuentaCobro
    ) {
      const giro = await this.pasarela.transferir({
        usuarioId: tarea.trabajadorId,
        cuentaDestino: perfil.cuentaCobro,
        monto: cuenta.movimientoSaldo,
        moneda: tarea.moneda,
        concepto: `Tarea ${tarea.folio}`,
        idempotencia: `payout:${tarea.id}`,
      });
      transferencia = giro.referencia;
    }

    const saldoResultante = perfil.saldo + (transferencia ? 0 : cuenta.movimientoSaldo);
    const ahora = new Date();

    const [actualizada] = await this.prisma.$transaction([
      this.prisma.tarea.update({
        where: { id: tareaId },
        data: { estado: 'PAGADA', cerradaEn: ahora },
      }),
      this.prisma.pago.update({
        where: { tareaId },
        data: {
          estado: tarea.metodoPago !== 'TARJETA' ? 'EN_MANO' : transferencia ? 'LIQUIDADO' : 'CAPTURADO',
          comision: cuenta.comision,
          tasaComision: cuenta.tasaComision,
          cargoServicio: cuenta.cargoServicio,
          propina: cuenta.propina,
          totalCliente: cuenta.cobroAlCliente,
          costoProcesamiento: cuenta.costoProcesamiento,
          netoTrabajador: cuenta.netoTrabajador,
          capturadoEn: ahora,
          liquidadoEn: transferencia ? ahora : null,
        },
      }),
      this.prisma.movimientoSaldo.create({
        data: {
          usuarioId: tarea.trabajadorId,
          tareaId,
          tipo: tarea.metodoPago === 'TARJETA' ? 'ACREDITACION_TRABAJO' : 'DEUDA_COMISION_EFECTIVO',
          monto: cuenta.movimientoSaldo,
          saldoResultante,
          detalle:
            tarea.metodoPago !== 'TARJETA'
              ? `Comisión de la tarea ${tarea.folio} cobrada en efectivo`
              : transferencia
                ? `Tarea ${tarea.folio} transferida a tu cuenta`
                : `Tarea ${tarea.folio} acreditada en tu saldo`,
        },
      }),
      this.prisma.perfilTrabajador.update({
        where: { usuarioId: tarea.trabajadorId },
        data: { saldo: saldoResultante, trabajosCompletados: { increment: 1 } },
      }),
      this.prisma.eventoTarea.create({
        data: { tareaId, desde: 'CONFIRMADA', hacia: 'PAGADA', actorRol: 'SISTEMA' },
      }),
    ]);

    // Recién con la tarea cerrada se puede mirar el ritmo del trabajo y la
    // relación entre las dos cuentas. Si esto falla, la plata ya se movió bien:
    // no puede tumbar la liquidación.
    await this.antifraude?.revisarTareaCerrada(tareaId).catch(() => undefined);

    return actualizada;
  }

  async porFolio(folio: string) {
    if (!esFolioValido(folio)) throw invalido('FOLIO_INVALIDO', 'El folio no tiene el formato TQ-AAMMDD-XXXX');
    const tarea = await this.prisma.tarea.findUnique({
      where: { folio: normalizarFolio(folio) },
      include: { eventos: { orderBy: { creadoEn: 'asc' } }, pago: true },
    });
    if (!tarea) throw noEncontrado('La tarea');
    return tarea;
  }

  /** Pregunta previa a la asignación, con cupo por trabajador. */
  async preguntar(tareaId: string, autorId: string, texto: string) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea) throw noEncontrado('La tarea');
    if (tarea.estado !== 'PUBLICADA') {
      throw conflicto('TAREA_NO_PUBLICADA', 'Las preguntas se hacen antes de que la tarea se asigne');
    }
    if (tarea.autorId === autorId) throw sinPermiso('No podés preguntarte a vos mismo');

    const hechas = await this.prisma.pregunta.count({ where: { tareaId, autorId } });
    if (hechas >= MAX_PREGUNTAS_POR_TRABAJADOR) {
      throw conflicto(
        'LIMITE_PREGUNTAS',
        `Podés hacer hasta ${MAX_PREGUNTAS_POR_TRABAJADOR} preguntas por tarea. Si te sirve el trabajo, tomalo.`,
      );
    }
    await this.antifraude?.revisarPregunta(tareaId, autorId, texto);
    return this.prisma.pregunta.create({ data: { tareaId, autorId, texto } });
  }

  /** Chat privado, sólo entre las dos partes y sólo con la tarea en curso. */
  async mensajear(tareaId: string, autorId: string, texto: string) {
    const tarea = await this.prisma.tarea.findUnique({ where: { id: tareaId } });
    if (!tarea) throw noEncontrado('La tarea');
    if (![tarea.autorId, tarea.trabajadorId].includes(autorId)) {
      throw sinPermiso('El chat es sólo entre el cliente y el trabajador asignado');
    }
    const abiertos: EstadoTarea[] = ['ASIGNADA', 'EN_CAMINO', 'EN_PROGRESO', 'ENTREGADA', 'EN_DISPUTA'];
    if (!abiertos.includes(tarea.estado)) {
      throw conflicto('CHAT_CERRADO', 'El chat está disponible mientras la tarea está en curso');
    }
    await this.antifraude?.revisarMensaje(tareaId, autorId, texto);
    return this.prisma.mensaje.create({ data: { tareaId, autorId, texto } });
  }

  /** Cotizador público: alimenta el slider de presupuesto en la app. */
  cotizarTarea(datos: Parameters<typeof cotizar>[0]) {
    return cotizar(datos);
  }

  private rolEn(tarea: Tarea, usuarioId: string): Actor {
    if (tarea.autorId === usuarioId) return 'CLIENTE';
    if (tarea.trabajadorId === usuarioId) return 'TRABAJADOR';
    throw sinPermiso('No participás de esta tarea');
  }

  /**
   * Cancelar sale gratis mientras el trabajador no salió de su casa. Una vez en
   * camino perdió el viaje y el horario, así que el cliente paga una retención y
   * la mayor parte va para él.
   */
  private async cobrarCancelacion(tarea: Tarea, actor: Actor) {
    if (actor !== 'CLIENTE') return;
    if (tarea.estado !== 'ASIGNADA' && tarea.estado !== 'EN_CAMINO') return;
    if (!tarea.trabajadorId) return;

    const { cargoAlCliente, compensacionTrabajador } = cargoPorCancelacion(
      {
        rubroSlug: tarea.rubroSlug,
        presupuesto: tarea.presupuesto,
        materiales: tarea.materiales,
        metodoPago: tarea.metodoPago,
        nivelTrabajador: 'NUEVO',
      },
      tarea.estado,
    );
    if (cargoAlCliente <= 0) return;

    const perfil = await this.prisma.perfilTrabajador.findUnique({
      where: { usuarioId: tarea.trabajadorId },
    });
    if (!perfil) return;

    const pago = await this.prisma.pago.findUnique({ where: { tareaId: tarea.id } });
    if (tarea.metodoPago === 'TARJETA' && pago?.referencia) {
      await this.pasarela.capturar(pago.referencia, cargoAlCliente);
    }

    const saldoResultante = perfil.saldo + compensacionTrabajador;
    await this.prisma.$transaction([
      this.prisma.movimientoSaldo.create({
        data: {
          usuarioId: tarea.trabajadorId,
          tareaId: tarea.id,
          tipo: 'COMPENSACION_CANCELACION',
          monto: compensacionTrabajador,
          saldoResultante,
          detalle: `Cancelación tardía de la tarea ${tarea.folio}`,
        },
      }),
      this.prisma.perfilTrabajador.update({
        where: { usuarioId: tarea.trabajadorId },
        data: { saldo: saldoResultante },
      }),
      this.prisma.pago.update({
        where: { tareaId: tarea.id },
        data: { estado: 'CAPTURADO', totalCliente: cargoAlCliente, netoTrabajador: compensacionTrabajador },
      }),
      this.prisma.eventoTarea.create({
        data: {
          tareaId: tarea.id,
          hacia: 'CANCELADA',
          actorRol: 'SISTEMA',
          nota: `Cargo por cancelación tardía: ${cargoAlCliente}`,
        },
      }),
    ]);
  }

  private async liberarRetencion(tareaId: string) {
    const pago = await this.prisma.pago.findUnique({ where: { tareaId } });
    // Si ya se capturó el cargo por cancelación tardía, no hay nada que liberar.
    if (pago?.referencia && pago.estado === 'RETENIDO') {
      await this.pasarela.liberar(pago.referencia);
      await this.prisma.pago.update({ where: { tareaId }, data: { estado: 'REEMBOLSADO' } });
    }
  }

  private async perfilDominio(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { perfil: { include: { habilidades: true } }, identidad: true },
    });
    if (!usuario) throw noEncontrado('El usuario');
    if (!usuario.perfil) throw invalido('SIN_PERFIL_TRABAJADOR', 'Todavía no creaste tu perfil de trabajador');
    return aPerfilDominio(usuario, usuario.perfil, usuario.identidad?.estado === 'VERIFICADO');
  }

  private async folioUnico(fecha: Date): Promise<string> {
    for (let intento = 0; intento < 8; intento++) {
      const folio = generarFolio(fecha);
      const existe = await this.prisma.tarea.findUnique({ where: { folio }, select: { id: true } });
      if (!existe) return folio;
    }
    throw new Error('No se pudo generar un folio único');
  }
}
