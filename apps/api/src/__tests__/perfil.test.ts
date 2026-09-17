import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { contextoDePrueba, crearCliente, limpiar, prisma } from './ayuda.js';

const ctx = contextoDePrueba();

beforeEach(limpiar);
afterAll(async () => {
  await prisma.$disconnect();
});

const SANTIAGO = { lat: -33.4489, lng: -70.6693 };
const BASE = { ...SANTIAGO, radioKm: 20, rubros: ['jardineria-corte-pasto'] };

describe('activar el perfil de trabajador', () => {
  it('lo crea y suma el rol: antes sólo se podía mirar y publicar', async () => {
    const usuario = await crearCliente('Ana');

    const r = await ctx.perfil.guardar(usuario.id, { ...BASE, bio: 'Corto pasto hace años.' });

    expect(r.perfil).toMatchObject({ radioKm: 20, disponible: true, nivel: 'NUEVO' });
    expect(r.perfil!.habilidades.map((h) => h.rubroSlug)).toEqual(['jardineria-corte-pasto']);
    const actualizado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(actualizado.roles).toContain('TRABAJADOR');
  });

  it('dice qué falta para poder tomar un trabajo', async () => {
    const usuario = await crearCliente();

    const r = await ctx.perfil.guardar(usuario.id, BASE);

    expect(r.pendientes).toContain('CARGAR_DOCUMENTO');
    expect(r.pendientes).not.toContain('CREAR_PERFIL');
  });

  it('un oficio con matrícula queda en revisión, no aprobado por uno mismo', async () => {
    const usuario = await crearCliente();

    const r = await ctx.perfil.guardar(usuario.id, { ...BASE, rubros: ['electricidad'] });

    expect(r.perfil!.habilidades[0]).toMatchObject({
      rubroSlug: 'electricidad',
      licenciaEstado: 'EN_REVISION',
      requiereLicencia: true,
    });
    expect(r.pendientes).toContain('ESPERANDO_MATRICULA');
  });

  it('guardar dos veces no duplica ni pierde la matrícula ya aprobada', async () => {
    const usuario = await crearCliente();
    await ctx.perfil.guardar(usuario.id, { ...BASE, rubros: ['electricidad', 'jardineria-corte-pasto'] });
    // Soporte aprobó la matrícula de electricista.
    await prisma.habilidad.updateMany({
      where: { rubroSlug: 'electricidad' },
      data: { licenciaEstado: 'VERIFICADO' },
    });

    const r = await ctx.perfil.guardar(usuario.id, {
      ...BASE,
      rubros: ['electricidad', 'jardineria-corte-pasto', 'plomeria'],
    });

    const porSlug = Object.fromEntries(r.perfil!.habilidades.map((h) => [h.rubroSlug, h.licenciaEstado]));
    expect(porSlug['electricidad']).toBe('VERIFICADO');
    expect(porSlug['plomeria']).toBe('EN_REVISION');
    expect(Object.keys(porSlug)).toHaveLength(3);
  });

  it('sacar un oficio lo saca de verdad', async () => {
    const usuario = await crearCliente();
    await ctx.perfil.guardar(usuario.id, { ...BASE, rubros: ['jardineria-corte-pasto', 'limpieza-hogar'] });

    const r = await ctx.perfil.guardar(usuario.id, { ...BASE, rubros: ['limpieza-hogar'] });

    expect(r.perfil!.habilidades.map((h) => h.rubroSlug)).toEqual(['limpieza-hogar']);
  });
});

