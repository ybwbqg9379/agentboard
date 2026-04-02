import { createClient } from '@supabase/supabase-js';
import config from './config.js';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

if (!isTest) {
  if (!config.supabaseUrl) {
    throw new Error(
      '[supabaseClient] SUPABASE_URL is not configured. ' +
        'Set it in .env.local or environment variables. ' +
        'See .env.example for details.',
    );
  }
  if (!config.supabaseServiceKey) {
    throw new Error(
      '[supabaseClient] SUPABASE_SECRET_KEY is not configured. ' +
        'Set it in .env.local or environment variables. ' +
        'See .env.example for details.',
    );
  }
}

const url = config.supabaseUrl || 'http://localhost:54321';
const key = config.supabaseServiceKey || 'test-placeholder';

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

export default supabase;
