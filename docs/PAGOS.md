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

Cambiar de proveedor es escribir un adaptador nuevo: el flujo de la tarea no se
toca. Hay tres implementaciones:

- **`PasarelaSandbox`** — de mentira, para desarrollo y pruebas. Acepta tokens
  `tok_ok_…` y rechaza `tok_rechazada`, así se puede probar el camino triste.
- **`PasarelaStripe`** — PaymentIntents con `capture_method: manual` y pagos al
  trabajador por Stripe Connect.
- **`PasarelaMercadoPago`** — pagos con `capture: false` y captura posterior.

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

En los dos casos conviene empezar con las credenciales de prueba, correr el ciclo
completo (publicar, tomar, confirmar, cancelar tarde, reembolsar) y recién
después poner las de producción.

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
