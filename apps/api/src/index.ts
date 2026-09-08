import { cargarEnv } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { crearContexto } from './contexto.js';
import { crearServidor } from './servidor.js';

const env = cargarEnv();
const app = await crearServidor(crearContexto(prisma, env), env);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const señal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(señal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