describe('lo que el perfil no acepta', () => {
  it('un oficio que no existe, con la lista de los que sí', async () => {
    const usuario = await crearCliente();

    await expect(
      ctx.perfil.guardar(usuario.id, { ...BASE, rubros: ['domador-de-leones'] }),
    ).rejects.toMatchObject({ codigo: 'RUBRO_INEXISTENTE' });
  });

  it('sin oficios no hay perfil', async () => {
    const usuario = await crearCliente();
    await expect(ctx.perfil.guardar(usuario.id, { ...BASE, rubros: [] })).rejects.toMatchObject({
      codigo: 'SIN_RUBROS',
    });
  });

  it('sin zona marcada no hay radar', async () => {
    const usuario = await crearCliente();
    await expect(
      ctx.perfil.guardar(usuario.id, { ...BASE, lat: 0, lng: 0 }),
    ).rejects.toMatchObject({ codigo: 'SIN_UBICACION' });
  });

  it('un radio de mil kilómetros no es una zona', async () => {
    const usuario = await crearCliente();
    await expect(ctx.perfil.guardar(usuario.id, { ...BASE, radioKm: 1000 })).rejects.toMatchObject({
      codigo: 'RADIO_INVALIDO',
    });
  });

  it('veinte oficios no son un oficio', async () => {
    const usuario = await crearCliente();
    const muchos = ['jardineria-corte-pasto', 'limpieza-hogar', 'pintura', 'plomeria', 'electricidad',
      'carpinteria', 'albanileria', 'mudanza-flete', 'mensajeria'];
    await expect(ctx.perfil.guardar(usuario.id, { ...BASE, rubros: muchos })).rejects.toMatchObject({
      codigo: 'DEMASIADOS_RUBROS',
    });
  });
});

describe('irse de vacaciones', () => {
  it('apaga el radar sin borrar nada', async () => {
    const usuario = await crearCliente();
    await ctx.perfil.guardar(usuario.id, BASE);

    const apagado = await ctx.perfil.cambiarDisponibilidad(usuario.id, false);
    expect(apagado.perfil!.disponible).toBe(false);
    expect(apagado.perfil!.habilidades).toHaveLength(1);

    const prendido = await ctx.perfil.cambiarDisponibilidad(usuario.id, true);
    expect(prendido.perfil!.disponible).toBe(true);
  });
});

describe('el camino completo desde cero', () => {
  it('una cuenta nueva llega a ver el muro y a tomar un trabajo', async () => {
    const cliente = await crearCliente('Clienta');
    const nuevo = await crearCliente('Recién llegado');

    // 1. Activa el perfil.
    await ctx.perfil.guardar(nuevo.id, BASE);
    // 2. Carga el documento.
    await ctx.identidad.registrar(nuevo.id, {
      tipoDocumento: 'CEDULA',
      numero: '18456789',
      paisEmision: 'CL',
      nombreLegal: 'Recién Llegado Pérez',
      fechaNacimiento: new Date('1995-03-04'),
    });
    let estado = await ctx.perfil.ver(nuevo.id);
    expect(estado.pendientes).toContain('ESPERANDO_DOCUMENTO');

    // 3. Soporte lo aprueba.
    const soporte = await crearCliente('Soporte');
    await ctx.identidad.resolver(nuevo.id, true, soporte.id);
    estado = await ctx.perfil.ver(nuevo.id);
    expect(estado.pendientes).toEqual([]);

    // 4. Ahora ve el muro y puede tomar.
    const tarea = await ctx.tareas.publicar(cliente.id, {
      rubroSlug: 'jardineria-corte-pasto',
      titulo: 'Cortar el pasto del fondo',
      descripcion: 'Son unos 80 m2, con máquina propia. Hay canilla y enchufe.',
      unidades: 3,
      dificultad: 'BASICA',
      urgencia: 'PROGRAMADA',
      nivelMinimo: 'NUEVO',
      presupuesto: 30_000,
      metodoPago: 'TARJETA',
      metodoPagoToken: 'tok_ok_4242',
      lat: SANTIAGO.lat,
      lng: SANTIAGO.lng,
    });
    // Recién publicada, la tarea todavía es de la primera ola: sólo la ven los
    // de nivel alto. El que arranca la ve en el muro y con el reloj al lado.
    let muro = (await ctx.tareas.feed(nuevo.id)).tareas;
    expect(muro.map((t) => t.id)).toContain(tarea.id);
    expect(muro[0]).toMatchObject({ elegible: false, motivo: 'TURNO_NO_ABIERTO' });
    expect(muro[0]!.detalle).toMatch(/se abre para tu nivel/i);

    // Quince minutos después se abre para todos.
    await prisma.tarea.update({
      where: { id: tarea.id },
      data: { publicadaEn: new Date(Date.now() - 16 * 60 * 1000) },
    });
    muro = (await ctx.tareas.feed(nuevo.id)).tareas;
    expect(muro[0]!.elegible).toBe(true);

    const tomada = await ctx.tareas.aceptar(tarea.id, nuevo.id);
    expect(tomada.trabajadorId).toBe(nuevo.id);
  });
});
