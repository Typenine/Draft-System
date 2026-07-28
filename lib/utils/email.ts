type EmailPayload = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('sendEmail: RESEND_API_KEY is not set; email not sent');
    return;
  }
  const primaryFrom = payload.from || process.env.RESEND_FROM || undefined;
  const fallbackFrom = 'onboarding@resend.dev';
  const to = Array.isArray(payload.to) ? payload.to : [payload.to];

  async function attemptSend(fromAddr: string): Promise<{ ok: true } | { ok: false; error: Error }> {
    const body = {
      from: fromAddr,
      to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    };
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => '');
      return { ok: false, error: new Error(`Resend email failed: ${resp.status} ${resp.statusText} ${msg}`) };
    }
    return { ok: true };
  }

  const firstFrom = primaryFrom || fallbackFrom;
  const first = await attemptSend(firstFrom);
  if (first.ok) return;
  if (firstFrom !== fallbackFrom) {
    const second = await attemptSend(fallbackFrom);
    if (second.ok) return;
    throw first.error;
  }
  throw first.error;
}
