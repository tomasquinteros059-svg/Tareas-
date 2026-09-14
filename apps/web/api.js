/*
 * Cliente de la API.
 *
 * Es el puente entre la app y el servidor. Hasta acá la app guardaba todo en el
 * propio teléfono: alcanza para mostrar el producto y no para operarlo, porque
 * dos personas en dos teléfonos nunca ven la misma tarea.
 *
 * Tres decisiones que valen la pena:
 *
 *  - **la sesión vive en el navegador y se revisa sola**. Un token vencido no
 *    se nota hasta que algo falla en el peor momento; acá se detecta al
 *    arrancar y se vuelve al ingreso;
 *  - **los errores llegan con su código**, el mismo que devuelve la API
 *    (`TAREA_YA_TOMADA`, `SALDO_INSUFICIENTE`). La pantalla decide qué decir;
 *    el cliente no inventa mensajes;
 *  - **abierto como archivo suelto, no hay servidor**. La app se abre con doble
 *    clic desde el escritorio y ahí no hay a quién llamar: en ese caso el modo
 *    conectado queda apagado en vez de fallar en cada pantalla.
 */
(function () {
  'use strict';

  var CLAVE_SESION = 'tareas.sesion.v1';
  var hayServidor = location.protocol === 'http:' || location.protocol === 'https:';

  function leerSesion() {
    try {
      var crudo = localStorage.getItem(CLAVE_SESION);
      return crudo ? JSON.parse(crudo) : null;
    } catch (e) {
      return null;
    }
  }

  function guardarSesion(sesion) {
    try {
      if (sesion) localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
      else localStorage.removeItem(CLAVE_SESION);
    } catch (e) {
      /* Sin almacenamiento la sesión dura lo que dure la pestaña. */
    }
    memoria = sesion;
  }

  var memoria = leerSesion();

  function ErrorApi(codigo, mensaje, status, detalle) {
    var e = new Error(mensaje || 'Algo se rompió');
    e.name = 'ErrorApi';
    e.codigo = codigo || 'ERROR';
    e.status = status || 0;
    e.detalle = detalle;
    return e;
  }

  async function pedir(metodo, ruta, cuerpo) {
    if (!hayServidor) throw ErrorApi('SIN_SERVIDOR', 'Esta copia de la app no está conectada a ningún servidor');

    var opciones = { method: metodo, headers: {} };
    if (memoria && memoria.token) opciones.headers.authorization = 'Bearer ' + memoria.token;
    if (cuerpo !== undefined) {
      opciones.headers['content-type'] = 'application/json';
      opciones.body = JSON.stringify(cuerpo);
    }

    var r;
    try {
      r = await fetch(ruta, opciones);
    } catch (e) {
      throw ErrorApi('SIN_CONEXION', 'No pudimos llegar al servidor. Revisá la señal.', 0);
    }

    var texto = await r.text();
    var datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch (e) {
      datos = null;
    }

    if (r.ok) return datos;

    // La sesión venció o la cerraron del otro lado: se limpia acá, para que la
    // app no siga creyendo que hay alguien adentro.
    if (r.status === 401) guardarSesion(null);
    var error = (datos && datos.error) || {};
    throw ErrorApi(error.codigo, error.mensaje, r.status, error.detalle);
  }

  var api = {
    disponible: hayServidor,

    sesion: function () {
      return memoria;
    },
    hayCuenta: function () {
      return Boolean(memoria && memoria.token);
    },
    salir: function () {
      guardarSesion(null);
    },

    /* --- Entrar --- */
    pedirCodigo: function (telefono) {
      return pedir('POST', '/auth/telefono/codigo', { telefono: telefono });
    },
    verificarCodigo: async function (telefono, codigo, nombre, apellido) {
      var r = await pedir('POST', '/auth/telefono/verificar', {
        telefono: telefono,
        codigo: codigo,
        nombre: nombre || undefined,
        apellido: apellido || undefined,
      });
      guardarSesion({ token: r.token, usuario: r.usuario, desde: Date.now() });
      return r;
    },

    /* --- Lo mío --- */
    yo: function () {
      return pedir('GET', '/yo');
    },
    saldo: function () {
      return pedir('GET', '/saldo');
    },
    misTareas: function () {
      return pedir('GET', '/tareas/mias');
    },

    /* --- El muro --- */
    catalogo: function () {
      return pedir('GET', '/catalogo');
    },
    cotizar: function (datos) {
      return pedir('POST', '/cotizar', datos);
    },
    feed: function () {
      return pedir('GET', '/feed');
    },
    tarea: function (folio) {
      return pedir('GET', '/tareas/' + encodeURIComponent(folio));
    },

    /* --- Mover una tarea --- */
    publicar: function (datos) {
      return pedir('POST', '/tareas', datos);
    },
    confirmarPago: function (id) {
      return pedir('POST', '/tareas/' + id + '/confirmar-pago');
    },
    aceptar: function (id) {
      return pedir('POST', '/tareas/' + id + '/aceptar');
    },
    cambiarEstado: function (id, estado, extra) {
      return pedir('POST', '/tareas/' + id + '/estado', Object.assign({ estado: estado }, extra || {}));
    },
    preguntar: function (id, texto) {
      return pedir('POST', '/tareas/' + id + '/preguntas', { texto: texto });
    },
    mensajear: function (id, texto) {
      return pedir('POST', '/tareas/' + id + '/mensajes', { texto: texto });
    },
    calificar: function (id, datos) {
      return pedir('POST', '/tareas/' + id + '/calificar', datos);
    },

    /* --- Plata del trabajador --- */
    retiros: function () {
      return pedir('GET', '/retiros');
    },
    guardarBanco: function (datos) {
      return pedir('PUT', '/retiros/banco', datos);
    },
    pedirRetiro: function (monto) {
      return pedir('POST', '/retiros', { monto: monto });
    },
    deudas: function () {
      return pedir('GET', '/deudas');
    },
    pagarDeuda: function (metodoPagoToken) {
      return pedir('POST', '/deudas/pagar', metodoPagoToken ? { metodoPagoToken: metodoPagoToken } : {});
    },

    /* --- Perfil de trabajador --- */
    perfil: function () {
      return pedir('GET', '/perfil');
    },
    guardarPerfil: function (datos) {
      return pedir('PUT', '/perfil', datos);
    },
    disponibilidad: function (disponible) {
      return pedir('POST', '/perfil/disponibilidad', { disponible: disponible });
    },

    /* --- Identidad --- */
    registrarIdentidad: function (datos) {
      return pedir('POST', '/identidad', datos);
    },

    /* --- Avisos --- */
    claveAvisos: function () {
      return pedir('GET', '/avisos/clave');
    },
    suscribirAvisos: function (datos) {
      return pedir('POST', '/avisos/suscribir', datos);
    },
    bajaAvisos: function (endpoint) {
      return pedir('POST', '/avisos/baja', { endpoint: endpoint });
    },

    /** ¿La sesión guardada sigue sirviendo? Se pregunta al arrancar. */
    comprobar: async function () {
      if (!hayServidor || !api.hayCuenta()) return null;
      try {
        var r = await api.yo();
        memoria.usuario = r.usuario;
        guardarSesion(memoria);
        return r;
      } catch (e) {
        if (e.status === 401) return null;
        throw e;
      }
    },
  };

  window.Tareas = window.Tareas || {};
  window.Tareas.api = api;
})();
