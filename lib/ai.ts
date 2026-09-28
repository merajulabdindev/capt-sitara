// One function, two providers. Set AI_PROVIDER=gemini (free tier, default) or anthropic.
// Optional: AI_VERIFY_PROVIDER to use a different provider for the answer-checking pass.

export type Provider = 'gemini' | 'anthropic';
export type Ask = (prompt: string, opts?: { system?: string; think?: boolean; provider?: Provider }) => Promise<any>;

export function defaultProvider(): Provider {
  return (process.env.AI_PROVIDER as Provider) === 'anthropic' ? 'anthropic' : 'gemini';
}
export function verifyProvider(): Provider {
  const v = process.env.AI_VERIFY_PROVIDER as Provider | undefined;
  return v === 'anthropic' || v === 'gemini' ? v : defaultProvider();
}

// Pull the first JSON value out of a model reply (handles ```json fences and chatter).
export function parseJSON(text: string): any {
  const t = text.replace(/```json|```/gi, '').trim();
  const starts = [t.indexOf('['), t.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('no JSON in model reply');
  const s = Math.min(...starts);
  const close = t[s] === '[' ? ']' : '}';
  const e = t.lastIndexOf(close);
  if (e < s) throw new Error('unterminated JSON in model reply');
  return JSON.parse(t.slice(s, e + 1));
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) return res.json();
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (![429, 500, 502, 503, 529].includes(res.status)) break;
    if (res.status === 429 && attempt >= 1) break;               // free-tier per-minute limit: let the scheduler wait
    await new Promise((r) => setTimeout(r, res.status === 429 ? 15_000 : 1500 * (attempt + 1)));
  }
  throw new Error(`AI request failed: ${lastErr}`);
}

async function gemini(prompt: string, system: string | undefined, think: boolean): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const j = await post(
    `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`,
    { 'x-goog-api-key': key },
    {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json', temperature: think ? 0.2 : 0.9, maxOutputTokens: 8192,
        // only 2.5+/3 models understand thinkingConfig; "pro" models cannot switch thinking off
        ...(/gemini-(2\.5|3)/.test(model) && !/lite/.test(model) ? { thinkingConfig: { thinkingBudget: think ? 2048 : (/pro/.test(model) ? 512 : 0) } } : {}),
      },
    });
  const parts = j?.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('Gemini returned no content: ' + JSON.stringify(j).slice(0, 200));
  return parts.map((p: any) => p.text ?? '').join('');
}

async function anthropic(prompt: string, system: string | undefined, think: boolean): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const j = await post('https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 6000,
      temperature: think ? 0.2 : 0.9,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt + '\n\nReply with JSON only. No markdown fences, no commentary.' }],
    });
  const c = j?.content;
  if (!Array.isArray(c)) throw new Error('Anthropic returned no content');
  return c.map((b: any) => b.text ?? '').join('');
}

export const ask: Ask = async (prompt, opts = {}) => {
  const p = opts.provider ?? defaultProvider();
  const text = p === 'anthropic' ? await anthropic(prompt, opts.system, !!opts.think)
                                 : await gemini(prompt, opts.system, !!opts.think);
  return parseJSON(text);
};
