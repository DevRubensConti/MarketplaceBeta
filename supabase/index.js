// supabase/index.js
const { createClient } = require('@supabase/supabase-js');

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE; // NUNCA expor ao browser

if (!url || !key) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE no .env');
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

module.exports = supabase;
