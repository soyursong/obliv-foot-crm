/**
 * 풋센터 CRM — 더미 환자 '박수진' 진료차트 시드
 * T-20260608-foot-MEDCHART-TIMELINE-FILTER AC-7
 *
 * 목적: 원장님(문지은)이 진료차트 좌측 '진료 경과 타임라인'의 필터/가독성을
 *      실제 데이터로 직접 확인할 수 있도록, 진료메모/치료메모/처방이 풍부한
 *      더미 환자 1명을 생성한다. (현장 지정 환자명 = 박수진)
 *
 * 대상: 박수진 (신규 생성, is_simulation=true → 통계/실데이터 분리)
 * AC-7 요건:
 *   - 진료메모(chart_doctor_memos) 3건+   → 5건
 *   - 치료메모(medical_charts.treatment_record) 3건+ → 5건
 *   - 처방(medical_charts.prescription_items) 2건+   → 3건(회차 2·4·6)
 *   - + 임상경과(clinical_progress) 다수 → '어떻게 치료받았는지' 한눈 검증용
 *
 * 좌측 타임라인 데이터소스 = medical_charts (displayCharts) + chart_doctor_memos(merge).
 *   ※ 상담(consult)·방문진료내역(check_ins)은 좌측 비대상 → 좌측=진료 전용(AC-5) 검증.
 *
 * 멱등성: 동일 이름 is_simulation 환자가 이미 있으면 중단(중복 시드 방지).
 * 프로덕션 실데이터 오염 금지: is_simulation=true + customer_memo '[TEST-SEED]' 마킹.
 * 롤백: node scripts/rollback_chart_park_sujin_20260608.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브 (문지은 원장 소속 클리닉)
const CUSTOMER_NAME = '박수진';
const PHONE = '+821055557788';
const DOCTOR_NAME = '문지은';          // created_by_name 스냅샷(타임라인 기록자 표시)
const TODAY = '2026-06-08';

function pastDate(daysAgo) {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function pastTs(daysAgo, hour = 11, min = 0) {
  return `${pastDate(daysAgo)}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
}

async function run() {
  console.log('=== 박수진 진료차트 시드 (T-20260608-foot-MEDCHART-TIMELINE-FILTER AC-7) ===\n');

  // ── 0. 멱등성 가드 ──────────────────────────────────────────
  const { data: dup } = await sb
    .from('customers')
    .select('id')
    .eq('clinic_id', CLINIC_ID)
    .eq('name', CUSTOMER_NAME)
    .eq('is_simulation', true);
  if (dup && dup.length > 0) {
    console.log(`⚠️ 이미 시뮬레이션 환자 '${CUSTOMER_NAME}'(${dup[0].id}) 존재 → 중복 시드 방지로 중단.`);
    console.log('   재생성하려면 먼저: node scripts/rollback_chart_park_sujin_20260608.mjs');
    process.exit(0);
  }

  // ── 1. 고객 생성 ──────────────────────────────────────────
  console.log('1. 고객 생성...');
  const { data: cust, error: cErr } = await sb
    .from('customers')
    .insert({
      clinic_id:      CLINIC_ID,
      name:           CUSTOMER_NAME,
      phone:          PHONE,
      visit_type:     'returning',
      is_simulation:  true,
      gender:         'F',
      birth_date:     '1991-07-14',
      chart_number:   'TS-0608',
      inflow_channel: '네이버검색',
      customer_memo:  '[TEST-SEED] T-20260608-foot-MEDCHART-TIMELINE-FILTER AC-7 좌측 타임라인 가독성 검증용 더미 환자.',
      treatment_note: '양발 무지외반증 + 발톱 무좀(좌무지). 비가열 레이저 중심 12회 패키지 진행 중.',
    })
    .select('id')
    .single();
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`);
  const CUSTOMER_ID = cust.id;
  console.log(`  → customer_id: ${CUSTOMER_ID}`);

  // ── 2. medical_charts 6회차 (치료메모 5 / 임상경과 6 / 처방 3) ──
  console.log('2. medical_charts 6건 삽입...');
  const charts = [
    // 1회차(초진) — 진단·임상경과·치료메모, 처방 X
    {
      visit_date: pastDate(54),
      chief_complaint: '양쪽 엄지발가락 변형, 보행 시 통증',
      diagnosis: '양측 무지외반증(M20.1), 좌측 조갑백선 의심',
      clinical_progress: '초진. 양측 무지외반증 grade II. 좌무지 발톱 변색·비후 → 조갑백선 의심, KOH 검사 시행. 보행 시 VAS 5. 12회 비가열 레이저 패키지 계획 설명.',
      treatment_record: '초진 검진 및 사진 촬영. 풋프린트 측정. 좌무지 발톱 KOH 채취.',
      prescription_items: null,
    },
    // 2회차 — 프컨+비가열, 처방 O(외용 항진균제)
    {
      visit_date: pastDate(47),
      chief_complaint: '발톱 무좀 관리 시작',
      diagnosis: '조갑백선(B35.1), 무지외반증(M20.1)',
      clinical_progress: '2회차. KOH 양성 확인 → 조갑백선 확진. 프리컨디셔닝 15분 후 비가열 레이저 20분. 통증 VAS 5→4.',
      treatment_record: '프리컨디셔닝 15분, 비가열 레이저 20분(좌우 무지 집중). 시술 후 쿨링.',
      prescription_items: [
        { name: '터비나핀 외용액', dosage: '1일 1회 환부', route: '외용', frequency: '1일 1회', days: 30, notes: '좌무지 발톱 도포', count: 1 },
        { name: '우레아 크림 20%', dosage: '취침 전 도포', route: '외용', frequency: '1일 1회', days: 30, notes: '발뒤꿈치 각질', count: 1 },
      ],
    },
    // 3회차 — 비가열, 치료메모만
    {
      visit_date: pastDate(40),
      chief_complaint: '경과 양호',
      diagnosis: '조갑백선(B35.1), 무지외반증(M20.1)',
      clinical_progress: '3회차. 비가열 레이저 20분. 발톱 변색 경계 또렷해짐(호전 경향). 통증 VAS 4→3.',
      treatment_record: '비가열 레이저 20분. 환부 사진 비교 — 신생 발톱 정상 색조 관찰.',
      prescription_items: null,
    },
    // 4회차 — 가열, 처방 O(경구)
    {
      visit_date: pastDate(28),
      chief_complaint: '무지외반 부위 뻣뻣함',
      diagnosis: '무지외반증(M20.1)',
      clinical_progress: '4회차. 가열 레이저 15분으로 연부조직 이완 유도. 무지외반 각도 변화는 경미하나 보행 편의 개선. 경구 항진균 병용 시작.',
      treatment_record: '가열 레이저 15분. 무지 관절 가동범위 스트레칭 교육.',
      prescription_items: [
        { name: '이트라코나졸 캡슐 100mg', dosage: '1일 2회 식후', route: '경구', frequency: '1일 2회', days: 7, notes: '펄스요법 1주', count: 2 },
      ],
    },
    // 5회차 — 비가열+포도듈, 치료메모만
    {
      visit_date: pastDate(18),
      chief_complaint: '발톱 호전 지속',
      diagnosis: '조갑백선(B35.1)',
      clinical_progress: '5회차. 포도듈 부착 후 비가열 레이저 20분. 발톱 근위부 정상 성장 50% 도달. 통증 VAS 3→2.',
      treatment_record: '포도듈 부착, 비가열 레이저 20분. 다음 방문 시 경과사진 재촬영 예정.',
      prescription_items: null,
    },
    // 6회차(최근) — 비가열, 처방 O(외용 보습)
    {
      visit_date: pastDate(5),
      chief_complaint: '전반적 만족, 유지 관리 문의',
      diagnosis: '조갑백선(B35.1) 호전, 무지외반증(M20.1)',
      clinical_progress: '6회차. 비가열 레이저 25분. 좌무지 발톱 70% 정상화. 보행 통증 VAS 2 유지. 잔여 6회 + 홈케어 안내.',
      treatment_record: '비가열 레이저 25분. 홈케어(보습·발톱 관리) 교육. 경과사진 촬영 완료.',
      prescription_items: [
        { name: '히알루론산 풋크림', dosage: '1일 2회 도포', route: '외용', frequency: '1일 2회', days: 30, notes: '유지 보습', count: 2 },
      ],
    },
  ].map(c => ({
    clinic_id:        CLINIC_ID,
    customer_id:      CUSTOMER_ID,
    materials_used:   null,
    treatment_result: null,
    created_by:       null,
    created_by_name:  DOCTOR_NAME,
    created_at:       `${c.visit_date}T11:30:00+09:00`,
    updated_at:       `${c.visit_date}T11:30:00+09:00`,
    ...c,
  }));

  const { data: mcData, error: mcErr } = await sb
    .from('medical_charts')
    .insert(charts)
    .select('id, visit_date')
    .order('visit_date', { ascending: true });
  if (mcErr) throw new Error(`medical_charts 삽입 실패: ${mcErr.message}`);
  console.log(`  → medical_charts ${mcData.length}건 삽입`);

  // 회차→chart_id 매핑(visit_date 오름차순 = 1회차..6회차)
  const byDate = Object.fromEntries(mcData.map(m => [m.visit_date, m.id]));

  // ── 3. chart_doctor_memos 5건 (진료메모, 원장 전용) ─────────
  console.log('3. chart_doctor_memos(진료메모) 5건 삽입...');
  const docMemos = [
    { visit_date: pastDate(54), memo: '[원장] 초진 — 무지외반 보존치료 우선, 수술 적응증 아님. 조갑백선 KOH 결과 확인 후 항진균 결정. 환자 통증 호소 큼, 라포 형성 주의.' },
    { visit_date: pastDate(47), memo: '[원장] KOH 양성. 외용 항진균(터비나핀) 시작, 간기능 이슈 없어 추후 경구 병용 고려. 비가열 위주로 무지외반 부위 부담 최소화.' },
    { visit_date: pastDate(28), memo: '[원장] 외용 단독 반응 더뎌 이트라코나졸 펄스요법(1주) 추가. 경구 시작 — 위장장애/약물상호작용 문진 완료. 다음 방문 시 간수치 확인 권고.' },
    { visit_date: pastDate(18), memo: '[원장] 신생 발톱 성장 양호. 펄스요법 1주기 완료, 2주기는 경과 보고 결정. 무지외반 통증 VAS 2로 환자 만족.' },
    { visit_date: pastDate(5), memo: '[원장] 발톱 70% 정상화 — 항진균 종료 가능 수준. 잔여 레이저는 무지외반 연부조직 관리 위주로 전환. 유지 패키지 권유.' },
  ];
  const docMemoRows = docMemos.map(d => ({
    medical_chart_id: byDate[d.visit_date],
    customer_id:      CUSTOMER_ID,
    clinic_id:        CLINIC_ID,
    memo:             d.memo,
    created_by:       null,
    created_at:       `${d.visit_date}T11:35:00+09:00`,
    updated_at:       `${d.visit_date}T11:35:00+09:00`,
  }));
  const { error: dmErr } = await sb.from('chart_doctor_memos').insert(docMemoRows);
  if (dmErr) throw new Error(`chart_doctor_memos 삽입 실패: ${dmErr.message}`);
  console.log(`  → 진료메모 ${docMemoRows.length}건 삽입`);

  // ── 완료 요약 ────────────────────────────────────────────
  console.log('\n=== 시드 완료 ===');
  console.log(`환자명:        ${CUSTOMER_NAME} (is_simulation=true)`);
  console.log(`customer_id:   ${CUSTOMER_ID}`);
  console.log(`medical_charts: 6건 (치료메모 6 / 임상경과 6 / 처방 3[회차2·4·6])`);
  console.log(`chart_doctor_memos(진료메모): 5건`);
  console.log('\nAC-7 체크:');
  console.log('  진료메모 3건+: ✓ (5건)');
  console.log('  치료메모 3건+: ✓ (6건)');
  console.log('  처방 2건+:     ✓ (3건)');
  console.log('\n🔖 롤백: node scripts/rollback_chart_park_sujin_20260608.mjs');
  console.log('→ responder 회신: "박수진 환자 준비 완료" (원장님 좌측 타임라인 직접 확인)');
}

run().catch(e => {
  console.error('시드 실패:', e.message);
  process.exit(1);
});
