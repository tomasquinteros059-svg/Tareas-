# La app como APK

Acá adentro no hay una app aparte: es la misma que está en `apps/web/dist`,
envuelta para que Android la instale como cualquier otra. Capacitor mete los
archivos de la app dentro del paquete, así que el APK **funciona sin servidor y
sin señal**: se abre y muestra la demostración con sus cien trabajos. Desde
Perfil se puede conectar al servidor, igual que en la versión web.

## Bajarla ya hecha

Cada vez que cambia la app, GitHub la compila sola y la deja acá:

**<https://github.com/tomasquinteros059-svg/Tareas-/releases/tag/apk-ultima>**

Ese enlace es fijo: siempre tiene la última. Se abre desde el teléfono Android,
se baja el `.apk` y se instala. Android va a avisar que no viene de la tienda —
hay que darle permiso al navegador para instalar. Es lo normal en una app de
prueba.

La receta está en [`.github/workflows/apk.yml`](../../.github/workflows/apk.yml).

## Qué se ve al abrirla

Arranca en la **demostración**: la app entera con datos de ejemplo guardados en
el teléfono, sin señal y sin servidor. Sirve para probar el diseño, los textos,
el tamaño de los botones y el recorrido completo.

Para usarla contra un servidor de verdad: **Perfil → Conectar con el servidor**,
escribir la dirección y guardarla. La app la comprueba antes de aceptarla, así
que una dirección mal escrita avisa en el momento en vez de dejar la app rota.

La dirección hace falta porque adentro del APK la app vive en el teléfono: no
hay ningún servidor en su propia dirección, a diferencia de la versión web.

## Construirlo a mano

Hace falta **Android Studio** instalado (trae el SDK, que es lo único que no se
puede resolver con npm).

```bash
cd apps/movil
npm install
npm run apk
```

El archivo queda en:

```
apps/movil/android/app/build/outputs/apk/debug/app-debug.apk
```

Ese APK es de *depuración*: se instala en un teléfono con "orígenes
desconocidos" habilitado, pero no sirve para publicar en Google Play. Para la
tienda hace falta firmarlo con una clave propia y subirlo como AAB; eso se hace
desde Android Studio y requiere la cuenta de desarrollador.

## Si no tenés Android Studio

Dos caminos, los dos sin instalar nada:

1. **Abrir `apps/demo-app.html` en el teléfono.** Es un archivo suelto: se
   manda por WhatsApp o Drive, se abre con Chrome y anda igual, sin conexión.
2. **Instalarla desde el navegador**, una vez que el servidor esté en línea:
   entrar a la dirección y elegir "Agregar a la pantalla de inicio". Queda con
   ícono, a pantalla completa y con avisos, que es casi todo lo que da un APK.

## Por qué el APK no está versionado en el repositorio

Un APK es un binario: si se versiona, nadie sabe de qué versión del código
salió, y el repositorio engorda con cada compilación. Por eso se construye desde
el código y se publica aparte, con el commit del que salió anotado. La carpeta
`android/` tampoco se versiona: la genera `cap add android` en segundos y lo que
hay que revisar es la configuración de acá arriba, no cuarenta archivos
generados.
