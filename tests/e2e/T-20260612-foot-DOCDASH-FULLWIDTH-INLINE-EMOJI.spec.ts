/**
 * E2E spec — T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI
 * 진료대시보드(DoctorCallDashboard) 테이블 풀폭·타이포·여백 + 이름옆 임상경과/진료차트 이모지 인라인버튼
 *   + 끝 임상경과 미리보기 유지 + 진료차트 칼럼 제거 + [추가] 처방/임상경과 컬럼 폭 확대·처방 드롭다운
 *   알약근접폭·처방 셀 미리보기·알약버튼→파란글씨 '처방완료' (문지은 대표원장).
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일.
 *
 * AC-1  테이블 풀폭(max-w 제한 해제, w-full) + 폰트 상향(text-[15px]) + 여백 축소(p-2/md:p-3)
 * AC-2  이름 옆(상태 전) 임상경과(📝)/진료차트(🩺) 이모지 버튼(테두리형) — 기존 저장경로/라우트 재사용
 * AC-3  끝 임상경과 칼럼 미리보기 전용(입력 UI 없음) + 진료차트 별도 칼럼 제거(colspan 8/7 재계산)
 * item6 처방·임상경과 칼럼 우선 폭 확대(처방 20/24%, 임상경과 22/23%)
 * item7 처방 드롭다운 행 전체폭 → 처방칼럼 근접폭(우측 anchor, max-w-xs)
 * item8 처방 셀 약명 인라인 미리보기(RxConfirmedSummary summary, RXSET 표시모델 재사용)
 * item9 알약버튼 → 파란글씨 '처방완료'(plainText, 버튼 chrome 제거)
 *
 * ⚠ GUARD: 임상경과 인라인 저장경로(CLINICAL-INLINE-REFINE) / 진료차트 열기 라우트(onOpenChart 'full') /
 *   11FIX AC-11(임상경과 칼럼)·AC-12(시술 칼럼) / 진료의 NOT NULL / 처방게이트(QUICKRX-INCLINIC-GATE) 회귀 금지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');
const TOOLS = () => SRC('pages/DoctorTools.tsx');
const RXBAR = () => SRC('components/doctor/QuickRxBar.tsx');

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 풀폭 · 폰트 · 여백
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 — 테이블 풀폭/폰트/여백', () => {
  test('DoctorTools 컨테이너 max-w 제한 해제 + w-full + 여백 축소', () => {
    const s = TOOLS();
    // 실제 className 에서 너비 제한(max-w-5xl) 제거 — 코멘트 언급은 무관(className 패턴으로 정밀 검증).
    expect(s).not.toContain('space-y-4 max-w-5xl');
    expect(s).toContain('p-2 md:p-3 space-y-4 w-full');
  });

  test('두 테이블 모두 text-[15px] 폰트 상향', () => {
    const s = DASH();
    const m = s.match(/data-testid="doctor-call-feed-table"[^>]*/);
    expect(s).toContain('text-[15px]" data-testid="doctor-call-feed-table"');
    expect(s).toContain('text-[15px]" data-testid="doctor-completed-table"');
    expect(m).toBeTruthy();
  });

  test('셀 패딩 축소 — 밀도 압축(px-1.5 py-1)', () => {
    const s = DASH();
    // CLINIC3-TABLEDENSITY-TIGHTEN supersede(밀도 압축, 4~6px 여백): px-2 py-1.5 → px-1.5 py-1.
    // 헤더 셀은 px-1.5 py-1 로 추가 축소되었어야 함(드롭다운 expand 행 px-3 는 예외).
    expect(s).toContain('<th className="px-1.5 py-1">이름</th>');
    expect(s).toContain('<th className="px-1.5 py-1">처방</th>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 이름 옆 임상경과/진료차트 이모지 버튼
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 — 이름 옆 이모지 인라인 버튼', () => {
  // MONOTONE-RELAYOUT supersede(대표원장 반전 요청): 이름 옆 이모지 버튼(NAME_EMOJI_BTN) →
  //   신설 '차트' 칼럼(CHART_CELL_EMOJI_BTN, 테두리형)으로 이동. 이름 옆 NAME_EMOJI_BTN 폐지.
  test('이모지 버튼 토큰 = 차트 칼럼 CHART_CELL_EMOJI_BTN(테두리형) — 구 NAME_EMOJI_BTN 폐지', () => {
    const s = DASH();
    expect(s).not.toContain('NAME_EMOJI_BTN');
    const def = s.slice(s.indexOf('const CHART_CELL_EMOJI_BTN'));
    expect(def).toContain('border');
    expect(def).toContain('rounded');
  });

  test('임상경과 이모지(📝) → showClinical 토글(기존 인라인 저장경로 재사용)', () => {
    const s = DASH();
    expect(s).toContain('📝');
    // 이모지 버튼이 setShowClinical 토글을 호출(새 저장경로 신설 아님)
    expect(s).toMatch(/onClick=\{\(\) => setShowClinical\(\(v\) => !v\)\}/);
  });

  test('진료차트 이모지(🩺) → onOpenChart full(기존 라우트 재사용)', () => {
    const s = DASH();
    expect(s).toContain('🩺');
    expect(s).toContain("onOpenChart(checkIn.customer_id, 'full')");
  });

  test('이모지 버튼 2종 testid 존재(call/completed)', () => {
    const s = DASH();
    expect(s).toContain('doctor-call-fullchart-btn');
    expect(s).toContain('doctor-completed-fullchart-btn');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 끝 임상경과 미리보기 + 진료차트 칼럼 제거 + colspan 재계산
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 — 임상경과 미리보기 유지 + 진료차트 칼럼 제거', () => {
  // MONOTONE-RELAYOUT supersede(FULLWIDTH 진료차트 칼럼 제거 반전): 차트 칼럼 재신설 → 9 / 8.
  // CALLUX-3FIX supersede(생년(만나이) 칼럼 신설): 칼럼 +1 → 대기 10 / 완료 9.
  //   대기 10칼럼 = 방·상태·이름·생년·차트번호·오늘시술·차트·처방·임상경과·시간.
  test('colspan = 생년 칼럼 신설 반영(10 / 9)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 10;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 9;');
  });

  test('진료차트 별도 칼럼 헤더 제거(thead 내 "진료차트" th 잔존 0)', () => {
    const s = DASH();
    expect(s).not.toContain('<th className="px-2 py-1.5">진료차트</th>');
    expect(s).not.toContain('<th className="px-3 py-1.5">진료차트</th>');
  });

  test('끝 임상경과 셀은 미리보기 전용(셀 내 임상경과 입력 토글 버튼 없음)', () => {
    const s = DASH();
    // 끝 임상경과 칼럼 셀에 clinicalPreview 미리보기 렌더
    expect(s).toContain('data-testid="doctor-call-clinical-cell"');
    expect(s).toContain('clinicalPreview');
    // 임상경과 입력은 이름 옆 📝 버튼 단일 경로로 이동(셀 내 'doctor-*-chart-btn'은 이름 셀에만)
    expect(s).toContain('clinicalPreview: string | null;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item6 — 처방·임상경과 칼럼 우선 폭 확대
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item6 — 처방/임상경과 폭 확대', () => {
  // MONOTONE-RELAYOUT supersede: 칼럼 재배치 + 차트 칼럼 신설로 폭 재분배 → FULLWIDTH 전용 폭(20/22·24/23) 폐지.
  test('MONOTONE 폭 재분배 — FULLWIDTH 전용 폭 폐지 + 차트 칼럼(w-[7%]) 신설(양 섹션)', () => {
    const s = DASH();
    expect(s).not.toContain('<col className="w-[20%]" />');
    expect(s).not.toContain('<col className="w-[24%]" />');
    // 차트 칼럼(호출/완료 동일 7%) 신설 — 양 colgroup 각 1개.
    expect((s.match(/<col className="w-\[7%\]" \/>/g) ?? []).length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item7 — 처방 드롭다운 알약 근접폭
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item7 — 처방 드롭다운 폭 축소', () => {
  // RXCELL-REFINE(item2/AC-2) supersede: 처방 드롭다운 = 풀폭 펼침행 → 알약 anchor portal+fixed 팝오버.
  //   폭 축소 의도 보존(RX_POPOVER_W=320 ≈ max-w-xs 20rem). 구 mr-[2x%] 풀폭 anchor 폐지.
  test('처방 드롭다운 폭 축소 = 알약 anchor portal 팝오버(RX_POPOVER_W) 보존', () => {
    const s = DASH();
    expect(s).toContain('const RX_POPOVER_W = 320');
    expect(s).toContain('anchorRef');
    expect(s).not.toMatch(/mr-\[2[23]%\]/); // 구 풀폭 anchor 폐지
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item8/9 — 처방 셀 미리보기 + 파란글씨 처방완료
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item8/9 — 처방 셀 미리보기 + 파란글씨 처방완료', () => {
  test('RxConfirmedSummary plainText prop 정의', () => {
    const s = RXBAR();
    expect(s).toContain('plainText = false');
    expect(s).toContain('plainText?: boolean;');
  });

  test('plainText 분기: 파란글씨(text-sky-600) · 버튼 chrome(border/bg) 제거', () => {
    const s = RXBAR();
    expect(s).toContain('text-sky-600');
    // plainText 분기에는 bg-transparent(버튼 배경 제거)
    expect(s).toContain('bg-transparent');
  });

  test('대시보드 처방 셀: 확정 시 plainText 처방완료, 미처방 시에만 알약 버튼', () => {
    const s = DASH();
    expect(s).toContain('plainText');
    // 확정 분기에서 RxConfirmedSummary 사용 + 미처방 분기에서 처방 버튼
    expect(s).toContain("checkIn.prescription_status === 'confirmed' ?");
    expect(s).toContain('doctor-call-rx-btn');
  });

  test('약명 미리보기는 RXSET 표시모델(formatRxConfirmedSummary) 재사용(신규 표시 규칙 신설 0)', () => {
    const s = RXBAR();
    expect(s).toContain('formatRxConfirmedSummary');
    expect(s).toContain('data-testid="rx-confirmed-drugs"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD — 회귀 가드
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GUARD — 회귀 0', () => {
  test('진료의 NOT NULL 강제(임상경과 저장경로) — MedicalChartPanel singleLine 재사용 유지', () => {
    const s = DASH();
    expect(s).toContain('showClinical');
    // 임상경과 인라인 행은 customer_id 가드 + 기존 저장경로
    expect(s).toContain('showClinical && checkIn.customer_id');
  });

  test('처방 게이트(checkRxInClinic/inClinicRxGate) import 보존', () => {
    const s = DASH();
    expect(s).toContain('inClinicRxGate');
  });

  test('11FIX AC-12 시술 별도 칼럼(ProcedureCell) 보존', () => {
    const s = DASH();
    expect(s).toContain('ProcedureCell');
    expect(s).toContain('data-testid="doctor-procedure-cell"');
  });
});
