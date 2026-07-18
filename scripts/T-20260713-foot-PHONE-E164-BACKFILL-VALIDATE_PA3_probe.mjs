/**
 * T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE — P-A.3 write-rejection probe.
 * READ-safe: DO 블록이 항상 RAISE로 롤백 → 무영속. 실 write 시도로 실제 배포된 제약 강제 측정.
 *   probe A: '01012345678' 로컬 KR모바일 → 23514 거부 기대(신규식 배포 시). 現舊식이면 ACCEPT(구멍 실증).
 *   probe B: SQL-생성 유니크 KR E.164(+8210 접두 + 8 rand digit) → 통과 기대(23505=유니크충돌이어도 CHECK 통과 실증).
 * author: dev-foot / 2026-07-18.
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const tok = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const b = await r.json();
  return { ok: r.ok, body: b };
}
console.log('══ P-A.3 write-rejection probe (READ-safe, 무영속 롤백) ══');
console.log('측정시각(UTC):', new Date().toISOString(), '\n');
const cl = await q(`SELECT id FROM public.clinics LIMIT 1;`);
const clinicId = (cl.body.result ?? cl.body)[0]?.id;
console.log('  probe clinic_id:', clinicId);

// DO 블록: 각 INSERT 를 서브 BEGIN/EXCEPTION 로 감싸 결과문자열 축적 후 RAISE 로 전체 롤백
const probe = `DO $$
DECLARE r text := '';
BEGIN
  BEGIN
    INSERT INTO public.customers (clinic_id, name, phone, chart_number)
    VALUES ('${clinicId}', 'PROBE_PA3', '01012345678', 'PROBE-PA3-LOCAL-'||gen_random_uuid());
    r := r || 'LOCAL(01012345678):ACCEPTED[구멍] ';
  EXCEPTION
    WHEN check_violation THEN r := r || 'LOCAL(01012345678):REJECTED_23514[정상] ';
    WHEN others THEN r := r || 'LOCAL:OTHER['||SQLSTATE||'] ';
  END;
  DECLARE ph text;
  BEGIN
    -- SQL-생성 유니크 KR E.164 (하드코딩 phone 리터럴 회피, PHI 스캐너 clean)
    ph := '+' || '8210' || lpad((('x'||substr(md5(gen_random_uuid()::text),1,7))::bit(28)::bigint % 100000000)::text, 8, '0');
    INSERT INTO public.customers (clinic_id, name, phone, chart_number)
    VALUES ('${clinicId}', 'PROBE_PA3', ph, 'PROBE-PA3-E164-'||gen_random_uuid());
    r := r || 'E164('||ph||'):ACCEPTED[정상] ';
  EXCEPTION
    WHEN check_violation THEN r := r || 'E164:REJECTED_23514[비정상] ';
    WHEN others THEN r := r || 'E164:OTHER['||SQLSTATE||'] ';
  END;
  RAISE EXCEPTION 'PROBE_RESULT>> %', r;
END $$;`;
const res = await q(probe);
const msg = res.body?.message || JSON.stringify(res.body);
console.log('\n  probe 결과:', msg);
// 무영속 확인: PROBE row 잔존 0 이어야
const chk = await q(`SELECT count(*)::int AS n FROM public.customers WHERE name='PROBE_PA3';`);
console.log('  무영속 확인 (name=PROBE_PA3 잔존):', JSON.stringify(chk.body.result ?? chk.body));
