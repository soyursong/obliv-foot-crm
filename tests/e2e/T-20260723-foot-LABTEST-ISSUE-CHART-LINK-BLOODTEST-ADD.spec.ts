/**
 * E2E spec — T-20260723-foot-LABTEST-ISSUE-CHART-LINK-BLOODTEST-ADD
 *
 * 치료테이블 균검사/피검사 발급·결과지 업로드 → 2번차트(고객차트) [검사결과] 탭 연동 +
 * [검사결과] 탭에 피검사(혈액검사) 섹션/항목 신규 추가.
 *
 * 핵심(재사용·신규 스키마 0):
 *   - 검사결과 탭은 기존 균검사(KOH)만 노출 → 균검사와 병렬로 피검사(혈액검사) 섹션 신규 추가.
 *   - 연동은 별도 배선 불필요 — 이미 공유 테이블로 성립:
 *       · 균검사 발급  : 치료테이블 '발급하기'(publish_koh_result) → form_submissions(status='published')
 *                        → 검사결과 탭 KohPublishedResults 자동 표시(旣구현).
 *       · 피검사 업로드: 치료테이블 '결과지 업로드'(BloodResultDialog) 와 검사결과 탭 신규 섹션이
 *                        동일 patient_file_records(kind='blood_result', customer_id 스코프) 공유
 *                        → 어느 쪽에서 올리든 양방향 즉시 반영.
 *
 *   AC-1 치료테이블 균검사/피검사 발급·업로드 → 2번차트 [검사결과] 탭 연동(공유 테이블, 즉시 반영).
 *   AC-2 [검사결과] 탭에 피검사(혈액검사) 섹션 신규 노출 — 균검사와 병렬.
 *   AC-3 결과지 업로드 → [검사결과] 탭 해당 항목에 첨부·미리보기(보기/다운로드) 연동.
 *   AC-4 빈 상태(발급/업로드 없음) 정상 렌더, null-safety — 피검사 섹션도 빈 상태 노출.
 *   AC-5 신규 스키마 0(patient_file_records·form_submissions 재사용) → data-architect CONSULT 불요.
 *   AC-6 KOH↔피검사 kind 격리 유지(koh_result / blood_result), 치료테이블 발급/업로드 회귀 0.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 가드(현장 클릭 시나리오 → 코드 불변식) +
 *   앱 로드(HTTP 200). CHART2-KOH-BLOODRESULT-STYLE-UPLOAD spec 패턴 동형.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const chart = () => read('src/pages/CustomerChartPage.tsx');
const shared = () => read('src/components/PatientResultFiles.tsx');
const examSection = () => read('src/components/treatment/ExamTargetsSection.tsx');
const bloodDialog = () => read('src/components/BloodResultDialog.tsx');
const kohPublished = () => read('src/components/KohPublishedResults.tsx');

test.describe('T-20260723-foot-LABTEST-ISSUE-CHART-LINK-BLOODTEST-ADD', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-2: 검사결과 탭 피검사 섹션 신규 노출(균검사와 병렬) ────────────────────
  test('AC-2: 검사결과 탭에 피검사(혈액검사) 섹션 신규 — PatientResultFiles kind=blood_result', () => {
    const c = chart();
    // 피검사 섹션 헤더 라벨
    expect(c).toContain('피검사(혈액검사)');
    // 피검사 섹션이 공통 결과지 폼(PatientResultFiles)을 blood_result 로 사용
    expect(c).toContain('kind="blood_result"');
    expect(c).toContain('prefix="blood_result"');
    expect(c).toContain('testidPrefix="blood-result"');
    // 균검사 섹션은 그대로 유지(병렬) — 회귀 0
    expect(c).toContain('kind="koh_result"');
    expect(c).toContain('KOH균검사');
  });

  test('AC-2: 검사결과 탭 = 균검사 + 발행보고서 + 피검사 3블록 동시 렌더(test_result 탭)', () => {
    const c = chart();
    // 검사결과 탭 조건부 렌더 안에 세 블록이 함께 존재
    expect(c).toContain("chartTab === 'test_result'");
    expect(c).toContain('<KohPublishedResults');
    // PatientResultFiles 가 KOH·혈액 양쪽에서 각각 호출(2회 이상)
    const occurrences = (c.match(/<PatientResultFiles/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  // ── AC-1/AC-3: 연동 = 공유 테이블 재사용(별도 배선 불필요) ─────────────────────
  test('AC-1/AC-3: 피검사 연동은 patient_file_records(blood_result·customer_id) 공유로 성립', () => {
    // 치료테이블 업로드(BloodResultDialog) 와 검사결과 탭(PatientResultFiles) 이 동일 테이블·kind 사용
    const b = bloodDialog();
    expect(b).toContain("const BLOOD_KIND = 'blood_result'");
    expect(b).toContain("from('patient_file_records')");
    const s = shared();
    // 조회 = customer_id + kind 스코프(치료테이블에서 올린 blood_result 를 그대로 조회 = 즉시 연동)
    expect(s).toContain("eq('customer_id', customerId)");
    expect(s).toContain("eq('kind', kind)");
    // 업로드 후 read-after-write(즉시 반영)
    expect(s).toContain('await load();');
  });

  test('AC-3: 결과지 첨부 미리보기/다운로드 — documents 버킷 on-demand signedUrl(1h)', () => {
    const s = shared();
    expect(s).toContain("from('documents').createSignedUrl(path, 3600)");
    // 목록 행 보기/다운로드 액션
    expect(s).toContain('${testidPrefix}-view');
    expect(s).toContain('${testidPrefix}-download');
  });

  test('AC-1: 균검사 발급 연동은 form_submissions(published) 재사용(旣구현·회귀 0)', () => {
    const kp = kohPublished();
    expect(kp).toContain("eq('status', 'published')");
    expect(kp).toContain("from('form_submissions')");
    // 검사결과 탭이 KohPublishedResults 를 customer 스코프로 렌더
    const c = chart();
    expect(c).toContain('<KohPublishedResults clinicId={customer.clinic_id} customerId={customer.id} />');
  });

  // ── AC-4: 빈 상태 null-safety ────────────────────────────────────────────────
  test('AC-4: 피검사 섹션 빈 상태 — 발급/업로드 없음 시 "등록된 결과지가 없습니다" 정상 렌더', () => {
    const s = shared();
    expect(s).toContain('${testidPrefix}-empty');
    expect(s).toContain('등록된 결과지가 없습니다.');
    // 방어성: 테이블 미적용 prod(42P01/42703) → 빈 목록 폴백(무파손)
    expect(s).toMatch(/42P01|42703/);
  });

  // ── AC-5: 신규 스키마 0 — CONSULT 불요 ──────────────────────────────────────
  test('AC-5: 신규 마이그레이션 0 — 기존 patient_file_records 테이블 재사용(신규 스키마 없음)', () => {
    // 본 티켓 신규 마이그 파일 없음(파일명 티켓ID 미포함)
    const migDir = path.join(root, 'supabase/migrations');
    const migs = fs.existsSync(migDir) ? fs.readdirSync(migDir) : [];
    const ownMig = migs.filter((f) => /LABTEST-ISSUE-CHART-LINK-BLOODTEST|20260723.*bloodtest.*chart/i.test(f));
    expect(ownMig).toHaveLength(0);
    // 재사용 대상 테이블은 旣존재(20260623150000)
    const m = read('supabase/migrations/20260623150000_patient_file_records.sql');
    expect(m).toContain("kind        text        NOT NULL DEFAULT 'blood_result'");
    // kind 는 free-text(CHECK/enum 없음) → blood_result 신규 값 추가여도 스키마 변경 0
    expect(m).not.toMatch(/kind[^\n]*CHECK/);
  });

  // ── AC-6: 치료테이블 발급/업로드 회귀 0 + kind 격리 ─────────────────────────
  test('AC-6: 치료테이블 ExamTargetsSection 발급/업로드 계약 불변(회귀 0)', () => {
    const e = examSection();
    // 균검사 발급(publish_koh_result) + 피검사 결과지 업로드(BloodResultDialog) 동선 보존
    expect(e).toContain("rpc('publish_koh_result'");
    expect(e).toContain("import BloodResultDialog from '@/components/BloodResultDialog'");
    expect(e).toContain('data-testid="exam-koh-issue-btn"');
    expect(e).toContain('data-testid="exam-blood-result-upload"');
    // blood_result 카운트 조회로 업로드↔보기 라벨 분기(공유 테이블 근거)
    expect(e).toContain("eq('kind', 'blood_result')");
  });

  test('AC-6: kind 격리 — KOH=koh_result / 피검사=blood_result 섞이지 않음', () => {
    const c = chart();
    // 검사결과 탭 안에서 두 kind 가 각각 명시
    expect(c).toContain('kind="koh_result"');
    expect(c).toContain('kind="blood_result"');
    // 공통 폼은 prop kind 로만 필터(하드코딩 kind 없음)
    const s = shared();
    expect(s).toContain("eq('kind', kind)");
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트 — 갤탭 실기기 confirm 대상):
 *
 * [시나리오1] 균검사 발급 → 차트 연동
 *   1. 로그인 → 치료테이블 → 환자 선택 → '균검사 발급하기' → 발급 확인
 *   2. 해당 환자 2번차트 → [검사결과] 탭 → '발행된 검사결과 보고서'에 방금 발급 row 표시(검사종류/발급일시)
 *
 * [시나리오2] 피검사 결과지 업로드 → 피검사 섹션 표시
 *   1. 치료테이블 → 환자 선택 → 피검사 '결과지 업로드' → PDF/JPG/PNG 업로드
 *   2. 2번차트 → [검사결과] 탭 → 신규 '피검사(혈액검사)' 섹션에 업로드 결과지 row 표시
 *
 * [시나리오3] 결과지 첨부 연동
 *   1. [검사결과] 탭 피검사 섹션 [보기] → 새 창 미리보기 / [다운로드] → 저장 (signedUrl 1h)
 *   2. 검사결과 탭에서 직접 '결과지 업로드' 해도 동일 patient_file_records 공유 → 치료테이블 라벨(N건) 갱신
 *
 * [시나리오4] 엣지
 *   1. 발급/업로드 없는 환자 [검사결과] 탭 진입 → 균검사·피검사 두 섹션 모두 '등록된 결과지가 없습니다' 빈 상태(에러 0)
 *
 * 비고: FE-only(신규 스키마 0). patient_file_records(kind='blood_result') + form_submissions(published) 재사용.
 */
