import { createClient } from '@supabase/supabase-js';
export const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'missing-key');
export const CAT: Record<string, string> = {
  verbal: 'Verbal Intelligence', nonverbal: 'Non-Verbal Intelligence',
  education: 'Education & Academic', gk: 'General Knowledge',
};
export const ISSB_MSG = 'Sabr kru Gudiya waqt aaany pr y bhi hu jay ga';
