import { describe, expect, it } from 'vitest';
import {
  OLAS,
  destinatariosDeOla,
  evaluarElegibilidad,
  olaActual,
  olasPendientes,
  ordenarFeed,
  type TareaPublicada,
} from '../despacho.js';
import type { Nivel, PerfilTrabajador } from '../tipos.js';

const PUBLICADA = new Date('2026-09-08T12:00:00Z');

const tarea = (extra: Partial<TareaPublicada> = {}): TareaPublicada => ({
  id: 't1',
  folio: 'TQ-260908-4F7K',
  rubroSlug: 'jardineria-corte-pasto',
  autorId: 'cliente-1',
  ubicacion: { lat: -34.6037, lng: -58.3816 },
  nivelMinimo: 'NUEVO',
  presupuesto: 3000,
  metodoPago: 'TARJETA',
  publicadaEn: PUBLICADA,
  ...extra,
});

const trabajador = (extra: Partial<PerfilTrabajador> = {}): PerfilTrabajador => ({
  id: 'w1',
  nivel: 'PLATA',
  calificacion: 4.6,
  trabajosCompletados: 20,
  identidadVerificada: true,
  telefonoVerificado: true,
  antecedentesVerificados: false,
  rubros: ['jardineria-corte-pasto'],
  licencias: [],
  ubicacion: { lat: -34.61, lng: -58.39 },
  radioKm: 20,
  deudaComisiones: 0,
  aceptaEfectivo: true,
  suspendido: false,
  ...extra,
});

const enSegundos = (s: number) => new Date(PUBLICADA.getTime() + s * 1000);

describe('olas de radar', () => {
  it('arranca reservada para los mejor calificados y se va abriendo', () => {
    expect(olaActual(0).nivelMinimo).toBe('ORO');
    expect(olaActual(120).nivelMinimo).toBe('PLATA');
    expect(olaActual(600).nivelMinimo).toBe('BRONCE');
    expect(olaActual(5000).nivelMinimo).toBe('NUEVO');
  });

  it('un PLATA no ve la tarea en el primer minuto pero sí después', () => {
    const t = tarea();
    const w = trabajador();
    const temprano = evaluarElegibilidad(t, w, { ahora: enSegundos(10) });
    expect(temprano.elegible).toBe(false);
    expect(temprano.motivo).toBe('TURNO_NO_ABIERTO');
    expect(temprano.detalle).toMatch(/80 s/);
    expect(evaluarElegibilidad(t, w, { ahora: enSegundos(120) }).elegible).toBe(true);
  });

  it('un PLATINO puede tomarla desde el segundo cero', () => {
    const r = evaluarElegibilidad(tarea(), trabajador({ nivel: 'PLATINO' }), { ahora: enSegundos(1) });
    expect(r.elegible).toBe(true);
  });
});

describe('elegibilidad', () => {
  const ahora = enSegundos(1000);

  it('el autor no puede tomar su propia tarea', () => {
    const r = evaluarElegibilidad(tarea(), trabajador({ id: 'cliente-1' }), { ahora });
    expect(r.motivo).toBe('AUTOR_NO_PUEDE_TOMAR');
  });

  it('exige identidad y teléfono verificados', () => {
    expect(evaluarElegibilidad(tarea(), trabajador({ identidadVerificada: false }), { ahora }).motivo).toBe(
      'IDENTIDAD_NO_VERIFICADA',
    );
    expect(evaluarElegibilidad(tarea(), trabajador({ telefonoVerificado: false }), { ahora }).motivo).toBe(
      'TELEFONO_NO_VERIFICADO',
    );
  });

  it('exige matrícula en los rubros que la requieren', () => {
    const t = tarea({ rubroSlug: 'electricidad' });
    const sinLicencia = trabajador({ rubros: ['electricidad'], nivel: 'ORO' });
    expect(evaluarElegibilidad(t, sinLicencia, { ahora }).motivo).toBe('LICENCIA_FALTANTE');
    const conLicencia = trabajador({ rubros: ['electricidad'], licencias: ['electricidad'], nivel: 'ORO' });
    expect(evaluarElegibilidad(t, conLicencia, { ahora }).elegible).toBe(true);
  });

  it('exige antecedentes cuando el rubro o el cliente lo piden', () => {
    const t = tarea({ rubroSlug: 'cuidado-ninos' });
    const w = trabajador({ rubros: ['cuidado-ninos'] });
    expect(evaluarElegibilidad(t, w, { ahora }).motivo).toBe('ANTECEDENTES_FALTANTES');
    expect(
      evaluarElegibilidad(tarea({ exigeAntecedentes: true }), trabajador(), { ahora }).motivo,
    ).toBe('ANTECEDENTES_FALTANTES');
  });

  it('respeta el nivel mínimo que pidió el cliente', () => {
    const r = evaluarElegibilidad(tarea({ nivelMinimo: 'ORO' }), trabajador(), { ahora });
    expect(r.motivo).toBe('NIVEL_INSUFICIENTE');
  });

  it('bloquea a quien debe comisiones de trabajos en efectivo', () => {
    const r = evaluarElegibilidad(tarea(), trabajador({ deudaComisiones: 5000 }), { ahora });
    expect(r.motivo).toBe('DEUDA_DE_COMISIONES');
  });

  it('no ofrece tareas en efectivo a quien no lo acepta', () => {
    const r = evaluarElegibilidad(tarea({ metodoPago: 'EFECTIVO' }), trabajador({ aceptaEfectivo: false }), {
      ahora,
    });
    expect(r.motivo).toBe('NO_ACEPTA_EFECTIVO');
  });

  it('descarta lo que queda fuera del radio del trabajador', () => {
    const lejos = trabajador({ ubicacion: { lat: -31.42, lng: -64.18 }, radioKm: 30 });
    const r = evaluarElegibilidad(tarea(), lejos, { ahora });
    expect(r.motivo).toBe('FUERA_DE_RADIO');
    expect(r.distanciaKm).toBeGreaterThan(600);
  });
});

