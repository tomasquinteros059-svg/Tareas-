import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import {
  cajaDeBusqueda,
  destinatariosDeOla,
  OLAS,
  olasPendientes,
  RADIO_MAXIMO_OLA,
} from '@tareas/domain';
import { invalido, noEncontrado } from '../../lib/errores.js';
import { aPerfilDominio, aTareaDominio } from '../tareas/mapeos.js';

/**
 * Avisos push.
 *
 * Sin esto el radar por olas es una idea linda que no funciona: nadie va a
 * estar con la app abierta esperando que aparezca un trabajo. La tarea se
 * publica, se abre para los mejor calificados y más cercanos, y si nadie mira
 * la pantalla no la toma nadie.
 *
 * Tres cuidados que definen si la gente deja los avisos prendidos:
 *
 *  - **un aviso por tarea y por persona**. En cada ola se avisa sólo a quien
 *    recién ahora puede tomarla; el que ya podía, ya fue avisado. Quien recibe
 *    cinco avisos de lo mismo apaga los avisos, y después no se entera de nada;
 *  - **no despertar a nadie al pedo**: sólo se avisa a quien tiene el turno
 *    abierto y está disponible;
 *  - **darse de baja solo**. Cuando el navegador contesta que la suscripción ya
 *    no existe (404 o 410), se borra. Si no, la lista se llena de teléfonos que
 *    ya no están y cada envío tarda más.
 */

export interface Aviso {
  titulo: string;
  cuerpo: string;
  /** Adónde lleva el aviso al tocarlo. */
  url?: string;
  /** Avisos con la misma etiqueta se reemplazan en vez de apilarse. */
  etiqueta?: string;
  /** La tarea de la que habla, para que la campana pueda llevar hasta ella. */
  tareaId?: string;
}

export interface DatosSuscripcion {
  endpoint: string;
  claves: { p256dh: string; auth: string };
  agente?: string;
}

/** Cuántos rechazos seguidos antes de dar por muerta una suscripción. */
const MAX_FALLOS = 5;
/** Con la última ola ya avisada no queda nada por anunciar de esa tarea. */
const ULTIMA_OLA = OLAS[OLAS.length - 1]!.indice;

export class ServicioAvisos {
  private readonly configurado: boolean;

  constructor(
    private readonly prisma: PrismaClient,
    opciones: { clavePublica?: string; clavePrivada?: string; contacto?: string } = {},
  ) {
    this.configurado = Boolean(opciones.clavePublica && opciones.clavePrivada);
    if (this.configurado) {
      webpush.setVapidDetails(
        opciones.contacto ?? 'mailto:soporte@tareas.cl',
        opciones.clavePublica!,
        opciones.clavePrivada!,
      );
    }
    this.clavePublica = opciones.clavePublica ?? null;
  }

  /** La clave que el navegador necesita para suscribirse. Es pública a propósito. */
  readonly clavePublica: string | null;

  get activo(): boolean {
    return this.configurado;
  }

  /**
   * El navegador ya consiguió el permiso y su dirección de entrega. Se guarda
   * por `endpoint`, que es lo que identifica al dispositivo: volver a
   * suscribirse desde el mismo teléfono actualiza, no duplica.
   */
  async suscribir(usuarioId: string, datos: DatosSuscripcion) {
    if (!datos.claves?.p256dh || !datos.claves?.auth) {
      throw invalido('SUSCRIPCION_INVALIDA', 'Faltan las claves de la suscripción');
    }
    return this.prisma.suscripcionPush.upsert({
      where: { endpoint: datos.endpoint },
      create: {
        usuarioId,
        endpoint: datos.endpoint,
        p256dh: datos.claves.p256dh,
        auth: datos.claves.auth,
        agente: datos.agente ?? null,
      },
      update: {
        usuarioId,
        p256dh: datos.claves.p256dh,
        auth: datos.claves.auth,
        agente: datos.agente ?? null,
        fallos: 0,
      },
    });
  }

