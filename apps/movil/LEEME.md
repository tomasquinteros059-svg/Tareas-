# La app como APK

Acá adentro no hay una app aparte: es la misma que está en `apps/web/dist`,
envuelta para que Android la instale como cualquier otra. Capacitor mete los
archivos de la app dentro del paquete, así que el APK **funciona sin servidor y
sin señal**: se abre y muestra la demostración con sus cien trabajos. Desde
Perfil se puede conectar al servidor, igual que en la versión web.

## Construirlo

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

## Por qué el APK no viene hecho en el repositorio

Un APK es un binario: si se versiona, nadie sabe de qué versión del código
salió. Se construye desde el código, como todo lo demás. Y la carpeta
`android/` tampoco se versiona: la genera `cap add android` en segundos y lo
que hay que revisar es la configuración de acá arriba, no cuarenta archivos
generados.
