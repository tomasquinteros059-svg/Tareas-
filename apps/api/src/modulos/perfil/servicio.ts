import type { PrismaClient } from '@prisma/client';
import { buscarRubro, CATALOGO } from '@tareas/domain';
import { invalido, noEncontrado } from '../../lib/errores.js';

/**
 * El perfil de trabajador.
 *
 * Faltaba, y era un agujero raro: la base lo tenía, el despacho lo usaba para
 * decidir quién puede tomar cada tarea, y no había forma de crearlo desde la
 * app. Los perfiles existían porque los creaba la semilla. Con esto, alguien
 * que se registra puede pasar de cliente a trabajador sin que nadie toque la
 * base a mano.
 *
 * Dos cosas no se tocan desde acá, a propósito:
 *
 *  - **la matrícula**. Uno declara que es electricista; que lo sea lo valida
 *    soporte contra el papel. Si el trabajador pudiera aprobarse la licencia
 *    solo, la licencia no querría decir nada;
 *  - **los antecedentes**, por lo mismo: son lo que habilita a entrar a una
 *    casa con chicos.
 */
export interface DatosPerfil {
  bio?: string;
  /** Dónde trabaja: es el centro del radar. */
  lat: number;
  lng: number;
  radioKm: number;
  /** Oficios que dice hacer. Los que piden matrícula quedan en revisión. */
  rubros: string[];
  aceptaEfectivo?: boolean;
  /** Si aparece o no en el radar. Apagarlo es irse de vacaciones sin borrar nada. */
  disponible?: boolean;
}

const RADIO_MINIMO = 1;
const RADIO_MAXIMO = 60;
const MAX_RUBROS = 8;

export class ServicioPerfil {
  constructor(private readonly prisma: PrismaClient) {}

