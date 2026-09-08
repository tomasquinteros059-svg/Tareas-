import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Los números de documento son el dato más sensible de la app. Se guardan
 * cifrados con AES-256-GCM (reversible sólo para soporte/legales) y además se
 * guarda un HMAC del número, que permite detectar que dos cuentas usan el mismo
 * documento sin tener que descifrar nada.
 */
export function cifrar(texto: string, claveHex: string): string {
  const clave = Buffer.from(claveHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
}

export function descifrar(paquete: string, claveHex: string): string {
  const [ivB64, tagB64, datosB64] = paquete.split('.');
  if (!ivB64 || !tagB64 || !datosB64) throw new Error('Paquete cifrado con formato inválido');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(claveHex, 'hex'),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(datosB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Huella determinística para buscar duplicados sin exponer el número. */
export function huella(texto: string, claveHex: string): string {
  return createHmac('sha256', Buffer.from(claveHex, 'hex')).update(normalizarDocumento(texto)).digest('hex');
}

export function normalizarDocumento(numero: string): string {
  return numero.replace(/[\s.\-]/g, '').toUpperCase();
}

export function comparar(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
