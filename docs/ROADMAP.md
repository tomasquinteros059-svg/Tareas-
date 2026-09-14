# Qué falta para lanzar

Estado al 11 de septiembre de 2026. Lo de arriba bloquea el lanzamiento; lo de
abajo se puede hacer con la app ya en la calle.

---

## Hecho

- Reglas de negocio completas: pisos por oficio y fórmula del mínimo, olas del
  radar, niveles, comisiones, cancelación con cargo, propinas y la máquina de
  estados de la tarea.
- API y base de datos con el ciclo entero: publicar, tomar, ejecutar, confirmar,
  liquidar, cancelar, reclamar.
- Verificación de identidad (documento cifrado), teléfono y matrícula por oficio.
- **Pasarela de pagos**: adaptadores de Stripe y Mercado Pago, webhooks con
  verificación de firma y control de repetidos. Ver [`PAGOS.md`](PAGOS.md).
- App completa en un archivo (`apps/demo-app.html`) con portada, ingreso con
  LinkedIn, muro por categorías, avisos, fotos, buscador y perfiles públicos.
- **El reloj del sistema**: expira lo que nadie tomó, confirma a las 24 horas
  para que el silencio del cliente no deje a nadie sin cobrar, publica las
  calificaciones a ciegas y libera las reservas antes de que el banco las
  caduque. Se corre con `pnpm --filter @tareas/api reloj` desde un cron.
- 111 pruebas automáticas.

## Bloquea el lanzamiento

### 1. La empresa antes que el código
Ningún proveedor de pagos habilita cobros sin una sociedad registrada, su
identificación fiscal y una cuenta bancaria a su nombre. También hacen falta los
términos y condiciones y la política de privacidad publicados —más aún acá, que
se guardan documentos de identidad—. Es el trámite más lento: conviene empezarlo
antes que cualquier otra cosa de esta lista.

### 2. Las credenciales de pago y una prueba real
El código está listo; falta la cuenta, las claves y correr el ciclo completo con
credenciales de prueba primero y de producción después. Y decidir quién absorbe
un contracargo cuando el trabajo ya se hizo y al trabajador ya se le pagó.

### 3. La aplicación móvil
Hoy la app es una página. Para la calle hace falta iOS y Android, que además es
la única forma de tener avisos push — y sin push, el radar por olas no sirve:
nadie va a estar mirando la pantalla esperando que aparezca un trabajo.

### 4. Verificación de identidad automática
Hoy la aprobación del documento es manual. Con volumen no escala y es la pieza
que sostiene toda la confianza del producto: hay que conectar un proveedor de
KYC que compare la selfie con el documento.

### 5. Envío real de SMS
La interfaz está; falta el adaptador (Twilio, Vonage o el que convenga por costo
local) para los códigos de verificación.

### 6. Panel de soporte
Disputas, reembolsos parciales, ajustes de saldo y revisión de documentos. Sin
esto, cada problema termina siendo un mensaje de WhatsApp a las once de la noche.

### 7. Decisiones de negocio sin las que no se puede cobrar
- **Moneda y precios por país.** El catálogo está en dólares de referencia y se
  ajusta con un solo factor, pero hay que fijar los números reales del mercado
  donde se lance.
- **Qué pasa si alguien rompe algo.** Es la primera pregunta que va a hacer un
  cliente. O hay un seguro, o hay un tope de responsabilidad escrito y explicado.
- **Por dónde empezar.** Sin trabajadores no hay clientes y sin clientes no hay
  trabajadores. Se rompe arrancando por **un rubro y una zona**, no por la app
  entera: veinte personas buenas en un oficio en un barrio valen más que
  doscientas repartidas por todo el país.

## Después del lanzamiento

- Búsqueda geográfica en la base (PostGIS): hoy el radar trae las últimas 200
  tareas y filtra en memoria.
- Cobro automático de las deudas de comisión de quienes trabajan en efectivo
  (el reloj ya tiene dónde engancharlo).
- Retiros del trabajador a su banco, para el caso en que el proveedor no
  transfiere por API.
- Antifraude: cuentas que se califican entre sí, tareas fantasma, y quien intenta
  pactar por fuera para evitar la comisión.
- Tareas recurrentes (la limpieza de todos los martes) y equipos para trabajos
  de más de una persona.
- Precios dinámicos por demanda: la fórmula ya tiene el lugar donde entran.
