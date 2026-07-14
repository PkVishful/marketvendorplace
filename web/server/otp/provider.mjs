// Pluggable OTP delivery seam. The default logs the code (staging/local only,
// never a real-user delivery path). A real SMS adapter implements the same
// async send({ phone, code, purpose }) and is selected via config.provider.

export class ConsoleSink {
  async send({ phone, code, purpose }) {
    console.log(`[otp:${purpose}] code for ${phone}: ${code}`);
    return { delivered: true, channel: 'console' };
  }
}

// Interface a future SMS adapter must satisfy (documented, not yet implemented):
//   class SmsProvider { constructor(config) {} async send({ phone, code, purpose }) {} }

export function selectProvider(config) {
  switch (config.provider) {
    case 'console':
      return new ConsoleSink();
    default:
      throw new Error(`unknown OTP provider: ${config.provider}`);
  }
}
