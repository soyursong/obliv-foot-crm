/**
 * E2E spec — T-20260609-foot-DOCDASH-LABEL-RX-REFINE
 * 진료대시보드/진료환자목록/환자창 field-soak 재피드백 정제 (문지은 대표원장 6/9).
 *
 * 검증 대상 (buildable 4건 + item3 구조):
 *   item1: 진료대시보드 진입 헤더 라벨 '진료 도구' → '진료대시보드' (라벨 오기 교정)
 *   item2: 환자 창(확정 처방 요약) 헤더 라벨 '처방완료' → '처방 내용' (DoctorPatientList 한정,
 *          RxConfirmedSummary label prop. DoctorCallDashboard 등 다른 소비처는 기본값 '처방완료' 유지=무회귀)
 *   item3: 처방 약 한 줄 표기 — formatRxConfirmedSummary 가 `{name} {freq} *` 한 줄 `*` 구분자 포맷 유지
 *          (구조는 이미 deployed. `1/3/2` 토큰 매핑은 planner FOLLOWUP 대기 — 본 spec은 구조 회귀 가드)
 *   item4: 진료환자목록 이름·처방 O/X 배지 가로 중앙정렬(text-center / justify-center). grid 컬럼 보존.
 *   item6: 필터 '처방없음'(none) → '처방나감'(confirmed). 술어 방향 교정 = 처방전 있는(확정) 환자만 노출.
 *
 * 스타일: 형제 티켓(DOCPATIENTLIST-SORT-LAYOUT)과 동일 — 구현 정본을 in-page 순수 로직으로 모사 +
 *   소스 파일 정적 검증(라벨/정렬 회귀 가드). auth/DB 비의존(unit 프로젝트).
 *
 * ⚠ REDEFINITION_RISK(비파괴): 같은 surface 오늘 4건 deployed/in-flight.
 *   기존 산출물(MEDDASH/DOCPATIENTLIST-SORT/CHARTBTN/DOCDASH-CHART-UX) 보존 위 적층 — 회귀 가드 포함.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: 처방 필터 술어 (DoctorPatientList.filtered) ─────────────────────
//   item6: 'none'(처방없음) 제거, 'confirmed'(처방나감) 신설 — 처방전 있는(확정) 환자만.
type Filter = 'all' | 'pending' | 'confirmed';
type RxStatus = 'none' | 'pending' | 'confirmed';
const passesFilter = (filter: Filter, status: RxStatus): boolean => {
  if (filter === 'pending') return status === 'pending';
  if (filter === 'confirmed') return status === 'confirmed';
  return true; // all
};

// ── 정본 모사: formatRxConfirmedSummary (lib/rxTooltip.ts) ─────────────────────
//   item3: 다중 약 한 줄, `{name} {freq} *` (freq 결측 시 `{name} *`), 구분자 ' '(각 약 끝 ' *').
interface RxItemLike { name?: string | null; frequency?: string | null }
const formatRxConfirmedSummary = (items: RxItemLike[] | null | undefined): string => {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      const name = (it?.name ?? '').trim() || '(이름 미입력)';
      const freq = (it?.frequency ?? '').trim();
      return freq ? `${name} ${freq} *` : `${name} *`;
    })
    .join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — item1: 진료대시보드 헤더 라벨 오기 교정
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 item1 — 진료대시보드 헤더 라벨', () => {
  test('DoctorTools 헤더 h1 = "진료대시보드" (오기 "진료 도구" 잔존 0)', () => {
    const src = SRC('pages/DoctorTools.tsx');
    expect(src).toContain('<h1 className="text-lg font-bold">진료대시보드</h1>');
    // 헤더 h1 에 옛 라벨이 남아있지 않아야 (탭 트리거 '진료 알림판'/'진료 환자 목록'은 무관 — 보존)
    expect(src).not.toContain('<h1 className="text-lg font-bold">진료 도구</h1>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — item2: 환자 창 '처방 내용' 라벨 (DoctorPatientList 한정 / 무회귀)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 item2 — 처방 내용 라벨 주입(무회귀)', () => {
  test('RxConfirmedSummary 가 label prop 수용 + 기본값 "처방완료"', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // label prop 도입 + 기본값 처방완료 (DoctorCallDashboard 무전달 → 종전 표기 유지)
    expect(src).toMatch(/label\s*=\s*'처방완료'/);
    // 버튼 텍스트가 하드코딩 '처방완료' 대신 {label} 로 렌더
    expect(src).toContain('{label}');
  });

  test('DoctorPatientList 가 확정요약에 label="처방 내용" 전달', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    expect(src).toContain('label="처방 내용"');
  });

  test('회귀: DoctorCallDashboard 는 label 미전달 → 기본 "처방완료" 유지', () => {
    const src = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 다른 surface 소비처에 '처방 내용' 라벨이 새어들지 않음(무회귀)
    expect(src).not.toContain('label="처방 내용"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — item3: 처방 약 한 줄 `*` 표기 (구조 회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 item3 — 약 한 줄 표기 포맷', () => {
  test('다중 약 → 한 줄, 약 간 `*` 구분자 (약A f1 * 약B f2 *)', () => {
    const out = formatRxConfirmedSummary([
      { name: '약A', frequency: '1/3/2' },
      { name: '약B', frequency: '' },
    ]);
    expect(out).toBe('약A 1/3/2 * 약B *');
    // 줄바꿈 없는 단일 라인
    expect(out).not.toContain('\n');
  });

  test('freq 결측 → `{name} *` (댕글링 공백 없음)', () => {
    expect(formatRxConfirmedSummary([{ name: '단독약' }])).toBe('단독약 *');
  });

  test('빈/비배열 → 빈 문자열 (안전)', () => {
    expect(formatRxConfirmedSummary([])).toBe('');
    expect(formatRxConfirmedSummary(null)).toBe('');
    expect(formatRxConfirmedSummary(undefined)).toBe('');
  });

  test('정본(lib/rxTooltip.ts)이 한 줄 `*` 포맷 유지 (구조 회귀 가드)', () => {
    const src = SRC('lib/rxTooltip.ts');
    expect(src).toContain('export function formatRxConfirmedSummary');
    expect(src).toMatch(/\$\{name\}\s*\$\{freq\}\s*\*/); // `${name} ${freq} *`
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4 — item4: 이름·처방배지 가로 중앙정렬 (grid 컬럼 보존)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S4 item4 — 이름·배지 중앙정렬', () => {
  const src = () => SRC('components/doctor/DoctorPatientList.tsx');

  test('이름 셀 text-center (가로 중앙)', () => {
    expect(src()).toContain('className="text-sm font-semibold truncate text-center"');
  });

  test('처방배지 셀 flex justify-center (justify-start 잔존 0)', () => {
    const s = src();
    // 배지 래퍼가 justify-center
    expect(s).toContain('{/* ③ 처방 상태 배지');
    expect(s).toMatch(/처방 상태 배지[\s\S]*?<div className="flex justify-center">/);
  });

  test('회귀: grid 컬럼 정의 7트랙 보존 + items-center(세로 중앙) 유지', () => {
    const s = src();
    expect(s).toContain('grid grid-cols-[1.75rem_3rem_5rem_5.5rem_3.75rem_minmax(0,1fr)_auto] items-center');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5 — item6: '처방나감' 필터 (술어 방향 교정)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S5 item6 — 처방나감 필터', () => {
  test('confirmed 필터 → 처방전 있는(확정) 환자만 통과', () => {
    expect(passesFilter('confirmed', 'confirmed')).toBe(true);
    expect(passesFilter('confirmed', 'none')).toBe(false);
    expect(passesFilter('confirmed', 'pending')).toBe(false);
  });

  test('all/pending 필터 동작 보존 (회귀)', () => {
    expect(passesFilter('all', 'none')).toBe(true);
    expect(passesFilter('all', 'confirmed')).toBe(true);
    expect(passesFilter('pending', 'pending')).toBe(true);
    expect(passesFilter('pending', 'confirmed')).toBe(false);
  });

  test('소스: 필터 라벨 "처방나감" + key "confirmed", 옛 "처방 없음"/none 제거', () => {
    const s = SRC('components/doctor/DoctorPatientList.tsx');
    expect(s).toMatch(/key:\s*'confirmed'\s*as const,\s*label:\s*`처방나감/);
    expect(s).toContain("if (filter === 'confirmed') return p.prescription_status === 'confirmed';");
    // 옛 필터 옵션/술어 제거 (배지 title="처방 없음" 은 별개 — 필터 옵션 라벨만 검사)
    expect(s).not.toMatch(/key:\s*'none'\s*as const/);
    expect(s).not.toContain("if (filter === 'none')");
  });
});
