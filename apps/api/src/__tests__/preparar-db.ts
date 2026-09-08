import { execSync } from 'node:child_process';

export const URL_TEST =
  process.env.TEST_DATABASE_URL ?? 'postgresql://tareas:tareas@localhost:5432/tareas_test?schema=public';

/** Deja la base de test con el esquema al día antes de correr nada. */
export default function setup() {
  execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: URL_TEST },
    stdio: 'ignore',
  });
}
