#!/usr/bin/env node
/**
 * Phase B apply — INV-1 divergent 1건 per-row heal (SOP §2-F).
 * supervisor DB-GATE-GO (MSG-20260718-052324-z2r1): gate step3(Phase A postverify PASS)
 *   + step4(freeze_reverify PASS, exit 0) 통과. Phase B apply = GO.
 * 순서 게이트: Phase A 소스닫힘 증거 확보 + freeze_reverify PASS 後에만 apply(본 실행 직전 재확인).
 * 비파괴·가역(rollback 동봉). 명시 PK freeze 1행 · old-value 가드(status='confirmed') ·
 *   EXISTS active 링크 재확인 · v_n=1 RAISE guard(atomic). 자동배치/count-UPDATE 아님. 원장 무접점.
 *
 * NOTE(2026-07-18): 실제 apply 는 Git SSOT 5분 sync 로 working-tree 가 detached HEAD 로
 *   스왑되는 레이스를 피하기 위해 /tmp 의 self-contained 사본(동일 SQL verbatim)으로 실행함.
 *   본 스크립트는 canonical 아티팩트(마이그 파일 경로 의존판). 재현 시 브랜치 checkout 직후 실행.
 */
import { q } from './dryrun_lib.mjs';
import { readFileSync } from 'node:fs';

const SQL_PATH = 'supabase/migrations/20260716091000_selfcheckin_inv1_divergent_perrow_heal.sql';
const FREEZE_ID = '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a';

const main = async () => {
  const [pre] = await q(`SELECT status FROM public.reservations WHERE id='${FREEZE_ID}';`);
  console.log(`[pre] frozen reservation ${FREEZE_ID} status = ${pre?.status}`);
  if (pre?.status !== 'confirmed') {
    console.error(`[abort] pre-state status != 'confirmed' (got ${pre?.status}) — old-value 가드 drift, apply 중단`);
    process.exit(2);
  }

  const sql = readFileSync(SQL_PATH, 'utf8');
  console.log(`[apply] ${SQL_PATH} → prod (atomic BEGIN/COMMIT + v_n=1 guard)`);
  await q(sql); // guard RAISE 시 throw → 전체 txn 롤백(가역)

  const [post] = await q(`SELECT status FROM public.reservations WHERE id='${FREEZE_ID}';`);
  const [{ n }] = await q(
    `SELECT count(*)::int AS n FROM public.reservations WHERE id='${FREEZE_ID}' AND status='checked_in';`);
  console.log(`[post] frozen reservation status = ${post?.status} · checked_in count = ${n}`);
  if (post?.status !== 'checked_in' || n !== 1) {
    console.error('[FAIL] post-state 불일치 — heal 미완결');
    process.exit(1);
  }
  console.log('[apply] OK — Phase B heal committed. affected_rows=1 (confirmed→checked_in), guard v_n=1 통과.');
};
main().catch(e => { console.error('APPLY FAIL:', e.message); process.exit(1); });
