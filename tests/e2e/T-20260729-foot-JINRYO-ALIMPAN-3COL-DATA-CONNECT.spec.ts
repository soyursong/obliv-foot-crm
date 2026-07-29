/**
 * E2E spec — T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT
 * 진료 알림판(DoctorCallDashboard 상시뷰) 소견서·진단서 '처리대기'/'서류 완료' 테이블 —
 *   3개 컬럼(생년/오늘시술/처방내역)이 전 환자 '—' 로 비어 있던 회귀를 실 데이터에 연동.
 *   (현장 종로풋센터 2026-07-29 김주연 총괄 U0ATDB587PV 지적 · confirm MSG-b6gp thread 1785293193.209349)
 *
 * confirm 확정:
 *   AC-2 오늘시술 = '2번차트(펜차트) 티켓 차감 기준' = check_ins.treatment_kind. 당일 시술 '모두' 표기.
 *   AC-3 처방내역 = 결제미니창(PMW). "결제 창이 더 정확할 거 같앙"(ts 1785293527.605139).
 *
 * RC(diagnose-first):
 *   ① AC-1 생년: 큐 birthDate 가 요청 생성시 field_data 에 박힌 '스냅샷'이라 결측이면 만나이 미표시.
 *      → customers.birth_date 'live' 소스(진료대시보드 환자테이블 동일 소스)를 우선 사용.
 *   ② AC-2 오늘시술: 기존 셀이 medical_charts.treatment_record(snap.treatment)를 읽어 대개 공란.
 *      → 당일(KST) check_ins.treatment_kind(?? treatment_category) 전체를 나열(PKG-BOX-INDICATOR SSOT).
 *   ③ AC-3 처방내역: 기존 셀이 medical_charts.prescription_items 를 읽어 공란.
 *      → PMW settle 시 처방약(services.category_label='처방약')이 영속되는 check_in_services 를 읽어 나열.
 *
 * FIX(ADDITIVE, read-only, db_change=false, no-DDL):
 *   useQueueCustomerBirthDates(customers.birth_date) / useQueueTodayProcedureRx(check_ins + check_in_services)
 *   신설 + DocRequestQueue 3개 셀 재배선. 발행/저장/귀속 로직 무접촉. 신규 컬럼/테이블/enum/RLS = 0.
 *
 * 검증 방식(§dev-foot): 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
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

test.describe('T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT — 진료 알림판 소견서·진단서 3컬럼 데이터 연동', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 생년(만나이) = customers.birth_date live ─────────────────────────────
  test('AC-1 데이터: useQueueCustomerBirthDates — customers.birth_date 조회(read-only)', () => {
    const l = lib();
    expect(l).toContain('export function useQueueCustomerBirthDates');
    expect(l).toMatch(/from\('customers'\)/);
    expect(l).toContain('birth_date');
    // read-only: 이 훅 스코프 내 write 금지.
    expect(l).not.toMatch(/useQueueCustomerBirthDates[\s\S]*?\.(insert|update|upsert|delete)\(/);
    // graceful 폴백(빈 맵) — 큐 무붕괴.
    expect(l).toMatch(/useQueueCustomerBirthDates[\s\S]*?catch\s*\{[\s\S]*?return\s*\{\}/);
  });

  test('AC-1 표시: 생년 셀이 live 우선(스냅샷 폴백) 값을 birthYearAgeDisplay 로 파생', () => {
    const q = queue();
    expect(q).toContain('useQueueCustomerBirthDates');
    expect(q).toContain('data-testid="docreq-cell-birth"');
    // birthDisplay = live 우선(liveBirthDates) → snapshot(r.birthDate) 폴백.
    expect(q).toMatch(/liveBirthDates\[r\.customerId\][\s\S]*?\|\|\s*r\.birthDate/);
    expect(q).toContain('birthYearAgeDisplay(birthDisplay)');
    // 결측 null-safe '—'.
    expect(q).toMatch(/birthYearAgeDisplay\(birthDisplay\)\s*\|\|\s*'—'/);
  });

  // ── AC-2: 오늘시술 = 당일 check_ins.treatment_kind 전체 ─────────────────────────
  test('AC-2 데이터: useQueueTodayProcedureRx — 당일(KST) check_ins.treatment_kind 수집', () => {
    const l = lib();
    expect(l).toContain('export function useQueueTodayProcedureRx');
    expect(l).toMatch(/from\('check_ins'\)/);
    expect(l).toContain('treatment_kind');
    // 당일(KST) 경계 필터 + PKG-BOX-INDICATOR SSOT 동형 라벨(treatment_kind ?? treatment_category).
    expect(l).toContain('todaySeoulISODate');
    expect(l).toContain('export function procedureLabelOf');
    expect(l).toMatch(/treatment_kind\s*\?\?\s*row\.treatment_category/);
    // graceful 폴백.
    expect(l).toMatch(/useQueueTodayProcedureRx[\s\S]*?catch\s*\{[\s\S]*?return\s*\{\}/);
  });

  test('AC-2 표시: 오늘시술 셀 = 당일 시술 전체 나열(첫건/한건 아님)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-today-proc"');
    // 당일 시술 '모두' 표기 — procedures 배열을 join(', ').
    expect(q).toMatch(/today\.procedures[\s\S]*?join\(', '\)/);
    expect(q).toContain('procedureText');
  });

  // ── AC-3: 처방내역 = 결제미니창(PMW) 당일 처방약 ────────────────────────────────
  test('AC-3 데이터: PMW 처방약 = check_in_services + services.category_label=처방약', () => {
    const l = lib();
    expect(l).toMatch(/from\('check_in_services'\)/);
    // services 임베드로 category_label 판별 + 처방약만 편입(순수 파생).
    expect(l).toContain('export function extractRxDrugNames');
    expect(l).toContain("'처방약'");
    expect(l).toContain('service_name');
    // 소스 전환 근거: medical_charts.prescription_items 아님(PMW check_in_services).
    expect(l).toContain('service_id(category_label)');
  });

  test('AC-3 표시: 처방내역 셀 = 당일 PMW 처방약 전체 나열(rx 소스 전환)', () => {
    const q = queue();
    expect(q).toContain('data-testid="docreq-cell-rx"');
    // rx = today.prescriptions.join — medical_charts snap.prescription 아님.
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
 * [ ] AC-1: 진료 알림판 → 소견서·진단서 처리대기/서류완료 테이블, birth_date 등록 환자 행에 "YYYY (만 N세)" 표시.
 * [ ] AC-1: birth_date 미등록 환자 행은 '—' 유지(크래시 없음).
 * [ ] AC-2: 오늘 시술 차감된 환자 행 "오늘시술"에 시술종류(가열/비가열/포돌로게/수액/체험권 등) 표시.
 * [ ] AC-2: 당일 여러 건 차감 환자는 전체가 콤마로 나열되는지(첫 건만 아님) 확인.
 * [ ] AC-2: 당일 차감 없는 환자는 '—' 유지.
 * [ ] AC-3: 결제미니창에서 처방약 넣은 환자 행 "처방내역"에 그 약 목록 표시(치료테이블/펜차트 아님, 결제창 기준).
 * [ ] AC-3: 처방약 없는 환자 행은 '—' 유지.
 * [ ] 회귀: 담당 진료의·서류종류·해당항목·발행/작성하기 동선, 서류 완료 그룹 열람 정상.
 */
