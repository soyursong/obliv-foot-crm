/**
 * seed_dummy_reservations.mjs — 더미 예약 생성 정식(canonical) CLI
 * T-20260608-foot-DUMMY-CUSTOMER-COCREATE
 *
 * 모든 향후 더미 예약 생성은 ad-hoc INSERT 대신 이 스크립트(=dummy_factory)를 경유한다.
 * factory 가 customers 동시 생성 + customer_id 즉시 연결 + NULL 0 을 구조적으로 보장한다.
 *
 * 사용:
 *   DRY_RUN=1 node scripts/seed_dummy_reservations.mjs   # 무변경 미리보기
 *   node scripts/seed_dummy_reservations.mjs             # 실제 적용 + 사후검증
 *
 * 날짜/슬롯/명단은 아래 CONFIG 에서 조정. 기본은 '내일' 11:00~19:00 슬롯당 1초진+1재진.
 */
import { createClient } from '@supabase/supabase-js';
import { createDummyReservations } from './lib/dummy_factory.mjs';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DRY = process.env.DRY_RUN === '1';

// ── CONFIG ────────────────────────────────────────────────────────────────
const CLINIC_SLUG = process.env.CLINIC_SLUG || 'jongno-foot';
function tomorrowKST() {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  now.setUTCDate(now.getUTCDate() + 1);
  return now.toISOString().slice(0, 10);
}
const TARGET_DATE = process.env.TARGET_DATE || tomorrowKST();
const MEMO = process.env.MEMO || '테스트 더미';
const SLOTS = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

// phone 은 (clinic_id, phone) UNIQUE — 재실행해도 동일인 재사용(idempotent).
function buildItems() {
  const items = [];
  SLOTS.forEach((time, i) => {
    items.push({
      name: `더미초진${String(i + 1).padStart(2, '0')}`,
      phone: `+8210000040${String(i + 1).padStart(2, '0')}`,
      visitType: 'new',
      date: TARGET_DATE,
      time,
    });
    items.push({
      name: `더미재진${String(i + 1).padStart(2, '0')}`,
      phone: `+8210000041${String(i + 1).padStart(2, '0')}`,
      visitType: 'returning',
      date: TARGET_DATE,
      time,
    });
  });
  return items;
}

async function main() {
  console.log(DRY ? '== DRY-RUN ==' : '== APPLY ==');
  console.log(`날짜: ${TARGET_DATE} / clinic: ${CLINIC_SLUG} / memo: "${MEMO}"`);

  const { data: clinic, error: ce } = await sb
    .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
  if (ce || !clinic) throw new Error(`클리닉 조회 실패(${CLINIC_SLUG}): ${ce?.message}`);

  const items = buildItems();
  const summary = await createDummyReservations(sb, clinic.id, items, { memo: MEMO, dryRun: DRY });

  console.log('\n── 요약 ──────────────────────────────────────────────');
  console.log(`  customers: ${summary.customers} (재사용 ${summary.reused} + 신규 ${summary.created})`);
  console.log(`  reservations: ${summary.reservations}`);
  console.log(`  customer_id NULL: ${summary.nullLinks}`);

  if (DRY) {
    console.log('\nDRY-RUN 완료. 실제 적용: DRY_RUN 미지정 후 재실행.');
    return;
  }

  // 독립 사후검증 (factory 외부에서 한 번 더) — 오늘 적재분 NULL 0 확인
  const { data: post } = await sb
    .from('reservations')
    .select('id, customer_id')
    .eq('clinic_id', clinic.id)
    .eq('reservation_date', TARGET_DATE)
    .eq('memo', MEMO);
  const stillNull = (post ?? []).filter((r) => !r.customer_id).length;
  console.log(`\n[검증] ${TARGET_DATE} memo="${MEMO}" 예약 ${post?.length ?? 0}건 중 customer_id NULL ${stillNull}건`);
  if (stillNull > 0) {
    console.error('❌ NULL 잔존 — 무결성 위반');
    process.exit(1);
  }
  console.log('✅ 무결성 OK — 모든 더미 예약 customer_id 연결 완료');
}

main().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
