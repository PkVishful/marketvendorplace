// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ConsoleSink, selectProvider } from './provider.mjs';

describe('otp provider', () => {
  it('ConsoleSink.send resolves delivered', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await new ConsoleSink().send({ phone: '9876543210', code: '123456', purpose: 'otp' });
    expect(r).toEqual({ delivered: true, channel: 'console' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('selectProvider returns ConsoleSink by default', () => {
    expect(selectProvider({ provider: 'console' })).toBeInstanceOf(ConsoleSink);
  });

  it('selectProvider throws on unknown provider', () => {
    expect(() => selectProvider({ provider: 'nope' })).toThrow(/unknown OTP provider/);
  });
});