  /** Lo que tiene que mostrar la campana. */
  async mios(usuarioId: string) {
    const avisos = await this.prisma.aviso.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });
    return { avisos, sinLeer: avisos.filter((a) => !a.leido).length };
  }

  /** Se marcan al abrir la campana: es cuando de verdad los vio. */
  async marcarLeidos(usuarioId: string) {
    const { count } = await this.prisma.aviso.updateMany({
      where: { usuarioId, leido: false },
      data: { leido: true },
    });
    return { leidos: count };
  }

  async desuscribir(usuarioId: string, endpoint: string) {
    const { count } = await this.prisma.suscripcionPush.deleteMany({ where: { usuarioId, endpoint } });
    if (count === 0) throw noEncontrado('La suscripción');
    return { baja: true };
  }

  /**
   * Manda un aviso a todos los dispositivos de una persona. Devuelve a cuántos
   * llegó: cero no es un error —puede no tener ninguno— pero sirve para saberlo.
   */
  async enviar(usuarioId: string, aviso: Aviso): Promise<number> {
    // Se guarda antes de intentar mandarlo, y aunque el push no esté
    // configurado. Quien no dio permiso de avisos —o entra desde otro
    // teléfono— si no, no se entera nunca de nada: ni de que le tomaron el
    // trabajo, ni de que el otro va en camino.
    await this.prisma.aviso
      .create({
        data: {
          usuarioId,
          titulo: aviso.titulo,
          cuerpo: aviso.cuerpo,
          url: aviso.url,
          tareaId: aviso.tareaId,
        },
      })
      .catch(() => {
        /* Un aviso que no se pudo anotar no tiene que voltear la operación. */
      });

    if (!this.configurado) return 0;
    const destinos = await this.prisma.suscripcionPush.findMany({ where: { usuarioId } });
    let entregados = 0;

    for (const destino of destinos) {
      try {
        await webpush.sendNotification(
          {
            endpoint: destino.endpoint,
            keys: { p256dh: destino.p256dh, auth: destino.auth },
          },
          JSON.stringify(aviso),
          { TTL: 900 },
        );
        entregados++;
        await this.prisma.suscripcionPush.update({
          where: { id: destino.id },
          data: { ultimoEnvio: new Date(), fallos: 0 },
        });
      } catch (error) {
        await this.anotarFallo(destino.id, error);
      }
    }
    return entregados;
  }

  /**
   * Una pasada del reloj: anuncia las olas que se abrieron desde la última vez.
   *
   * El candado es el mismo de siempre: el UPDATE lleva la condición de que la
   * ola avisada siga siendo la que se leyó. Si el reloj corre dos veces o en
   * dos servidores, el segundo afecta cero filas y no avisa de nuevo.
   */
  async anunciarOlas(ahora = new Date(), limite = 100) {
    const resumen = { tareas: 0, avisos: 0 };
    if (!this.configurado) return resumen;

    const tareas = await this.prisma.tarea.findMany({
      where: { estado: 'PUBLICADA', expiraEn: { gt: ahora }, olaAvisada: { lt: ULTIMA_OLA } },
      orderBy: { publicadaEn: 'asc' },
      take: limite,
    });

    for (const tarea of tareas) {
      if (!tarea.publicadaEn) continue;
      const pendientes = olasPendientes(tarea.publicadaEn, tarea.olaAvisada, ahora);
      if (pendientes.length === 0) continue;

      // Buscar a los candidatos antes de marcar la ola: si la consulta falla,
      // la ola queda sin avisar y se reintenta en la pasada siguiente. Al revés
      // —marcar primero— un error dejaría esa ola muda para siempre.
      const candidatos = await this.candidatos(tarea.lat, tarea.lng, tarea.autorId);
      const enDominio = aTareaDominio(tarea);

      const ultima = pendientes[pendientes.length - 1]!;
      const { count } = await this.prisma.tarea.updateMany({
        where: { id: tarea.id, olaAvisada: tarea.olaAvisada },
        data: { olaAvisada: ultima.indice },
      });
      if (count === 0) continue;

      let avisados = 0;
      for (const ola of pendientes) {
        const destinos = destinatariosDeOla(enDominio, candidatos.perfiles, ola);
        for (const perfil of destinos) {
          avisados += await this.enviar(perfil.id, {
            titulo: `${tarea.titulo}`,
            cuerpo: `${formatearMonto(tarea.presupuesto, tarea.moneda)} · ${tarea.folio}`,
            url: `/tarea/${tarea.folio}`,
            etiqueta: `tarea-${tarea.id}`,
          });
        }
      }
      resumen.tareas++;
      resumen.avisos += avisados;
    }
    return resumen;
  }

  /**
   * Los trabajadores que podrían llegar a esta tarea. Se filtran por zona en la
   * base: mandarle la tabla entera al dominio funcionaría con veinte perfiles y
   * no con veinte mil.
   */
  private async candidatos(lat: number, lng: number, autorId: string) {
    const caja = cajaDeBusqueda({ lat, lng }, RADIO_MAXIMO_OLA);
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        id: { not: autorId },
        suspendido: false,
        perfil: {
          disponible: true,
          lat: { gte: caja.latMin, lte: caja.latMax },
          lng: { gte: caja.lngMin, lte: caja.lngMax },
        },
        suscripciones: { some: {} },
      },
      include: { perfil: { include: { habilidades: true } }, identidad: true },
      take: 500,
    });

    return {
      perfiles: usuarios
        .filter((u) => u.perfil)
        .map((u) => aPerfilDominio(u, u.perfil!, u.identidad?.estado === 'VERIFICADO')),
    };
  }

  /**
   * El navegador dice que esa suscripción ya no existe: se borra. Cualquier
   * otro error se cuenta, y a los cinco seguidos también se borra —un destino
   * que nunca contesta sólo hace más lento cada envío—.
   */
  private async anotarFallo(id: string, error: unknown) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await this.prisma.suscripcionPush.delete({ where: { id } }).catch(() => undefined);
      return;
    }
    const actualizada = await this.prisma.suscripcionPush
      .update({ where: { id }, data: { fallos: { increment: 1 } } })
      .catch(() => null);
    if (actualizada && actualizada.fallos >= MAX_FALLOS) {
      await this.prisma.suscripcionPush.delete({ where: { id } }).catch(() => undefined);
    }
  }
}

function formatearMonto(monto: number, moneda: string): string {
  const sinDecimales = ['CLP', 'JPY', 'KRW', 'PYG', 'VND', 'ISK', 'COP'].includes(moneda);
  const valor = sinDecimales ? monto : monto / 100;
  return `${moneda === 'CLP' ? '$' : ''}${valor.toLocaleString('es-CL')}`;
}
