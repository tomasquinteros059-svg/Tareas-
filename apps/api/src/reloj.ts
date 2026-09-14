/**
 * El reloj, para correr desde afuera.
 *
 *   pnpm --filter @tareas/api reloj
 *
 * Pensado para un cron cada pocos minutos. Hace una pasada, informa qué hizo y
 * se va: no queda corriendo. Si algo falla, sale con código 1 para que el cron
 * lo registre como error.
 */
import { cargarEnv } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { crearContexto } from './contexto.js';

const env = cargarEnv();
const ctx = crearContexto(prisma, env);
const resumen = await ctx.reloj.correr();

console.log(
  [
    `expiradas: ${resumen.expiradas}`,
    `confirmadas solas: ${resumen.confirmadas}`,
    `calificaciones publicadas: ${resumen.calificacionesLiberadas}`,
    `reservas liberadas: ${resumen.reservasLiberadas}`,
    `deudas cobradas: ${resumen.deudasCobradas} (${resumen.deudasCobradasMonto})`,
  ].join(' · '),
);
if (resumen.errores.length) {
  console.error('errores:', resumen.errores.join(' | '));
}
await prisma.$disconnect();
process.exit(resumen.errores.length ? 1 : 0);
