/**
 * E2E spec — T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL
 *
 * 경과분석 동선 재배치(reporter=김주연 총괄):
 *   [변경1] 예약관리(/reservations) — 경과분석 ON/OFF 토글 + 캘린더형 경과분석 뷰 완전 제거.
 *           filterProgress state/토글버튼/필터 분기 회수 → 예약관리는 항상 전체 예약 표시(기존 OFF 동작 = 기본).
 *           ⚠ progress_check_required 트리거/배지(읽기전용 표시)는 유지 — 변경2 데이터 소스.
 *   [변경2] 치료테이블(/admin/treatment-table) — ③ '경과분석' 탭 신설(기존 2탭 뒤 3번째).
 *           당일(부모 공통 날짜선택기, 기본=오늘) progress_check_required 예약을 리스트(테이블)로 표시.
 *           컬럼: 환자 / 회차 / 예약시간 / 담당자. 캘린더·일간보기 형태 금지.
 *
 * 데이터: 전부 기존 컬럼 read-only(progress_check_required/label = T-PROGRESS-CHECKPOINT 트리거 SSOT 소비).
 *   신규 테이블/컬럼/enum/RLS/트리거 0 → NO-DDL. db_change=false.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 본문 현장 클릭 시나리오 3종을 코드 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const reservations = () => read('src/pages/Reservations.tsx');
const treatTable = () => read('src/pages/TreatmentTable.tsx');
const progressSection = () => read('src/components/treatment/ProgressTargetsSection.tsx');

test.describe('T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL', () => {
  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: 예약관리 경과분석 ON/OFF + 캘린더 뷰 완전 제거 (AC-1/2/3) ──────
  test('시나리오1: 예약관리 — 경과분석 토글버튼/필터 state/분기 전부 제거', () => {
    const r = reservations();
    // 토글 버튼 testid 제거(현장에서 [경과분석 ON/OFF] 버튼이 더 이상 없음)
    expect(r).not.toContain('data-testid="progress-filter-btn"');
    // 필터 state 선언/사용 제거 — filterProgress 가 활성 코드(jsx/조건)에 남지 않음.
    //   (변경 이력 주석에는 단어가 남을 수 있으므로, state 선언과 setter 호출 패턴으로 가드)
    expect(r).not.toContain('const [filterProgress, setFilterProgress]');
    expect(r).not.toContain('setFilterProgress');
    expect(r).not.toContain('filterProgress ?');
    expect(r).not.toContain('!filterProgress');
    expect(r).not.toContain('|| r.progress_check_required)');
  });

  test('시나리오1: 예약관리 — 제거 후 전체 예약 표시(OFF 기본) + 새 예약 항상 노출', () => {
    const r = reservations();
    // 일간/주간 양쪽 뷰는 보존(회귀 가드)
    expect(r).toContain("viewMode === 'day'");
    expect(r).toContain('주간');
    expect(r).toContain('일간');
    // '새 예약' 버튼은 filterProgress 가드 없이 항상 노출
    expect(r).toContain('새 예약');
    // (+) 슬롯 생성 버튼은 마감(full) 여부로만 가드
    expect(r).toContain('{!full ? (');
  });

  test('시나리오1: 회귀 — progress_check_required 트리거/배지(읽기전용)는 유지', () => {
    const r = reservations();
    // 트리거 마킹 데이터(변경2 소스)는 보존: 배지는 progress_check_required 기준으로 계속 렌더
    expect(r).toContain('r.progress_check_required && (');
    expect(r).toContain('data-testid={`progress-badge-${r.id}`}');
    // 예약 생성 시 경과분석 감지 배너도 보존(체크포인트 트리거 자체 불변)
    expect(r).toContain('data-testid="progress-check-banner"');
  });

  // ── 시나리오 2: 치료테이블 경과분석 탭 정상 동선 (AC-4/5/6) ─────────────────
  test('시나리오2: 치료테이블 — [경과분석] 탭이 기존 2탭 뒤 3번째에 배치', () => {
    const t = treatTable();
    // 신규 탭 트리거 + 섹션 연결
    expect(t).toContain('data-testid="tab-progress-targets"');
    expect(t).toContain('ProgressTargetsSection');
    // 탭 순서: 진료 환자 이력 → 균·피검사 → 경과분석 (3번째)
    const idxHistory = t.indexOf('data-testid="tab-doctor-history"');
    const idxExam = t.indexOf('data-testid="tab-exam-targets"');
    const idxProgress = t.indexOf('data-testid="tab-progress-targets"');
    expect(idxHistory).toBeGreaterThan(-1);
    expect(idxExam).toBeGreaterThan(-1);
    expect(idxProgress).toBeGreaterThan(-1);
    expect(idxProgress).toBeGreaterThan(idxExam);
    expect(idxExam).toBeGreaterThan(idxHistory);
    // SectionTab 타입에 'progress' 포함(④ 경과분석 플랜은 confirm 후 맨 뒤 독립 랜딩)
    expect(t).toContain("'history' | 'exam' | 'progress'");
  });

  test('시나리오2: 경과분석 탭 = 당일 progress_check_required 예약 리스트(read-only)', () => {
    const s = progressSection();
    // 데이터 소스 = reservations(progress_check_required=true, 당일, 취소 제외)
    expect(s).toContain("from('reservations')");
    expect(s).toContain("eq('progress_check_required', true)");
    expect(s).toContain("eq('reservation_date', date)");
    expect(s).toContain("neq('status', 'cancelled')");
    // 리스트(테이블) 형태 — 캘린더/일간보기 아님
    expect(s).toContain('data-testid="progress-targets-table"');
    expect(s).toContain('<table');
    // 컬럼: 환자 / 회차 / 예약시간 / 담당자
    expect(s).toContain('환자');
    expect(s).toContain('회차');
    expect(s).toContain('예약시간');
    expect(s).toContain('담당자');
    expect(s).toContain('data-testid="progress-label-cell"');
    expect(s).toContain('data-testid="progress-time-cell"');
    expect(s).toContain('data-testid="progress-registrar-cell"');
  });

  test('시나리오2: 이름 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴(부모 재사용)', () => {
    const s = progressSection();
    expect(s).toContain('data-testid="progress-name-clickable"');
    expect(s).toContain('nameInteraction.onLeftClick(r.customerId)');
    expect(s).toContain('nameInteraction.onContextMenu(e,');
  });

  // ── 시나리오 3: 엣지 — 당일 대상자 0명 ─────────────────────────────────────
  test('시나리오3: 경과분석 탭 — 당일 대상자 0명 빈 상태 메시지(에러 없음)', () => {
    const s = progressSection();
    expect(s).toContain('data-testid="progress-targets-empty"');
    expect(s).toContain('오늘 경과분석 대상자가 없습니다');
  });

  // ── NO-DDL / 회귀 가드 ─────────────────────────────────────────────────────
  test('회귀0: NO-DDL — 신규 섹션은 read-only(insert/update/rpc 발행 없음)', () => {
    const s = progressSection();
    expect(s).not.toContain('.insert(');
    expect(s).not.toContain('.update(');
    expect(s).not.toContain('.rpc(');
  });

  test('회귀0: 신규 섹션 방어성 — ADDITIVE 컬럼 미적용 prod 빈 목록 폴백', () => {
    const s = progressSection();
    // progress_check_required/label 미적용(42703/PGRST204) 시 throw 아닌 빈 목록 폴백
    expect(s).toContain('42703');
    expect(s).toContain('PGRST204');
  });

  test('회귀0: 치료테이블 기존 2섹션 보존', () => {
    const t = treatTable();
    expect(t).toContain('DoctorHistorySection');
    expect(t).toContain('ExamTargetsSection');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 예약관리 ON/OFF 제거 확인
 *   1. admin 로그인 → /reservations(예약관리)
 *   2. 화면에 [경과분석 ON/OFF] 토글 버튼이 더 이상 없음
 *   3. 일간/주간 보기 전환 — 양쪽 모두 경과분석 토글 부재
 *   4. 예약 목록이 전체 예약으로 정상 표시(필터 잔재 없음)
 *
 * [시나리오2] 치료테이블 경과분석 탭 동선
 *   1. admin 로그인 → 사이드바 [치료 테이블] → /admin/treatment-table
 *   2. 기존 2탭(진료 환자 이력 / 균검사&피검사 대상자) 뒤 3번째에 [경과분석] 탭
 *   3. [경과분석] 탭 클릭 → 당일 경과분석 대상 환자가 리스트(테이블) 형태로 표시
 *   4. 각 행에 환자명·회차·예약시간·담당자 표시
 *   5. 캘린더/일간보기 형태가 아님(리스트/테이블)
 *
 * [시나리오3] 엣지 — 당일 대상자 0명
 *   1. 오늘 경과분석 체크포인트 해당 예약이 없는 날짜 기준
 *   2. [경과분석] 탭 진입 → "오늘 경과분석 대상자가 없습니다" 빈 상태(에러 없음)
 *
 * 비고: NO-DDL. 신규 컬럼/테이블/enum/RLS/트리거 0(전부 기존 컬럼 read). DA CONSULT/supervisor DDL-diff 불요.
 *   db_change=false. ④경과분석 플랜(TAB-MOVE-TREATTABLE)은 문지은 대표원장 confirm 후 맨 뒤 독립 랜딩.
 */
