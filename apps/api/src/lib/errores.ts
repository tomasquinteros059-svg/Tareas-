/** Error de negocio con código estable: el cliente móvil traduce por `codigo`. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

export const noEncontrado = (que: string) => new ErrorApi(404, 'NO_ENCONTRADO', `${que} no existe`);
export const sinPermiso = (mensaje = 'No tenés permiso para esta acción') =>
  new ErrorApi(403, 'SIN_PERMISO', mensaje);
export const conflicto = (codigo: string, mensaje: string, detalle?: unknown) =>
  new ErrorApi(409, codigo, mensaje, detalle);
export const invalido = (codigo: string, mensaje: string, detalle?: unknown) =>
  new ErrorApi(422, codigo, mensaje, detalle);
