/*
 * El trabajador de servicio.
 *
 * Hace dos cosas, y las dos son la diferencia entre una página y una app:
 *
 *  - **guarda la app** para que abra sin conexión. El que corta el pasto está
 *    en el fondo de una casa con media barra de señal: si la pantalla no abre,
 *    no hay trabajo;
 *  - **recibe los avisos** cuando se abre una ola del radar, que es lo único
 *    que hace que alguien se entere de una tarea nueva sin estar mirando.
 *
 * La estrategia de guardado es "red primero, guardado si falla": la app se
 * actualiza sola cuando hay señal y sigue abriendo cuando no la hay. Al revés
 * —guardado primero— la gente se queda con una versión vieja durante días.
 */
const CACHE = 'tareas-v1';
/*
 * Todo lo que la app necesita para abrir se guarda en la instalación, no al
 * pasar. En la primera visita el trabajador de servicio todavía no controla la
 * página, así que los archivos de esa primera carga no pasan por acá: si no se
 * guardan ahora, quedan afuera hasta la visita siguiente —y la app abre sin el
 * botón de avisos justo cuando la persona se queda sin señal—.
 */
const BASICOS = [
  '/',
  '/api.js',
  '/instalar.js',
  '/manifest.webmanifest',
  '/icono-192.png',
  '/icono-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(BASICOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  // Sólo se guarda lo que se lee. Un POST nunca se sirve de una copia: sería
  // dar por hecha una publicación o un pago que no llegó a ningún lado.
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

  evento.respondWith(
    fetch(pedido)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((c) => c.put(pedido, copia));
        }
        return respuesta;
      })
      .catch(async () => {
        const guardada = await caches.match(pedido);
        if (guardada) return guardada;
        // Sin conexión y sin copia de esta dirección: se devuelve la portada,
        // que es lo que hace que la app abra igual.
        if (pedido.mode === 'navigate') return caches.match('/');
        throw new Error('sin conexión');
      }),
  );
});

self.addEventListener('push', (evento) => {
  let aviso = { titulo: 'Tareas', cuerpo: 'Hay novedades' };
  try {
    if (evento.data) aviso = { ...aviso, ...evento.data.json() };
  } catch {
    /* Un aviso mal formado igual tiene que mostrar algo. */
  }

  evento.waitUntil(
    self.registration.showNotification(aviso.titulo, {
      body: aviso.cuerpo,
      icon: '/icono-192.png',
      badge: '/icono-192.png',
      // La etiqueta hace que dos avisos de la misma tarea se reemplacen en vez
      // de apilarse. Cinco avisos de lo mismo terminan con los avisos apagados.
      tag: aviso.etiqueta || 'tareas',
      renotify: false,
      data: { url: aviso.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(evento.notification.data?.url || '/', self.location.origin).href;

  // Si la app ya está abierta se la trae al frente en vez de abrir otra
  // pestaña: en un teléfono, dos copias de la misma app confunden.
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const ventana of ventanas) {
        if (ventana.url.startsWith(self.location.origin) && 'focus' in ventana) {
          ventana.navigate?.(destino);
          return ventana.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