describe('ordenarFeed', () => {
  it('pone primero lo tomable y después ordena por cercanía', () => {
    const cerca = tarea({ id: 'cerca', ubicacion: { lat: -34.605, lng: -58.382 }, presupuesto: 2000 });
    const lejos = tarea({ id: 'lejos', ubicacion: { lat: -34.7, lng: -58.5 }, presupuesto: 9000 });
    const bloqueada = tarea({ id: 'bloqueada', nivelMinimo: 'PLATINO' });
    const feed = ordenarFeed([lejos, bloqueada, cerca], trabajador(), { ahora: enSegundos(1000) });
    expect(feed.map((x) => x.tarea.id)).toEqual(['cerca', 'lejos']);
  });
});

describe('a quién se le avisa en cada ola', () => {
  const tarea: TareaPublicada = {
    id: 't1',
    folio: 'TQ-260914-A1B2',
    rubroSlug: 'jardineria-corte-pasto',
    autorId: 'cliente',
    ubicacion: { lat: -33.4489, lng: -70.6693 },
    nivelMinimo: 'NUEVO',
    presupuesto: 30_000,
    metodoPago: 'TARJETA',
    publicadaEn: new Date('2026-09-14T12:00:00Z'),
  };

  /** Un trabajador habilitado, a `km` de la tarea. */
  function trabajador(id: string, nivel: Nivel, km = 1): PerfilTrabajador {
    return {
      id,
      nivel,
      calificacion: 4.8,
      trabajosCompletados: 50,
      identidadVerificada: true,
      telefonoVerificado: true,
      antecedentesVerificados: true,
      rubros: ['jardineria-corte-pasto'],
      licencias: [],
      ubicacion: { lat: -33.4489 + km / 111.32, lng: -70.6693 },
      radioKm: 40,
      deudaComisiones: 0,
      aceptaEfectivo: true,
      suspendido: false,
    };
  }

  const todos = [
    trabajador('oro', 'ORO'),
    trabajador('plata', 'PLATA'),
    trabajador('bronce', 'BRONCE'),
    trabajador('nuevo', 'NUEVO'),
    trabajador('oro-lejos', 'ORO', 30),
  ];

  it('la primera ola es sólo para los de nivel alto y cerca', () => {
    const destinos = destinatariosDeOla(tarea, todos, OLAS[0]!).map((t) => t.id);
    expect(destinos).toEqual(['oro']);
  });

  it('cada ola avisa sólo a los que recién ahora pueden tomarla', () => {
    expect(destinatariosDeOla(tarea, todos, OLAS[1]!).map((t) => t.id)).toEqual(['plata']);
    expect(destinatariosDeOla(tarea, todos, OLAS[2]!).map((t) => t.id)).toEqual(['bronce']);
  });

  it('el que estaba fuera de radio entra cuando el radio crece', () => {
    const destinos = destinatariosDeOla(tarea, todos, OLAS[3]!).map((t) => t.id);
    expect(destinos).toContain('nuevo');
    expect(destinos).toContain('oro-lejos');
  });

  it('nadie recibe dos avisos por la misma tarea', () => {
    const avisados = OLAS.flatMap((ola) => destinatariosDeOla(tarea, todos, ola).map((t) => t.id));
    expect(new Set(avisados).size).toBe(avisados.length);
  });
});

describe('qué olas quedaron pendientes de avisar', () => {
  const publicada = new Date('2026-09-14T12:00:00Z');
  const enSegundos = (s: number) => new Date(publicada.getTime() + s * 1000);

  it('recién publicada, la primera', () => {
    expect(olasPendientes(publicada, -1, enSegundos(1)).map((o) => o.indice)).toEqual([0]);
  });

  it('avisada la primera, espera a que se abra la segunda', () => {
    expect(olasPendientes(publicada, 0, enSegundos(30))).toEqual([]);
    expect(olasPendientes(publicada, 0, enSegundos(100)).map((o) => o.indice)).toEqual([1]);
  });

  it('si el reloj estuvo caído, se avisan todas las que se pasaron', () => {
    expect(olasPendientes(publicada, 0, enSegundos(1000)).map((o) => o.indice)).toEqual([1, 2, 3]);
  });

  it('avisadas todas, no queda nada', () => {
    expect(olasPendientes(publicada, 3, enSegundos(99999))).toEqual([]);
  });
});
