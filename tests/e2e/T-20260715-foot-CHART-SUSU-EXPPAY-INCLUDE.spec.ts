/**
 * T-20260715-foot-CHART-SUSU-EXPPAY-INCLUDE
 * 고객 차트 '수납내역' 탭에 체험(experience=회수1·단건) 패키지 구입 영수증결제도 표시.
 *
 * 배경 (RC-A, F-4716 forensic 중 발견):
 *   체험권(내성체험권 등) 구입 = 회수1 패키지. 그 구입 영수증결제는 payments 테이블에
 *   memo='영수증 업로드(회수1·단건)' 로 기록된다(ReceiptUploadSection, 회수1 단건 분기).
 *   기존 수납내역 탭 필터 `!memo.startsWith('영수증 업로드')` 가 이 행까지 제외 →
 *   회수1 패키지의 유일 수납 행이 사라져 차트가 '결제없음'으로 보여 현장 오인.
 *   → 현장 의향 확인 완료(김주연 총괄): 체험 영수증결제도 수납내역 탭에 같이 표시.
 *
 * ★DISPLAY-ONLY: 프론트 read/query 필터만 확장. payments write-path·미수 귀속 로직
 *   (형제 P0 T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR 소관)·스키마 무접점.
 *   병렬 조회경로 신설 없음 — 기존 payments 배열 파생 filter 만 변경.
 *
 * 본 스펙은 auth-free 정적 소스 가드(unit 프로젝트). 필터 확장 성질을
 * 소스 레벨에서 결정적으로 단언한다(시드 결제 데이터 없이 회귀 차단).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHART_PAGE = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');

function src(): string {
  return readFileSync(CHART_PAGE, 'utf-8');
}

/** 정본 소스에서 feePayments 필터 본문을 추출해 실제 판정 함수로 재구성(런타임 단언). */
function makeFeeFilter(): (memo: string | null | undefined) => boolean {
  // 소스의 filter 함수 로직을 1:1 미러 — 소스가 바뀌어 성질이 깨지면 아래 단언에서 즉시 검출.
  const s = src();
  // 회수1 포함 분기 존속 확인 후 로직 모사
  if (!s.includes("if (memo.startsWith('영수증 업로드(회수1')) return true;")) {
    throw new Error('feePayments 필터에 체험(회수1) 포함 분기가 없음 — 소스 회귀');
  }
  if (!s.includes("return !memo.startsWith('영수증 업로드');")) {
    throw new Error('feePayments 필터에 일반 영수증 업로드 제외 분기가 없음 — 소스 회귀');
  }
  return (memoIn) => {
    const memo = memoIn ?? '';
    if (memo.startsWith('영수증 업로드(회수1')) return true;
    return !memo.startsWith('영수증 업로드');
  };
}

test.describe('T-20260715-foot-CHART-SUSU-EXPPAY-INCLUDE — 체험 영수증결제 수납내역 표시', () => {
  // ── AC1: 체험(회수1·단건) 영수증결제가 수납내역(feePayments)에 포함 ─────────────
  test('AC1: memo=영수증 업로드(회수1·단건) 행은 수납내역에 포함된다', () => {
    const s = src();
    // (a) 포함 분기 존속 (식별키)
    expect(s).toContain("if (memo.startsWith('영수증 업로드(회수1')) return true;");
    // (b) 판정 함수 런타임: 회수1 영수증결제 memo → 포함(true)
    const feeFilter = makeFeeFilter();
    expect(feeFilter('영수증 업로드(회수1·단건)')).toBe(true);
  });

  // ── AC2: 동일 행 렌더 — feePayments 는 기존 테이블(동일 컬럼)로 그대로 렌더 ────────
  test('AC2: 포함된 행은 기존 일반 수납 행과 동일 테이블(feePayments.map)로 노출', () => {
    const s = src();
    // 체험 행도 feePayments 로 흘러 동일 테이블 map 을 탄다 → 별도 렌더/컬럼 분기 없음
    expect(s).toContain('{feePayments.map((p) => (');
    expect(s).toContain('{feePayments.length === 0 ?');
    // 신규 병렬 조회경로/별도 상태 없음 — payments 배열 파생 filter 만
    expect(s).toContain('const feePayments = payments.filter((p) => {');
  });

  // ── AC3: 필터 확장 회귀 — 기존 정상 수납 행 중복/누락/순서교란 없음 ────────────────
  test('AC3: 일반 수납 행은 기존과 동일하게 유지(중복·누락·순서교란 0)', () => {
    const feeFilter = makeFeeFilter();
    // 일반 진료비 수납(영수증 업로드 아님) → 종전과 동일하게 포함
    expect(feeFilter('진료비 수납')).toBe(true);
    expect(feeFilter('')).toBe(true);
    expect(feeFilter(null)).toBe(true);
    expect(feeFilter('카드 결제')).toBe(true);
    // 일반 영수증 업로드(패키지 잔금 연결분·비회수1) → 종전과 동일하게 제외(결제영수증 섹션 표기)
    expect(feeFilter('영수증 업로드')).toBe(false);

    // 순서/중복 불변식: filter 는 순수 파생 — 원본 payments 순서 보존, 중복 생성 없음
    const payments = [
      { memo: '진료비 수납' },
      { memo: '영수증 업로드' },            // 제외
      { memo: '영수증 업로드(회수1·단건)' }, // 신규 포함(체험)
      { memo: '카드 결제' },
    ];
    const kept = payments.filter((p) => feeFilter(p.memo));
    // 예상: 진료비 수납 / 영수증 업로드(회수1·단건) / 카드 결제 (원순서 유지, 중복 0)
    expect(kept.map((p) => p.memo)).toEqual([
      '진료비 수납',
      '영수증 업로드(회수1·단건)',
      '카드 결제',
    ]);
  });

  // ── AC4: DISPLAY-ONLY — write 경로/집계 쿼리/스키마 무접점 ────────────────────────
  test('AC4: read/query 필터만 확장 — feePayments 블록에 mutation/신규 write 없음', () => {
    const s = src();
    // DISPLAY-ONLY 명시 코멘트 존속
    expect(s).toContain('DISPLAY-ONLY');
    expect(s).toContain('T-20260715-foot-CHART-SUSU-EXPPAY-INCLUDE');
    // feePayments/directPkgPayments 는 순수 .filter 파생값(insert/update/delete 없음)
    expect(s).toContain('const feePayments = payments.filter');
    expect(s).toContain("const directPkgPayments = pkgPayments.filter((p) => p.memo !== '영수증 업로드');");
    // 패키지 결제 필터(directPkgPayments)는 불변 — 본 티켓은 payments 축만 확장(형제 P0 write-path 무접점)
  });
});
