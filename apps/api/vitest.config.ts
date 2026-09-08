import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/__tests__/preparar-db.ts'],
    // Los tests comparten una base real: se corren en serie para que el estado
    // de una prueba no se le mezcle a otra.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
  },
});
