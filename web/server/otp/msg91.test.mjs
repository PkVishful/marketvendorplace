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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ type: 'success', message: 'queued' }),
    });
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

  it('throws when MSG91 returns HTTP 200 with an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ type: 'error', message: 'Template not approved' }),
    }));
    await expect(new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' }))
      .rejects.toThrow(/MSG91 send failed: Template not approved/);
  });

  it('treats a 2xx with an unparseable body as delivered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.reject(new Error('not json')),
    }));
    const r = await new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' });
    expect(r).toEqual({ delivered: true, channel: 'msg91' });
  });

  it('passes an abort signal so a hung endpoint cannot block the OTP handler', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ type: 'success' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('surfaces an aborted fetch as a clear MSG91 timeout error', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));
    await expect(new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' }))
      .rejects.toThrow(/MSG91 send timed out/);
  });
});
