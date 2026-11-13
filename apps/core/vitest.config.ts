import { defineConfig } from 'vitest/config';

// Testes unitários do backend. Rodam em Node puro (sem jsdom) — os alvos
// atuais são lógica de domínio sem dependência de browser. Arquivos `*.test.ts`
// moram AO LADO do código que testam (regra 2 do CLAUDE.md: módulo coeso e
// auto-contido, não há pasta `__tests__/` técnica separada).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Zera spies/mocks entre cada `it` — evita vazamento de estado em suítes
    // que reusam `vi.fn()` (Camada B do ContractsService).
    clearMocks: true,
  },
});
