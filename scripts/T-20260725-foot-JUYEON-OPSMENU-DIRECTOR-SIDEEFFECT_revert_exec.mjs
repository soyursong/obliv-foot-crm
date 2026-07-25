/**
 * T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT — MUTATION EXEC
 * 승인: 문지은 대표원장 "총괄님 요청대로처리해"(1784941899) + 김주연 총괄 "관리자로 되돌리기"(1784942507)
 * canonical fn 경유 director→admin 원복. baseline='admin' 재기록 금지(fn 상수).
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const pick = k => (env.match(new RegExp(`^${k}=(.+)$`,'m'))||[])[1]?.trim();
const tok = pick('SUPABASE_ACCESS_TOKEN');
const REF='rxlomoozakkjesdqjtvd', ID='ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql})});
  const t=await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const log={ ts:new Date().toISOString(), ticket:'T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT', phase:'MUTATION-EXEC' };
try{
  // [2] 착수前 실측 스냅샷(원본 role 기록)
  const pre = await q(`SELECT id, role, updated_at FROM public.user_profiles WHERE id='${ID}';`);
  log.snapshot_before = { role: pre[0]?.role, updated_at: pre[0]?.updated_at, expected:'director', target_baseline:'admin' };
  if (pre[0]?.role !== 'director') throw new Error(`ABORT: 착수前 role=${pre[0]?.role} (기대 director 아님) — divergence. mutation 미실행.`);

  // [3] canonical revert fn 호출 (director→admin) + rows-affected 검증
  const rv = await q(`SELECT public.foot_juyeon_tempgrant_revert() AS r;`);
  const res = rv[0]?.r;
  log.revert_result = res;
  const rows = res?.rows;
  // Cross-CRM Write Rows-Affected 표준: 0-row + error=null silent 실패 금지
  if (rows !== 1) throw new Error(`ROWS-AFFECTED 검증 실패: expected=1 got=${rows}. res=${JSON.stringify(res)} — silent write-failure 방지 abort.`);
  log.rows_affected_check = 'PASS (rows=1)';

  // [5] 사후: role=admin 재확인 (3메뉴 role-gating 통과 근거)
  const post = await q(`SELECT id, role, updated_at FROM public.user_profiles WHERE id='${ID}';`);
  log.snapshot_after = { role: post[0]?.role, updated_at: post[0]?.updated_at };
  if (post[0]?.role !== 'admin') throw new Error(`POST 검증 실패: role=${post[0]?.role} (기대 admin 아님).`);

  // [4] DOCWRITE-1WK 라이프사이클 정합: tick hold no-op 확인 + cron 잡 종료(revert 가 해지) + baseline 상수 보존
  const tick = await q(`SELECT public.foot_juyeon_tempgrant_tick('2026-08-01 06:00:00+00'::timestamptz) AS t;`);
  log.tick_holdcheck = { result: tick[0]?.t, is_hold_noop: tick[0]?.t?.action==='hold' && tick[0]?.t?.rows===0 };
  const cron = await q(`SELECT jobname FROM cron.job WHERE jobname='foot-juyeon-tempgrant-lifecycle';`);
  log.cron_lifecycle = { remaining_rows: cron.length, terminated: cron.length===0 };
  const baseline = await q(`SELECT proname, (prosrc ~ 'v_orig_role[^;]*:=[^;]*''admin''') AS baseline_admin_const
    FROM pg_proc WHERE proname IN ('foot_juyeon_tempgrant_revert','foot_juyeon_tempgrant_tick') ORDER BY proname;`);
  log.baseline_preserved = baseline;

  // 종합 게이트
  const ok = rows===1 && post[0]?.role==='admin' && log.tick_holdcheck.is_hold_noop
    && log.cron_lifecycle.terminated && baseline.every(b=>b.baseline_admin_const);
  log.FINAL_GATE = ok ? 'PASS — admin 원복 완료, rows=1, hold no-op, lifecycle 종료, baseline=admin 보존' : 'FAIL';
  console.log(JSON.stringify(log,null,2));
  process.exit(ok?0:3);
}catch(err){ log.ERROR=err.message; console.log(JSON.stringify(log,null,2)); console.error('EXEC FAIL:',err.message); process.exit(2); }
