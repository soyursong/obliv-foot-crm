/**
 * T-20260602-multi-CALLBACK-EF-4-NEW — 풋 CRM callback outbox LIVE 컷오버
 *
 * supervisor 신호(MSG-20260705-135428-w8jb) 수신 → §dev_foot_db_apply_gate 실행:
 *   dopamine_callback_config.mode : 'shadow' → 'live' (단일 행 id=true UPDATE).
 *
 * 선행(supervisor 완료 확인): DOPAMINE_CALLBACK_SECRET 주입(vucxspurgmrcslvdbiot,
 *   digest d2f0a6a2…) + crm-lifecycle-callback EF redeploy. → live 시 도파민 수신부가
 *   status 전환 수행(shadow 동안엔 audit만).
 *
 * 코드 변경 無 · DDL 無 · 신규 컬럼/테이블/enum 無 → data-architect CONSULT 게이트 비대상.
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 *
 * usage:
 *   node scripts/T-20260602-multi-CALLBACK-EF-4-NEW_foot_cutover_live.mjs            # preflight→apply→verify
 *   node scripts/T-20260602-multi-CALLBACK-EF-4-NEW_foot_cutover_live.mjs --rollback # live→shadow 복원
 */
const rollback = process.argv.includes('--rollback');
const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TARGET = rollback ? 'shadow' : 'live';
const EXPECT_BEFORE = rollback ? 'live' : 'shadow';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { throw new Error('SUPABASE_ACCESS_TOKEN env required'); })();

async function q(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    console.error('❌ query 실패:', resp.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  return body;
}

console.log(`🚀 CALLBACK outbox 컷오버 → mode='${TARGET}' (${rollback ? 'ROLLBACK' : 'LIVE cutover'})`);

// ── 1. PREFLIGHT: 현재 config 실측 (단일 행 + 기대 상태 대조) ────────────────
const before = await q(`SELECT id, mode, updated_at FROM public.dopamine_callback_config ORDER BY id;`);
console.log('\n[BEFORE 실측]');
console.table(before);

if (!Array.isArray(before) || before.length !== 1) {
  console.error(`❌ config 행 수 이상: ${before.length} (기대 1). STOP.`);
  process.exit(1);
}
if (before[0].mode === TARGET) {
  console.log(`ℹ️ 이미 mode='${TARGET}' — 멱등 no-op. 종료.`);
  process.exit(0);
}
if (before[0].mode !== EXPECT_BEFORE) {
  console.error(`❌ before mode='${before[0].mode}' ≠ 기대 '${EXPECT_BEFORE}'. STOP (수동 확인 필요).`);
  process.exit(1);
}

// ── 2. APPLY: 1행 UPDATE (RETURNING 으로 정확히 1행 확인) ────────────────────
const applied = await q(`
  UPDATE public.dopamine_callback_config
     SET mode = '${TARGET}', updated_at = now()
   WHERE id = true AND mode = '${EXPECT_BEFORE}'
  RETURNING id, mode, updated_at;`);
console.log('\n[UPDATE RETURNING]');
console.table(applied);

if (!Array.isArray(applied) || applied.length !== 1 || applied[0].mode !== TARGET) {
  console.error('❌ UPDATE 결과 이상(1행/mode 불일치). STOP.');
  process.exit(1);
}

// ── 3. POSTVERIFY ───────────────────────────────────────────────────────────
const after = await q(`SELECT id, mode, updated_at FROM public.dopamine_callback_config ORDER BY id;`);
console.log('\n[AFTER 실측]');
console.table(after);
console.log(`\n✅ 컷오버 완료 — mode='${after[0].mode}', updated_at=${after[0].updated_at}`);
