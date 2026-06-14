import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
console.log('오늘(KST):', today);
const { data: ci, error } = await sb.from('check_ins').select('id, status, laser_room, checked_in_at').eq('laser_room', '가열성레이저').order('checked_in_at', { ascending: false });
if (error) console.log('ERR check_ins:', error.message);
else for (const c of ci) { const day = new Date(new Date(c.checked_in_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10); console.log(`  ${c.id.slice(0, 8)} status=${c.status} day=${day}${day === today ? ' ⚠오늘' : ''}`); }
const { data: st } = await sb.from('check_ins').select('status').limit(3000);
console.log('status 관측값:', [...new Set((st || []).map(s => s.status))].sort());
process.exit(0);
