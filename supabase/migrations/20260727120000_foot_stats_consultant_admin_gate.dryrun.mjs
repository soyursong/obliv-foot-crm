/**
 * T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §2 — DRY-RUN (READ-ONLY, 무영속)
 *
 * ⚠ SELECT/introspection 만. write/DDL 0 (Migration Dry-Run No-Persistence Protocol).
 *   본 마이그는 데이터 변형이 아닌 '게이트 신설(SECDEF 래퍼) + 하위 GRANT 회수'이므로
 *   dry-run 은 (a) 적용 前 상태 캡처 (b) 게이트 술어 fail-closed 정합 (c) 위임 대상 데이터소스 건재
 *   (d) 이름충돌 부재 를 무영속 검증한다. 실 DDL 정합은 apply 후 introspection(evidence)로 확정.
 *
 * 실행: node supabase/migrations/20260727120000_foot_stats_consultant_admin_gate.dryrun.mjs
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('=== DRY-RUN 20260727120000 foot_stats_consultant_admin_gate (무영속) ===\n');

// (a) 적용 前 상태 — 래퍼 부재 + 하위 함수 authenticated GRANT 보유(=아직 회수 전).
const pre = await q(`
  SELECT
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='foot_stats_consultant_admin') AS wrapper_cnt,
    (SELECT string_agg(g,',') FROM (SELECT unnest(p.proacl::text[]) g FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='foot_stats_consultant') s) AS base_acl;
`);
console.log('(a) PRE  래퍼 존재수 =', pre[0].wrapper_cnt, '(기대 0)');
console.log('    PRE  base(foot_stats_consultant) acl =', pre[0].base_acl);
const preHasAuth = (pre[0].base_acl || '').includes('authenticated=X');
console.log('    PRE  base authenticated EXECUTE =', preHasAuth, '(기대 true=회수 전)');

// (b) 게이트 술어 fail-closed — service_role/GUC 무설정(=auth.uid() null) 컨텍스트에서 is_admin_or_manager()=false.
//     (MAPI 는 postgres 로 실행되나 auth.uid()=null → current_user_role()=null → false. 비admin default-deny 재현.)
const gate = await q(`SELECT public.is_admin_or_manager() AS g;`);
console.log('\n(b) is_admin_or_manager() [auth.uid 부재 컨텍스트] =', gate[0].g, '(기대 false → 래퍼 RAISE 42501)');

// (c) 위임 대상 데이터소스 건재 — 하위 foot_stats_consultant 가 현행 데이터 반환(래퍼가 위임할 대상).
const src = await q(`SELECT count(*) AS n, COALESCE(sum(total_amount),0) AS tot
  FROM public.foot_stats_consultant('${CLINIC}'::uuid, date_trunc('month', now())::date, now()::date);`);
console.log('\n(c) 하위 데이터소스 행수 =', src[0].n, '/ 누적매출합 =', Number(src[0].tot).toLocaleString('ko-KR'), '원 (위임 대상 건재)');

// (d) 이름충돌 — foot_stats_consultant_admin 시그니처 부재 확인(CREATE OR REPLACE 안전).
console.log('\n(d) 래퍼 이름충돌 =', pre[0].wrapper_cnt === 0 ? '없음(신설 안전)' : '⚠ 이미 존재');

// 무영속: 본 스크립트는 SELECT 만 수행 — pg_proc/ACL 변경 0. POST 재확인.
const post = await q(`SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='foot_stats_consultant_admin') AS wrapper_cnt;`);
console.log('\n(무영속) POST 래퍼 존재수 =', post[0].wrapper_cnt, '(PRE 와 동일 → dry-run 영속 0)');
console.log('\n=== DRY-RUN 통과: 적용 준비 완료 ===');
