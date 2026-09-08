# Qué falta para salir a la calle

Lo que está hecho es el motor: reglas de negocio, API y base de datos, con 82 tests
en verde. Esto es lo que sigue, en orden de lo que más duele si no está.

## Antes de la primera tarea real

1. **Pasarela de pagos de verdad.** La interfaz `Pasarela`
   (`apps/api/src/modulos/pagos/pasarela.ts`) ya está: hay que escribir el adaptador
   de Stripe o Mercado Pago (según el país) y conectar los webhooks de captura y
   contracargo. El resto del flujo no se toca.
2. **Verificación de identidad automatizada.** Hoy la aprobación es manual
   (`POST /identidad/:usuarioId/resolver`). Conviene un proveedor de KYC que compare
   la selfie con el documento y valide que no está adulterado.
3. **Envío real de SMS.** La interfaz `Enviador` ya está; falta el adaptador
   (Twilio, Vonage o el que convenga por costo local).
4. **App móvil.** Es donde vive el producto: dos flujos distintos (publicar / tomar)
   sobre la misma API. Recomendado: React Native con Expo, para salir en iOS y
   Android a la vez.
5. **Notificaciones push.** El radar por olas no sirve si el trabajador no se entera
   en el momento. Es la pieza que hace que una tarea se tome en 90 segundos y no en
   dos horas.
6. **Términos, política de privacidad y tratamiento de datos.** Se guardan
   documentos de identidad: hay obligaciones legales concretas según el país
   (conservación, borrado, quién puede consultarlos).

## Apenas haya volumen

7. **Búsqueda geográfica en la base.** Hoy el feed trae las últimas 200 tareas
   publicadas y filtra en memoria. Con volumen hay que usar PostGIS o índices
   geohash y filtrar por radio en la consulta.
8. **Trabajos programados.** Expirar tareas que nadie tomó, confirmar
   automáticamente a las 24 h, liberar calificaciones vencidas
   (`ServicioCalificaciones.liberarVencidas`) y cobrar deudas de comisión. La lógica
   está escrita; falta el planificador que la dispare.
9. **Panel de soporte.** Disputas, reembolsos parciales, ajustes de saldo y
   revisión de documentos. Sin esto, cada problema es un mensaje de WhatsApp.
10. **Retiros del trabajador.** Está el saldo y el libro mayor; falta el flujo de
    "sacar la plata" con su cuenta bancaria validada.
11. **Antifraude.** Cuentas que se califican entre sí, tareas fantasma para lavar
    dinero, trabajadores que piden salir de la app para evitar la comisión.

## Cuando el negocio lo pida

12. **Tareas recurrentes** (la limpieza de todos los martes) con el mismo trabajador.
13. **Equipos** para trabajos que necesitan más de una persona (mudanzas, eventos).
14. **Seguro por trabajo**, que es lo que termina de dar confianza en tareas caras.
15. **Precios dinámicos por demanda**: la fórmula ya tiene el lugar donde entra
    (`ConfiguracionPrecios`), sólo hay que alimentarla con oferta y demanda por zona.
16. **Presupuesto con visita previa** para obras grandes, donde el precio no se
    puede cerrar sin ver.
