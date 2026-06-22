/**
 * E2E spec — T-20260614-foot-DOCPATIENTLIST-COLWIDTH-EXPAND-QUICKEDIT (문지은 대표원장)
 * 진료 환자목록 테이블(진료 알림판 DoctorCallDashboard, 대기/완료 양 테이블) 정비.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec(POSTDEPLOY-REFINE-5 등) 컨벤션 동일.
 *
 * AC-1 컬럼폭: 식별컬럼군(방·상태·이름·생년·차트번호 = 앞 5칸) 합 ≤ 50%(테이블 절반).
 *         남는 ≥50%를 본문(처방완료·임상경과) 컬럼에 넓게 배분 — 처방이 최대 데이터 컬럼.
 *         (대기 colgroup: 5·9·11·9·8·9·6·24·14·5 / 완료: 5·10·12·9·8·9·6·25·16, 각 합 100%)
 * AC-2 (PARADIGM 재정의, 문지은 대표원장 MSG-20260614-213335-rdin): 처방완료·임상경과 셀 본문 클릭 →
 *         '해당 컬럼 폭 범위 안에서만' 셀 바로 아래 드롭다운/팝오버처럼 펼침(읽기). 다른 컬럼(환자명·시간·생년) 비가림.
 *         종전 '행 전체폭 펼침행(<tr colSpan>)'(05b0453) 폐기 → ColumnExpandPopover(앵커 셀 폭 = 컬럼 폭, portal fixed)로 리워크.
 *         바깥클릭 닫힘 = CHART-CLINICAL-CLICKOUTSIDE(mousedown) 패턴 재사용. 처방 표기 1/3/2 토큰(RX-TOKEN-FORMAT) 유지.
 * AC-3 빠른수정: 처방완료 연필버튼 → 빠른수정(차트 풀오픈 없이 즉석 처방수정). apply mutation 무변경.
 *         클릭 affordance 분리: 본문 클릭=펼침(읽기) / 연필버튼=빠른수정·취소 메뉴.
 *
 * ⚠ GUARD: DB 무변경(폭·펼침·빠른수정 전부 표시/기존 mutation 레이어). 신규 펼침/수정 컴포넌트 신설 0
 *   — RxConfirmedSummary(QuickRxBar 모듈) 확장 + 기존 QuickRxBar apply 재사용. colgroup 합 100% 유지.
 *   레거시 소비처(DoctorPatientList, onToggleExpand 미제공)는 split 미진입 — 회귀 0.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const QRX = () => SRC('components/doctor/QuickRxBar.tsx');
// T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: ColumnExpandPopover 가 DoctorCallDashboard 로컬 정의 → 공유 모듈로 추출됨.
//   팝오버 내부 구현(폭계산·portal·mousedown)은 본 모듈에서, DoctorCallDashboard 는 import·사용을 검증.
const POP = () => SRC('components/doctor/ColumnExpandPopover.tsx');

// 특정 <colgroup> 블록에서 w-[N%] 폭 순서를 뽑는다.
function colWidths(block: string): number[] {
  return [...block.matchAll(/w-\[(\d+)%\]/g)].map((m) => Number(m[1]));
}
function colgroupAfter(s: string, anchor: string): number[] {
  const start = s.indexOf(anchor);
  const cgStart = s.indexOf('<colgroup>', start);
  const cgEnd = s.indexOf('</colgroup>', cgStart);
  return colWidths(s.slice(cgStart, cgEnd));
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 컬럼폭: 식별군 ≤ 절반, 본문(처방·임상경과) 넓게
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ STALE-RECONCILE (T-20260615-foot-DOCDASH-COLGROUP-E2E-STALE-RECONCILE, 가설A):
//   EXPAND-QUICKEDIT 배포본([5,9,11,9,8,9,6,24,14,5]/[5,10,12,9,8,9,6,25,16]) 이후 5개 후속 티켓이
//   B colgroup 을 '합법' 진화시킴: RATIO-TUNE → STATNAME-WIDEN-CENTER → WAITDONE-ALIGN →
//   NAME-EMOJI-CLINICAL-3FIX('차트' 칼럼 제거 10→9col) → RX-DISPLAY-REVAMP(처방×1.5).
//   배포 정본(commit aa2e7819) 실측 = 9칼럼 [4,8,7,9,8,9,18,32,5] 합100 (feed==completed).
//   합100 & 시각정상 → 기대값을 deployed truth 로 갱신. AC-1 '처방 최대' 는 본문우선 재분배로
//   임상경과 최대로 supersede. 식별군≤50% invariant 는 유지.
const TRUTH = [4, 8, 7, 9, 8, 9, 18, 32, 5]; // 방·상태·이름·생년·차트번호·오늘시술·처방·임상경과·시간
test.describe('AC-1 컬럼폭 — 식별군 ≤50%, 본문 확대', () => {
  test('대기(호출) colgroup: 식별군 합 36(≤50) · 임상경과 최대 · 합 100', () => {
    const widths = colgroupAfter(DASH(), 'doctor-call-feed-table');
    expect(widths).toEqual(TRUTH);
    // 식별컬럼군 = 앞 5칸(방·상태·이름·생년·차트번호) ≤ 테이블 절반.
    const idGroup = widths.slice(0, 5).reduce((a, b) => a + b, 0);
    expect(idGroup).toBe(36);
    expect(idGroup).toBeLessThanOrEqual(50);
    // 남는 비중(식별군 제외)이 ≥50% — 본문 컬럼에 배분.
    expect(100 - idGroup).toBeGreaterThanOrEqual(50);
    // 본문우선 재분배(supersede): 임상경과(idx7)가 가장 넓은 데이터 컬럼.
    expect(widths[7]).toBe(Math.max(...widths));
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('완료 colgroup: 대기와 동일 9칼럼 · 임상경과32 최대 · 합 100', () => {
    const widths = colgroupAfter(DASH(), 'doctor-completed-table');
    expect(widths).toEqual(TRUTH);
    const idGroup = widths.slice(0, 5).reduce((a, b) => a + b, 0);
    expect(idGroup).toBe(36);
    expect(idGroup).toBeLessThanOrEqual(50);
    expect(100 - idGroup).toBeGreaterThanOrEqual(50);
    expect(widths[7]).toBe(32);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
    // WAITDONE-ALIGN: 완료 colgroup == 대기 colgroup.
    expect(widths).toEqual(colgroupAfter(DASH(), 'doctor-call-feed-table'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 처방완료 셀 본문 클릭 → 컬럼앵커 드롭다운 펼침(다른 컬럼 비가림, 토큰 1/3/2 유지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 PARADIGM — 처방완료 펼침: 컬럼앵커 드롭다운 + 비가림', () => {
  test('대기(CallFeedRow): 본문 클릭 토글 + 컬럼앵커 팝오버 + RX-TOKEN-FORMAT', () => {
    const s = DASH();
    expect(s).toContain('setExpandRx');
    expect(s).toContain('onToggleExpand={() => setExpandRx');
    // 컬럼앵커 드롭다운(ColumnExpandPopover) 로 펼침 — 셀(rxCellRef) 앵커.
    expect(s).toContain('doctor-call-rx-expand-pop');
    expect(s).toContain('doctor-call-rx-expand');
    expect(s).toContain('anchorRef={rxCellRef}');
    // 처방 전문은 1/3/2 토큰(formatRxItemToken) 으로 — raw text 금지.
    expect(s).toContain('formatRxItemToken');
    // PARADIGM: 행 전체폭 펼침행(<tr colSpan>) 폐기 — 무효 testId 잔존 금지.
    expect(s).not.toContain('doctor-call-rx-expand-row');
  });

  test('완료(CompletedRow): 컬럼앵커 팝오버 + 토큰 동일 적용', () => {
    const s = DASH();
    expect(s).toContain('doctor-completed-rx-expand-pop');
    expect(s).toContain('doctor-completed-rx-expand');
    expect(s).not.toContain('doctor-completed-rx-expand-row');
    // CompletedRow 도 동일 토큰 경로(formatRxItemToken) 사용 — 양 테이블 정합.
    const occ = [...s.matchAll(/formatRxItemToken/g)].length;
    expect(occ).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 임상경과 셀 본문 클릭 → 컬럼앵커 드롭다운 펼침(다른 컬럼 비가림)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 PARADIGM — 임상경과 펼침: 컬럼앵커 드롭다운 + 비가림', () => {
  test('대기·완료: 임상경과 펼침 버튼 + 컬럼앵커 팝오버 + 입력 토글(📝) 보존', () => {
    const s = DASH();
    expect(s).toContain('doctor-call-clinical-expand-btn');
    expect(s).toContain('doctor-call-clinical-expand-pop');
    expect(s).toContain('anchorRef={clinicalCellRef}');
    expect(s).toContain('doctor-completed-clinical-expand-btn');
    expect(s).toContain('doctor-completed-clinical-expand-pop');
    // PARADIGM: 행 전체폭 펼침행(<tr colSpan>) 폐기.
    expect(s).not.toContain('doctor-call-clinical-expand-row');
    expect(s).not.toContain('doctor-completed-clinical-expand-row');
    // 펼침은 읽기 전용 전문 보존 + 컬럼 폭 내 줄바꿈.
    expect(s).toContain('whitespace-pre-wrap');
    // 입력용 임상경과(singleLine 📝) 토글은 별개 축으로 보존(회귀 0).
    expect(s).toContain('setShowClinical');
  });

  test('GUARD 비가림: ColumnExpandPopover 폭=앵커 셀(컬럼) 폭, portal fixed, mousedown 바깥클릭 닫힘', () => {
    // 컬럼앵커 팝오버 단일 컴포넌트로 리워크(신규 토글 난립 0).
    //   T-20260620-foot-DOCDASH-DOCREQ-TABLEVIEW: 공유 모듈로 추출 — 내부 구현은 POP(), 소비는 DASH() 가 검증.
    const p = POP();
    expect(p).toContain('export function ColumnExpandPopover');
    // 폭 = 앵커 셀(컬럼) 폭 → 가로로 다른 컬럼 침범 0(비가림 보장).
    expect(p).toContain('const width = Math.min(r.width');
    // body portal + position fixed (행을 밀지 않음).
    expect(p).toContain('position: \'fixed\'');
    expect(p).toContain('document.body');
    // 바깥클릭 닫힘 = CHART-CLINICAL-CLICKOUTSIDE mousedown 패턴 재사용.
    expect(p).toContain('mousedown');
    // 길면 컬럼 폭 안에서 세로 스크롤.
    expect(p).toContain('overflow-y-auto');
    // DoctorCallDashboard 는 공유 컴포넌트를 import·사용(로컬 재정의 없음).
    const s = DASH();
    expect(s).toContain("from '@/components/doctor/ColumnExpandPopover'");
    expect(s).toContain('<ColumnExpandPopover');
    expect(s).not.toContain('function ColumnExpandPopover(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4 — 빠른수정: 연필 → 빠른수정(차트 풀오픈 X), apply mutation 무변경
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 빠른수정 — 연필 즉석 처방수정', () => {
  test('split 모드: 본문(펼침)·연필(수정/취소) affordance 분리', () => {
    const s = QRX();
    // onToggleExpand 제공 시에만 split 진입 → 레거시 소비처 회귀 0.
    expect(s).toContain('const splitMode = typeof onToggleExpand === \'function\'');
    expect(s).toContain('if (splitMode)');
    // 본문 클릭 = 펼침(읽기), 연필 = 액션.
    expect(s).toContain('rx-confirmed-done');
    expect(s).toContain('rx-confirmed-edit-btn');
  });

  test('연필 메뉴: 빠른수정 + 처방취소(executeCancel) 양 분기', () => {
    const s = QRX();
    expect(s).toContain('rx-confirmed-menu');
    expect(s).toContain('rx-confirmed-menu-quickedit');
    expect(s).toContain('rx-confirmed-menu-cancel');
    expect(s).toContain('executeCancel');
  });

  test('빠른수정 팝오버: 인라인 QuickRxBar(apply 재사용) — 차트 풀오픈 분기 아님', () => {
    const s = QRX();
    expect(s).toContain('rx-confirmed-quickedit');
    // 빠른수정 팝오버는 QuickRxBar(apply mutation) 를 인라인 렌더 — onApplied 로 닫힘.
    const popStart = s.indexOf('rx-confirmed-quickedit"');
    const popEnd = s.indexOf('document.body', popStart);
    const pop = s.slice(popStart, popEnd);
    expect(pop).toContain('<QuickRxBar');
    expect(pop).toContain('onApplied');
    // 빠른수정 액션 자체는 setEditPos(팝오버 열기)지 onOpenChart 호출이 아님 — 메뉴 항목에서 검증.
    const menuStart = s.indexOf('rx-confirmed-menu-quickedit');
    const menuEnd = s.indexOf('</button>', menuStart);
    expect(s.slice(menuStart, menuEnd)).toContain('setEditPos');
  });

  test('GUARD: 빠른수정/취소가 apply·cancel mutation 을 신설하지 않음(기존 재사용)', () => {
    const s = QRX();
    // 신규 mutation 훅 추가 없이 기존 경로 재사용.
    expect(s).toContain('executeCancel');
    // 레거시(non-split) 동선 보존 — actionMenu 드롭다운(수정→차트/취소) 유지.
    expect(s).toContain('rx-confirmed-menu-edit'); // 레거시 차트수정 항목
  });
});
