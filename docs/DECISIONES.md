# Decisiones de diseño

Por qué la app funciona así y no de otra manera. Cada punto responde a un problema
concreto del negocio.

---

## 1. Una tarea es una orden de trabajo, no un post

**Problema:** en los grupos de Facebook una solicitud junta 40 comentarios
("¿cuánto pagás?", "yo lo hago", "te paso presupuesto"), nadie sabe quién quedó a
cargo y la conversación real se pierde.

**Cómo lo resolvemos:**

- Cada tarea tiene un **folio** legible: `TQ-260908-4F7K` (fecha + 4 caracteres sin
  0/O ni 1/I, para poder dictarlo por teléfono). Todo —el chat, el recibo, el
  reclamo, la llamada a soporte— se refiere a ese folio.
- **No hay comentarios públicos.** Hay dos canales, y cada uno se abre en su momento:
  - **Preguntas** (antes de asignar): máximo 2 por trabajador, privadas con el
    cliente. Si el cliente marca una respuesta como útil, se muestra a todos los
    demás candidatos y nadie vuelve a preguntar lo mismo.
  - **Chat** (después de asignar): privado, sólo entre el cliente y el trabajador
    asignado, y sólo mientras la tarea está en curso.
- Cada cambio de estado queda en la **bitácora** (`EventoTarea`): quién, cuándo,
  desde dónde. Eso es lo que se mira en una disputa, no una captura de pantalla.

**Cómo se administra la fila:** el trabajador no navega un muro, ve un **radar**
(`GET /feed`) ya filtrado por lo que puede hacer y ordenado por cercanía y monto.
Cada tarea aparece una sola vez, con un botón: *Aceptar*.

---

## 2. El primero que la ve, se la lleva

**Problema:** si hay postulaciones, el cliente tiene que elegir, y eso convierte un
trabajo de 40 dólares en una tarde de gestión.

**Cómo lo resolvemos:** precio cerrado, sin puja. El primero que acepta, la toma.

El punto delicado es la carrera: dos trabajadores pueden apretar *Aceptar* en el
mismo milisegundo. **La carrera la resuelve la base, no el código**:

```sql
UPDATE "Tarea" SET estado='ASIGNADA', "trabajadorId"=$1
WHERE id=$2 AND estado='PUBLICADA' AND "trabajadorId" IS NULL
```

Si afecta 1 fila, ganó. Si afecta 0, otro llegó primero y recibe
`409 TAREA_YA_TOMADA`. No hay locks nuestros ni una lectura previa en la que
confiar. Está probado con cuatro aceptaciones en paralelo
(`apps/api/src/__tests__/tareas.test.ts`).

---

## 3. Las calificaciones sirven para elegir, no para decorar

El cliente elige un **nivel mínimo** al publicar: `NUEVO`, `BRONCE`, `PLATA`, `ORO`
o `PLATINO`. Puede pedir a alguien que recién empieza y pagar el piso, o exigir un
PLATINO y pagar 60% más. Es la misma tarea con distinto respaldo.

**Cómo se gana el nivel** (`packages/domain/src/reputacion.ts`): trabajos
completados + estrellas + tasa de cancelación + puntualidad + identidad verificada.
Se recalcula después de cada trabajo cerrado: no es un sello permanente, se pierde
si el servicio se cae.

**Las estrellas son bayesianas.** Una sola reseña de 5 estrellas no pone a nadie
arriba de alguien con 200 trabajos y 4.8: cada perfil arranca con un "prior" en el
promedio de la plataforma y la reputación se gana con volumen.

**Doble ciego.** Ninguna de las partes ve la nota de la otra hasta que ambas
calificaron (o pasan 7 días). Sin esto las notas se vuelven represalias y todo el
mundo termina con 5 estrellas.

### El radar por olas

La reputación también compra **tiempo de ventaja**. Cuando una tarea se publica:

| Ola | Momento | Quién la ve |
| --- | --- | --- |
| 0 | primeros 90 s | ORO y PLATINO |
| 1 | 90 s – 5 min | PLATA para arriba |
| 2 | 5 – 15 min | BRONCE para arriba |
| 3 | después | todos los que cumplen el mínimo del cliente |

Dentro de cada ola sigue siendo "el primero que llega, se la lleva". Los mejor
calificados no tienen prioridad al aceptar: tienen prioridad al **enterarse**.

---

## 4. Ninguna tarea se publica por debajo de lo que el oficio vale

Cada rubro trae su **piso por unidad** y su **mínimo facturable** (aunque el trabajo
dure 20 minutos, se cobran 2 horas). Sobre eso, la fórmula
(`packages/domain/src/precios.ts`):

```
base = piso del rubro x unidades facturables
      x dificultad (BÁSICA 1.0 · MEDIA 1.35 · ALTA 1.8 · EXPERTA 2.5)
      x urgencia (PROGRAMADA 1.0 · HOY 1.15 · INMEDIATA 1.35)
      x nivel exigido (NUEVO 1.0 → PLATINO 1.6)
      x fuera de horario (noche o fin de semana: 1.25)
      + traslado (por km fuera de los primeros 10)
      + materiales (se reembolsan, no pagan comisión)
```

