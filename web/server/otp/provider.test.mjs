// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ConsoleSink, selectProvider } from './provider.mjs';
import { Msg91Provider } from './msg91.mjs';

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

describe('selectProvider msg91', () => {
  it('returns a Msg91Provider when configured', () => {
    const p = selectProvider({ provider: 'msg91', msg91: { authKey: 'k', templateId: 't', senderId: null } });
    expect(p).toBeInstanceOf(Msg91Provider);
  });
  it('throws when msg91 keys are missing', () => {
    expect(() => selectProvider({ provider: 'msg91', msg91: { authKey: null, templateId: null } }))
      .toThrow(/MSG91/);
  });
});