  /** El perfil propio, con lo que falta para poder trabajar. */
  async ver(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { perfil: { include: { habilidades: true } }, identidad: true },
    });
    if (!usuario) throw noEncontrado('El usuario');

    const perfil = usuario.perfil;
    return {
      perfil: perfil
        ? {
            bio: perfil.bio,
            nivel: perfil.nivel,
            calificacion: perfil.calificacion,
            trabajosCompletados: perfil.trabajosCompletados,
            trabajosAceptados: perfil.trabajosAceptados,
            trabajosCancelados: perfil.trabajosCancelados,
            cantidadCalificaciones: perfil.cantidadCalificaciones,
            llegadasPuntuales: perfil.llegadasPuntuales,
            lat: perfil.lat,
            lng: perfil.lng,
            radioKm: perfil.radioKm,
            disponible: perfil.disponible,
            aceptaEfectivo: perfil.aceptaEfectivo,
            saldo: perfil.saldo,
            antecedentes: perfil.antecedentes,
            habilidades: perfil.habilidades.map((h) => ({
              rubroSlug: h.rubroSlug,
              licenciaEstado: h.licenciaEstado,
              requiereLicencia: buscarRubro(h.rubroSlug)?.requiereLicencia ?? false,
            })),
          }
        : null,
      // La lista de lo que falta es lo que la app dibuja como pasos: es mejor
      // decirlo acá una vez que reconstruirlo en cada cliente.
      pendientes: pendientes(usuario),
    };
  }

  /**
   * Crea o actualiza el perfil. Es idempotente: mandar lo mismo dos veces deja
   * lo mismo, y agregar un oficio no borra la matrícula ya aprobada de otro.
   */
  async guardar(usuarioId: string, datos: DatosPerfil) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) throw noEncontrado('El usuario');

    if (!Number.isFinite(datos.lat) || !Number.isFinite(datos.lng)) {
      throw invalido('SIN_UBICACION', 'Marcá dónde trabajás: es el centro de tu radar');
    }
    if (datos.lat === 0 && datos.lng === 0) {
      throw invalido('SIN_UBICACION', 'Marcá dónde trabajás: es el centro de tu radar');
    }
    if (!(datos.radioKm >= RADIO_MINIMO && datos.radioKm <= RADIO_MAXIMO)) {
      throw invalido('RADIO_INVALIDO', `El radio va de ${RADIO_MINIMO} a ${RADIO_MAXIMO} km`);
    }

    const rubros = [...new Set(datos.rubros.map((r) => r.trim()).filter(Boolean))];
    if (rubros.length === 0) throw invalido('SIN_RUBROS', 'Elegí al menos un oficio');
    if (rubros.length > MAX_RUBROS) {
      throw invalido('DEMASIADOS_RUBROS', `Elegí hasta ${MAX_RUBROS} oficios: es mejor hacer pocos bien`);
    }
    const desconocido = rubros.find((r) => !buscarRubro(r));
    if (desconocido) {
      throw invalido('RUBRO_INEXISTENTE', `No conocemos el oficio "${desconocido}"`, {
        conocidos: CATALOGO.map((r) => r.slug),
      });
    }

    const comun = {
      bio: datos.bio?.trim() || null,
      lat: datos.lat,
      lng: datos.lng,
      radioKm: datos.radioKm,
      aceptaEfectivo: datos.aceptaEfectivo ?? true,
      disponible: datos.disponible ?? true,
    };

    const perfil = await this.prisma.perfilTrabajador.upsert({
      where: { usuarioId },
      create: { usuarioId, ...comun },
      update: comun,
      include: { habilidades: true },
    });

    // Los oficios que ya estaban se dejan como están —con su matrícula y su
    // antigüedad—; se agregan los nuevos y se borran los que sacó.
    const tenia = new Set(perfil.habilidades.map((h) => h.rubroSlug));
    const quiere = new Set(rubros);
    const agregar = rubros.filter((r) => !tenia.has(r));
    const sacar = perfil.habilidades.filter((h) => !quiere.has(h.rubroSlug)).map((h) => h.id);

    if (agregar.length || sacar.length) {
      await this.prisma.$transaction([
        ...(sacar.length ? [this.prisma.habilidad.deleteMany({ where: { id: { in: sacar } } })] : []),
        ...agregar.map((rubroSlug) =>
          this.prisma.habilidad.create({
            data: {
              perfilId: perfil.id,
              rubroSlug,
              // Lo que pide matrícula entra en revisión: lo aprueba soporte
              // contra el papel, no el propio interesado.
              licenciaEstado: buscarRubro(rubroSlug)!.requiereLicencia ? 'EN_REVISION' : 'PENDIENTE',
            },
          }),
        ),
      ]);
    }

    // Trabajar es un rol: sin esto la sesión siguiente no lo tendría.
    if (!usuario.roles.includes('TRABAJADOR')) {
      await this.prisma.usuario.update({
        where: { id: usuarioId },
        data: { roles: { set: [...usuario.roles, 'TRABAJADOR'] } },
      });
    }

    return this.ver(usuarioId);
  }

  /** Irse de vacaciones sin borrar nada. */
  async cambiarDisponibilidad(usuarioId: string, disponible: boolean) {
    const perfil = await this.prisma.perfilTrabajador.findUnique({ where: { usuarioId } });
    if (!perfil) throw noEncontrado('El perfil de trabajador');
    await this.prisma.perfilTrabajador.update({ where: { usuarioId }, data: { disponible } });
    return this.ver(usuarioId);
  }
}

/** Qué le falta a esta persona para poder tomar un trabajo. */
function pendientes(usuario: {
  telefonoOk: boolean;
  perfil: { habilidades: { rubroSlug: string; licenciaEstado: string }[] } | null;
  identidad: { estado: string } | null;
}): string[] {
  const falta: string[] = [];
  if (!usuario.telefonoOk) falta.push('VERIFICAR_TELEFONO');
  if (!usuario.perfil) falta.push('CREAR_PERFIL');
  if (!usuario.identidad) falta.push('CARGAR_DOCUMENTO');
  else if (usuario.identidad.estado !== 'VERIFICADO') falta.push('ESPERANDO_DOCUMENTO');

  const enRevision = (usuario.perfil?.habilidades ?? []).filter(
    (h) => buscarRubro(h.rubroSlug)?.requiereLicencia && h.licenciaEstado !== 'VERIFICADO',
  );
  if (enRevision.length) falta.push('ESPERANDO_MATRICULA');
  return falta;
}
