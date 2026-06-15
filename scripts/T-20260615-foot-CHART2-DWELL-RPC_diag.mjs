/**
 * T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP AC-6 — slot_dwell "조회 실패" RC 진단 (READ-ONLY)
 * prod(rxlomoozakkjesdqjtvd)에서 fn_check_in_slot_dwell RPC가 실제로 어떤 에러를 던지는지 확정.
 * 추정금지 — anon key(현장 동일 경로) + service role 둘 다로 RPC 호출해 에러코드/메시지 캡처.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const SERVICE = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const ANON = (env.match(/VITE_SUPABASE_ANON_KEY=(.+)/) || env.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/) || [])[1]?.trim();

const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

async function callRpc(client, label, ids) {
  const { data, error } = await client.rpc('fn_check_in_slot_dwell', { p_check_in_ids: ids });
  console.log(`\n[${label}] ids=${JSON.stringify(ids).slice(0,80)}`);
  if (error) {
    console.log(`  ❌ ERROR code=${error.code} hint=${error.hint || '-'}`);
    console.log(`     message=${error.message}`);
    console.log(`     details=${error.details || '-'}`);
  } else {
    console.log(`  ✅ OK rows=${data?.length ?? 0}`);
    if (data?.length) console.log(`     sample=${JSON.stringify(data[0])}`);
  }
  return { data, error };
}

console.log('=== AC-6: fn_check_in_slot_dwell prod RPC 진단 (READ-ONLY) ===');
console.log('ANON key present:', !!ANON);

// 1) 빈 배열
await callRpc(svc, 'SERVICE / empty[]', []);

// 2) 실제 check_in id 1건 확보 후 호출
const { data: ci, error: ciErr } = await svc
  .from('check_ins')
  .select('id, status, checked_in_at')
  .order('checked_in_at', { ascending: false })
  .limit(3);
if (ciErr) {
  console.log('check_ins fetch error:', ciErr.message);
} else {
  console.log('\nrecent check_ins:', ci.map(c => ({ id: c.id.slice(0,8), status: c.status })));
  const ids = ci.map(c => c.id);
  await callRpc(svc, 'SERVICE / real ids', ids);
  if (ANON) {
    const anonC = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    await callRpc(anonC, 'ANON / real ids (RLS 경로)', ids);
  }
}

// 3) 함수 시그니처 자체 조회 (pg_proc)
const { data: sig, error: sigErr } = await svc.rpc('fn_check_in_slot_dwell', { p_check_in_ids: ['00000000-0000-0000-0000-000000000000'] });
console.log('\n[signature probe / fake uuid]', sigErr ? `ERR code=${sigErr.code} ${sigErr.message}` : `OK rows=${sig?.length ?? 0}`);

console.log('\n=== END ===');
