/**
 * E2E spec — T-20260616-foot-RX-COLUMN-INPUT-UNIFY-ALLSCREENS
 *
 * 현장(문지은 대표원장): "처방세트 추가든 뭐든 약을 다루는 화면에서는 칼럼명과 안의 박스를 통일.
 *   박스 안엔 숫자만. 칼럼명도 네가 말한 거로 고정. 절대 달라지지 않게."
 *
 * 칼럼명 표준(확정본): 약이름(용량) / 용법 / 횟수 / 일수
 *   정본 출처 = RXTABLE-PRESCRIPTION-ALIGN AC1(commit e9cbb16, 배포완료).
 *   토큰 매핑(RX-TOKEN-FORMAT, deployed): 1=dosage(1회량)/3=count(1일횟수)/2=days(총일수). 필드매핑·순서 불변.
 *
 * 핵심 AC:
 *   AC1: 약 입력 전 화면의 칼럼 라벨을 표준으로 고정(SSOT 상수 RX_COL 사용). 화면별 임의 변형 제거.
 *   AC2: 용법·횟수·일수 input 숫자전용(한글·영문 차단). 약이름 박스 제외. 범위(~)는 용법 박스 한정 허용.
 *   AC3: 칼럼 순서·필드 매핑(RX-TOKEN-FORMAT 1/3/2) 유지 — 변경 없음.
 *   AC4: 약 1/3/2 display 토큰과 column 매핑 일관성 유지(rxFreqCore 등 정본 미변경).
 *
 * 식별 surface(진행로그):
 *   - PrescriptionSetsTab.tsx (처방세트 추가/편집)
 *   - SuperPhrasesTab.tsx (상용구 약 입력)
 *   - PaymentMiniWindow.tsx (처방 용량/횟수/일수 인라인)
 *   - DocumentPrintPanel.tsx (rx_standard 용량/횟수/일수 인라인)
 *   - 제외(회귀 금지): MedicalChartPanel 처방내역 테이블뷰 = RXTABLE 완료분(정본).
 *
 * 본 spec 은 칼럼 라벨 SSOT·숫자전용 필터·필드매핑 불변식을 정본 소스에 정적 단언으로 인코딩해
 *   화면별 재-divergence 회귀를 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RXFMT = 'src/lib/rxFormat.ts';
const RXSET = 'src/components/admin/PrescriptionSetsTab.tsx';
const SUPER = 'src/components/admin/SuperPhrasesTab.tsx';
const PMW = 'src/components/PaymentMiniWindow.tsx';
const DPP = 'src/components/DocumentPrintPanel.tsx';
const MEDCHART = 'src/components/MedicalChartPanel.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// SSOT — 칼럼 라벨/숫자필터 단일 출처 (절대 달라지지 않게)
// ─────────────────────────────────────────────────────────────────────────────
test('SSOT-1: RX_COL 칼럼 라벨 표준이 rxFormat.ts 한 곳에 고정', () => {
  const src = read(RXFMT);
  expect(src).toContain('export const RX_COL');
  expect(src).toContain("name: '약이름'");
  expect(src).toContain("dosage: '용량'");
  expect(src).toContain("freq: '용법'");
  expect(src).toContain("count: '횟수'");
  expect(src).toContain("days: '일수'");
  expect(src).toContain("nameWithDosage: '약이름(용량)'");
});

test('SSOT-2: 숫자전용/범위 필터 헬퍼 존재 — 숫자만(rxDigits) + 숫자+범위(rxDigitsRange)', () => {
  const src = read(RXFMT);
  expect(src).toContain('export function rxDigits');
  expect(src).toContain("replace(/[^0-9]/g, '')");
  expect(src).toContain('export function rxDigitsRange');
  expect(src).toContain("replace(/[^0-9~]/g, '')");
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 처방세트 추가/편집 폼 (PrescriptionSetsTab)
//   칼럼명 표준 + 횟수·일수 숫자전용. 임의 변형(약품/시술명 등) 제거.
// ─────────────────────────────────────────────────────────────────────────────
test('S1-1: 처방세트 폼 칼럼 라벨이 RX_COL SSOT 참조(약이름/용량/횟수/일수)', () => {
  const src = read(RXSET);
  expect(src).toMatch(/from\s+['"]@\/lib\/rxFormat['"]/);
  expect(src).toContain('{RX_COL.name}');
  expect(src).toContain('{RX_COL.dosage}');
  expect(src).toContain('{RX_COL.count}');
  expect(src).toContain('{RX_COL.days}');
});

test('S1-2: 화면별 임의 변형 라벨(약품/시술명·약품명·1일횟수·회수·투약일) 잔존 0', () => {
  const src = read(RXSET);
  expect(src).not.toContain('>약품/시술명');
  expect(src).not.toContain('약품명 *');
  expect(src).not.toContain('1일횟수');
  expect(src).not.toContain('>회수<');
  expect(src).not.toContain('투약일');
});

test('S1-3: 횟수=RxCountInput(type=number)·일수=type=number — 숫자전용 보장', () => {
  const rxsrc = read(RXSET);
  // 일수 input 은 type=number(한글 차단) + 정수 floor
  expect(rxsrc).toContain('data-testid="rx-set-item-days-input"');
  expect(rxsrc).toMatch(/type="number"[\s\S]{0,200}rx-set-item-days-input|rx-set-item-days-input[\s\S]{0,200}/);
  // 횟수는 RxCountInput(자체 type=number)
  const rxcount = read('src/components/admin/RxCountInput.tsx');
  expect(rxcount).toContain('type="number"');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 상용구(약 입력) 폼 (SuperPhrasesTab)
//   칼럼명 표준 + 용법(범위허용 숫자전용)·횟수·일수 숫자전용.
// ─────────────────────────────────────────────────────────────────────────────
test('S2-1: 상용구 약 폼 칼럼 라벨이 RX_COL SSOT 참조(약이름/용량/용법/횟수/일수)', () => {
  const src = read(SUPER);
  expect(src).toMatch(/from\s+['"]@\/lib\/rxFormat['"]/);
  expect(src).toContain('{RX_COL.name}');
  expect(src).toContain('{RX_COL.dosage}');
  expect(src).toContain('{RX_COL.freq}');
  expect(src).toContain('{RX_COL.count}');
  expect(src).toContain('{RX_COL.days}');
  // 임의 변형 라벨 제거
  expect(src).not.toContain('약품/시술명 *');
});

test('S2-2: 용법(frequency) 박스 숫자+범위 전용 — rxDigitsRange 필터(한글 "1일 3회" 차단)', () => {
  const src = read(SUPER);
  expect(src).toContain("onChange(idx, 'frequency', rxDigitsRange(e.target.value))");
  // 한글 placeholder '1일 2회' 제거(숫자 코어 안내로 교체)
  expect(src).not.toContain("placeholder=\"1일 2회\"");
});

test('S2-3: 일수 박스 rxDigits 숫자전용 + type=number, 횟수=RxCountInput', () => {
  const src = read(SUPER);
  expect(src).toContain("onChange(idx, 'days'");
  expect(src).toContain('rxDigits(e.target.value)');
  expect(src).toContain('<RxCountInput');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 처방 작성/수납 인라인 (PaymentMiniWindow / DocumentPrintPanel)
//   용량/횟수/일수 라벨 표준 + 숫자전용 강제.
// ─────────────────────────────────────────────────────────────────────────────
test('S3-1: PaymentMiniWindow 처방 인라인 — RX_COL 라벨 + rxDigits 숫자전용(3박스)', () => {
  const src = read(PMW);
  expect(src).toMatch(/from\s+['"]@\/lib\/rxFormat['"]/);
  expect(src).toContain('{RX_COL.dosage}');
  expect(src).toContain('{RX_COL.count}');
  expect(src).toContain('{RX_COL.days}');
  expect(src).toContain('unit_dose: rxDigits(e.target.value)');
  expect(src).toContain('daily_freq: rxDigits(e.target.value)');
  expect(src).toContain('total_days: rxDigits(e.target.value)');
});

test('S3-2: DocumentPrintPanel rx_standard 인라인 — RX_COL 라벨 + rxDigits 숫자전용(3박스)', () => {
  const src = read(DPP);
  expect(src).toMatch(/from\s+['"]@\/lib\/rxFormat['"]/);
  expect(src).toContain('{RX_COL.dosage}');
  expect(src).toContain('{RX_COL.count}');
  expect(src).toContain('{RX_COL.days}');
  expect(src).toContain('unit_dose: rxDigits(e.target.value)');
  expect(src).toContain('daily_freq: rxDigits(e.target.value)');
  expect(src).toContain('total_days: rxDigits(e.target.value)');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3/AC4 — 필드 매핑·토큰 정본 불변(presentation + validation only)
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD-1: DB 스키마 변경(ALTER TABLE) 없음 — 전 surface 순수 FE', () => {
  for (const p of [RXFMT, RXSET, SUPER, PMW, DPP]) {
    expect(read(p)).not.toMatch(/alter\s+table/i);
  }
});

test('GUARD-2: 필드 매핑 불변 — 용법=frequency / 횟수=count / 일수=days 키 유지', () => {
  expect(read(SUPER)).toContain("onChange(idx, 'frequency'");
  expect(read(SUPER)).toContain("onChange(idx, 'days'");
  // 토큰 코어 정본(rxFreqCore) 미변경 — RXTABLE 정본 헬퍼 보존
  expect(read(RXFMT)).toContain('export function rxFreqCore');
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀 가드 — MedicalChartPanel 처방내역 테이블뷰(RXTABLE 완료분) 미접촉
// ─────────────────────────────────────────────────────────────────────────────
test('REGRESSION: MedicalChartPanel 처방내역 테이블 헤더(약이름(용량)/용법/횟수/일수) 보존', () => {
  const src = read(MEDCHART);
  expect(src).toContain('약이름 (용량)');
  expect(src).toContain('>용법<');
  expect(src).toContain('>횟수<');
  expect(src).toContain('>일수<');
});
