import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Lo que este archivo cuida.
 *
 * La app tiene dos modos: la demostración, que guarda todo en el teléfono, y el
 * modo conectado, donde lo que se hace es de verdad. El error que se repitió
 * —y que hizo que la app "pareciera andar" sin andar— es siempre el mismo:
 * una pantalla que en modo conectado sigue cambiando un número local en vez de
 * llamar al servidor.
 *
 * No hay forma de detectarlo mirando la pantalla: se ve igual. Sí hay forma de
 * detectarlo leyendo el código, y es lo que hacen estas pruebas. Si mañana
 * alguien agrega una pantalla de plata sin su rama conectada, esto falla antes
 * de llegar a la calle.
 */
const HTML = readFileSync(new URL('../../../demo-app.html', import.meta.url), 'utf8');
const CONSTRUIR = readFileSync(new URL('../../../web/construir.mjs', import.meta.url), 'utf8');
const API = readFileSync(new URL('../../../web/api.js', import.meta.url), 'utf8');

/** El cuerpo de una función de la app, para poder mirarlo solo. */
function cuerpoDe(nombre: string): string {
  const inicio = HTML.indexOf(`function ${nombre}(`);
  expect(inicio, `no existe la función ${nombre} en la app`).toBeGreaterThan(-1);
  let nivel = 0;
  let i = HTML.indexOf('{', inicio);
  const desde = i;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') nivel++;
    else if (HTML[i] === '}' && --nivel === 0) return HTML.slice(desde, i + 1);
  }
  throw new Error(`no encontré el final de ${nombre}`);
}

describe('la puerta de entrada', () => {
  it('con servidor detrás, el botón grande de la portada lleva al servidor', () => {
    const acciones = cuerpoDe('accionesDePortada');
    expect(acciones).toContain('data-pantalla="servidor"');
    // Y la cuenta inventada en el teléfono queda como lo que es.
    expect(acciones).toContain('Ver la demostración sin cuenta');
  });

  it('la pantalla del servidor se puede ver sin haber creado antes una cuenta falsa', () => {
    expect(HTML).toMatch(/var PUBLICAS = \[[^\]]*"servidor"/);
  });

  it('las pantallas de la demostración avisan que son una demostración', () => {
    expect(cuerpoDe('cintaDemostracion')).toContain('Estás en la demostración');
    expect(HTML.split('h += cintaDemostracion();').length - 1).toBe(2);
  });

  it('el cliente de la API se carga antes que la app, no después', () => {
    // Al revés, la portada se dibuja sin saber todavía que hay un servidor.
    const antes = CONSTRUIR.indexOf("'</head>', '<script src=\"/api.js\">");
    expect(antes, 'api.js tiene que ir en la cabecera').toBeGreaterThan(-1);
  });
});

describe('ninguna pantalla que mueve plata se queda en el teléfono', () => {
  const conectadas: Array<[string, string]> = [
    ['pagarDeuda', 'pagarDeuda'],
    ['retirar', 'pedirRetiro'],
    ['abrirDisputa', 'cambiarEstado'],
    ['responder', 'responder'],
    ['calificar', 'calificar'],
    ['aceptarTarea', 'aceptar'],
    ['cambiarEstado', 'cambiarEstado'],
  ];

  for (const [funcion, llamada] of conectadas) {
    it(`${funcion} llama al servidor cuando hay sesión abierta`, () => {
      const cuerpo = cuerpoDe(funcion);
      expect(cuerpo, `${funcion} no pregunta si está conectada`).toContain('conectado()');
      expect(cuerpo, `${funcion} no llama a api.${llamada}`).toContain(`api.${llamada}(`);
    });
  }

  it('todo lo que la app llama existe en el cliente de la API', () => {
    const usados = new Set([...HTML.matchAll(/Tareas\.api\.([a-zA-Z]+)\(/g)].map((m) => m[1]!));
    const definidos = new Set([...API.matchAll(/^\s{4}([a-zA-Z]+): (?:async )?function/gm)].map((m) => m[1]!));
    for (const nombre of usados) {
      expect(definidos.has(nombre), `la app llama a api.${nombre}() y no existe`).toBe(true);
    }
  });
});

describe('el muro conectado se mira solo', () => {
  it('hay un refresco que va a buscar los trabajos nuevos al servidor', () => {
    const cuerpo = cuerpoDe('refrescarMuro');
    expect(cuerpo).toContain('api.feed()');
    expect(cuerpo).toContain('api.misTareas()');
    // Y quien no es trabajador no pide un muro que no tiene.
    expect(cuerpo).toContain('esTrabajador');
  });

  it('el refresco se da cuenta cuando se abre la ola, no sólo cuando cambia el estado', () => {
    // El radar abre por olas: un trabajo pasa de "se abre para tu nivel en 40 s"
    // a tomable sin cambiar de estado. Si la huella sólo mirara el estado, la
    // pantalla se quedaría con el cartel viejo y el trabajo se lo llevaría otro.
    const cuerpo = cuerpoDe('refrescarMuro');
    expect(cuerpo).toContain('elegibleServidor');
  });

  it('el temporizador de la demostración no redibuja encima del modo conectado', () => {
    expect(HTML).toContain('if (!conectado()) render();');
    expect(HTML).toContain('refrescarMuro();');
  });
});

describe('la campana y la salida', () => {
  it('los avisos que muestra la campana vienen del servidor', () => {
    // Conectada, la campana leía una lista local que nadie llenaba: estaba
    // siempre vacía, y el punto rojo nunca aparecía.
    expect(cuerpoDe('refrescarAvisos')).toContain('api.avisos()');
    expect(HTML).toContain('avisosRemotos');
  });

  it('cerrar sesión suelta también la sesión del servidor', () => {
    // Si no, el token queda en el teléfono y la app vuelve a entrar sola en la
    // próxima recarga. En un teléfono prestado, eso es la cuenta abierta.
    const i = HTML.indexOf('if (a === "cerrar-sesion")');
    expect(i).toBeGreaterThan(-1);
    expect(HTML.slice(i, i + 900)).toContain('api.salir()');
  });
});

describe('nadie se queda mirando una pantalla sin salida', () => {
  it('desde el ingreso al servidor se puede volver a la portada', () => {
    expect(cuerpoDe('vistaServidor')).toContain('data-pantalla="portada"');
  });

  it('un nombre que la app todavía no conoce no rompe la pantalla', () => {
    expect(cuerpoDe('usuario')).toContain('conectado()');
  });
});
