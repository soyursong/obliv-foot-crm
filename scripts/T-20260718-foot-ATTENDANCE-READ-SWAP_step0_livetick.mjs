/**
 * T-20260718-foot-ATTENDANCE-READ-SWAP — step0 live-tick 3자 정합 실측 (evidence#1 방법론 재현)
 * pg-worker 경로(cron 과 동일): SELECT public.trigger_attendance_sync() → net.http_post → EF 라이브 시트 reconcile.
 * idempotent(정상 cron 틱과 동일). 목적: 배포前 same-instant 시트↔DB present 정합 재확인.
 */
import { query, PROJ_REF } from './lib/foot_migration_ledger.mjs';
const FOOT_CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`── STEP0 LIVE-TICK — ${nowKst()} — proj=${PROJ_REF} ──\n`);

// baseline id (틱 前 최신 EF 응답)
const base = await query(`SELECT coalesce(max(id),0) AS id FROM net._http_response WHERE content::text LIKE '%staff_active%';`);
const baseId = Number((base?.[0] ?? base?.result?.[0])?.id ?? 0);
console.log('baseline http id =', baseId);

// present count 틱 前
const pre = await query(`SELECT count(*) AS n FROM public.staff_attendance WHERE clinic_id='${FOOT_CLINIC_ID}' AND date=(now() AT TIME ZONE 'Asia/Seoul')::date AND status='present';`);
console.log('present(today) pre-tick =', JSON.stringify(pre));

// 라이브 틱 발화 (cron 동일 경로)
const fire = await query(`SELECT public.trigger_attendance_sync() AS r;`);
console.log('trigger_attendance_sync =', JSON.stringify(fire));

// EF 응답 도착 폴링 (async net.http_post)
let resp = null;
for (let i = 0; i < 15; i++) {
  await sleep(2000);
  const q = await query(`
    SELECT id, status_code,
           (content::jsonb ->> 'ok') AS ok,
           (content::jsonb ->> 'inserted') AS inserted,
           (content::jsonb ->> 'updated')  AS updated,
           (content::jsonb ->> 'deleted')  AS deleted,
           (content::jsonb ->> 'unmatched') AS unmatched,
           (content::jsonb ->> 'errors')    AS errors,
           (content::jsonb ->> 'staff_active') AS staff_active,
           created
    FROM net._http_response
    WHERE id > ${baseId} AND content::text LIKE '%staff_active%'
    ORDER BY id DESC LIMIT 1;`);
  const row = (q?.[0] ?? q?.result?.[0]);
  if (row) { resp = row; break; }
  console.log(`  … waiting EF response (attempt ${i + 1})`);
}
console.log('\nLIVE-TICK EF RESPONSE =', JSON.stringify(resp, null, 2));

// present count 틱 後
const post = await query(`SELECT count(*) AS n FROM public.staff_attendance WHERE clinic_id='${FOOT_CLINIC_ID}' AND date=(now() AT TIME ZONE 'Asia/Seoul')::date AND status='present';`);
console.log('present(today) post-tick =', JSON.stringify(post));

// 판정
const preN = Number((pre?.[0] ?? pre?.result?.[0])?.n);
const postN = Number((post?.[0] ?? post?.result?.[0])?.n);
const unmatched = resp ? JSON.parse(resp.unmatched || '[]') : ['NO_RESP'];
const errors = resp ? JSON.parse(resp.errors || '[]') : ['NO_RESP'];
const clean = resp && resp.status_code === 200 && resp.ok === 'true'
  && unmatched.length === 0 && errors.length === 0 && preN === postN;
console.log('\n── LIVE-TICK VERDICT ──');
console.log('status_code=', resp?.status_code, 'ok=', resp?.ok, 'unmatched=', unmatched.length, 'errors=', errors.length);
console.log('present pre==post:', preN, '==', postN, '→', preN === postN);
console.log('3자 정합(시트 reconcile unmatched=0/errors=0 → 시트present==DB present) + freshness =', clean ? 'CLEAN ✅' : 'STALE/BROKEN ❌');
