import { invalido } from '../../lib/errores.js';

/**
 * Login social. Google resuelve identidad básica; LinkedIn además trae el perfil
 * profesional, que es lo que le da respaldo a un abogado o a un contador dentro
 * de la app (se guarda la URL del perfil y se muestra en su ficha).
 */
export interface PerfilProveedor {
  proveedor: 'GOOGLE' | 'LINKEDIN';
  proveedorId: string;
  email?: string;
  nombre: string;
  apellido: string;
  fotoUrl?: string;
  perfilUrl?: string;
  datos?: Record<string, unknown>;
}

export interface ProveedorOauth {
  /** URL a la que mandamos al usuario para que autorice. */
  urlAutorizacion(estado: string): string;
  /** Cambia el `code` de la redirección por el perfil del usuario. */
  perfilDesdeCodigo(codigo: string): Promise<PerfilProveedor>;
}

export interface ConfigOauth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class ProveedorGoogle implements ProveedorOauth {
  constructor(private readonly config: ConfigOauth) {}

  urlAutorizacion(estado: string): string {
    const p = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: estado,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  async perfilDesdeCodigo(codigo: string): Promise<PerfilProveedor> {
    const token = await intercambiar('https://oauth2.googleapis.com/token', {
      code: codigo,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
    });
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!r.ok) throw invalido('OAUTH_FALLIDO', 'No se pudo leer el perfil de Google');
    const u = (await r.json()) as Record<string, string>;
    return {
      proveedor: 'GOOGLE',
      proveedorId: u.sub!,
      email: u.email,
      nombre: u.given_name ?? '',
      apellido: u.family_name ?? '',
      fotoUrl: u.picture,
    };
  }
}

export class ProveedorLinkedin implements ProveedorOauth {
  constructor(private readonly config: ConfigOauth) {}

  urlAutorizacion(estado: string): string {
    const p = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: estado,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
  }

  async perfilDesdeCodigo(codigo: string): Promise<PerfilProveedor> {
    const token = await intercambiar('https://www.linkedin.com/oauth/v2/accessToken', {
      grant_type: 'authorization_code',
      code: codigo,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
    });
    const r = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!r.ok) throw invalido('OAUTH_FALLIDO', 'No se pudo leer el perfil de LinkedIn');
    const u = (await r.json()) as Record<string, string>;
    return {
      proveedor: 'LINKEDIN',
      proveedorId: u.sub!,
      email: u.email,
      nombre: u.given_name ?? '',
      apellido: u.family_name ?? '',
      fotoUrl: u.picture,
      perfilUrl: u.profile,
      datos: { locale: u.locale },
    };
  }
}

async function intercambiar(url: string, cuerpo: Record<string, string>) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cuerpo),
  });
  if (!r.ok) throw invalido('OAUTH_FALLIDO', 'El proveedor rechazó el código de autorización');
  return (await r.json()) as { access_token: string };
}
