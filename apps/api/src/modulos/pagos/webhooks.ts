import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Avisos del proveedor de pagos.
 *
 * Son la única fuente confiable de lo que pasó con la plata: una captura puede
 * confirmarse minutos después, un contracargo llega días más tarde y el cliente
 * ya no está en la app. Por eso se verifica la firma (si no, cualquiera podría
 * decirnos que un pago salió bien) y se guarda el id del evento para no
 * procesar dos veces el mismo aviso.
 */
export interface EventoPago {
  id: string;
  tipo: string;
  referencia: string | null;
}

/** Firma de Stripe: `t=<ts>,v1=<hmac>` sobre `<ts>.<cuerpo>`. */
export function verificarFirmaStripe(cuerpo: string, cabecera: string, secreto: string, ahora = Date.now()): boolean {
  const partes = Object.fromEntries(
    cabecera.split(',').map((x) => {
      const [k, ...v] = x.split('=');
      return [k?.trim(), v.join('=')];
    }),
  ) as Record<string, string>;
  const ts = Number(partes.t);
  if (!ts || !partes.v1) return false;
  // Ventana de 5 minutos: un aviso viejo reenviado no vale.
  if (Math.abs(ahora / 1000 - ts) > 300) return false;
  const esperado = createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex');
  return comparar(esperado, partes.v1);
}

/** Firma de Mercado Pago: `ts=<ts>,v1=<hmac>` sobre `id:<id>;request-id:<rid>;ts:<ts>;`. */
export function verificarFirmaMercadoPago(
  datosId: string,
  requestId: string,
  cabecera: string,
  secreto: string,
): boolean {
  const partes = Object.fromEntries(
    cabecera.split(',').map((x) => {
      const [k, ...v] = x.split('=');
      return [k?.trim(), v.join('=').trim()];
    }),
  ) as Record<string, string>;
  if (!partes.ts || !partes.v1) return false;
  const cadena = `id:${datosId};request-id:${requestId};ts:${partes.ts};`;
  const esperado = createHmac('sha256', secreto).update(cadena).digest('hex');
  return comparar(esperado, partes.v1);
}

function comparar(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function eventoDeStripe(cuerpo: Record<string, any>): EventoPago {
  const objeto = cuerpo?.data?.object ?? {};
  return {
    id: String(cuerpo.id ?? ''),
    tipo: String(cuerpo.type ?? ''),
    referencia: objeto.payment_intent ?? objeto.id ?? null,
  };
}

export function eventoDeMercadoPago(cuerpo: Record<string, any>): EventoPago {
  return {
    id: String(cuerpo.id ?? ''),
    tipo: String(cuerpo.action ?? cuerpo.type ?? ''),
    referencia: cuerpo?.data?.id ? String(cuerpo.data.id) : null,
  };
}

/**
 * Aplica el aviso sobre nuestro registro de pago. Cada evento se procesa una
 * sola vez: si ya lo vimos, devolvemos `repetido` y no tocamos nada.
 */
export async function aplicarEvento(
  prisma: PrismaClient,
  proveedor: string,
  evento: EventoPago,
): Promise<{ estado: 'aplicado' | 'repetido' | 'ignorado' }> {
  if (!evento.id) return { estado: 'ignorado' };

  const yaVisto = await prisma.eventoTarea.findFirst({
    where: { actorRol: 'PASARELA', nota: `${proveedor}:${evento.id}` },
    select: { id: true },
  });
  if (yaVisto) return { estado: 'repetido' };

  const pago = evento.referencia
    ? await prisma.pago.findFirst({ where: { referencia: evento.referencia } })
    : null;
  if (!pago) return { estado: 'ignorado' };

  const nuevoEstado = estadoSegunEvento(evento.tipo);
  await prisma.$transaction([
    ...(nuevoEstado ? [prisma.pago.update({ where: { id: pago.id }, data: { estado: nuevoEstado } })] : []),
    prisma.eventoTarea.create({
      data: {
        tareaId: pago.tareaId,
        hacia: 'EN_DISPUTA',
        actorRol: 'PASARELA',
        nota: `${proveedor}:${evento.id}`,
        datos: { tipo: evento.tipo, referencia: evento.referencia },
      },
    }),
  ]);
  return { estado: 'aplicado' };
}

function estadoSegunEvento(tipo: string): 'CAPTURADO' | 'REEMBOLSADO' | 'FALLIDO' | null {
  if (/succeeded|approved|captured/i.test(tipo)) return 'CAPTURADO';
  if (/refund|charge_back|chargeback|cancelled|canceled/i.test(tipo)) return 'REEMBOLSADO';
  if (/failed|rejected|dispute/i.test(tipo)) return 'FALLIDO';
  return null;
}
