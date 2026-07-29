/**
 * E2E spec — T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT (refix-2)
 * 진료 알림판(DoctorCallDashboard 상시뷰) 소견서·진단서 '처리대기'/'서류 완료' 테이블 —
 *   3개 컬럼(생년/오늘시술/처방내역)이 전 환자 '—' 로 비어 있던 회귀를 실 데이터에 연동.
 *   (현장 종로풋센터 2026-07-29 김주연 총괄 U0ATDB587PV 지적 · confirm MSG-b6gp thread 1785293193.209349)
 *
 * ★field-soak 🔴 REOPEN → refix-2 (MSG-20260729-151321-n5yh, diagnosis-first)
 *   1차 배포(995efb0d) 라이브에서 AC-1·AC-2 여전히 '—'. service_role 로 prod 진단한 결과 근본원인 2축 확정:
 *   (소스축) · customers.birth_date = 전 환자 거의 NULL(풋센터는 생년을 rrn_enc 암호화 보관) → birth_date 직접조회 무효
 *            · check_ins.treatment_kind/treatment_category/treatment_contents = prod 전 행 NULL(죽은 컬럼) → 오늘시술 무효
 *   (스코프축) '글로벌 오늘(KST) check_ins' 조회는 '서류 완료'(과거일 발행) 행의 과거 방문을 못 잡아 전면 공란.
 *
 * FIX (refix-2, ADDITIVE, read-only, db_change=false, no-DDL):
 *   AC-1 생년 = useQueueCustomerBirthDates → 서버 RPC fn_customer_birthdates(p_clinic_id,p_ids)
 *              (SECURITY DEFINER, rrn 서버복호화 → birth_date_display 'YYYY-MM-DD' 만 반환) + birthYearAgeDisplay 8자리 분기.
 *   AC-2 오늘시술 = useQueueVisitProcedureRx → 그 방문(check_in_id) package_sessions.session_type(status='used')
 *              → sessionTypeLabel 간략형(가열/비가열/포돌로게/수액/체험권/리본). "티켓 차감"(웅 맞고) 실 소스.
 *   AC-3 처방내역 = 그 방문 check_in_services(services.category_label='처방약') service_name. PMW settle 영속.
 *   ★스코프 = 각 큐 행의 check_in_id 앵커(대기=오늘 방문·완료=과거 방문 모두 정상). 신규 컬럼/테이블/enum/RLS = 0.
 *
 * 검증 방식(§dev-foot): 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   ★prod 데이터 실재 검증(service_role)은 scripts/diag-jinryo-3col-verify.mjs 로 재현 가능
 *     (2026-07-29 실측: AC-1 65/65 · AC-2 60/65 · AC-3 47/65 값 표시 — 1차 0/65 대비 회복 확인).
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상 — green build·spec PASS 는 종결 근거 아님).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const queue = () => read('src/components/doctor/DocRequestQueue.tsx');
const lib = () => read('src/lib/opinionRequest.ts');
const format = () => read('src/lib/format.ts');

test.describe('T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT (refix-2) — 진료 알림판 3컬럼 방문스코프 재결선', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 생년(만나이) = fn_customer_birthdates RPC(rrn 서버파생) ──────────────────
  test('AC-1 데이터: useQueueCustomerBirthDates — fn_customer_birthdates RPC(read-only)', () => {
    const l = lib();
    expect(l).toContain('export function useQueueCustomerBirthDates');
    // RC: customers.birth_date 직접조회(전 환자 NULL) 폐기 → 서버 RPC 로 전환.
    expect(l).toMatch(/useQueueCustomerBirthDates[\s\S]*?\.rpc\('fn_customer_birthdates'/);
    expect(l).toMatch(/p_clinic_id:\s*clinicId/);
    expect(l).toContain('birth_date_display');
    // read-only: 이 훅 스코프 내 write 금지.
    expect(l).not.toMatch(/useQueueCustomerBirthDates[\s\S]*?\.(insert|update|upsert|delete)\(/);
    // graceful 폴백(빈 맵) — 큐 무붕괴.
    expect(l).toMatch(/useQueueCustomerBirthDates[\s\S]*?catch\s*\{[\s\S]*?return\s*\{\}/);
  });

  test('AC-1 표시함수: birthYearAgeDisplay 가 8자리 완전연도(YYYY-MM-DD) 흡수', () => {
    const f = format();
    // 버그(b) 수정: RPC 반환 'YYYY-MM-DD'(digits 8자리)를 YYYYMMDD 로 분기 파싱(기존 6자리 YYMMDD 무회귀).
    expect(f).toMatch(/digits\.length\s*===\s*8/);
    expect(f).toMatch(/digits\.slice\(0,\s*4\)/); // 완전연도
  });

  test('AC-1 표시: 생년 셀 = RPC 파생 우선(스냅샷 폴백) → birthYearAgeDisplay', () => {
    const q = queue();
    expect(q).toContain('useQueueCustomerBirthDates');
    expect(q).toContain('data-testid="docreq-cell-birth"');
    // birthDisplay = live(RPC) 우선 → snapshot(r.birthDate) 폴백.
    expect(q).toMatch(/liveBirthDates\[r\.customerId\][\s\S]*?\|\|\s*r\.birthDate/);
    expect(q).toContain('birthYearAgeDisplay(birthDisplay)');
    expect(q).toMatch(/birthYearAgeDisplay\(birthDisplay\)\s*\|\|\s*'—'/);
  });

  // ── AC-2: 오늘시술 = 방문 package_sessions.session_type(간략형) ────────────────────
  test('AC-2 데이터: useQueueVisitProcedureRx — 방문 package_sessions.session_type(status=used)', () => {
    const l = lib();
    expect(l).toContain('export function useQueueVisitProcedureRx');
    // RC: 죽은 컬럼 check_ins.treatment_kind 폐기 → 방문 패키지 회차 차감(package_sessions).
    expect(l).toMatch(/from\('package_sessions'\)/);
    expect(l).toContain('session_type');
    expect(l).toMatch(/\.eq\('status',\s*'used'\)/);
    // 간략형 SSOT 매핑(가열/비가열/포돌로게/수액/체험권/리본).
    expect(l).toContain('export function sessionTypeLabel');
    for (const ko of ['가열', '비가열', '포돌로게', '수액', '체험권', '리본']) expect(l).toContain(ko);
    // graceful 폴백.
    expect(l).toMatch(/useQueueVisitProcedureRx[\s\S]*?catch\s*\{[\s\S]*?return\s*\{\}/);
  });

  test('AC-2 스코프: 방문(check_in_id) 앵커 — 글로벌 오늘 조회 폐기(완료행=과거방문 정상)', () => {
    const l = lib();
    const q = queue();
    // 훅 인자 = checkInIds (customerIds 아님).
    expect(l).toMatch(/useQueueVisitProcedureRx\(clinicId:\s*string\s*\|\s*null,\s*checkInIds:\s*string\[\]\)/);
    // 소비부: checkInIds 로 호출 + todayForRow 가 r.checkInId 로 조회.
    expect(q).toMatch(/useQueueVisitProcedureRx\(clinicId,\s*checkInIds\)/);
    expect(q).toMatch(/visitProcRx\[r\.checkInId\]/);
    // 죽은 소스 재도입 금지(회귀 가드).
    expect(l).not.toContain('useQueueTodayProcedureRx');
  });

  test('AC-2 표시: 오늘시술 셀 = 방문 시술 전체 나열(첫건/한건 아님)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-today-proc"');
    expect(q).toMatch(/today\.procedures[\s\S]*?join\(', '\)/);
    expect(q).toContain('procedureText');
  });

  // ── AC-3: 처방내역 = 방문 check_in_services(PMW 처방약) ────────────────────────────
  test('AC-3 데이터: PMW 처방약 = check_in_services + services.category_label=처방약', () => {
    const l = lib();
    expect(l).toMatch(/from\('check_in_services'\)/);
    expect(l).toContain('export function extractRxDrugNames');
    expect(l).toContain("'처방약'");
    expect(l).toContain('service_name');
    expect(l).toContain('service_id(category_label)');
  });

  test('AC-3 표시: 처방내역 셀 = 방문 PMW 처방약 전체 나열(rx 소스 전환)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-rx"');
    expect(q).toMatch(/today\.prescriptions[\s\S]*?join\(', '\)/);
    expect(q).not.toMatch(/const rx = snap\?\.prescription/);
  });

  // ── 회귀 가드: 기존 9컬럼 + 발행/완료 그룹 무회귀, 양 테이블 동일 소스 ────────────
  test('회귀: 기존 컬럼/발행 동선 무회귀, 대기+완료 두 테이블 모두 연동', () => {
    const q = queue();
    for (const col of ['이름', '생년', '차트번호', '담당 진료의', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // 대기+완료 두 테이블 모두에 3컬럼 resolver 전달(양쪽 표시).
    expect((q.match(/birthDateForRow=/g)?.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect((q.match(/todayForRow=/g)?.length ?? 0)).toBeGreaterThanOrEqual(2);
    // 임상경과(범위 밖)는 기존 소스(snap.progress) 유지.
    expect(q).toContain('snap?.progress');
    // 발행/완료 매핑 단일 소스 보존(무회귀).
    const l = lib();
    expect(l).toContain('mapPublishedRequestRow');
    expect(l).toContain('useOpinionRequestQueue');
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(§dev-foot: green build·spec PASS 는 종결 근거 아님) ──
 * [ ] AC-1: 진료 알림판 → 소견서·진단서 처리대기/서류완료 테이블, 환자 행에 "YYYY (만 N세)" 표시(전 환자 '—' 아님).
 * [ ] AC-1: 생년 미확보 환자 행은 '—' 유지(크래시 없음).
 * [ ] AC-2: 시술(레이저 등) 차감된 환자 행 "오늘시술"에 간략형(가열/비가열/포돌로게/수액/체험권/리본) 표시.
 * [ ] AC-2: 방문 여러 회차 차감 환자는 전체가 콤마로 나열되는지(첫 건만 아님) 확인.
 * [ ] AC-2: 시술 차감 없는 환자는 '—' 유지.
 * [ ] AC-3: 결제미니창에서 처방약 넣은 환자 행 "처방내역"에 그 약 목록 표시(결제창 기준).
 * [ ] AC-3: '서류 완료'(과거일 발행) 행도 그 방문의 생년/시술/처방이 정상 표시되는지(스코프 회복 확인).
 * [ ] 회귀: 담당 진료의·서류종류·해당항목·발행/작성하기 동선, 서류 완료 그룹 열람 정상.
 */
