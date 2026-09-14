/*
 * Lo que convierte la página en una app instalada: registra el trabajador de
 * servicio y pide permiso para los avisos.
 *
 * El permiso NO se pide al entrar. Un cartel de "¿permitir notificaciones?" en
 * el primer segundo se rechaza casi siempre, y el navegador no lo vuelve a
 * preguntar nunca: se pierde el canal para siempre. Se pide cuando la persona
 * toca el botón de avisos, que es cuando ya sabe para qué sirve.
 */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').catch(function (error) {
    console.warn('No se pudo registrar el trabajador de servicio:', error);
  });

  /** Base64 de la clave VAPID al formato de bytes que pide el navegador. */
  function aBytes(base64) {
    var relleno = '='.repeat((4 - (base64.length % 4)) % 4);
    var limpio = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
    var crudo = atob(limpio);
    var bytes = new Uint8Array(crudo.length);
    for (var i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return bytes;
  }

  async function activarAvisos(token) {
    if (!('PushManager' in window)) {
      return { ok: false, motivo: 'Este navegador no recibe avisos' };
    }
    var permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      return { ok: false, motivo: 'Sin permiso no podemos avisarte de los trabajos nuevos' };
    }

    var respuesta = await fetch('/avisos/clave');
    var datos = await respuesta.json();
    if (!datos.activo || !datos.clavePublica) {
      return { ok: false, motivo: 'Los avisos todavía no están encendidos en el servidor' };
    }

    var registro = await navigator.serviceWorker.ready;
    var suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aBytes(datos.clavePublica),
    });

    var enviada = suscripcion.toJSON();
    await fetch('/avisos/suscribir', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: token ? 'Bearer ' + token : '',
      },
      body: JSON.stringify({
        endpoint: enviada.endpoint,
        claves: enviada.keys,
        agente: navigator.userAgent.slice(0, 200),
      }),
    });
    return { ok: true };
  }

  async function apagarAvisos(token) {
    var registro = await navigator.serviceWorker.ready;
    var suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) return { ok: true };
    await fetch('/avisos/baja', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: token ? 'Bearer ' + token : '',
      },
      body: JSON.stringify({ endpoint: suscripcion.endpoint }),
    }).catch(function () {});
    await suscripcion.unsubscribe();
    return { ok: true };
  }

  /* Android y escritorio avisan cuando la app se puede instalar; se guarda el
   * evento para poder ofrecerlo desde un botón en lugar de un cartel del
   * navegador que aparece y se va. */
  var invitacion = null;
  window.addEventListener('beforeinstallprompt', function (evento) {
    evento.preventDefault();
    invitacion = evento;
    window.dispatchEvent(new CustomEvent('tareas:instalable'));
  });

  window.Tareas = window.Tareas || {};
  window.Tareas.avisos = { activar: activarAvisos, apagar: apagarAvisos };
  window.Tareas.instalar = async function () {
    if (!invitacion) return { ok: false, motivo: 'Ya está instalada, o el navegador no lo permite' };
    invitacion.prompt();
    var eleccion = await invitacion.userChoice;
    invitacion = null;
    return { ok: eleccion.outcome === 'accepted' };
  };
  window.Tareas.instalada = window.matchMedia('(display-mode: standalone)').matches;
})();
