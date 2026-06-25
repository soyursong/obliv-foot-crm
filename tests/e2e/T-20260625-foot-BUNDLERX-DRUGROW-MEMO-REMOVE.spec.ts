/**
 * E2E spec — T-20260625-foot-BUNDLERX-DRUGROW-MEMO-REMOVE
 *
 * 현장(문지은 대표원장, C0ATE5P6JTH 2026-06-25 10:42):
 *   "묶음처방 할때 약 뒤에 무조건 숫자 세개 1/3/2 이렇게만 나오라고 했잖아. 메모는 처방세트에서
 *    등록하는 거고 여기는 그 약들을 묶어서 처방나가는 세트만 기록하는 곳이야. 약에는 무조건
 *    숫자 삼종만 연결하는거야 수정해줘."
 *
 * AC-1: 묶음처방 추가/수정 모달의 약 항목 행(RxSetItemRow)에서 설명(notes) 입력칸 제거.
 *        약 항목 행 = 약이름 + 용량 + 횟수 + 일수(숫자 3종)만.
 * AC-2: prescription_sets.items[].notes 필드는 보존(DROP 0). UI 입력칸만 제거 — 기존 notes 유실 0.
 *        (db_change:false / 저장은 items 통째 upsert → onChange 미경유 notes 그대로 보존)
 * AC-0: 메모 입력처는 처방세트(약품폴더 DrugFoldersTab '설명' 인라인 에디터)에 존재 — orphan 아님.
 * AC-3: 출력(rxTooltip 미니멀 한줄)은 약이름+숫자3종 토큰만, notes 미노출(NAMEDESC Q2 정합 회귀).
 *
 * policy_superseded(surface narrow): T-20260610-foot-RXSET-NAMEDESC-MODEL Q2 LOCK — 설명 노출
 *   허용 surface에서 묶음처방 약항목 행 제외. NAMEDESC 핵심 정의("메모는 처방세트에서 등록")는 유지·강화.
 *
 * 정적 소스 단언(데이터/로그인 비의존)으로 회귀 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RXSET = 'src/components/admin/PrescriptionSetsTab.tsx';
const DRUGFOLDERS = 'src/components/admin/DrugFoldersTab.tsx';
const RXTIP = 'src/lib/rxTooltip.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 묶음처방 약 항목 행에서 설명(notes) 입력칸 제거 — 약이름+숫자3종만
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: RxSetItemRow 에 설명(notes) 입력칸 없음 — testid·onChange·라벨 모두 제거', () => {
  const src = read(RXSET);
  expect(src).not.toContain('rx-set-item-notes-input');
  expect(src).not.toContain("onChange(idx, 'notes'");
  expect(src).not.toContain('>설명</Label>');
  expect(src).not.toContain('placeholder="분류·메모"');
});

test('AC1-2: 약 항목 행에 숫자 3종(용량/횟수/일수) 입력칸은 존속 — 약이름 검색 포함', () => {
  const src = read(RXSET);
  expect(src).toContain('rx-set-item-name-input');     // 약이름(검색)
  expect(src).toContain('rx-set-item-dosage-input');   // 용량
  expect(src).toContain('rx-set-item-days-input');     // 일수
  expect(src).toContain('RxCountInput');               // 횟수
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: notes 필드/컬럼 보존 — UI 입력칸만 제거(DROP 0)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: PrescriptionItem 타입에 notes 필드 보존(삭제 금지)', () => {
  const src = read(RXSET);
  expect(src).toContain('notes: string');
});

test('AC2-2: 저장 = items 배열 통째 upsert → onChange 미경유 notes 영속(유실 0)', () => {
  const src = read(RXSET);
  // 편집 모달 저장 경로 + 생성 모달 저장 경로 모두 items 전체를 upsert.
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  expect(src).toContain('form: { ...createForm, name: setName }');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-0: 메모 입력처는 처방세트(약품폴더)에 존재 — 제거가 메모 동선을 orphan 시키지 않음
// ─────────────────────────────────────────────────────────────────────────────
test('AC0-1: 약품폴더(DrugFoldersTab)에 약별 설명 인라인 편집 존재 — 메모 등록처 보장', () => {
  const src = read(DRUGFOLDERS);
  // 약별 '설명'(description) 인라인 저장 — 더블클릭 에디터 + updateDesc mutation.
  expect(src).toContain('updateDesc');
  expect(src).toContain('drug-folder-viewall-desc-head');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 출력 미니멀 한줄(rxTooltip)은 약이름+숫자3종만 — notes 미노출(NAMEDESC Q2 정합 회귀)
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-1: 확정 요약 한줄은 notes/route 토큰 미포함', () => {
  const src = read(RXTIP);
  expect(src).toContain('formatRxConfirmedSummary');
  expect(src).not.toContain('it.notes');
  expect(src).not.toContain('it.route');
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: db_change 없음 — items.notes 컬럼/필드 DROP·ALTER 마이그 신설 금지
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: UI-only 변경 — notes 제거 관련 신규 DROP/ALTER 마이그 없음', () => {
  const src = read(RXSET);
  // 컬럼 삭제·SQL 흔적이 컴포넌트에 없음(presentation only).
  expect(src).not.toMatch(/DROP\s+COLUMN/i);
  expect(src).not.toMatch(/ALTER TABLE prescription_sets/i);
});
