/**
 * T-20260602-foot-REFUND-SESSION-CLEANUP  AC-3 / AC-4
 *
 * 기존 환불 패키지(packages.status='refunded')의 잔존 'used' 세션을 'refunded'로 일괄 전이.
 * AC-1 함수 fix(20260603000000)는 go-forward만 해결 → 과거 환불 건의 유령 세션은 본 backfill로 정비.
 *
 * ⚠ 운영 DB 대량 데이터 변경 — dev-foot 단독 실행 금지.
 *   기본은 DRY-RUN(카운트만 보고). data-steward 검증 + supervisor 승인 후에만 --apply.
 *
 * 사용:
 *   # 1) 드라이런 (기본) — 영향 세션/패키지 카운트만 출력, 변경 0
 *   SUPABASE_ACCESS_TOKEN=... node scripts/backfill_refund_ghost_sessions_20260603.mjs
 *   # 2) 실제 적용 (supervisor 승인 후)
 *   SUPABASE_ACCESS_TOKEN=... node scripts/backfill_refund_ghost_sessions_20260603.mjs --apply
 *   # 3) 롤백 (전이된 세션을 used로 환원 — 본 backfill이 만든 변경만 식별 불가하므로 주의)
 *   SUPABASE_ACCESS_TOKEN=... node scripts/backfill_refund_ghost_sessions_20260603.mjs --rollback
 *
 * author: dev-foot / 2026-06-03
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

// 영향 대상: status='refunded' 패키지에 매달린 'used' 세션
const DRYRUN_SQL = `
  SELECT
    COUNT(*)                              AS ghost_session_cnt,
    COUNT(DISTINCT ps.package_id)         AS affected_package_cnt
  FROM package_sessions ps
  JOIN packages p ON p.id = ps.package_id
  WHERE p.status = 'refunded'
    AND ps.status = 'used';
`;

// AC-4 검증: 적용 후 0 이어야 함
const VERIFY_SQL = DRYRUN_SQL;

const APPLY_SQL = `
  UPDATE package_sessions ps
     SET status = 'refunded'
    FROM packages p
   WHERE p.id = ps.package_id
     AND p.status = 'refunded'
     AND ps.status = 'used';
`;

// ⚠ 롤백은 '환불 패키지의 refunded 세션'을 used로 되돌린다. backfill 이전부터 refunded였던 세션과
//    구분 불가하므로, 함수 fix(20260603000000) 배포 이후 신규 환불 건까지 used로 되돌릴 위험이 있다.
//    원칙적으로 backfill 롤백은 권장하지 않으며, 필요 시 data-steward가 스냅샷 기반으로 수행.
const ROLLBACK_SQL = `
  UPDATE package_sessions ps
     SET status = 'used'
    FROM packages p
   WHERE p.id = ps.package_id
     AND p.status = 'refunded'
     AND ps.status = 'refunded';
`;

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

async function run() {
  if (ROLLBACK) {
    console.warn('⚠️ ROLLBACK 모드 — 환불 패키지의 refunded 세션을 used로 환원합니다.');
    console.warn('   data-steward 승인 없이 실행 금지. 신규 환불 건 오염 위험 있음.');
    await runQuery(ROLLBACK_SQL, 'rollback');
    console.log('✅ rollback 실행 완료');
    return;
  }

  // 항상 먼저 드라이런 카운트 출력
  const before = await runQuery(DRYRUN_SQL, 'dryrun');
  console.log('📊 [DRY-RUN] 정비 대상 유령 세션 현황:');
  console.log('   ', JSON.stringify(before));

  if (!APPLY) {
    console.log('ℹ️ DRY-RUN 종료 (변경 없음). 실제 적용하려면 supervisor 승인 후 --apply 플래그 사용.');
    return;
  }

  console.log('🚀 --apply 모드 — 일괄 전이(used→refunded) 실행 중...');
  await runQuery(APPLY_SQL, 'apply');

  // AC-4 검증: 잔존 0 확인
  const after = await runQuery(VERIFY_SQL, 'verify');
  console.log('✅ 정비 완료. 잔존 유령 세션:', JSON.stringify(after));
  const remaining = Number(after?.[0]?.ghost_session_cnt ?? -1);
  if (remaining === 0) {
    console.log('✅ AC-4 충족: 환불 패키지의 used 세션 0건.');
  } else {
    console.warn(`⚠️ AC-4 미충족: 잔존 ${remaining}건 — 재확인 필요.`);
    process.exit(2);
  }
}

run().catch((err) => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
