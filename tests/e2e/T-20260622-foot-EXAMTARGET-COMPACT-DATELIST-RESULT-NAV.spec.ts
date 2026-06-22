/**
 * E2E spec — T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV
 *
 * 치료 테이블 §B '균검사 & 피검사 대상자' 정밀화(TREATTABLE-ADDON-COMPACT-DATEFILTER 후속):
 *   AC-1 컴팩트화      — 행 height/padding/leading 축소(밀도↑). 내용 보존(항목 삭제 0),
 *                        폰트 가독 최소 유지(≥11px, RESVCAL-COMPACT-CONTENT-KEEP 동일 원칙).
 *   AC-2 일자별 리스트  — 단일 명단 → 검사신청일(check_ins.checked_in_at, KST) 기준 일자별 그룹핑.
 *                        기준일자 DISCOVERY 결론 = '검사신청일'. 부모 date 를 윈도 끝으로 직전 N일 묶음.
 *   AC-3 검사결과 생성  — ⚠ DISCOVERY 게이트. KOH 결과=별도 저장모델(form_submissions koh_result) 재사용,
 *                        혈액검사 결과=저장모델 부재 → 신청 boolean 재사용 금지·'준비중' 비활성(총괄 confirm 후 후속).
 *   AC-4 우클릭         — 기존 CRM 컨텍스트 메뉴 그대로 위임(부모 nameInteraction.onContextMenu, 신규 정의 0).
 *   AC-5 좌클릭         — 2번차트 오픈(부모 nameInteraction.onLeftClick → useChart 재사용).
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 현장 클릭 시나리오를 코드 가드로 변환. NO-DDL(전부 기존 컬럼 read-only). db_change=false.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const page_ = () => read('src/pages/TreatmentTable.tsx');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1 컴팩트화 ──────────────────────────────────────────────────────────
  test('AC-1: 행 패딩 축소(px-2 py-1) + 폰트 가독 최소 유지(≥11px) + 내용 보존', () => {
    const b = sectionB();
    // 행/헤더 셀 패딩 더 조밀하게(직전 px-2.5 py-1.5 → px-2 py-1)
    expect(b).toContain('px-2 py-1');
    // 폰트 과압축 금지: 본문 13px / 메타·배지 11px(가독 최소). 10px 이하 본문 폰트 회귀가드
    expect(b).toContain('text-[13px]');
    expect(b).toContain('text-[11px]');
    expect(b).not.toContain('text-[9px]');
    expect(b).not.toContain('text-[10px] tabular-nums'); // 행 번호 폰트 과압축 회귀가드
    // 내용 보존: 환자/검사상태/검사결과/차트번호 컬럼 모두 유지
    expect(b).toContain('exam-name-clickable');
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
    expect(b).toContain('chartNoBadge');
  });

  // ── AC-2 일자별 리스트(검사신청일 그룹핑) ───────────────────────────────────
  test('AC-2: 검사신청일(KST checked_in_at) 기준 일자별 그룹핑 렌더', () => {
    const b = sectionB();
    // 일자 그룹 컨테이너 + 그룹별 카운트
    expect(b).toContain('data-testid="exam-date-group"');
    expect(b).toContain('data-testid="exam-date-group-count"');
    // 기준일자 = 검사신청일(checked_in_at) → KST 날짜로 환산해 그룹 키 사용
    expect(b).toContain('seoulISODate');
    expect(b).toContain("import { chartNoBadge, seoulISODate } from '@/lib/format'");
    expect(b).toContain('requestDate');
    // 윈도(직전 N일) 범위 조회 — date 를 윈도 끝으로
    expect(b).toContain('WINDOW_DAYS');
    expect(b).toContain('windowBounds');
    expect(b).toContain("gte('check_ins.checked_in_at'");
    expect(b).toContain("lte('check_ins.checked_in_at'");
    // 환자×검사신청일 단위 집계(같은 환자라도 신청일 다르면 별도 행)
    expect(b).toContain('`${cid}__${reqDate}`');
    // 부모 공통 날짜선택기는 그대로(윈도 끝으로 소비) — queryKey 에 date 포함
    expect(b).toContain("['exam_targets', clinicId, date]");
  });

  test('AC-2: 최근 신청일 먼저 정렬 + 그룹 내 가나다순', () => {
    const b = sectionB();
    expect(b).toContain('b.date.localeCompare(a.date)'); // 최근 신청일 먼저
    expect(b).toContain("localeCompare(b.customerName, 'ko')"); // 그룹 내 이름순
  });

  // ── AC-3 검사결과 생성(DISCOVERY 게이트) ────────────────────────────────────
  test('AC-3: KOH 결과 = 별도 저장모델 재사용(신청 boolean 비재사용), 혈액검사 = 준비중 비활성', () => {
    const b = sectionB();
    // KOH 결과 = 신청 boolean 이 아닌 별도 저장모델(form_submissions koh_result) read
    expect(b).toContain("queryKey: ['koh_published', clinicId]");
    expect(b).toContain("eq('form_key', 'koh_result')");
    expect(b).toContain('koh_service_id');
    // 발행본 보기 / 미발행 생성(기존 surface 재사용)
    expect(b).toContain('data-testid="exam-koh-result-view"');
    expect(b).toContain('data-testid="exam-koh-result-new"');
    expect(b).toContain("navigate('/admin/doctor-tools')");
    // 혈액검사 결과 = 저장모델 부재 → 준비중 비활성(신규 백엔드 0)
    expect(b).toContain('data-testid="exam-blood-result-new"');
    expect(b).toContain('disabled');
    expect(b).toMatch(/준비\s*중/);
  });

  test('AC-3 NO-DDL: 본 섹션 read-only — insert/update/publish RPC 직접 호출 0', () => {
    const b = sectionB();
    expect(b).not.toContain('.insert(');
    expect(b).not.toContain('.update(');
    expect(b).not.toContain("rpc('publish");
  });

  // ── AC-4/AC-5 이름 인터랙션(기존 재사용) ────────────────────────────────────
  test('AC-4/AC-5: 좌클릭=2번차트 / 우클릭=기존 CRM 컨텍스트 메뉴 위임(신규 정의 0)', () => {
    const p = page_();
    const b = sectionB();
    // 섹션은 부모 핸들러 위임만(신규 메뉴/네비 정의 없음)
    expect(b).toContain('data-testid="exam-name-clickable"');
    expect(b).toContain('nameInteraction.onLeftClick(r.customerId)');
    expect(b).toContain('nameInteraction.onContextMenu');
    // 부모: 좌클릭 2번차트(useChart) + 우클릭 기존 CustomerQuickMenu 재사용
    expect(p).toContain("import { useChart } from '@/lib/chartContext'");
    expect(p).toContain('openChart(');
    expect(p).toContain("import { CustomerQuickMenu } from '@/components/CustomerQuickMenu'");
    expect(p).toContain('<CustomerQuickMenu');
  });

  // ── 회귀 ────────────────────────────────────────────────────────────────────
  test('회귀: 빈 상태/리스트업 조건/방어성(42703 폴백) 보존', () => {
    const b = sectionB();
    expect(b).toContain('data-testid="exam-targets-empty"');
    expect(b).toContain("or('koh_requested.eq.true,blood_test_requested.eq.true')");
    expect(b).toMatch(/42703/); // ADDITIVE 컬럼 미적용 prod 폴백
    expect(b).toContain('<KohResultDialog');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 컴팩트 + 일자별 리스트
 *   1. 로그인 → '치료 테이블' → '균검사 & 피검사 대상자' 탭 → 이전보다 조밀(여백↓), 내용은 전부 유지(가독)
 *   2. 명단이 검사신청일별로 묶여(날짜 헤더 + N명) 최근 신청일이 위에 표시
 *   3. 상단 날짜선택기 이동 → 해당 날짜를 끝으로 직전 2주 윈도가 일자별로 갱신
 *
 * [시나리오2] 검사결과
 *   1. 균검사 신청 행: 발행본=결과 보기(KohResultDialog), 미발행=결과 생성(균검사 보고서 이동)
 *   2. 피검사 신청 행: '결과(준비중)' 비활성 — 결과 저장모델 부재(총괄 confirm 후 후속)
 *
 * [시나리오3] 이름 인터랙션
 *   1. 이름 좌클릭 → 2번차트 열림
 *   2. 이름 우클릭 → 기존 CRM 컨텍스트 메뉴(고객차트/진료차트/예약/수납/문자)
 *
 * [시나리오4] 엣지/회귀
 *   1. 데이터 0건 기간 → 빈 상태 메시지
 *   2. 결제·예약·차트 저장 동선 미영향
 *
 * 비고: NO-DDL. db_change=false.
 *   ⚠ AC-3 DISCOVERY(혈액검사 결과 저장모델 부재) → data-architect CONSULT + responder 경유 1안 UX
 *     총괄 confirm 후 별도 티켓. KOH 결과는 기존 form_submissions(koh_result) 저장모델 재사용(신청 boolean 비재사용).
 */
