// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Msg91Provider } from './msg91.mjs';

const cfg = { msg91: { authKey: 'AUTHKEY', templateId: 'TPL', senderId: null } };

afterEach(() => vi.unstubAllGlobals());

describe('Msg91Provider', () => {
  it('throws when auth key or template id is missing', () => {
    expect(() => new Msg91Provider({ msg91: { authKey: null, templateId: null } }))
      .toThrow(/MSG91/);
  });

  it('posts our code to the flow API with the right shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new Msg91Provider(cfg).send({ phone: '9876543210', code: '123456', purpose: 'otp' });
    expect(r).toEqual({ delivered: true, channel: 'msg91' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://control.msg91.com/api/v5/flow/');
    expect(opts.method).toBe('POST');
    expect(opts.headers.authkey).toBe('AUTHKEY');
    const body = JSON.parse(opts.body);
    expect(body.template_id).toBe('TPL');
    expect(body.recipients[0].mobiles).toBe('919876543210');
    expect(body.recipients[0].var1).toBe('123456');
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' }))
      .rejects.toThrow(/MSG91 send failed: 401/);
  });
});
