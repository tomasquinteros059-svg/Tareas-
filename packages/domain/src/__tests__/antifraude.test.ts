import { describe, expect, it } from 'vitest';
import { revisarRelacion, revisarRitmo, revisarTexto, riesgo } from '../antifraude.js';

describe('pactar por fuera', () => {
  it('encuentra un teléfono, aunque venga separado para disimular', () => {
    expect(revisarTexto('mi cel es 9 1234 5678', true)[0]?.senal).toBe('CONTACTO_POR_FUERA');
    expect(revisarTexto('llamame al +56 9 1234 5678')[0]?.senal).toBe('CONTACTO_POR_FUERA');
    expect(revisarTexto('escribime a beto.gomez@gmail.com')[0]?.senal).toBe('CONTACTO_POR_FUERA');
  });

  it('pesa mucho más en una pregunta pública que en el chat de la tarea', () => {
    const publico = revisarTexto('mi numero es 912345678', true);
    const privado = revisarTexto('mi numero es 912345678', false);
    expect(publico[0]!.peso).toBeGreaterThan(privado[0]!.peso);
  });

  it('reconoce la intención aunque no deje ningún número', () => {
    const hallazgos = revisarTexto('mejor lo arreglamos por whatsapp y nos evitamos la comisión');
    expect(hallazgos.map((h) => h.senal)).toContain('PEDIDO_DE_TRATO_DIRECTO');
  });

  it('con la tarea ya asignada, coordinar por teléfono no es pactar por fuera', () => {
    const chat = revisarTexto('Llamame al 912345678 cuando llegues');
    expect(chat.map((h) => h.senal)).toEqual(['CONTACTO_POR_FUERA']);

    // La misma frase antes de asignar sí: ahí no hay nada que coordinar.
    const pregunta = revisarTexto('Llamame al 912345678 cuando llegues', true);
    expect(pregunta.map((h) => h.senal)).toContain('PEDIDO_DE_TRATO_DIRECTO');
  });

  it('no se asusta con un mensaje normal', () => {
    expect(revisarTexto('Hola, puedo ir el martes a las 10. Llevo mi máquina.')).toEqual([]);
    expect(revisarTexto('El presupuesto de $28.000 me parece bien')).toEqual([]);
    expect(revisarTexto('Te mando una foto por acá cuando termine')).toEqual([]);
  });
});

describe('cuentas que se califican entre sí', () => {
  it('marca el par que se publica trabajos de ida y vuelta', () => {
    const hallazgos = revisarRelacion({
      tareasConEsteCliente: 5,
      tareasInvertidas: 5,
      tareasDelTrabajador: 5,
    });
    expect(hallazgos.map((h) => h.senal)).toContain('PAR_RECIPROCO');
    expect(hallazgos.map((h) => h.senal)).toContain('CLIENTE_UNICO');
  });

  it('no marca al cliente que volvió a llamar al mismo jardinero', () => {
    expect(
      revisarRelacion({ tareasConEsteCliente: 3, tareasInvertidas: 0, tareasDelTrabajador: 40 }),
    ).toEqual([]);
  });

  it('dos trabajos entre las mismas personas no alcanzan', () => {
    expect(
      revisarRelacion({ tareasConEsteCliente: 1, tareasInvertidas: 1, tareasDelTrabajador: 2 }),
    ).toEqual([]);
  });
});

describe('tareas fantasma', () => {
  it('un trabajo de tres horas no se entrega en noventa segundos', () => {
    const hallazgos = revisarRitmo({
      segundosHastaAceptar: 5,
      segundosDeTrabajo: 90,
      horasCotizadas: 3,
    });
    expect(hallazgos.map((h) => h.senal)).toEqual(['TAREA_RELAMPAGO', 'CALIFICACION_EXPRESS']);
  });

  it('un trabajo que llevó lo que tenía que llevar no se marca', () => {
    expect(
      revisarRitmo({ segundosHastaAceptar: 120, segundosDeTrabajo: 3 * 3600, horasCotizadas: 3 }),
    ).toEqual([]);
  });
});

describe('el puntaje de riesgo', () => {
  it('sin señales no hay riesgo', () => {
    expect(riesgo([])).toEqual({ puntaje: 0, nivel: 'BAJO' });
  });

  it('una señal fuerte sola ya es riesgo medio', () => {
    expect(riesgo(revisarTexto('mi numero es 912345678', true)).nivel).toBe('MEDIO');
  });

  it('varias señales flojas no valen lo mismo que una fuerte', () => {
    const tres = riesgo([
      { senal: 'CLIENTE_UNICO', peso: 35, detalle: '' },
      { senal: 'CLIENTE_UNICO', peso: 35, detalle: '' },
      { senal: 'CLIENTE_UNICO', peso: 35, detalle: '' },
    ]);
    expect(tres.puntaje).toBeLessThan(35 * 3);
  });

  it('el par recíproco con teléfono público llega a alto', () => {
    const puntaje = riesgo([
      ...revisarTexto('te paso mi numero: 912345678', true),
      ...revisarRelacion({ tareasConEsteCliente: 5, tareasInvertidas: 5, tareasDelTrabajador: 5 }),
    ]);
    expect(puntaje.nivel).toBe('ALTO');
  });

  it('nunca pasa de 100', () => {
    const muchos = Array.from({ length: 20 }, () => ({
      senal: 'PAR_RECIPROCO' as const,
      peso: 50,
      detalle: '',
    }));
    expect(riesgo(muchos).puntaje).toBe(100);
  });
});
