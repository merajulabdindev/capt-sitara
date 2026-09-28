// GET /api/cron  (Authorization: Bearer $CRON_SECRET)
// Closes abandoned attempts, queues auto-reminders, and sends queued emails with retry.
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

const CAT: Record<string, string> = {
  verbal: 'Verbal Intelligence', nonverbal: 'Non-Verbal Intelligence',
  education: 'Education & Academic', gk: 'General Knowledge',
};

function render(row: any): { subject: string; text: string } {
  const p = row.payload;
  if (row.template === 'reminder') {
    const left = (p.remaining as string[]).map((c) => CAT[c] ?? c).join(', ');
    return { subject: 'Capt Sitara: practice reminder', text: `${p.candidate_name}, today's tests still pending: ${left}.` };
  }
  const mins = Math.floor(p.elapsed_seconds / 60), secs = p.elapsed_seconds % 60;
  const mistakes = (p.mistakes as any[]).length
    ? (p.mistakes as any[]).map((m) => `  - ${m.topic}: ${m.count}`).join('\n') : '  none';
  return {
    subject: `Capt Sitara: ${CAT[p.category]} ${p.score}/${p.total} (${p.percentage}%)`,
    text: [`Candidate: ${p.candidate_name}`, `Date: ${p.date_local}`, `Category: ${CAT[p.category]}`,
      `Score: ${p.score}/${p.total} (${p.percentage}%)${p.timed_out ? ' [timed out]' : ''}`,
      `Time used: ${mins}m ${secs}s`, 'Mistakes by topic:', mistakes].join('\n'),
  };
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const closed = await sb.rpc('close_expired_attempts');
  const reminded = await sb.rpc('enqueue_auto_reminder');

  const { data: rows, error } = await sb.from('email_outbox')
    .select('*, recipient:profiles(email)')
    .in('status', ['pending', 'failed']).lt('tries', 5).lte('next_try_at', new Date().toISOString())
    .order('created_at').limit(20);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // SMTP adapter (Gmail app password, Brevo, etc). Swap this block for Resend if preferred.
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    try {
      const { subject, text } = render(row);
      await transport.sendMail({ from: process.env.MAIL_FROM, to: row.recipient.email, subject, text });
      await sb.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), tries: row.tries + 1 }).eq('id', row.id);
      sent++;
    } catch (e: any) {
      const tries = row.tries + 1;
      await sb.from('email_outbox').update({
        status: 'failed', tries, last_error: String(e?.message ?? e).slice(0, 500),
        next_try_at: new Date(Date.now() + tries * 10 * 60_000).toISOString(),
      }).eq('id', row.id);
      failed++;
    }
  }
  return Response.json({ closed: closed.data, reminded: reminded.data, sent, failed });
}
