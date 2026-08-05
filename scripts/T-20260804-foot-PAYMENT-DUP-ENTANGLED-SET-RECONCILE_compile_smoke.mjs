/**
 * T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE — COMPILE-SMOKE (BEGIN…ROLLBACK, live prod).
 *
 * 목적(supervisor FIX-REQUEST MSG-20260805-131737 강권):
 *   dryrun.mjs(standalone SELECT)는 DO블록 내 plpgsql 이름해석 오류(42601/42703)를
 *   구조적으로 미검출한다. deploy-ready 재마킹 前, 전 DO블록을 라이브 prod 에서 1회 실제 컴파일/실행
 *   (전 oracle 통과 확인)하고 무영속(ROLLBACK)으로 되돌려 검증한다.
 *
 * 무영속 보장(2겹, Migration Dry-Run No-Persistence Protocol 준수):
 *   (1) apply.sql 의 outer `BEGIN;`/`COMMIT;` txn-control 제거(strip) — API auto-commit 회피.
 *   (2) DO블록 마지막(전 oracle 통과 RAISE NOTICE 직후, END 직전)에 sentinel `RAISE EXCEPTION` 주입.
 *       plpgsql DO블록은 원자적 → 미처리 예외 = 블록 전체(DDL 포함) rollback. auto-commit 여도 영속 불가.
 *   (3) 사후 post-probe: freeze 대상 행 status/존재 재조회 → mutation 0 실증.
 *
 * 판독:
 *   • 에러 42703/42601 등 → 컴파일/이름해석 결함 잔존(FAIL).
 *   • 에러 = sentinel(COMPILE-SMOKE-SENTINEL-ROLLBACK) → 전 statement(orphan oracle L226 포함) 실행 성공(PASS).
 *   • 에러 = DRIFT-ABORT/ORACLE-FAIL → freeze drift 또는 oracle 불일치(별도 처리).
 *
 * READ-ONLY 결과(무영속). dev-foot 직접 apply 아님(가역 verify only).
 */
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t };
}

const CUST = '9487b2f7-0769-4038-a373-84182f6acc11';
const PKG  = 'cd91e487-8ee9-4701-b40c-ab1cef60a2cd';
const SENTINEL = 'COMPILE-SMOKE-SENTINEL-ROLLBACK';

// ── apply.sql 로드 → txn-control strip + sentinel 주입 ─────────────────────────
const raw = readFileSync('scripts/T-20260804-foot-PAYMENT-DUP-ENTANGLED-SET-RECONCILE_apply.sql', 'utf8');

// outer BEGIN;/COMMIT; 제거 (DO블록만 남긴다)
let body = raw
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');

// DO블록 최종 END(oracle 전량 통과 직후) 직전에 sentinel 주입.
// 마지막 "END $$;" 를 sentinel + END 로 치환.
const endMarker = 'END $$;';
const idx = body.lastIndexOf(endMarker);
if (idx < 0) { console.error('END $$; marker not found'); process.exit(1); }
const inject = `  RAISE EXCEPTION '${SENTINEL} (전 oracle 통과 후 강제 rollback — 무영속 verify)';\n`;
body = body.slice(0, idx) + inject + body.slice(idx);

console.error('── COMPILE-SMOKE: DO블록 전량 실행(라이브 prod) → sentinel rollback ──');
const res = await q(body);

const combined = res.body || '';
let verdict, detail;
if (combined.includes(SENTINEL)) {
  verdict = 'PASS';
  detail = '전 statement(orphan oracle L226 포함) 컴파일/실행 성공. sentinel 로 무영속 rollback 도달.';
} else if (/42703/.test(combined)) {
  verdict = 'FAIL'; detail = 'PG 42703 잔존 (record 필드/별칭 충돌).';
} else if (/42601/.test(combined)) {
  verdict = 'FAIL'; detail = 'PG 42601 잔존 (구문/placeholder).';
} else if (/DRIFT-ABORT/.test(combined)) {
  verdict = 'DRIFT'; detail = 'freeze snapshot drift — 재-freeze/재-CONSULT 필요.';
} else if (/ORACLE-FAIL/.test(combined)) {
  verdict = 'ORACLE-FAIL'; detail = 'oracle assertion 불일치.';
} else if (res.ok) {
  verdict = 'UNEXPECTED-OK'; detail = 'sentinel 미도달인데 에러도 없음 — 수동 확인 필요.';
} else {
  verdict = 'OTHER-ERROR'; detail = '기타 에러 — body 확인.';
}

console.log('\n=== COMPILE-SMOKE VERDICT:', verdict, '===');
console.log(detail);
console.log('--- raw response (head) ---');
console.log(combined.slice(0, 800));

// ── post-probe: 무영속 실증 (freeze 대상 행 status/존재 재조회) ────────────────
console.error('\n── POST-PROBE: mutation 0 실증 ──');
const probe = await q(`
  SELECT
    (SELECT count(*) FROM public.payments
       WHERE id IN ('46821230-d76e-49ab-b5c3-a9e69a5a5255','e0dc5d36-6530-44ec-b848-10b1b590b2d2',
                    'fa509f09-48bb-4859-a470-589e15df1868','73e604cf-9b78-4f86-b5c9-a09f204cf086')
         AND status='active') AS pay_active_still,
    (SELECT count(*) FROM public.package_payments
       WHERE id IN ('38b5c660-787a-4beb-9da6-a2bc32f12f65','5182ecea-d124-419b-94e9-742e04d9b944')) AS pkgpay_still,
    (SELECT count(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name='_archive_paydup_namjh_20260804') AS archive_tbl_exists,
    (SELECT paid_amount FROM public.packages WHERE id='${PKG}') AS pkg_paid_cache;
`);
console.log('\n--- post-probe (무영속 확인) ---');
console.log(probe.body);
console.log('\n기대: pay_active_still=4, pkgpay_still=2, archive_tbl_exists=0 (DO블록 rollback 으로 미생성), pkg_paid_cache=변동없음');

process.exit(verdict === 'PASS' ? 0 : 1);
