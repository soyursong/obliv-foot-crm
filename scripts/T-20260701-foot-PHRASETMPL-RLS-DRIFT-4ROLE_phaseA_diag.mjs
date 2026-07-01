import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{
    method:'POST', headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify({query: sql})
  });
  if(!r.ok){ throw new Error(`${r.status} ${await r.text()}`); }
  return r.json();
}
console.log('=== 1) phrase_templates 현재 PROD 정책 (2026-07-01) ===');
console.log(JSON.stringify(await q(`
  SELECT policyname, cmd, roles::text AS roles, qual AS using_expr, with_check AS check_expr
  FROM pg_policies WHERE schemaname='public' AND tablename='phrase_templates'
  ORDER BY policyname;`), null, 2));

console.log('\n=== 2) staff_write_staffarea_phrases 존재? ===');
console.log(JSON.stringify(await q(`
  SELECT count(*)::int AS present FROM pg_policies
  WHERE schemaname='public' AND tablename='phrase_templates'
    AND policyname='staff_write_staffarea_phrases';`), null, 2));

console.log('\n=== 3) schema_migrations 6/20~7/01 apply 여부 ===');
console.log(JSON.stringify(await q(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version >= '20260620000000' AND version <= '20260701999999'
  ORDER BY version;`), null, 2));

// ── Phase A 결론 (2026-07-01 실측) ────────────────────────────────
// [DRIFT 확정] staff_write_staffarea_phrases (mig 20260620120000 / commit 92a95431) = PROD 부재.
//   PROD phrase_templates 정책 = admin_write_phrase_templates{admin,manager,director} + staff_read(true) 2건뿐.
// [RC] 미apply — 해당 정책 apply 스크립트가 repo에 한 번도 커밋/실행된 적 없음.
//   ce6b498b(6/20)는 role 실측 '재검증' 스크립트지 apply 아님. supabase_migrations 원장은
//   20260609234500 에서 멈춤(118행) → 6/09 이후 마이그는 원장 미추적, 개별 apply .mjs 로만 PROD 반영.
//   → apply 스크립트 없는 92a95431 은 push/reconcile 경로 자체가 없어 영구 미반영.
// [혐의 기각①] revert 아님 — rollback 실행/커밋 흔적 0, 정책은 애초에 생성된 적 없음.
// [혐의 기각②] 20260624180000 덮어씀 아님 — 그 마이그(및 실제 랜딩한 CLINICMGMT-3TAB apply, 6/25)는
//   admin_write_phrase_templates(별개 정책명)만 DROP/CREATE. staff_write_staffarea_phrases 미참조 → 덮을 수 없음.
//   PROD admin_write 의 director 는 20260624180000 이 아니라 CLINICMGMT-3TAB apply 로 랜딩(동일 shape).
// [sibling] coordinator_write_staffarea_phrases(20260701030000, deploy-ready) 도 PROD 부재이나
//   이는 drift 아님 = consult_pending GO + supervisor DDL-diff 게이트로 apply 대기(설계상 pending).
// [systemic] 6/09 이후 전 마이그가 원장 미추적 → apply 스크립트 누락 시 조용히 미반영(본 건이 그 casualty).
//   → 인접 마이그 PROD 미반영분 전수 parity audit 별도 권고(precedent: PROD-MIGRATION-PARITY-AUDIT 0615).
