// web/server/otp/msg91.mjs
// MSG91 SMS OTP provider. Delivers OUR server-generated code via MSG91's Flow API
// (a DLT-approved template with a variable for the code) — it does NOT use MSG91's
// own OTP generator, so the hashed/TTL/single-use engine stays the source of truth.

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
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      body: JSON.stringify({
        template_id: this.templateId,
        recipients: [{ mobiles: `91${phone}`, var1: code }],
      }),
    });
    if (!res.ok) {
      throw new Error(`MSG91 send failed: ${res.status}`);
    }
    return { delivered: true, channel: 'msg91' };
  }
}
