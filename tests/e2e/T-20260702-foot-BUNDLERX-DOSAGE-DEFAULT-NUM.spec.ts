/**
 * E2E spec — T-20260702-foot-BUNDLERX-DOSAGE-DEFAULT-NUM
 *
 * 현장확정 (문지은 대표원장, C0ATE5P6JTH, 2026-07-02):
 *   "묶음처방 추가 화면 약 용량칸에 '적정량'(글자)이 뜬다. 약 무조건 숫자 세개 뜨라고 했는데 반영 안 됨."
 *
 * = 묶음처방 빌더(PrescriptionSetsTab)의 새 약 항목 baked default 를 숫자로 주입.
 *   이전 EMPTY_ITEM.dosage='' → placeholder("적정량")만 보여 "글자가 뜬다"는 혼선.
 *   AC1: dosage '' → '1' / AC2: count 미설정 → 3, days 기존 3 유지 → 새 약 = 용량1·횟수3·일수3.
 *   AC4: 기본값은 초기 표시일 뿐 — onChange 바인딩 존속으로 사용자 입력을 덮어쓰지 않음(저장 무회귀).
 *   AC3: prod prescription_sets.items 중 dosage="적정량" = 0건(dry-run 확인) → 데이터 정비 무대상.
 *
 * 본 spec 은 정본 소스(PrescriptionSetsTab)에 불변식을 정적 단언으로 인코딩해 회귀를 가드한다
 *   (데이터/로그인 비의존, BUILDER-RESTRUCTURE spec 동형 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const RXSET = 'src/components/admin/PrescriptionSetsTab.tsx';

// EMPTY_ITEM 객체 리터럴 블록만 추출(다른 상수 오염 방지).
function emptyItemBlock(src: string): string {
  const m = src.match(/const EMPTY_ITEM:\s*PrescriptionItem\s*=\s*\{([\s\S]*?)\};/);
  if (!m) throw new Error('EMPTY_ITEM 리터럴을 찾지 못함');
  return m[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 새 약 추가 시 숫자 기본값(용량1·횟수3·일수3)
// ─────────────────────────────────────────────────────────────────────────────
test('S1-1: AC1 — EMPTY_ITEM.dosage 기본값이 숫자 "1" (빈값/글자 아님)', () => {
  const block = emptyItemBlock(read(RXSET));
  expect(block).toMatch(/dosage:\s*'1'/);        // '1' 주입
  expect(block).not.toMatch(/dosage:\s*''/);     // 빈값 아님(placeholder "적정량" 노출 방지)
  expect(block).not.toContain('적정량');          // 글자 기본값 없음
});

test('S1-2: AC2 — EMPTY_ITEM.count=3, days=3 (새 약 = 용량1·횟수3·일수3)', () => {
  const block = emptyItemBlock(read(RXSET));
  expect(block).toMatch(/count:\s*3/); // 횟수 3 주입(이전 미설정)
  expect(block).toMatch(/days:\s*3/);  // 일수 3 유지
});

test('S1-3: 용량 입력칸 placeholder 가 "적정량"(글자)이 아니라 숫자 힌트', () => {
  const src = read(RXSET);
  // 빌더 ItemRow 용량칸(rx-set-item-dosage-input) 인근에 "적정량" placeholder 잔존 금지
  expect(src).not.toContain('placeholder="적정량"');
  // 용량칸은 여전히 존재(회귀 없음)
  expect(src).toContain('rx-set-item-dosage-input');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 기본값 편집·저장 무회귀 (AC4: 초기 표시일 뿐 강제 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('S2-1: AC4 — 용량/횟수/일수 onChange 바인딩 존속 (사용자 입력이 기본값을 덮어씀)', () => {
  const src = read(RXSET);
  expect(src).toContain("onChange(idx, 'dosage'");  // 용량 편집 경로
  expect(src).toContain("onChange(idx, 'count', v)"); // 횟수 편집 경로(RxCountInput)
  expect(src).toContain("onChange(idx, 'days'");     // 일수 편집 경로
});

test('S2-2: AC4 — items 배열 통째 upsert 로 사용자 수정값 영속(신규 스키마 0)', () => {
  const src = read(RXSET);
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  // FE 컴포넌트에 DDL 흔적 없음(prescription_sets.items JSONB 재사용)
  expect(src).not.toMatch(/ALTER TABLE/i);
  expect(src).not.toMatch(/CREATE TYPE/i);
});

test('S2-3: 편집·수정 진입점 무회귀 — 빌더 add/edit 함수 존속', () => {
  const src = read(RXSET);
  expect(src).toContain('function addItem()');      // 약 추가(신규 행 = EMPTY_ITEM)
  expect(src).toContain('function openAdd()');       // 신규 세트 진입
  expect(src).toContain('function openEditBundle');  // 기존 세트 편집(저장값 보존 로드)
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 기존 '적정량' 데이터 정비(AC3): prod 0건 → 무대상, dry-run 산출물 보존
// ─────────────────────────────────────────────────────────────────────────────
test('S3-1: AC3 — 데이터 정비 dry-run 스크립트가 read-only 로 존재(대량 UPDATE 게이트 준수)', () => {
  const script = read('scripts/T-20260702-foot-BUNDLERX-DOSAGE-DEFAULT-NUM_ac3_dryrun.mjs');
  expect(script).toContain('read-only');
  // 조회 전용 — 파괴적 write(update/delete/upsert) 미포함
  expect(script).not.toMatch(/\.update\(/);
  expect(script).not.toMatch(/\.delete\(/);
  expect(script).not.toMatch(/\.upsert\(/);
});