El resultado es el **mínimo**, y publicar por debajo se rechaza con
`422 PRESUPUESTO_INSUFICIENTE` diciendo cuál es el piso. Además se sugiere una
banda (mínimo +20% a +50%): pagar el piso justo significa esperar más.

El mínimo calculado queda **congelado en la tarea** (`minimoCalculado`) como prueba
de que el precio era legítimo el día que se publicó, aunque las tarifas cambien
después.

Los pisos del catálogo (`packages/domain/src/catalogo.ts`) van de USD 7/hora en
limpieza a USD 250/día en un abogado, y se ajustan por país con un solo factor
(`factorPais`) sin tocar código.

---

## 5. La plata pasa por la app, en efectivo también

**Con tarjeta:** al publicar se **retiene** el monto (no se cobra). Si la tarjeta se
rechaza, la tarea no se publica: nadie sale a trabajar contra un presupuesto que no
existe. Cuando el cliente confirma, se captura, se descuenta la comisión y el neto
va al saldo del trabajador. Si se cancela antes de que salga, se libera la retención.

**En efectivo (tipo Uber):** el trabajador cobra el 100% en la mano y la comisión le
queda como **deuda** en su saldo. Si la deuda pasa el límite, deja de poder tomar
trabajos hasta saldarla. La plataforma cobra lo mismo por los dos caminos.

**Comisión:** 10-15% según el rubro (los oficios de alto ticket pagan menos), con
descuento por nivel (hasta -4% para un PLATINO) y un mínimo por trabajo para que los
tickets chicos no den pérdida. Al cliente se le cobra un 5% de cargo de servicio.

Todo movimiento queda asentado en `MovimientoSaldo` con el saldo resultante: **si el
saldo del perfil y el libro mayor divergen, gana el libro**. El dinero se guarda
siempre en enteros (centavos); con floats, un marketplace termina descuadrado.

---

## 6. Seguridad: quién entra a tu casa

- **Documento obligatorio** para tomar trabajos. El número se guarda cifrado con
  AES-256-GCM y además se guarda un HMAC que permite detectar que dos cuentas usan
  el mismo documento **sin descifrar nada**. La API nunca devuelve el número: sólo
  `••••5678`.
- **Teléfono verificado** con código de un solo uso (se guarda el hash, no el
  código; 5 intentos y 5 envíos por hora).
- **Matrícula validada** en los rubros que la exigen: electricidad, plomería,
  abogacía, contabilidad, enfermería. Sin matrícula, el trabajo ni siquiera aparece.
- **Antecedentes verificados** para tareas con menores, adultos mayores o mascotas.
  El cliente además puede exigirlos en cualquier tarea.
- **Código de inicio:** el cliente le dicta 4 dígitos al trabajador en la puerta.
  Sin ese código la tarea no arranca: es la prueba de que llegó al lugar correcto y
  con la persona correcta.
- **Dirección exacta** recién después de asignar; antes se muestra la zona.

**Login:** Google y LinkedIn identifican, y el perfil de LinkedIn queda visible en
la ficha del trabajador como respaldo profesional (lo que le da peso a un abogado o
a un contador). Pero el **teléfono verificado es obligatorio igual**: dos personas
que se van a encontrar en una casa necesitan un contacto real.

---

## 7. Estados: nada cambia por fuera de la tabla

```
BORRADOR → PUBLICADA → ASIGNADA → EN_CAMINO → EN_PROGRESO → ENTREGADA → CONFIRMADA → PAGADA
                ↓          ↓           ↓            ↓            ↓
            EXPIRADA   (vuelve a   (vuelve a   EN_DISPUTA   EN_DISPUTA
            CANCELADA   la fila)    la fila)
```

Cada transición declara **quién** puede hacerla (cliente, trabajador, sistema o
soporte). El trabajador no puede darse por confirmado a sí mismo; el cliente no
puede autoasignarse una tarea; sólo soporte resuelve disputas. Si el trabajador se
baja, la tarea vuelve a la fila y le queda la cancelación en su historial. Si el
cliente no confirma en 24 h, el sistema confirma solo y se libera el pago.

---

## 8. Antifraude: sumar señales, no acusar

Tres cosas rompen un marketplace de trabajos y ninguna necesita hackear nada:
pactar por fuera después de conocerse por la app, dos cuentas que se califican
entre sí hasta llegar a ORO, y tareas fantasma que se publican y se confirman en
dos minutos sin que nadie haya trabajado.

La decisión de fondo es que **una sospecha no cierra una cuenta**. Un teléfono en
un mensaje puede ser "llamame cuando llegues"; dos trabajos entre las mismas
personas puede ser un cliente que quedó contento. Una cuenta bloqueada por un
falso positivo es una persona que se queda sin trabajar por un error nuestro, y
eso no se arregla pidiendo disculpas. Entonces las señales se suman en un
puntaje y se levanta una alerta para que la mire alguien.

La única excepción es el **teléfono en una pregunta pública antes de asignar**:
ahí no hay nada que coordinar todavía, el único uso posible es sacar el trabajo
de la app, y el daño es inmediato. Eso sí se rechaza en el momento.

El puntaje no es una suma simple: tres señales flojas no equivalen a una fuerte.
Se toma la más pesada y el resto aporta la mitad, que es la forma de que veinte
indicios menores no terminen pareciendo una certeza.
