/**
 * E2E spec — T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER
 *
 * 부모 T-20260620-foot-TREATTABLE-2SECTION-REVAMP(deployed) surface 위 4종 UX 증분:
 *   A. 레이아웃 컴팩트화      — 양 섹션 테이블 px/py·텍스트 축소(정보밀도 ↑).
 *   B. 일자별 필터           — 부모 TreatmentTable 공통 단일 날짜선택기 → 양 섹션 date prop(controlled).
 *   C. 검사결과 동행배치/생성  — 섹션B 각 행에 '검사신청' 상태 + '검사결과' 동작 같은 줄. 발행본=KohResultDialog 보기,
 *                              미발행 KOH=균검사 보고서(KohReportTab) 생성 동선. ⚠ 혈액검사 결과 생성 백엔드 부재→준비중.
 *   D. 이름 인터랙션          — 좌클릭=2번차트(useChart) / 우클릭=CRM 컨텍스트 메뉴(CustomerQuickMenu 재사용).
 *
 * 검증: 현장 PHI 계정 → 인증/실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 본문 현장 클릭 시나리오 4종을 코드 가드로 변환.
 *
 * NO-DDL: 전부 기존 컬럼 read-only(ADDITIVE 소비). 신규 테이블/컬럼/enum/RLS 0. db_change=false.
 *   ⚠ pending: B 필터범위(탭 공통 vs 독립)·C 입력 UX(모달/드로어/인라인) → 총괄 confirm. 현재=골격 선행.
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

test.describe('T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER', () => {
  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── A. 컴팩트 레이아웃 ──────────────────────────────────────────────────────
  test('AC-1: 양 섹션 테이블 컴팩트(px-2.5 py-1.5 행간/텍스트 축소)', () => {
    const a = sectionA();
    const b = sectionB();
    // 행/헤더 패딩 축소(기존 px-4 py-3 → px-2.5 py-1.5)
    expect(a).toContain('px-2.5 py-1.5');
    expect(b).toContain('px-2.5 py-1.5');
    // 본문 텍스트 축소
    expect(a).toContain('text-[13px]');
    expect(b).toContain('text-[13px]');
    // 회귀: 과거 넉넉 패딩(px-4 py-3) 잔존 0 (정보밀도 상향 확인)
    expect(a).not.toContain('px-4 py-3');
    expect(b).not.toContain('px-4 py-3');
  });

  // ── B. 공통 날짜선택기(탭 공통 단일) ────────────────────────────────────────
  test('AC-2: 부모가 공통 단일 날짜선택기 소유 → 양 섹션에 date prop 전달(controlled)', () => {
    const p = page_();
    const a = sectionA();
    const b = sectionB();
    // 부모 = 단일 날짜 네비 소유
    expect(p).toContain('data-testid="treatment-date-nav"');
    expect(p).toContain('data-testid="treatment-date-prev"');
    expect(p).toContain('data-testid="treatment-date-next"');
    expect(p).toContain('data-testid="treatment-date-today"');
    expect(p).toContain('const [date, setDate]');
    // 양 섹션에 date prop 주입
    expect(p).toContain('<DoctorHistorySection date={date}');
    expect(p).toContain('<ExamTargetsSection date={date}');
    // 섹션은 controlled date prop 수신(내부 date state 소유 안 함)
    expect(a).toContain('date: string');
    expect(b).toContain('date: string');
    // 섹션 쿼리가 date 로 필터(queryKey 에 date 포함 → 날짜 변경 시 재조회)
    expect(a).toContain("['doctor_history', clinicId, date]");
    expect(b).toContain("['exam_targets', clinicId, date]");
    // 섹션B(검사신청)도 날짜 범위 필터 적용(B: 양 섹션 적용)
    expect(b).toContain("gte('check_ins.checked_in_at'");
    expect(b).toContain("lte('check_ins.checked_in_at'");
  });

  // ── C. 검사결과 동행배치 + 생성/보기 ────────────────────────────────────────
  test('AC-3: 섹션B 각 행 = 검사신청 상태 + 검사결과 동작 같은 줄', () => {
    const b = sectionB();
    // 신청 상태 박스(부모 기능 보존) + 결과 동작이 같은 셀(한 줄)
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
    expect(b).toContain('data-testid="exam-koh-group"');
    expect(b).toContain('data-testid="exam-blood-group"');
    // KOH 결과 생성/보기 동작
    expect(b).toContain('data-testid="exam-koh-result-new"');
    expect(b).toContain('data-testid="exam-koh-result-view"');
    expect(b).toMatch(/결과 생성/);
    expect(b).toMatch(/결과 보기/);
  });

  test('AC-4: 발행본 KOH 결과 = KohResultDialog 재사용(read-after-write 동일 쿼리키 invalidate 공유)', () => {
    const b = sectionB();
    // 발행본 인덱스 = KohReportTab usePublishedKoh 와 동일 SSOT/쿼리키(read-after-write 공유)
    expect(b).toContain("queryKey: ['koh_published', clinicId]");
    expect(b).toContain("eq('form_key', 'koh_result')");
    expect(b).toContain('koh_service_id');
    // 결과 보기 = 기존 KohResultDialog 컴포넌트 재사용
    expect(b).toContain("import KohResultDialog from '@/components/KohResultDialog'");
    expect(b).toContain('<KohResultDialog');
  });

  test('AC-4 DISCOVERY: 혈액검사 결과 생성 백엔드 부재 → 준비중(비활성). KOH 생성은 기존 보고서 surface 재사용', () => {
    const b = sectionB();
    // 혈액검사 결과 생성 동선 부재 → 비활성 자리만(개발 협의 표지)
    expect(b).toContain('data-testid="exam-blood-result-new"');
    expect(b).toContain('disabled');
    expect(b).toMatch(/준비\s*중/);
    // KOH 생성 = 기존 발행 surface(균검사 보고서/의사 도구) 재사용 — 본 파일 내 신규 publish/insert 없음
    expect(b).toContain("navigate('/admin/doctor-tools')");
  });

  // ── D. 이름 인터랙션(좌클릭 차트 / 우클릭 메뉴) ──────────────────────────────
  test('AC-5: 좌클릭=2번차트(useChart) / 우클릭=CRM 컨텍스트 메뉴 재사용(신규 메뉴 0)', () => {
    const p = page_();
    const a = sectionA();
    const b = sectionB();
    // 부모: useChart 단일 게이트로 2번차트 open + CustomerQuickMenu 재사용(Dashboard/Reservations 동일)
    expect(p).toContain("import { useChart } from '@/lib/chartContext'");
    expect(p).toContain('openChart(');
    expect(p).toContain("import { CustomerQuickMenu } from '@/components/CustomerQuickMenu'");
    expect(p).toContain('<CustomerQuickMenu');
    // 진료차트/문자도 기존 컴포넌트 재사용
    expect(p).toContain("import MedicalChartPanel from '@/components/MedicalChartPanel'");
    expect(p).toContain("import SendSmsDialog from '@/components/SendSmsDialog'");
    // 양 섹션: 이름 좌클릭/우클릭 핸들러 위임
    expect(a).toContain('data-testid="dh-name-clickable"');
    expect(a).toContain('nameInteraction.onLeftClick');
    expect(a).toContain('nameInteraction.onContextMenu');
    expect(b).toContain('data-testid="exam-name-clickable"');
    expect(b).toContain('nameInteraction.onLeftClick');
    expect(b).toContain('nameInteraction.onContextMenu');
  });

  // ── 시나리오 4 / 회귀 ───────────────────────────────────────────────────────
  test('AC-6 회귀0: 부모 2섹션 기능(2탭·발행 O/X·균/피 박스 동행) 보존', () => {
    const p = page_();
    const a = sectionA();
    const b = sectionB();
    // 부모 2탭 구조 보존
    expect(p).toContain('data-testid="treatment-section-tabs"');
    expect(p).toContain('data-testid="tab-doctor-history"');
    expect(p).toContain('data-testid="tab-exam-targets"');
    // 섹션A 발행 O/X 보존
    expect(a).toContain('testid="dh-rx-issue"');
    expect(a).toContain('testid="dh-opinion-issue"');
    expect(a).toContain("in('status_flag', ['purple', 'pink'])");
    // 섹션B 균/피 박스 동행(1환자 1행) 보존
    expect(b).toContain("or('koh_requested.eq.true,blood_test_requested.eq.true')");
    expect(b).toContain('new Map<string, ExamTargetRow>()');
  });

  test('회귀0: NO-DDL — 두 섹션 read-only(insert/update/발행 RPC 직접 호출 0)', () => {
    const a = sectionA();
    const b = sectionB();
    expect(a).not.toContain('.insert(');
    expect(a).not.toContain('.update(');
    expect(a).not.toContain("rpc('publish");
    // 섹션B: 검사결과 생성은 기존 surface 재사용(라우팅) — 본 파일에서 신규 write 없음
    expect(b).not.toContain('.insert(');
    expect(b).not.toContain('.update(');
    expect(b).not.toContain("rpc('publish");
  });

  test('시나리오4: 빈 상태 메시지(날짜 0건) 보존', () => {
    const a = sectionA();
    const b = sectionB();
    expect(a).toContain('data-testid="doctor-history-empty"');
    expect(b).toContain('data-testid="exam-targets-empty"');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 컴팩트 + 날짜 필터
 *   1. 로그인 → '치료 테이블' 진입 → 2섹션이 이전보다 조밀하게(여백 축소) 렌더
 *   2. 상단 단일 날짜선택기 ◀ → 어제: 섹션A·섹션B 모두 어제 데이터로 갱신
 *   3. '오늘' → 양 섹션 오늘 데이터로 갱신
 *
 * [시나리오2] 섹션B 검사결과
 *   1. '균검사 & 피검사 대상자' 탭 → 균검사 신청 행에서 '검사신청' 상태 옆 '결과 생성/보기' 같은 줄 확인
 *   2. 발행본 있는 환자 = '결과 보기' → KohResultDialog 결과지 표시
 *   3. 미발행 KOH = '결과 생성' → 균검사 보고서(의사 도구) 생성 동선 안내·이동
 *   4. 피검사 = '결과(준비중)' 비활성 — 결과 생성 동선 개발 협의 중(백엔드 부재)
 *
 * [시나리오3] 이름 인터랙션
 *   1. 섹션A/B 이름 좌클릭 → 2번차트 열림
 *   2. 같은 이름 우클릭 → 기존 CRM 컨텍스트 메뉴(고객차트/진료차트/예약/수납/문자) 표시
 *
 * [시나리오4] 엣지/회귀
 *   1. 데이터 0건 날짜 → 양 섹션 빈 상태 메시지
 *   2. 부모 기능(2탭·발행 O/X·균/피 동행) 정상
 *   3. 결제·예약·차트 저장 동선 미영향
 *
 * 비고: NO-DDL(전부 기존 컬럼 read). db_change=false. pending(B 필터범위·C 입력 UX) 총괄 confirm 후 후속.
 *   ⚠ DISCOVERY 보고: 혈액검사 결과 생성 백엔드(publish_blood RPC/blood_result 템플릿) 부재 →
 *     신규 비즈로직 필요(planner FOLLOWUP + data-architect CONSULT + supervisor DDL-diff). 본건 비포함.
 */
