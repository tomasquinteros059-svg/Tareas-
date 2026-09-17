import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATALOGO, buscarRubro, cotizar } from '@tareas/domain';
import { ErrorApi, invalido, sinPermiso } from './lib/errores.js';
import {
  aplicarEvento,
  eventoDeMercadoPago,
  eventoDeStripe,
  verificarFirmaMercadoPago,
  verificarFirmaStripe,
} from './modulos/pagos/webhooks.js';
import type { Contexto } from './contexto.js';

const VERSION = '0.1.0';

const dificultad = z.enum(['BASICA', 'MEDIA', 'ALTA', 'EXPERTA']);
const urgencia = z.enum(['PROGRAMADA', 'HOY', 'INMEDIATA']);
const nivel = z.enum(['NUEVO', 'BRONCE', 'PLATA', 'ORO', 'PLATINO']);
const metodoPago = z.enum(['TARJETA', 'EFECTIVO']);

const cotizacionSchema = z.object({
  rubroSlug: z.string(),
  unidades: z.number().positive(),
  dificultad,
  urgencia,
  nivelMinimo: nivel.default('NUEVO'),
  fueraDeHorario: z.boolean().optional(),
  distanciaKm: z.number().nonnegative().optional(),
  materiales: z.number().int().nonnegative().optional(),
});

const nuevaTareaSchema = cotizacionSchema.extend({
  titulo: z.string().min(5).max(120),
  descripcion: z.string().min(10).max(4000),
  presupuesto: z.number().int().positive(),
  metodoPago,
  metodoPagoToken: z.string().optional(),
  direccionId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  exigeAntecedentes: z.boolean().optional(),
  programadaPara: z.coerce.date().optional(),
  fotos: z.array(z.string().url()).max(8).optional(),
});

