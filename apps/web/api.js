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
  var CLAVE_BASE = 'tareas.servidor.v1';

  /*
   * A qué servidor le habla la app.
   *
   * Servida desde su propia dirección —la web instalable— el servidor es el
   * mismo de donde salió la página, y no hay nada que configurar.
   *
   * Dentro de la APK no: ahí la app vive adentro del teléfono y no hay ningún
   * servidor en su propia dirección. Sin esto, la APK mostraba "Entrar con mi
   * teléfono", alguien lo apretaba, y cada llamada moría contra el aire. Es
   * exactamente el error que veníamos de sacar de todas las demás pantallas.
   *
   * Entonces: dentro de la APK hay que escribir la dirección del servidor una
   * vez, y queda guardada.
   */
  var enUnaApp = (function () {
    try {
      if (window.Capacitor) return true;
      return /^capacitor:/.test(location.protocol) || location.origin === 'https://localhost';
    } catch (e) {
      return false;
    }
  })();

  function leerBase() {
    try {
      return localStorage.getItem(CLAVE_BASE) || '';
    } catch (e) {
      return '';
    }
  }

  var base = leerBase();
  var servidorPropio = !enUnaApp && (location.protocol === 'http:' || location.protocol === 'https:');
  var hayServidor = servidorPropio || Boolean(base);

  /** La dirección completa de una ruta de la API. */
  function direccion(ruta) {
    return base ? base.replace(/\/+$/, '') + ruta : ruta;
  }

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
      r = await fetch(direccion(ruta), opciones);
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

    /** Dentro de la APK hay que decirle a qué servidor hablarle. */
    configurable: enUnaApp,
    servidor: function () {
      return base;
    },

    /**
     * Guarda la dirección del servidor. Se comprueba antes de guardarla: una
     * dirección mal escrita guardada igual deja la app rota sin decir por qué.
     */
    fijarServidor: async function (url) {
      var limpia = String(url || '').trim().replace(/\/+$/, '');
      if (limpia && !/^https?:\/\//.test(limpia)) limpia = 'https://' + limpia;

      if (limpia) {
        var r;
        try {
          r = await fetch(limpia + '/salud');
        } catch (e) {
          throw ErrorApi('SERVIDOR_NO_RESPONDE', 'No pudimos llegar a esa dirección. Revisala.', 0);
        }
        var datos = null;
        try {
          datos = await r.json();
        } catch (e) {
          datos = null;
        }
        if (!r.ok || !datos || datos.ok !== true) {
          throw ErrorApi('NO_ES_TAREAS', 'Esa dirección responde, pero no es un servidor de Tareas.', r.status);
        }
      }

      base = limpia;
      hayServidor = servidorPropio || Boolean(base);
      api.disponible = hayServidor;
      try {
        if (limpia) localStorage.setItem(CLAVE_BASE, limpia);
        else localStorage.removeItem(CLAVE_BASE);
      } catch (e) {
        /* Sin almacenamiento dura lo que dure la app abierta. */
      }
      guardarSesion(null);
      return limpia;
    },

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
    responder: function (tareaId, preguntaId, texto) {
      return pedir('POST', '/tareas/' + tareaId + '/preguntas/' + preguntaId + '/responder', { texto: texto });
    },
    guardadas: function () {
      return pedir('GET', '/tareas/guardadas');
    },
    guardar: function (id) {
      return pedir('POST', '/tareas/' + id + '/guardar');
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
    guardarTarjeta: function (metodoPagoToken) {
      return pedir('PUT', '/deudas/tarjeta', { metodoPagoToken: metodoPagoToken });
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

    /**
     * ¿Está configurado el proveedor? Se pregunta antes de mandar a alguien a
     * una pantalla que va a terminar en un error del servidor.
     */
    proveedorListo: async function (proveedor) {
      try {
        var r = await fetch(direccion('/auth/' + proveedor), { method: 'GET', redirect: 'manual' });
        return r.type === 'opaqueredirect' || r.status === 0 || (r.status >= 300 && r.status < 400);
      } catch (e) {
        return false;
      }
    },

    /* --- Identidad --- */
    registrarIdentidad: function (datos) {
      return pedir('POST', '/identidad', datos);
    },

    /* --- Avisos --- */
    avisos: function () {
      return pedir('GET', '/avisos');
    },
    avisosLeidos: function () {
      return pedir('POST', '/avisos/leidos');
    },
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
