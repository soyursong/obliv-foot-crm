/**
 * E2E spec — T-20260620-foot-TREATTABLE-2SECTION-REVAMP
 *
 * 치료테이블 메뉴를 2탭/2섹션으로 전면 개편:
 *   §A 진료 환자 이력      = 진료콜(status_flag purple|pink) 등재 환자 + 처방전/소견·진단서 발행 O/X
 *   §B 균검사 & 피검사 대상자 = check_in_services.koh_requested|blood_test_requested(=true) 환자, 1환자 1행
 *
 * 데이터: 전부 기존 컬럼 read-only 재사용(ADDITIVE 소비). 신규 테이블/컬럼/enum/RLS 0 → NO-DDL.
 *   섹션B 저장모델 SSOT = BLOODTEST-TOGGLE-ADD / KOHTEST-LIFECYCLE(deployed).
 *   섹션A 처방발행 = check_ins.prescription_status='confirmed' AND doctor_confirm_prescription=true.
 *   섹션A 소견·진단서 = form_submissions(status='published', field_data.doc_kind='opinion_doc').
 *
 * 검증: 현장 PHI 계정 → 인증/실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 본문 현장 클릭 시나리오 4종을 코드 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const page_ = () => read('src/pages/TreatmentTable.tsx');
const sectionA = () => read('src/components/treatment/DoctorHistorySection.tsx');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('T-20260620-foot-TREATTABLE-2SECTION-REVAMP', () => {
  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 2섹션 렌더 + 섹션 전환 (AC-1) ──────────────────────────────
  test('시나리오1: 치료테이블 = 2탭(진료 환자 이력 / 균·피검사 대상자) 구조', () => {
    const p = page_();
    // 상단 2탭 노출
    expect(p).toContain('data-testid="treatment-section-tabs"');
    expect(p).toContain('data-testid="tab-doctor-history"');
    expect(p).toContain('data-testid="tab-exam-targets"');
    expect(p).toContain('진료 환자 이력');
    expect(p).toContain('균검사');
    expect(p).toContain('피검사');
    // 두 섹션 컴포넌트 연결
    expect(p).toContain('DoctorHistorySection');
    expect(p).toContain('ExamTargetsSection');
  });

  // ── 시나리오 2: 섹션A 발행 O/X (AC-2) + 뷰어 자리(AC-3, confirm 대기) ──────
  test('시나리오2: 섹션A 진료콜 등재 환자 + 처방전/소견·진단서 발행 O/X', () => {
    const a = sectionA();
    // 진료콜 등재 = status_flag purple|pink
    expect(a).toContain("from('check_ins')");
    expect(a).toContain("in('status_flag', ['purple', 'pink'])");
    // 처방전 발행 판정 = prescription_status='confirmed' AND doctor_confirm_prescription=true
    expect(a).toContain("'confirmed'");
    expect(a).toContain('doctor_confirm_prescription');
    // 소견·진단서 발행 = form_submissions published + doc_kind=opinion_doc
    expect(a).toContain("from('form_submissions')");
    expect(a).toContain("eq('status', 'published')");
    expect(a).toContain('opinion_doc');
    // 발행 O/X 배지 2종 (IssueBadge testid prop → DOM data-testid)
    expect(a).toContain('testid="dh-rx-issue"');
    expect(a).toContain('testid="dh-opinion-issue"');
    // 발행 O/X 라벨
    expect(a).toContain('발행 O');
    expect(a).toContain('발행 X');
  });

  test('시나리오2: 섹션A 뷰어는 confirm 대기(비활성 자리만 노출 — AC-3 pending)', () => {
    const a = sectionA();
    expect(a).toContain('data-testid="dh-view-btn"');
    // 뷰어 미구현(pending decision) — 보기 버튼 비활성
    expect(a).toContain('disabled');
    expect(a).toMatch(/준비\s*중/);
  });

  // ── 시나리오 3: 섹션B 검사 버튼 상태 (AC-4) ────────────────────────────────
  test('시나리오3: 섹션B = koh/blood 신청 환자 1환자 1행, [균검사][피검사] 동행 배치', () => {
    const b = sectionB();
    // 데이터 소스 = check_in_services koh_requested|blood_test_requested
    expect(b).toContain("from('check_in_services')");
    expect(b).toContain('koh_requested');
    expect(b).toContain('blood_test_requested');
    expect(b).toContain("or('koh_requested.eq.true,blood_test_requested.eq.true')");
    // 1환자 1행 집계(customer_id Map)
    expect(b).toContain('new Map<string, ExamTargetRow>()');
    // 같은 행에 균검사·피검사 박스 나란히 — AC-4 항목별 별도 행 금지 (ExamBadge testid prop → DOM data-testid)
    expect(b).toContain('testid="exam-koh-badge"');
    expect(b).toContain('testid="exam-blood-badge"');
    expect(b).toContain('label="균검사"');
    expect(b).toContain('label="피검사"');
    // 신청(active)만 ● — active prop 으로 활성/비활성 분기
    expect(b).toContain('active={r.kohRequested}');
    expect(b).toContain('active={r.bloodRequested}');
  });

  test('시나리오3: 섹션B 검사박스 활성(●)/비활성(○) 분기', () => {
    const b = sectionB();
    expect(b).toContain('●');
    expect(b).toContain('○');
    expect(b).toContain("data-active={active ? 'true' : 'false'}");
  });

  // ── 시나리오 4: 엣지 — 빈 상태 메시지 ──────────────────────────────────────
  test('시나리오4: 섹션A/섹션B 빈 상태 메시지', () => {
    const a = sectionA();
    const b = sectionB();
    expect(a).toContain('data-testid="doctor-history-empty"');
    expect(a).toContain('진료콜 명단에 오른 환자가 없습니다');
    expect(b).toContain('data-testid="exam-targets-empty"');
    expect(b).toContain('신청한 환자가 없습니다');
  });

  // ── NO-DDL / 회귀 가드 ─────────────────────────────────────────────────────
  test('회귀0: NO-DDL — 두 섹션 모두 read-only(insert/update/rpc 발행 없음)', () => {
    const a = sectionA();
    const b = sectionB();
    // 섹션은 표시(read)만 — 발행/저장 RPC 직접 호출 없음
    expect(a).not.toContain("rpc('publish_opinion_doc'");
    expect(a).not.toContain('.insert(');
    expect(b).not.toContain('.insert(');
    expect(b).not.toContain('.update(');
  });

  test('회귀0: 기존 4뷰 치료현황 패널 보존(TreatmentStatusPanel)', () => {
    // 데이터/로직 손실 0 — 구 본문은 별도 파일로 보존(재노출 가능).
    const panel = read('src/components/treatment/TreatmentStatusPanel.tsx');
    expect(panel).toContain('TreatmentStatusPanel');
    // 기존 deployed 로직(STAFF-SOURCE-FIX) 보존 표지
    expect(panel).toContain('assigned_staff_id');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 2섹션 렌더 + 전환
 *   1. 로그인 → 좌측 메뉴 '치료 테이블' 진입
 *   2. 상단 [진료 환자 이력] / [균검사 & 피검사 대상자] 2탭 노출
 *   3. 각 탭 클릭 → 해당 섹션 리스트 표시
 *
 * [시나리오2] 섹션A 발행 O/X (+뷰어 준비중)
 *   1. '진료 환자 이력' 탭 → 당일 진료콜 등재 환자 행
 *   2. 처방 확정된 환자 = 처방전 '발행 O', 미발행 = '발행 X'
 *   3. 소견서/진단서 발행본 있는 환자 = 소견·진단서 '발행 O'
 *   4. '보기' 버튼은 비활성('준비중') — 뷰어 표시방식 현장 confirm 후 활성화 예정
 *   ※ 발행 단계에서 소견서/진단서 doc_type 미보존 → 현재 '소견·진단서' 단일 O/X(planner 협의 항목)
 *
 * [시나리오3] 섹션B 검사 버튼 상태
 *   1. 2번차트 패키지탭 → 환자A 균검사 ON·피검사 OFF 저장
 *   2. '균검사 & 피검사 대상자' 탭 → 환자A 한 줄, [균검사 ●] [피검사 ○]
 *   3. 환자B 균·피 둘 다 ON → [균검사 ●] [피검사 ●]
 *   4. 미신청 환자는 목록에 없음
 *
 * [시나리오4] 엣지
 *   1. 진료콜 0명 날짜 → 섹션A 빈 상태 메시지
 *   2. 검사 신청 0명 → 섹션B 빈 상태 메시지
 *
 * 비고: NO-DDL. 신규 컬럼/테이블/enum/RLS 0(전부 기존 컬럼 read). DA CONSULT/supervisor DDL-diff 불요.
 *   db_change=false.
 */
