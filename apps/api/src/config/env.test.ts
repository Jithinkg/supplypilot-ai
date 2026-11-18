import { afterEach, expect, it, vi } from 'vitest';
import { FREE_MODEL, readEnv } from './env.js';
afterEach(() => vi.unstubAllEnvs());
it('pins the explicitly authorized free model and rejects paid or alternate selections', () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
  vi.stubEnv('OPENROUTER_MODEL', 'google/gemma-4-31b-it:free');
  expect(readEnv().OPENROUTER_MODEL).toBe(FREE_MODEL);
  for (const model of ['google/gemma-4-31b-it', 'openrouter/auto', 'nvidia/nemotron-3.5-lightning:free']) {
    vi.stubEnv('OPENROUTER_MODEL', model);
    expect(() => readEnv()).toThrow('Invalid environment: OPENROUTER_MODEL');
  }
});
