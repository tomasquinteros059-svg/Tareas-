# Pagos

Cómo funciona el dinero en Tareas y qué hace falta para encenderlo de verdad.

---

## El flujo, en dos tiempos

La app no cobra cuando se publica: **reserva**. Esa distinción es la que hace que
el sistema sea justo para los dos lados.

```
Publicar la tarea    →  se RETIENE el monto en la tarjeta del cliente
                        (el dinero queda reservado; no se le cobró nada)
El cliente confirma  →  se CAPTURA la retención
                        se descuenta la comisión
                        el neto se transfiere al trabajador (o va a su saldo)
Se cancela a tiempo  →  se LIBERA la reserva y no queda rastro en el resumen
Cancelación tardía   →  se captura sólo el 20% y el 80% de eso es del trabajador
Reclamo              →  la plata queda retenida hasta que soporte resuelve
```

El código que orquesta esto está en `apps/api/src/modulos/tareas/servicio.ts`.
Los montos siempre son **enteros en centavos**: nunca hay decimales flotantes
tocando dinero.

## La interfaz

Todo el trato con el proveedor pasa por una sola interfaz, `Pasarela`
(`apps/api/src/modulos/pagos/pasarela.ts`):

| Método | Cuándo se usa |
| --- | --- |
| `retener` | al publicar la tarea |
| `capturar` | cuando el cliente confirma el trabajo |
| `liberar` | si se cancela o expira sin que nadie la tome |
| `reembolsar` | disputas y resoluciones de soporte |
| `transferir` | pagarle el neto al trabajador |
| `confirmar` | cerrar una retención que necesitó pasar por el sitio del banco |

Cada adaptador además declara qué sabe hacer en `capacidades`:
`transferencias` (girarle plata a un tercero por API) y `cobroDirecto`
(cobrarle a una tarjeta guardada sin que la persona esté delante). De esos dos
booleanos dependen el retiro del saldo y el cobro de las comisiones adeudadas.

Cambiar de proveedor es escribir un adaptador nuevo: el flujo de la tarea no se
toca. Hay cuatro implementaciones:

- **`PasarelaSandbox`** — de mentira, para desarrollo y pruebas. Acepta tokens
  `tok_ok_…` y rechaza `tok_rechazada`, así se puede probar el camino triste.
- **`PasarelaStripe`** — PaymentIntents con `capture_method: manual` y pagos al
  trabajador por Stripe Connect.
- **`PasarelaMercadoPago`** — pagos con `capture: false` y captura posterior.
- **`PasarelaTransbank`** — Webpay Plus en modalidad diferida, para Chile.

Se elige con `PAYMENTS_PROVIDER`. Si falta la clave, el servidor **no arranca**:
es preferible fallar al inicio que descubrirlo con un cliente esperando.

## Una diferencia importante entre los dos proveedores

**Stripe** puede girarle plata al trabajador por API (Stripe Connect). Cuando el
trabajador conectó su cuenta (`PerfilTrabajador.cuentaCobro`), el neto sale
apenas se confirma el trabajo y el pago queda `LIQUIDADO`.

**Mercado Pago** no tiene una API simple para pagarle a un tercero: en el modelo
marketplace el dinero se reparte en el momento del cobro con `application_fee`.
Por eso su adaptador declara `capacidades.transferencias = false`, y el neto
queda en el **saldo del trabajador** dentro de la app, que retira desde la
pantalla de Saldo. El libro mayor registra el mismo movimiento en los dos casos:
lo único que cambia es dónde está la plata.

## El saldo del trabajador, en los dos sentidos

El saldo de `PerfilTrabajador` es un solo número que puede ir para los dos
lados: **positivo es plata a cobrar, negativo es comisión adeudada**. El libro
mayor (`MovimientoSaldo`) es la verdad; el saldo es su suma.

### Retiros: el saldo se vuelve plata en el banco

Cuando el proveedor no transfiere por API, el neto de cada trabajo se acredita
como saldo y queda ahí. Eso es una promesa hasta que alguien hace la
transferencia, y eso es lo que resuelven los retiros
(`apps/api/src/modulos/retiros/`):

```
PUT  /retiros/banco   →  el trabajador carga su cuenta (el número va cifrado;
                         en la app sólo se ven los últimos cuatro dígitos)
POST /retiros         →  pide el retiro: el saldo se descuenta en el acto
GET  /soporte/retiros →  la cola de transferencias, con la cuenta para copiar
POST /soporte/retiros/:id/pagado    →  se anota el comprobante
POST /soporte/retiros/:id/rechazar  →  la plata vuelve al saldo, con motivo
```