export async function registrarRutas(app: FastifyInstance, ctx: Contexto) {
  /**
   * Latido para el balanceador y para Docker. Toca la base a propósito: un
   * proceso vivo que no puede leer nada no está sano, y si respondiera que sí,
   * el balanceador le seguiría mandando gente a una pantalla rota.
   */
  app.get('/salud', async (_req, reply) => {
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      return { ok: true, version: VERSION, base: 'ok' };
    } catch {
      return reply.code(503).send({ ok: false, version: VERSION, base: 'sin conexión' });
    }
  });

  // --- Catálogo y cotizador: públicos, para que se pueda ver el precio sin cuenta.
  // La clave pública de los avisos: el navegador la necesita para suscribirse.
  app.get('/avisos/clave', async () => ({
    activo: ctx.avisos.activo,
    clavePublica: ctx.avisos.clavePublica,
  }));

  app.get('/catalogo', async () => ({
    rubros: CATALOGO.map((r) => ({
      slug: r.slug,
      nombre: r.nombre,
      familia: r.familia,
      unidad: r.unidad,
      minimoPorUnidad: r.minimoPorUnidad,
      unidadesMinimas: r.unidadesMinimas,
      requiereLicencia: r.requiereLicencia,
      requiereAntecedentes: r.requiereAntecedentes,
      requiereTitulo: r.requiereTitulo,
      categoria: r.categoria,
      comisionBase: r.comisionBase,
    })),
  }));

  app.get('/catalogo/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const rubro = buscarRubro(slug);
    if (!rubro) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Ese rubro no existe');
    return rubro;
  });

  app.post('/cotizar', async (req) => {
    const datos = cotizacionSchema.parse(req.body);
    return cotizar(datos, ctx.pais.precios);
  });

  /*
   * Avisos del proveedor de pagos. Van sin sesión —los manda el proveedor, no
   * un usuario— así que la única defensa es la firma. Siempre respondemos 200
   * salvo firma inválida: si devolvemos error por un evento que no nos
   * interesa, el proveedor lo reintenta durante días.
   */
  app.post('/webhooks/pagos/stripe', async (req, reply) => {
    const secreto = ctx.env.STRIPE_WEBHOOK_SECRET;
    if (!secreto) throw invalido('WEBHOOK_NO_CONFIGURADO', 'Falta STRIPE_WEBHOOK_SECRET');
    const firma = req.headers['stripe-signature'];
    if (typeof firma !== 'string' || !verificarFirmaStripe(req.cuerpoCrudo ?? '', firma, secreto)) {
      return reply.code(400).send({ error: { codigo: 'FIRMA_INVALIDA', mensaje: 'Firma inválida' } });
    }
    const resultado = await aplicarEvento(ctx.prisma, 'stripe', eventoDeStripe(req.body as Record<string, unknown>));
    return reply.send({ recibido: true, ...resultado });
  });

  app.post('/webhooks/pagos/mercadopago', async (req, reply) => {
    const secreto = ctx.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secreto) throw invalido('WEBHOOK_NO_CONFIGURADO', 'Falta MERCADOPAGO_WEBHOOK_SECRET');
    const firma = req.headers['x-signature'];
    const requestId = String(req.headers['x-request-id'] ?? '');
    const cuerpo = req.body as { data?: { id?: string } };
    const datosId = String(cuerpo?.data?.id ?? '');
    if (typeof firma !== 'string' || !verificarFirmaMercadoPago(datosId, requestId, firma, secreto)) {
      return reply.code(400).send({ error: { codigo: 'FIRMA_INVALIDA', mensaje: 'Firma inválida' } });
    }
    const resultado = await aplicarEvento(ctx.prisma, 'mercadopago', eventoDeMercadoPago(cuerpo as Record<string, unknown>));
    return reply.send({ recibido: true, ...resultado });
  });

  // --- Ingreso por teléfono (OTP). Google y LinkedIn cuelgan de /auth/:proveedor.
  app.post('/auth/telefono/codigo', async (req) => {
    const { telefono } = z.object({ telefono: z.string().min(8).max(20) }).parse(req.body);
    return ctx.otp.enviar(telefono);
  });

  app.post('/auth/telefono/verificar', async (req) => {
    const cuerpo = z
      .object({
        telefono: z.string().min(8).max(20),
        codigo: z.string().length(6),
        nombre: z.string().min(2).optional(),
        apellido: z.string().min(2).optional(),
      })
      .parse(req.body);

    const ok = await ctx.otp.verificar(cuerpo.telefono, cuerpo.codigo);
    if (!ok) throw invalido('CODIGO_INCORRECTO', 'El código no es correcto');

    // Siempre el número normalizado: si se guarda como lo escribió cada uno, la
    // misma persona termina con tres cuentas y el teléfono deja de ser único.
    const telefono = ctx.otp.normalizar(cuerpo.telefono);
    const usuario = await ctx.prisma.usuario.upsert({
      where: { telefono },
      create: {
        telefono,
        telefonoOk: true,
        nombre: cuerpo.nombre ?? 'Sin nombre',
        apellido: cuerpo.apellido ?? '',
      },
      update: { telefonoOk: true },
    });
    return { token: app.jwt.sign({ sub: usuario.id, roles: usuario.roles }), usuario };
  });

  app.get('/auth/:proveedor', async (req, reply) => {
    const { proveedor } = z.object({ proveedor: z.enum(['google', 'linkedin']) }).parse(req.params);
    const cliente = ctx.oauth[proveedor];
    if (!cliente) throw invalido('PROVEEDOR_NO_CONFIGURADO', `Falta configurar ${proveedor}`);
    return reply.redirect(cliente.urlAutorizacion(crypto.randomUUID()));
  });

  app.get('/auth/:proveedor/callback', async (req) => {
    const { proveedor } = z.object({ proveedor: z.enum(['google', 'linkedin']) }).parse(req.params);
    const { code } = z.object({ code: z.string() }).parse(req.query);
    const cliente = ctx.oauth[proveedor];
    if (!cliente) throw invalido('PROVEEDOR_NO_CONFIGURADO', `Falta configurar ${proveedor}`);

    const perfil = await cliente.perfilDesdeCodigo(code);
    const existente = await ctx.prisma.cuentaOAuth.findUnique({
      where: { proveedor_proveedorId: { proveedor: perfil.proveedor, proveedorId: perfil.proveedorId } },
      include: { usuario: true },
    });

    // El teléfono sigue siendo obligatorio: el login social identifica, pero el
    // contacto real entre dos personas que se van a encontrar es el teléfono.
    if (!existente) {
      return {
        requiereTelefono: true,
        perfil: { ...perfil, datos: undefined },
        mensaje: 'Verificá tu teléfono para terminar de crear la cuenta',
      };
    }
    return {
      token: app.jwt.sign({ sub: existente.usuarioId, roles: existente.usuario.roles }),
      usuario: existente.usuario,
    };
  });

  // --- De acá para abajo hace falta sesión.
  app.register(async (privadas) => {
    privadas.addHook('onRequest', async (req) => {
      await req.jwtVerify();
    });

    privadas.get('/yo', async (req) => {
      const usuario = await ctx.prisma.usuario.findUniqueOrThrow({
        where: { id: req.usuarioId() },
        include: { perfil: { include: { habilidades: true } } },
      });
      return { usuario, identidad: await ctx.identidad.ver(usuario.id) };
    });

    /* --- El perfil de trabajador: pasar de mirar a poder trabajar. --- */
    privadas.get('/perfil', async (req) => ctx.perfil.ver(req.usuarioId()));

    privadas.put('/perfil', async (req) => {
      const datos = z
        .object({
          bio: z.string().max(600).optional(),
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          radioKm: z.number().min(1).max(60),
          rubros: z.array(z.string().min(2).max(60)).min(1).max(8),
          aceptaEfectivo: z.boolean().optional(),
          disponible: z.boolean().optional(),
        })
        .parse(req.body);
      return ctx.perfil.guardar(req.usuarioId(), datos);
    });

    privadas.post('/perfil/disponibilidad', async (req) => {
      const { disponible } = z.object({ disponible: z.boolean() }).parse(req.body);
      return ctx.perfil.cambiarDisponibilidad(req.usuarioId(), disponible);
    });

    privadas.post('/identidad', async (req) => {
      const datos = z
        .object({
          tipoDocumento: z.enum(['CEDULA', 'DNI', 'PASAPORTE', 'LICENCIA_CONDUCIR']),
          numero: z.string().min(5).max(30),
          paisEmision: z.string().length(2),
          nombreLegal: z.string().min(4),
          fechaNacimiento: z.coerce.date(),
          frenteUrl: z.string().url().optional(),
          dorsoUrl: z.string().url().optional(),
          selfieUrl: z.string().url().optional(),
        })
        .parse(req.body);
      await ctx.identidad.registrar(req.usuarioId(), datos);
      return ctx.identidad.ver(req.usuarioId());
    });

    privadas.post('/identidad/:usuarioId/resolver', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).parse(req.params);
      const { aprobado, motivo } = z
        .object({ aprobado: z.boolean(), motivo: z.string().optional() })
        .parse(req.body);
      await ctx.identidad.resolver(usuarioId, aprobado, req.usuarioId(), motivo);
      return ctx.identidad.ver(usuarioId);
    });

    privadas.post('/tareas', async (req, reply) => {
      const datos = nuevaTareaSchema.parse(req.body);
      const tarea = await ctx.tareas.publicar(req.usuarioId(), datos);
      return reply.code(201).send(tarea);
    });

    privadas.post('/tareas/:id/confirmar-pago', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return ctx.tareas.confirmarPago(id, req.usuarioId());
    });

    // Antes de la ruta con folio: "mias" no es un folio, y aunque el router
    // prefiere lo estático, el orden acá lo deja claro para quien lea.
    privadas.get('/tareas/mias', async (req) => ({ tareas: await ctx.tareas.mias(req.usuarioId()) }));

    privadas.get('/tareas/:folio', async (req) => {
      const { folio } = z.object({ folio: z.string() }).parse(req.params);
      return ctx.tareas.porFolio(folio, { usuarioId: req.usuarioId(), roles: req.roles() });
    });

    privadas.get('/feed', async (req) => ({ tareas: await ctx.tareas.feed(req.usuarioId()) }));


    privadas.post('/tareas/:id/aceptar', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return ctx.tareas.aceptar(id, req.usuarioId());
    });

    privadas.post('/tareas/:id/estado', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const cuerpo = z
        .object({
          estado: z.enum([
            'EN_CAMINO',
            'EN_PROGRESO',
            'ENTREGADA',
            'CONFIRMADA',
            'CANCELADA',
            'PUBLICADA',
            'EN_DISPUTA',
          ]),
          codigoInicio: z.string().length(4).optional(),
          nota: z.string().max(500).optional(),
          propina: z.number().int().min(0).optional(),
        })
        .parse(req.body);
      return ctx.tareas.cambiarEstado(id, req.usuarioId(), cuerpo.estado, {
        codigoInicio: cuerpo.codigoInicio,
        nota: cuerpo.nota,
        propina: cuerpo.propina,
      });
    });

    privadas.post('/tareas/:id/preguntas', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { texto } = z.object({ texto: z.string().min(3).max(500) }).parse(req.body);
      return ctx.tareas.preguntar(id, req.usuarioId(), texto);
    });

    privadas.post('/tareas/:id/preguntas/:preguntaId/responder', async (req) => {
      const { id, preguntaId } = z
        .object({ id: z.string().uuid(), preguntaId: z.string().uuid() })
        .parse(req.params);
      const { texto } = z.object({ texto: z.string().min(1).max(500) }).parse(req.body);
      return ctx.tareas.responder(id, preguntaId, req.usuarioId(), texto);
    });

    privadas.get('/tareas/guardadas', async (req) => ctx.tareas.guardadas(req.usuarioId()));

    privadas.post('/tareas/:id/guardar', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return ctx.tareas.guardar(id, req.usuarioId());
    });

    privadas.post('/tareas/:id/mensajes', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { texto } = z.object({ texto: z.string().min(1).max(2000) }).parse(req.body);
      return ctx.tareas.mensajear(id, req.usuarioId(), texto);
    });

    privadas.post('/tareas/:id/calificar', async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const datos = z
        .object({
          estrellas: z.number().int().min(1).max(5),
          comentario: z.string().max(1000).optional(),
          etiquetas: z.array(z.string().max(30)).max(5).optional(),
          puntual: z.boolean().optional(),
        })
        .parse(req.body);
      return ctx.calificaciones.calificar(id, req.usuarioId(), datos);
    });

    /* --- Soporte. Todo acá exige el rol y queda firmado por quien lo hizo. --- */
    privadas.get('/soporte/bandeja', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      return ctx.soporte.bandeja();
    });

    privadas.post('/soporte/disputas/:id/resolver', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const cuerpo = z
        .object({
          resolucion: z.enum(['TRABAJADOR', 'CLIENTE', 'PARCIAL']),
          nota: z.string().min(10, 'Explicá la resolución: queda registrada'),
          montoAcordado: z.number().int().positive().optional(),
        })
        .parse(req.body);
      return ctx.soporte.resolverDisputa({ tareaId: id, revisorId: req.usuarioId(), ...cuerpo });
    });

    privadas.get('/soporte/usuarios/:id', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return ctx.soporte.ficha(id);
    });

    privadas.post('/soporte/usuarios/:id/saldo', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { monto, motivo } = z
        .object({ monto: z.number().int(), motivo: z.string().min(10) })
        .parse(req.body);
      return ctx.soporte.ajustarSaldo({ usuarioId: id, monto, motivo, revisorId: req.usuarioId() });
    });

    privadas.post('/soporte/usuarios/:id/suspender', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { motivo } = z.object({ motivo: z.string().min(10) }).parse(req.body);
      return ctx.soporte.suspender(id, motivo, req.usuarioId());
    });

    privadas.post('/soporte/usuarios/:id/habilitar', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return ctx.soporte.levantarSuspension(id);
    });

    privadas.get('/soporte/alertas', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      return ctx.antifraude.pendientes();
    });

    privadas.post('/soporte/alertas/:id/resolver', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { confirmada, nota } = z
        .object({ confirmada: z.boolean(), nota: z.string().min(10).max(500) })
        .parse(req.body);
      return ctx.antifraude.resolver(id, req.usuarioId(), confirmada, nota);
    });

    /* --- Avisos push. --- */
    privadas.post('/avisos/suscribir', async (req, reply) => {
      const datos = z
        .object({
          endpoint: z.string().url(),
          claves: z.object({ p256dh: z.string().min(10), auth: z.string().min(8) }),
          agente: z.string().max(200).optional(),
        })
        .parse(req.body);
      await ctx.avisos.suscribir(req.usuarioId(), datos);
      return reply.code(201).send({ suscripto: true });
    });

    privadas.post('/avisos/baja', async (req) => {
      const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
      return ctx.avisos.desuscribir(req.usuarioId(), endpoint);
    });

    /* --- Deuda de comisiones de los trabajos en efectivo. --- */
    privadas.get('/deudas', async (req) => ctx.deudas.estado(req.usuarioId()));

    privadas.put('/deudas/tarjeta', async (req) => {
      const { metodoPagoToken } = z.object({ metodoPagoToken: z.string().min(4) }).parse(req.body);
      return ctx.deudas.guardarMedioDePago(req.usuarioId(), metodoPagoToken);
    });

    privadas.post('/deudas/pagar', async (req) => {
      const { metodoPagoToken } = z
        .object({ metodoPagoToken: z.string().min(4).optional() })
        .parse(req.body ?? {});
      return ctx.deudas.pagar(req.usuarioId(), metodoPagoToken);
    });

    privadas.post('/deudas/confirmar', async (req) => ctx.deudas.confirmarPago(req.usuarioId()));

    /* --- Retiros: el saldo se vuelve plata en el banco del trabajador. --- */
    privadas.get('/retiros', async (req) => ctx.retiros.mios(req.usuarioId()));

    privadas.put('/retiros/banco', async (req) => {
      const datos = z
        .object({
          bancoNombre: z.string().min(3).max(60),
          tipoCuenta: z.enum(['CORRIENTE', 'VISTA', 'AHORRO', 'RUT']),
          numero: z.string().min(5).max(30),
          titular: z.string().min(5).max(120),
          rutTitular: z.string().min(8).max(15),
        })
        .parse(req.body);
      return ctx.retiros.guardarBanco(req.usuarioId(), datos);
    });

    privadas.post('/retiros', async (req, reply) => {
      const { monto } = z.object({ monto: z.number().int().positive() }).parse(req.body);
      const retiro = await ctx.retiros.solicitar(req.usuarioId(), monto);
      return reply.code(201).send(retiro);
    });

    privadas.get('/soporte/retiros', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      return ctx.retiros.pendientes();
    });

    privadas.post('/soporte/retiros/:id/pagado', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { referencia } = z.object({ referencia: z.string().min(3).max(120) }).parse(req.body);
      return ctx.retiros.marcarPagado(id, req.usuarioId(), referencia);
    });

    privadas.post('/soporte/retiros/:id/rechazar', async (req) => {
      exigirRol(req.roles(), 'SOPORTE');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const { motivo } = z.object({ motivo: z.string().min(10).max(500) }).parse(req.body);
      return ctx.retiros.rechazar(id, req.usuarioId(), motivo);
    });

    privadas.get('/saldo', async (req) => {
      const usuarioId = req.usuarioId();
      const [perfil, movimientos] = await Promise.all([
        ctx.prisma.perfilTrabajador.findUnique({ where: { usuarioId } }),
        ctx.prisma.movimientoSaldo.findMany({
          where: { usuarioId },
          orderBy: { creadoEn: 'desc' },
          take: 50,
        }),
      ]);
      return {
        saldo: perfil?.saldo ?? 0,
        deudaComisiones: perfil && perfil.saldo < 0 ? -perfil.saldo : 0,
        movimientos,
      };
    });
  });
}

function exigirRol(roles: string[], rol: string) {
  if (!roles.includes(rol) && !roles.includes('ADMIN')) {
    throw sinPermiso(`Esta acción es sólo para ${rol}`);
  }
}
