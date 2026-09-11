import { ErrorPasarela } from './pasarela.js';

/**
 * Llamadas HTTP a un proveedor de pagos.
 *
 * Tres cosas que no son opcionales cuando se mueve plata:
 *  - timeout, para no quedarse colgado con una retención en el aire;
 *  - reintentos sólo en errores de red y 5xx, nunca en un 4xx (un rechazo de
 *    tarjeta no mejora repitiéndolo);
 *  - clave de idempotencia, para que un reintento no cobre dos veces.
 */
export interface OpcionesLlamada {
  metodo: 'GET' | 'POST' | 'PUT';
  url: string;
  cabeceras: Record<string, string>;
  cuerpo?: string;
  timeoutMs?: number;
  reintentos?: number;
}

export async function llamar<T>(opciones: OpcionesLlamada): Promise<T> {
  const reintentos = opciones.reintentos ?? 2;
  const timeoutMs = opciones.timeoutMs ?? 15000;
  let ultimoError: unknown;

  for (let intento = 0; intento <= reintentos; intento++) {
    const corte = AbortSignal.timeout(timeoutMs);
    try {
      const r = await fetch(opciones.url, {
        method: opciones.metodo,
        headers: opciones.cabeceras,
        body: opciones.cuerpo,
        signal: corte,
      });
      const texto = await r.text();
      const datos = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};

      if (r.ok) return datos as T;

      // 4xx es decisión del proveedor: no se reintenta.
      if (r.status < 500) throw errorDeProveedor(r.status, datos);

      ultimoError = new ErrorPasarela('PROVEEDOR_CAIDO', `El proveedor respondió ${r.status}`);
    } catch (error) {
      if (error instanceof ErrorPasarela && error.codigo !== 'PROVEEDOR_CAIDO') throw error;
      ultimoError = error;
    }
    if (intento < reintentos) await esperar(250 * Math.pow(2, intento));
  }

  if (ultimoError instanceof ErrorPasarela) throw ultimoError;
  throw new ErrorPasarela('PROVEEDOR_INALCANZABLE', 'No pudimos comunicarnos con el proveedor de pagos');
}

function errorDeProveedor(status: number, datos: Record<string, unknown>): ErrorPasarela {
  const error = (datos.error ?? {}) as { code?: string; message?: string; decline_code?: string };
  const codigo = error.decline_code ?? error.code ?? (datos.error as string) ?? `HTTP_${status}`;
  const mensaje =
    error.message ??
    (datos.message as string) ??
    (Array.isArray(datos.cause) && (datos.cause[0] as { description?: string })?.description) ??
    'El pago fue rechazado';
  return new ErrorPasarela(String(codigo).toUpperCase(), String(mensaje));
}

export function formulario(datos: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(datos)) if (v !== undefined) p.append(k, String(v));
  return p.toString();
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
