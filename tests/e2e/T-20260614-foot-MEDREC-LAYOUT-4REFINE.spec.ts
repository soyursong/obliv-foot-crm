/**
 * E2E spec — T-20260614-foot-MEDREC-LAYOUT-4REFINE
 * 진료기록 패널(MedicalChartPanel) 레이아웃 정밀 수정 4항목 — 같은 패널 5차+ 연속 피드백.
 * reporter: 문지은 대표원장 (U0ALGAAAJAV).
 *
 * 항목:
 *   AC-1: 임상경과 + 의료진전용메모 좌측 세로줄(border-left) 제거
 *   AC-2: 치료사차트 + 치료메모 너비를 아래 임상경과/의료진전용메모와 동일 비율(4:1)로 정렬
 *   AC-3: 처방내역 우측상단 안내 멘트('우측 패널에서 처방세트 선택') 제거 → 미리보기만 유지
 *   AC-4: 진료일+진료의를 딱 한 줄(single row)에 — 헤더+내용 2단 구조 금지
 *
 * ⚠ AC-4 REDEFINITION (§13.1.A): T-20260612-MEDREC-DATE-DIAG-UI-REFINE ②(우측정렬)를 supersede.
 *   근본원인 = 각 필드 라벨이 block(라벨 위)+입력칸(아래) = 필드마다 '헤더+내용 2단'. 직전 수정들은
 *   두 필드를 좌우 배치만 했지 라벨 stacking 을 못 없앴음. → 라벨 block→inline 전환이 핵심 가드.
 *
 * 스타일: 형제 티켓(MEDREC-DATE-DIAG-UI-REFINE)과 동일 — 정본 소스 정적 가드(auth/DB 비의존, 결정론적).
 *   이 패널은 연속변형 핫스팟이라 시드/권한 의존 라이브 시나리오는 flaky → presence/absence 가드로
 *   AC를 결정론적으로 고정. 라이브 실화면 최종판정은 dev 자가 preview 스크린샷 + supervisor QA.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/MedicalChartPanel.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 임상경과 + 의료진전용메모 좌측 세로줄(border-left) 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 임상경과·의료진전용메모 좌측 세로줄 제거', () => {
  test('임상경과 컬럼 wrapper에 border-l-2 미존재(소헤더로 식별)', () => {
    const src = PANEL();
    // 임상경과 textarea(좌·flex-4) 컬럼 wrapper — border-l-2 + pl-3 제거.
    expect(src).toMatch(/<div className="sm:flex-\[4\] min-w-0">\s*\{\/\* T-20260612-foot-MEDREC-DATE-DIAG-UI-REFINE ⑤/);
    // 임상경과 소헤더는 유지(식별 수단).
    expect(src).toContain('<h4 className="text-xs font-medium text-gray-700">임상경과</h4>');
  });
  test('의료진 전용메모 컬럼 wrapper에 border-l-2 미존재(소헤더로 식별)', () => {
    const src = PANEL();
    expect(src).toContain('<div className="sm:flex-[1] min-w-0 flex flex-col" data-testid="doctor-memo-section">');
    expect(src).toContain('>의료진 전용메모</h4>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 치료사차트(좌·flex-4)|치료메모(우·flex-1) — 아래 임상경과/의료진메모와 동일 비율
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 치료사차트·치료메모 너비 정렬(4:1)', () => {
  test('치료사차트(좌) flex-[4], 치료메모(우) flex-[1] — 아래 NOTES 2단과 동일 비율', () => {
    const src = PANEL();
    // 치료 row(좌 치료사차트): flex-[4].
    expect(src).toMatch(/<div className="sm:flex-\[4\] min-w-0">\s*<div className="flex items-center gap-2 mb-1">\s*<label className="text-xs font-semibold text-muted-foreground">치료사차트<\/label>/);
    // 치료 row(우 치료메모): flex-[1].
    expect(src).toMatch(/<div className="sm:flex-\[1\] min-w-0">\s*<div className="flex items-center gap-2 mb-1">\s*<label className="text-xs font-semibold text-muted-foreground">치료메모<\/label>/);
    // 회귀 가드: 더 이상 1:1 균등(sm:flex-1)이 아님.
    expect(src).not.toMatch(/<div className="sm:flex-1 min-w-0">\s*<div className="flex items-center gap-2 mb-1">\s*<label[^>]*>치료사차트/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 처방내역 우측상단 안내 멘트 제거 → 미리보기(formRx 테이블/빈 상태)만 유지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 처방내역 우측상단 안내 멘트 제거', () => {
  test('"우측 패널에서 처방세트 선택" 우측상단 span 제거 + 미리보기 유지', () => {
    const src = PANEL();
    // 우측상단 보조 span 제거(헤더 라벨 우측에 붙던 안내).
    expect(src).not.toContain('<span className="text-[10px] text-muted-foreground">우측 패널에서 처방세트 선택</span>');
    // 처방내역 헤더는 라벨만(justify-between → 단순 flex).
    expect(src).toMatch(/<div className="flex items-center mb-1 min-h-\[1\.125rem\]">\s*<label className="text-xs font-semibold text-muted-foreground">처방내역<\/label>\s*<\/div>/);
    // 미리보기 유지: 처방 테이블 + 빈 상태.
    expect(src).toContain('data-testid="prescription-items-table"');
    expect(src).toContain('처방내역 없음');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 진료일+진료의 딱 한 줄(single row) — 헤더+내용 2단 금지
//   근본원인 가드: 라벨이 block(stacking)이 아니라 inline(라벨·값 같은 줄)이어야 함.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 진료일·진료의 단일 행(라벨 inline)', () => {
  test('진료일 라벨이 block-stacking이 아닌 inline(whitespace-nowrap) — 값과 한 줄', () => {
    const src = PANEL();
    // 진료일 라벨: block/mb-1(헤더 위 stacking) 제거 → inline whitespace-nowrap.
    expect(src).toMatch(/<label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">진료일<\/label>\s*<Input\s*type="date"/);
    // 진료일 라벨+입력칸이 같은 flex items-center 행 안.
    expect(src).toMatch(/<div className="flex items-center gap-2 min-w-0">\s*<label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">진료일/);
    // 회귀 가드: 더 이상 block label + mb-1(헤더 위 stacking)이 아님.
    expect(src).not.toContain('<label className="block text-xs font-semibold text-muted-foreground mb-1 text-left">진료일</label>');
  });
  test('담당 의사 라벨도 inline + select와 한 줄, 경고문만 select 아래로', () => {
    const src = PANEL();
    expect(src).toMatch(/<label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">담당 의사<\/label>\s*<div className="flex flex-col min-w-0">\s*<select/);
    // 회귀 가드: 더 이상 block label + sm:text-right(헤더 위 stacking/우측정렬)가 아님.
    expect(src).not.toContain('<label className="block w-full text-xs font-semibold text-muted-foreground mb-1 sm:text-right">');
    // 단일 행 wrapper: flex items-center(2단 flex-col 아님).
    expect(src).toMatch(/<div className="flex flex-wrap items-center gap-x-6 gap-y-1" data-testid="chart-date-doctor-row">/);
    // 진료의 NOT NULL 게이트(저장 로직) 보존.
    expect(src).toContain('data-testid="signing-doctor-warning"');
    expect(src).toContain('clinicDoctors.map');
  });
});