Dos detalles que no son detalles: el saldo se descuenta **al pedir**, no al
pagar —si no, entre el pedido y la transferencia se podría pedir dos veces la
misma plata—, y el RUT del titular se valida con módulo 11 antes de guardarlo,
porque un dígito cambiado hace rebotar la transferencia días después.

### Deudas: la comisión de los trabajos en efectivo

Quien cobra en efectivo se lleva el 100% en la mano y queda debiendo la
comisión. Si después hace un trabajo con tarjeta, la deuda se compensa sola. Si
trabaja siempre en efectivo, no: acumula hasta el límite, deja de poder tomar
trabajos y se va sin que nadie se lo haya cobrado. El módulo `deudas` cierra eso
(`apps/api/src/modulos/deudas/`):

```
PUT  /deudas/tarjeta   →  guarda una tarjeta (se prueba y se libera al guardarla)
POST /deudas/pagar     →  pagar ahora
POST /deudas/confirmar →  vuelta del banco, cuando hizo falta redirección
```

Si el proveedor tiene `cobroDirecto`, el reloj cobra solo cuando la deuda pasa
el mínimo. **Webpay no lo tiene**: manda siempre al sitio del banco, así que en
Chile la deuda se paga a mano desde la app y el cobro automático queda apagado
hasta contratar Oneclick. Las esperas entre reintentos y el mínimo cobrable son
reglas puras y viven en `packages/domain/src/deudas.ts`: se espera cada vez más
—24 h, 3 días, una semana— y después de cuatro rechazos se deja de insistir,
porque golpear una tarjeta sin fondos la hace ver como fraude al emisor.

## Los avisos del proveedor (webhooks)

Son la única fuente confiable de lo que pasó: una captura puede confirmarse
minutos después, y un contracargo llega días más tarde, cuando nadie está
mirando la pantalla.

```
POST /webhooks/pagos/stripe
POST /webhooks/pagos/mercadopago
```

Dos cuidados que ya están resueltos en el código:

- **Se verifica la firma** sobre el cuerpo exacto que llegó. Sin eso, cualquiera
  podría avisarnos que un pago salió bien. Los avisos con más de 5 minutos se
  rechazan, para que no sirva reenviar uno viejo.
- **Cada evento se procesa una sola vez.** El id del evento queda guardado; si
  el proveedor lo reintenta, se responde `repetido` sin tocar nada.

Siempre se responde 200, salvo firma inválida: si devolvemos error por un evento
que no nos interesa, el proveedor lo reintenta durante días.

## Chile: dos cosas que cambian

### El peso no tiene centavos

Todos los montos del sistema son **enteros en unidades mínimas**. En dólares la
unidad mínima es el centavo; en pesos chilenos es el peso. Por eso la conversión
hacia el proveedor no puede ser siempre "dividir por cien": `aUnidades()` y
`decimalesDe()` (en `packages/domain/src/dinero.ts`) resuelven eso por moneda.
Equivocarse acá no es un detalle de formato: se cobra cien veces de más o cien
veces de menos.

Para operar en Chile va `PAYMENTS_CURRENCY=CLP` y el catálogo usa
`PRECIOS_CHILE`: mismo piso relativo que en dólares, ajustado con `factorPais`,
y redondeo de a $500 porque nadie cotiza un trabajo en $8.437. Cortar el pasto
tres horas queda en $28.000, que es un número que un chileno reconoce.

### Webpay funciona distinto

Transbank es el medio con el que se paga casi todo en Chile, porque incluye
**Redcompra** (débito) y no sólo crédito. A cambio no recibe un token de
tarjeta: **manda al cliente al sitio del banco**. Entonces el flujo tiene un
paso más:

```
POST /tareas          →  crea la tarea en BORRADOR y devuelve urlRedireccion
                         (el cliente va al banco y paga)
POST /tareas/:id/confirmar-pago
                      →  se confirma con Transbank y recién ahí sale al radar
```

La tarea **no se publica** hasta que el pago está confirmado. Sin eso, un
trabajador podría salir para una casa con una reserva que nunca se completó.

Dos límites de Webpay que conviene tener presentes: el **diferido** (autorizar
ahora y capturar después) hay que pedirlo en el contrato, y la autorización
**caduca a los 7 días**. Y Webpay no le paga a terceros: todo llega a la cuenta
del comercio y a cada trabajador se le transfiere por fuera, así que el neto
queda en su saldo dentro de la app y se saca por la cola de retiros.

