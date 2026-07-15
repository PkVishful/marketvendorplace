// web/server/otp/msg91.mjs
// MSG91 SMS OTP provider. Delivers OUR server-generated code via MSG91's Flow API
// (a DLT-approved template with a variable for the code) — it does NOT use MSG91's
// own OTP generator, so the hashed/TTL/single-use engine stays the source of truth.

const SEND_TIMEOUT_MS = 10_000;

export class Msg91Provider {
  constructor(config) {
    const m = config.msg91 || {};
    if (!m.authKey || !m.templateId) {
      throw new Error('MSG91 provider requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    }
    this.authKey = m.authKey;
    this.templateId = m.templateId;
    this.senderId = m.senderId; // optional; usually embedded in the DLT template
    this.endpoint = 'https://control.msg91.com/api/v5/flow/';
  }

  async send({ phone, code /*, purpose */ }) {
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: this.authKey },
        body: JSON.stringify({
          template_id: this.templateId,
          recipients: [{ mobiles: `91${phone}`, var1: code }],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new Error(`MSG91 send timed out after ${SEND_TIMEOUT_MS}ms`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`MSG91 send failed: ${res.status}`);
    }
    // The Flow API can answer HTTP 200 with { type: 'error', message } — treat that
    // as a failed delivery, not a success.
    const body = await res.json().catch(() => null);
    if (body?.type === 'error') {
      throw new Error(`MSG91 send failed: ${body.message || 'error response'}`);
    }
    return { delivered: true, channel: 'msg91' };
  }
}
