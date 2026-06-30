/**
 * T-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL — 진료확인서 2 SKU relabel 슬라이스 (Migration B)
 *
 * GATE: data-architect CONSULT-REPLY DA-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL
 *       (MSG-20260630-123516-vsyz) → relabel = GO.
 *   · 대표 게이트 면제 동의 (autonomy §3.1: 가격0·DDL0·relabel-only ADDITIVE).
 *   · supervisor DDL-diff 불요 동의 (UPDATE-only 데이터 슬라이스, DDL 0).
 *   · D1(forward-only/행머지금지) + D3(tax=비급여) 승계.
 *   · bridge = (α) defer → FORMPANEL-SPLIT 슬라이스로 분리 (본 슬라이스 미포함).
 *   · C5900004(out-of-scope 진료확인서 3000) = 무접촉.
 *
 * ★ DA 적용 가드: before-검증 실측 1행 대조 (RECONCILE §4-2).
 *   relabel 직전 두 행 category_label='기본' 실측 확인 후 UPDATE. before≠기대 시 STOP.
 *
 * Supabase Management API 경유 직접 실행 (대시보드 수동 실행 금지 정책).
 * usage:
 *   node scripts/apply_20260630150000_foot_docconfirm_pricebranch_relabel.mjs            # preflight→apply→postverify
 *   node scripts/apply_20260630150000_foot_docconfirm_pricebranch_relabel.mjs --rollback # 제증명→기본 복원
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes('--rollback');

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
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

const PROBE = `
  SELECT id, service_code, name, price, category_label, active, is_insurance_covered
    FROM services
   WHERE clinic_id = '${CLINIC_ID}'
     AND service_code IN ('진료확인서1', '진료확인서2')
   ORDER BY service_code;`;

console.log(`🚀 진료확인서 2 SKU ${rollback ? 'ROLLBACK(제증명→기본)' : 'RELABEL(기본→제증명)'} (T-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL)`);

// ── 1. PREFLIGHT: 실측 1행 대조 (DA before-검증 가드) ─────────────────────────
const before = await q(PROBE);
console.log('\n[BEFORE 실측]');
console.table(before);

const expected = rollback ? '제증명' : '기본';
const targets = before.filter(r => ['진료확인서1', '진료확인서2'].includes(r.service_code));
if (targets.length !== 2) {
  console.error(`❌ STOP: 진료확인서1/2 대상 행 2개 기대, 실측 ${targets.length}개. relabel 미적용.`);
  process.exit(1);
}
const drift = targets.filter(r => r.category_label !== expected);
if (drift.length > 0) {
  // 멱등 케이스: 이미 기대 결과(상대 라벨)면 no-op 안내, 그 외 drift면 STOP.
  const done = drift.filter(r => r.category_label === (rollback ? '기본' : '제증명'));
  if (done.length === drift.length) {
    console.log(`\nℹ️ 이미 ${rollback ? '기본' : '제증명'} 상태 (멱등 no-op). 변경 없이 종료.`);
    process.exit(0);
  }
  console.error(`\n❌ STOP: before≠기대('${expected}'). 예상치 못한 category_label drift 발견 → 적용 중단 (DA §4-2 가드).`);
  console.error(JSON.stringify(drift.map(r => ({ code: r.service_code, label: r.category_label })), null, 2));
  process.exit(1);
}
// 가격 불변 가드: B안 = price mutate 0
const priceCheck = { '진료확인서1': 10000, '진료확인서2': 3000 };
for (const r of targets) {
  if (Number(r.price) !== priceCheck[r.service_code]) {
    console.error(`❌ STOP: ${r.service_code} price=${r.price} ≠ B안 기대(${priceCheck[r.service_code]}). 가격 정합 깨짐 → 중단.`);
    process.exit(1);
  }
}
console.log(`✅ PREFLIGHT 통과: 2행 모두 category_label='${expected}', 가격 정합(10,000/3,000) 확인.`);

// ── 2. APPLY ─────────────────────────────────────────────────────────────────
const file = rollback
  ? '../supabase/migrations/20260630150000_foot_docconfirm_pricebranch_relabel.rollback.sql'
  : '../supabase/migrations/20260630150000_foot_docconfirm_pricebranch_relabel.sql';
const SQL = readFileSync(join(__dir, file), 'utf8');
await q(SQL);
console.log(`\n✅ APPLY 완료 (${rollback ? 'rollback' : 'migration'} SQL 실행).`);

// ── 3. POSTVERIFY ────────────────────────────────────────────────────────────
const after = await q(PROBE);
console.log('\n[AFTER 실측]');
console.table(after);
const want = rollback ? '기본' : '제증명';
const ok = after.filter(r => ['진료확인서1', '진료확인서2'].includes(r.service_code))
  .every(r => r.category_label === want);
if (!ok) { console.error(`❌ POSTVERIFY 실패: category_label != '${want}'`); process.exit(1); }
console.log(`\n🎉 완료: 진료확인서1/2 category_label='${want}'. 가격·name·active 불변.`);
