import type { Habilidad, PerfilTrabajador as PerfilDb, Tarea, Usuario } from '@prisma/client';
import type { PerfilTrabajador, TareaPublicada } from '@tareas/domain';

/** Traduce el perfil guardado al perfil que entiende el dominio. */
export function aPerfilDominio(
  usuario: Pick<Usuario, 'id' | 'telefonoOk' | 'suspendido'>,
  perfil: PerfilDb & { habilidades: Habilidad[] },
  identidadVerificada: boolean,
): PerfilTrabajador {
  return {
    id: usuario.id,
    nivel: perfil.nivel,
    calificacion: perfil.calificacion,
    trabajosCompletados: perfil.trabajosCompletados,
    identidadVerificada,
    telefonoVerificado: usuario.telefonoOk,
    antecedentesVerificados: perfil.antecedentes === 'VERIFICADO',
    rubros: perfil.habilidades.map((h) => h.rubroSlug),
    licencias: perfil.habilidades.filter((h) => h.licenciaEstado === 'VERIFICADO').map((h) => h.rubroSlug),
    ubicacion: { lat: perfil.lat ?? 0, lng: perfil.lng ?? 0 },
    radioKm: perfil.radioKm,
    // El saldo negativo es deuda de comisiones de trabajos cobrados en efectivo.
    deudaComisiones: perfil.saldo < 0 ? -perfil.saldo : 0,
    aceptaEfectivo: perfil.aceptaEfectivo,
    suspendido: usuario.suspendido,
  };
}

export function aTareaDominio(tarea: Tarea): TareaPublicada {
  if (!tarea.publicadaEn) throw new Error(`La tarea ${tarea.folio} no está publicada`);
  return {
    id: tarea.id,
    folio: tarea.folio,
    rubroSlug: tarea.rubroSlug,
    autorId: tarea.autorId,
    ubicacion: { lat: tarea.lat, lng: tarea.lng },
    nivelMinimo: tarea.nivelMinimo,
    presupuesto: tarea.presupuesto,
    metodoPago: tarea.metodoPago,
    publicadaEn: tarea.publicadaEn,
    exigeAntecedentes: tarea.exigeAntecedentes,
  };
}