Lo mismo al revés: como Webpay no guarda tarjetas, la comisión que debe quien
trabaja en efectivo no se puede cobrar sola. El trabajador la paga desde la app
cuando quiere, y el límite de deuda sigue siendo lo que le impide seguir
tomando trabajos si no lo hace.

## Cómo encenderlo

### Con Stripe

1. Crear la cuenta en stripe.com y activarla (necesita datos de la empresa).
2. Habilitar **Connect** para poder pagarle a los trabajadores.
3. Copiar la clave secreta a `STRIPE_SECRET_KEY`.
4. Crear el webhook apuntando a `https://TU-DOMINIO/webhooks/pagos/stripe` y
   suscribirlo a `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.refunded` y `charge.dispute.created`. Copiar el secreto a
   `STRIPE_WEBHOOK_SECRET`.
5. En el alta del trabajador, crear su cuenta conectada y guardar el id en
   `PerfilTrabajador.cuentaCobro`.
6. `PAYMENTS_PROVIDER=stripe`.

### Con Mercado Pago

1. Crear la aplicación en el panel de desarrolladores.
2. Copiar el access token a `MERCADOPAGO_ACCESS_TOKEN`.
3. Configurar el webhook a `https://TU-DOMINIO/webhooks/pagos/mercadopago` y
   copiar la clave secreta a `MERCADOPAGO_WEBHOOK_SECRET`.
4. `PAYMENTS_PROVIDER=mercadopago`.

### Con Transbank (Chile)

1. Firmar el contrato de Webpay Plus **con la sociedad**, no a título personal:
   Transbank pide el RUT de la empresa y la cuenta corriente a su nombre, que es
   donde deposita. La cuenta se carga en el portal de Transbank; en el código no
   va nunca.
2. Pedir expresamente la modalidad **diferida**. Sin eso sólo se puede cobrar de
   una, y se pierde la reserva en dos tiempos que es la base de cómo funciona
   la app.
3. Probar primero contra integración: `TRANSBANK_PRODUCTION=false` con el código
   de comercio y la clave que Transbank publica para pruebas.
4. Cargar el código de comercio y la clave reales en `TRANSBANK_COMMERCE_CODE` y
   `TRANSBANK_API_KEY`, poner `TRANSBANK_PRODUCTION=true` y
   `TRANSBANK_RETURN_URL` apuntando a la pantalla de vuelta.
5. `PAYMENTS_PROVIDER=transbank` y `PAYMENTS_CURRENCY=CLP`.

En todos los casos conviene empezar con las credenciales de prueba, correr el
ciclo completo (publicar, tomar, confirmar, cancelar tarde, reembolsar) y recién
después poner las de producción.

## Dónde van los datos de la empresa

En el **portal del proveedor**, no en el código ni en el repositorio:

| Dato | Dónde va |
| --- | --- |
| Razón social y RUT | alta de la cuenta en Transbank / Mercado Pago / Stripe |
| Cuenta corriente del banco | portal del proveedor, para las liquidaciones |
| Correo de contacto | portal del proveedor y avisos de contracargos |
| Claves de API | variables de entorno del servidor, nunca versionadas |

Un número de cuenta en el historial de git no se borra: queda en cada copia del
repositorio para siempre. Lo único que el código necesita son las claves, y esas
viven en el entorno.

## Lo que no se resuelve con código

Esto hay que tenerlo antes de mover el primer peso de verdad:

- **Una empresa registrada** con su identificación fiscal. Ningún proveedor
  habilita cobros a nombre de una persona sin verificar quién es.
- **Cuenta bancaria a nombre de esa empresa**, que es donde liquida el proveedor.
- **Términos y condiciones y política de privacidad** publicados: los proveedores
  los piden para aprobar la cuenta, y además se guardan documentos de identidad.
- **Alta fiscal** y definición de cómo se factura la comisión.
- **Contracargos**: el proveedor descuenta el monto y una multa. Hay que decidir
  quién lo absorbe cuando el trabajo ya se hizo y se le pagó al trabajador.
- **Prevención de fraude**: cuentas que se califican entre sí, tareas fantasma
  para mover dinero, y gente que intenta pactar por fuera para evitar la comisión.

## Probarlo

```bash
pnpm --filter @tareas/api test
```

Las pruebas de `pagos.test.ts` no salen a internet: reemplazan `fetch` y
verifican lo que de verdad importa — que la retención se cree sin cobrar, que un
rechazo de tarjeta no se reintente, que un proveedor caído sí, que la clave de
idempotencia viaje en la cabecera, y que una firma inválida o vieja se rechace.
