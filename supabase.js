const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ckfaesrraivatujsqpxc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrZmFlc3JyYWl2YXR1anNxcHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ0ODQxMzQsImV4cCI6MjA2MDA2MDEzNH0.w-z4V8zA9DmPGUm_YMw7uZwWoIlMd3W78Wx0Jla5Nxo';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
