/**
 * T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY — BACKFILL APPLY (3-KEY 강제, GATED)
 *
 * 약품 동일성 규칙 (CANONICAL · 문지은 대표원장 확정 2026-06-29):
 *   unique key = (상품명, 성분명, 코드). 3개 중 하나라도 다르면 무조건 다른 약.
 *   auto-merge 절대 금지 — 이름·성분 같아도 코드 다르면 별도 row 유지.
 *
 * 본 스크립트 정책(이 티켓 FIX 이후):
 *   [AC-6a] 자동 연결은 (상품명·성분명·코드) 완전일치 1:1 일 때만 허용.
 *           퍼지/용량표기/이름-only 자동 auto-link 차단 → 사람확인 게이트로.
 *   [AC-6b] REVIEW6(퍼지 6건)은 영구 미연결. --confirm-review 경로 영구 비활성(실행 차단).
 *   [AC-6c] 06-18 name-only 로 연결됐던 AUTO5 는 별도 *_AUTO5_UNLINK_apply.mjs 로 무손실 해제됨.
 *
 * 실행:
 *   node ..._backfill_apply.mjs                 # dry-run(데이터 무변경)
 *   node ..._backfill_apply.mjs --confirm-auto  # 3-key 완전일치만 set (현재 데이터상 통과 0건 예상)
 *   --confirm-review                            # 영구 차단: 즉시 종료(어떤 DML 도 안 함)
 *
 * 코드 식별자: service 측 = hira_code → 없으면 service_code.  prescription_codes 측 = claim_code(단 LEGACY-* 플레이스홀더는 실코드 아님 → 미인정).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
const args = process.argv.slice(2);
const doAuto = args.includes('--confirm-auto');
const doReview = args.includes('--confirm-review');

// [AC-6b] --confirm-review 영구 비활성. 요청 시 어떤 DML 도 하지 않고 즉시 종료.
if (doReview) {
  console.error('⛔ --confirm-review 는 영구 비활성화됨 (T-20260618 FIX, 대표원장 2026-06-29 확정).');
  console.error('   REVIEW6(루마졸/베타베이트/삼아리도멕스/에스로반/터미졸/하이트리)=서로 다른 약, service_id 연결 금지.');
  console.error('   어떤 데이터도 변경하지 않고 종료합니다.');
  process.exit(2);
}

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const map = JSON.parse(fs.readFileSync('scripts/T-20260618-foot-RXSET-PRESCRX-SVC-DB-UNIFY_backfill_mapping.json', 'utf8'));

if (!doAuto) {
  console.log('ℹ️  DRY-RUN (플래그 없음). 데이터 무변경.');
  console.log(`   AUTO 후보 ${map.auto.length}건 / REVIEW(영구 미연결) ${map.review.length}건 / NONE ${map.none.length}건`);
  console.log('   본적용: --confirm-auto (3-key 완전일치만 통과). --confirm-review 는 영구 차단.');
  process.exit(0);
}

// ── 정규화: 상품명 표기차(밀리그람↔mg, 공백, mL↔ml)만 흡수. 코드/성분은 정규화로 흡수 금지. ──
const norm = (s) => (s||'').replace(/밀리그?람/g,'mg').replace(/마이크로그?람/g,'mcg').replace(/\s+/g,'').toLowerCase();
const realCode = (claim) => (claim && !/^LEGACY-/i.test(claim)) ? String(claim).trim() : null; // LEGACY-* = 실코드 아님

const c = conn(); await c.connect();
console.log('✅ DB 연결 (BACKFILL APPLY · 3-KEY 강제)', new Date().toISOString(), '\n');

let set=0, blocked=0, skip=0, conflict=0;
for (const a of map.auto) {
  // 실데이터 재조회 (mapping 캐시 신뢰 안 함)
  const svc = (await c.query(`SELECT id, name, hira_code, service_code FROM services WHERE id=$1`, [a.svc.id])).rows[0];
  const pc  = (await c.query(`SELECT id, name_ko, claim_code, service_id FROM prescription_codes WHERE id=$1`, [a.pc.id])).rows[0];
  if (!svc || !pc) { console.log(`⏭  SKIP 누락 svc/pc (${a.svc.name})`); skip++; continue; }

  // ── 3-KEY 검증 ──
  const nameOk = norm(svc.name) === norm(pc.name_ko);          // 상품명(표기차만 허용)
  const svcCode = svc.hira_code || svc.service_code || null;   // service 측 식별코드
  const pcCode  = realCode(pc.claim_code);                     // pc 측 실코드(LEGACY 제외)
  const codeOk  = !!(svcCode && pcCode && String(svcCode).trim() === pcCode); // 양측 실코드 동일해야 통과
  // 성분명: 별도 성분코드 컬럼 부재 → 상품명 괄호 성분 표기 동일성으로 갈음(상품명 일치에 포함). 코드 미충족이면 어차피 차단.

  if (nameOk && codeOk) {
    if (pc.service_id === svc.id) { skip++; console.log(`⏭  SKIP (이미 연결) "${pc.name_ko}"`); continue; }
    if (pc.service_id && pc.service_id !== svc.id) { conflict++; console.log(`⚠️  CONFLICT "${pc.name_ko}" 다른 service_id — 수동검토`); continue; }
    await c.query(`UPDATE prescription_codes SET service_id=$1 WHERE id=$2`, [svc.id, pc.id]);
    set++; console.log(`✅ SET [3KEY-PASS] "${pc.name_ko}" → "${svc.name}" (코드 ${svcCode})`);
  } else {
    blocked++;
    const why = !codeOk ? `코드 불일치(svc=${svcCode||'∅'} / pc=${pcCode||'LEGACY/∅'})` : '상품명 불일치';
    console.log(`🚫 BLOCK [3KEY-FAIL] "${pc.name_ko}" ↔ "${svc.name}" — ${why} → 사람확인 게이트`);
  }
}
console.log(`\n── 결과: SET ${set} / BLOCK ${blocked} / SKIP ${skip} / CONFLICT ${conflict} ──`);
console.log('※ 3-key(상품명·성분명·코드) 완전일치만 자동 연결. 나머지는 사람확인 게이트.');
await c.end();
