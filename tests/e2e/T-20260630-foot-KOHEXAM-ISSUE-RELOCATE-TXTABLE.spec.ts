/**
 * E2E spec — T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE
 *
 * 균검사 발급 기능 재편(김주연 총괄 요청, reporter U0ATDB587PV / 문원장 confirm U0ALGAAAJAV):
 *   [1] 채취조갑 선택 + 발급하기를 진료대시보드(KohReportTab)에서 치료테이블(ExamTargetsSection)
 *       '균검사 & 피검사 대상자' 탭으로 이전 — 거기서 바로 발급 가능.
 *   [2] 진료대시보드 균검사지는 입력·발급 기능을 빼고 ①신청유무 ②채취부위(R1) ③발급여부만
 *       보여주는 READ-ONLY 리스트로 축소.
 *   [3] 치료테이블 탭에서 균검사·피검사를 두 줄(분단)로 시각 분리(4q0l 재스펙).
 *
 * 데이터/DB 무변경 — UI 위치 재배치 + 기존 발급 로직(SSOT) 재사용. 발급 field_data 정본
 * 헬퍼(buildKohFieldData)와 RPC(set_koh_nail_sites/publish_koh_result)는 동일 호출(재구현 0).
 * 검증: 현장 PHI 계정(실데이터 우회 불가) → 정적 코드 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 현장 클릭 시나리오를 코드 가드로 변환. NO-DDL. db_change=false.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');
const kohTab = () => read('src/components/doctor/KohReportTab.tsx');

test.describe('T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── [1] 발급 UI 이전 — 치료테이블(ExamTargetsSection)에서 채취조갑 선택 + 발급하기 ──────────
  test('[1] 치료테이블에 채취조갑 선택 위젯 + 발급하기 버튼 존재', () => {
    const b = sectionB();
    // 조갑부위 입력 위젯(단일선택 토글) + 좌/우발 버튼(L1~R5, 템플릿 testid)
    expect(b).toContain('data-testid="exam-nail-site-editor"');
    expect(b).toContain('data-testid={`exam-nail-foot-${foot.prefix}`}');
    expect(b).toContain('data-testid={`exam-nail-${foot.prefix}${t}`}');
    // 발급하기 버튼
    expect(b).toContain('data-testid="exam-koh-issue-btn"');
    expect(b).toContain('발급하기');
  });

  test('[1] 발급 동작 = 기존 SSOT 재사용(재구현 0) — 정본 헬퍼 import + RPC 동일 호출', () => {
    const b = sectionB();
    // buildKohFieldData(정본, KohReportTab export) 재사용 — field_data 재구현 금지.
    expect(b).toContain("from '@/components/doctor/KohReportTab'");
    expect(b).toContain('buildKohFieldData');
    // 조갑부위 저장 = set_koh_nail_sites RPC(동일), 발급 = publish_koh_result RPC(동일, idempotent).
    expect(b).toContain("supabase.rpc('set_koh_nail_sites'");
    expect(b).toContain("supabase.rpc('publish_koh_result'");
    // 중복발급 방지 — 발행완료(kohPublished) 분기에서 발급 버튼 미노출(결과 보기로 대체).
    expect(b).toContain('data-testid="exam-koh-result-view"');
  });

  test('[1] 발급 게이트 = 조갑부위 + 생년월일(RRN 파생 폴백) — 기존 hard-block 이식', () => {
    const b = sectionB();
    expect(b).toContain('채취 조갑부위를 먼저 선택');
    expect(b).toContain('생년월일');
    // 생년월일 결측 시 RRN 파생 폴백(effectiveBirth) — fn_customer_birthdates(PHI: display 만).
    expect(b).toContain("supabase.rpc('fn_customer_birthdates'");
    expect(b).toContain('birth_date_display');
    expect(b).not.toMatch(/birthMap[\s\S]{0,200}\brrn\b/); // 평문 RRN 미수신
  });

  // ── [2] 진료대시보드 균검사지 = READ-ONLY 축소 ──────────────────────────────────────────
  test('[2] KohReportTab — 채취조갑 입력 위젯·발급/일괄발급/선택 UI 제거(읽기전용)', () => {
    const k = kohTab();
    expect(k).not.toContain('<NailSiteEditor');
    expect(k).not.toContain('data-testid="nail-site-editor"');
    expect(k).not.toContain('data-testid="koh-publish-btn"');
    expect(k).not.toContain('data-testid="koh-bulk-publish"');
    expect(k).not.toContain('data-testid="koh-select-all"');
    expect(k).not.toContain('data-testid="koh-row-select"');
    // 발급 동작 mutation 호출부 제거(read-only)
    expect(k).not.toContain('publishKoh.mutateAsync');
    expect(k).not.toContain('saveNailSites.mutate');
  });

  test('[2] KohReportTab — ①신청유무 ②채취부위 ③발급여부 read-only 표기', () => {
    const k = kohTab();
    // 헤더 3항목
    expect(k).toContain('신청유무');
    expect(k).toContain('채취부위');
    expect(k).toContain('발급여부');
    // 채취부위 = NAILFMT 컴팩트 포맷 재사용(formatNailSitesShort), read-only 텍스트
    expect(k).toContain('formatNailSitesShort');
    expect(k).toContain('data-testid="koh-nailsite-text"');
    // 발급여부: 미발행 텍스트 + 발행완료(보기, read) 버튼 보존
    expect(k).toContain('data-testid="koh-unpublished"');
    expect(k).toContain('data-testid="koh-published-btn"');
    // 발급 위치 안내(치료 테이블) 문구
    expect(k).toContain('치료 테이블');
  });

  // ── [3] 균검사·피검사 분리 표기(4q0l) — 두 줄 스택 + 점선 구분 ────────────────────────────
  test('[3] 균검사·피검사가 세로 2줄(flex-col)로 분리 — 가로 한 줄 섞임 회귀가드', () => {
    const b = sectionB();
    expect(b).toContain('data-testid="exam-result-stack"');
    expect(b).toContain('flex flex-col gap-1');
    expect(b).not.toContain('flex flex-wrap items-center gap-x-3 gap-y-1');
  });

  test('[3] 균검사 줄 / 피검사 줄 = 독립 그룹 + 피검사 줄 점선 시각 구분', () => {
    const b = sectionB();
    expect(b).toContain('data-testid="exam-koh-group"');
    expect(b).toContain('data-testid="exam-blood-group"');
    expect(b).toMatch(/border-t border-dashed[\s\S]{0,80}?data-testid="exam-blood-group"/);
  });

  // ── 회귀: 기존 콘텐츠/동작 보존 ─────────────────────────────────────────────
  test('회귀: 배지·검사결과 동작·이름 인터랙션 보존(레이아웃/발급만 추가)', () => {
    const b = sectionB();
    expect(b).toContain('exam-koh-badge');
    expect(b).toContain('exam-blood-badge');
    expect(b).toContain('data-testid="exam-koh-result-view"');
    expect(b).toContain('data-testid="exam-blood-result-upload"');
    expect(b).toContain('data-testid="exam-blood-result-view"');
    // 旣 '결과 생성'(외부 페이지 이동) 버튼은 발급하기로 대체됨 — 잔존 0.
    expect(b).not.toContain('data-testid="exam-koh-result-new"');
    // 이름 좌/우클릭 위임 보존
    expect(b).toContain('nameInteraction.onLeftClick(r.customerId)');
    expect(b).toContain('nameInteraction.onContextMenu');
  });

  test('회귀: ADDITIVE 컬럼 미적용 prod 폴백 보존(42703) + 빈 목록', () => {
    const b = sectionB();
    expect(b).toMatch(/42703/);
    expect(b).toContain('data-testid="exam-targets-empty"');
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 — 티켓 시나리오1/2):
 *   1. 로그인 → 환자 선택 → '치료 테이블' → '균검사 & 피검사 대상자' 탭 펼침.
 *   2. 채취부위(예 R1, L2) 버튼 선택 → '발급하기' → 균검사지 발급/생성 확인.
 *   3. 진료 대시보드 → 균검사지: 채취조갑 선택 UI·발급하기 버튼 없음(읽기전용) +
 *      신청유무/채취부위(R1)/발급여부(발행완료) 표기 + 치료테이블 발급이 즉시 반영(동일 데이터 소스).
 *   4. 치료테이블 탭에서 균검사/피검사가 두 줄(점선 분리)로 표기 — 한 줄에 섞이지 않음.
 *
 * 비고: §11 medical_confirm_gate = confirmed(문원장, U0ALGAAAJAV). NO-DDL. db_change=false.
 */
