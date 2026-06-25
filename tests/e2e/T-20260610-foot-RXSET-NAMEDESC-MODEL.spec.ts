/**
 * E2E spec — T-20260610-foot-RXSET-NAMEDESC-MODEL
 *
 * DECISION LOCK 2026-06-12 (문지은 대표원장):
 *   처방세트 항목 모델 = [이름+용량] / [설명] 2필드. 투여경로·용법·횟수·일수 입력칸은
 *   세트 등록화면에서 제거(기존 값 보존·숨김). 용법(1/3/2)은 묶음·빠른처방 불러올 때 입력.
 *   설명(notes/route/classification) = 세트 관리·입력 상세화면 限 노출. 공식문서(처방전/진단서/
 *   라벨/QR) + 미니멀 표기 UI(빠른처방 목록 약이름 한 줄)에는 절대 노출 금지.
 *   Q3 A-1 자동이관: 기존 19세트의 set.name → items[0].name(약 이름), 기존 분류명 → notes(설명).
 *
 * dev-foot 데이터감사(2026-06-13, READ-ONLY): prescription_sets 19/19 single-item,
 *   set.name=약이름 / items[0].name=분류(예 "항생제 연고") / notes 전부 empty / dosage·route 기존보유.
 *   → 1:1 결정적 이관(will_migrate=19, skip=0, 데이터손실 0).
 *
 * 본 spec 은 정본 소스(PrescriptionSetsTab/DocumentPrintPanel/rxTooltip)와 마이그 패키지에
 *   불변식을 정적 단언으로 인코딩해 회귀를 가드한다(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RXSET = 'src/components/admin/PrescriptionSetsTab.tsx';
const DOCPRINT = 'src/components/DocumentPrintPanel.tsx';
const RXTIP = 'src/lib/rxTooltip.ts';
const MIG = 'supabase/migrations/20260613120000_rxset_namedesc_migrate.sql';
const MIG_RB = 'supabase/migrations/20260613120000_rxset_namedesc_migrate.rollback.sql';
const AUDIT = 'supabase/ops/rxset_namedesc_dryrun_audit_20260613.sql';

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 세트 등록 = [이름+용량] / [설명] 2필드. route/용법/횟수/일수 입력칸 제거.
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ SUPERSEDED (surface narrow) by T-20260625-foot-BUNDLERX-DRUGROW-MEMO-REMOVE (2026-06-25):
//   동일 reporter(문지은 대표원장)가 Q2 LOCK '설명 노출 = 세트 관리·입력 상세화면 限 허용' 의 surface 범위를
//   "묶음처방 약 항목 행은 설명-허용 surface에서 제외"로 명시 narrow. → 묶음처방 ItemRow(RxSetItemRow)에서
//   설명(notes) 입력칸 제거(약이름+숫자3종만). notes 필드 자체는 보존(DROP 0, AC2-3 유지).
//   "메모는 처방세트(약품폴더 DrugFoldersTab '설명' 인라인)에서 등록"이라는 NAMEDESC 핵심 정의는 유지·강화됨.
//   notes-input 부재 단언은 BUNDLERX-DRUGROW-MEMO-REMOVE.spec.ts 소관.
test('AC2-1(narrowed): ItemRow 에 약품명·용량 입력칸 존재 — 설명(notes) 입력칸은 제거(MEMO-REMOVE supersede)', () => {
  const src = read(RXSET);
  expect(src).toContain('rx-set-item-name-input');     // 약품명(검색 드롭다운)
  expect(src).toContain('rx-set-item-dosage-input');   // 용량
  // 설명(notes) 입력칸은 묶음처방 약 항목 행에서 제거됨 — 메모는 처방세트(약품폴더)에서 등록.
  expect(src).not.toContain('rx-set-item-notes-input');
});

// ⚠ PARTIAL SUPERSEDED by T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE (2026-06-15):
//   문지은 대표원장(MSG-20260615-001650) "묶음처방에 숫자까지 넣어서 저장하고 처방할때 진료의가 수동 조정 가능."
//   → 묶음처방 빌더(PrescriptionSetsTab)에 한해 용량/횟수/일수(1/3/2) baked default 입력 재도입.
//   route/frequency(투여경로·용법)는 여전히 등록화면 미노출(use-time 입력 유지). 약 라이브러리(DrugFoldersTab) no-posology 규칙 불변.
//   count/days/RxCountInput 부재 단언은 본 티켓 spec(T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE.spec.ts)으로 교체.
test('AC2-2(보강): 투여경로·용법(frequency) 입력 UI 제거 — 등록화면 미노출(존속). 용량/횟수/일수는 본 티켓 spec으로 이관', () => {
  const src = read(RXSET);
  // route/frequency 금지는 존속 — 등록화면에 투여경로·용법 입력 없음.
  expect(src).not.toContain('>투여경로</Label>');
  expect(src).not.toContain('>용법</Label>');
  expect(src).not.toContain("onChange(idx, 'route'");
  expect(src).not.toContain("onChange(idx, 'frequency'");
  // 용량/횟수/일수(count/days/RxCountInput) 재도입 단언은 BUNDLERX-BUILDER-RESTRUCTURE spec 소관 — 여기선 검사하지 않음.
});

test('AC2-3: 기존 값 보존 — items 전체를 저장(route/frequency/days/count 영속)', () => {
  const src = read(RXSET);
  // 항목 배열을 통째로 upsert → 숨긴 필드(route/frequency/days/count) 손실 없음.
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  // PrescriptionItem 타입은 기존 필드 유지(보존 대상)
  expect(src).toContain('route: string');
  expect(src).toContain('frequency: string');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 설명 노출금지 surface — 공식문서(처방전 rx_items_html) + 미니멀 라인(rxTooltip)
// ─────────────────────────────────────────────────────────────────────────────
test('AC4-1: 공식문서 처방전(rx_items_html)은 notes/route/classification 미바인딩', () => {
  const src = read(DOCPRINT);
  // rx_items_html 빌드 경로는 name/unit_dose/daily_freq/total_days/method 만 사용(charge-item 기반).
  expect(src).toContain('rx_items_html');
  expect(src).toContain('buildRxItemsHtml');
  // 처방전 항목 매핑에 notes/route/classification 누출 없음(정적 단언)
  expect(src).not.toMatch(/rx_items_html[\s\S]{0,400}\.notes/);
  expect(src).not.toMatch(/buildRxItemsHtml[\s\S]{0,200}classification/);
});

test('AC4-2: 미니멀 한줄(rxTooltip)은 약이름+용법토큰만 — notes/route 미노출', () => {
  const src = read(RXTIP);
  // 확정 요약 한 줄 = name + {dosage}/{count}/{days}. notes/route/classification 토큰 없음.
  expect(src).toContain('formatRxConfirmedSummary');
  expect(src).not.toContain('it.notes');
  expect(src).not.toContain('it.route');
  expect(src).not.toContain('it.classification');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / Q3: 자동이관 마이그 패키지 — set.name→items[0].name, 분류→notes, 멱등·단일item·복원가능
// ─────────────────────────────────────────────────────────────────────────────
test('MIG-1: 마이그/롤백/dry-run audit 3종 파일 존재', () => {
  expect(existsSync(join(ROOT, MIG))).toBe(true);
  expect(existsSync(join(ROOT, MIG_RB))).toBe(true);
  expect(existsSync(join(ROOT, AUDIT))).toBe(true);
});

test('MIG-2: 이관 로직 = set.name→items[0].name, 분류명→notes(빈 notes일 때만)', () => {
  const sql = read(MIG);
  expect(sql).toContain("'name', ps.name");                       // 약 이름을 item.name 으로
  expect(sql).toContain("ps.items->0->>'name'");                  // 기존 분류명 출처
  // 기존 notes 보존(비었을 때만 분류명 이동)
  expect(sql).toMatch(/TRIM\(ps\.items->0->>'notes'\)/);
});

test('MIG-3: 멱등성·단일item 한정 가드 — 재실행 no-op, multi-item 무접촉', () => {
  const sql = read(MIG);
  // single-item 만 대상
  expect(sql).toContain('jsonb_array_length(ps.items) = 1');
  // 이미 이관된(items[0].name = set.name) 세트 제외 → 재실행 안전
  expect(sql).toContain("(ps.items->0->>'name') IS DISTINCT FROM ps.name");
});

test('MIG-4: 백업 스냅샷 + 검증 + 롤백 복원 — 데이터 안전', () => {
  const sql = read(MIG);
  const rb = read(MIG_RB);
  expect(sql).toContain('prescription_sets_namedesc_backup_20260613'); // 백업 테이블
  expect(sql).toMatch(/RAISE EXCEPTION/);                              // 불일치 시 abort
  expect(rb).toContain('SET items = b.items');                         // 원본 복원
  // 롤백은 사용자가 마이그 후 수정한 세트 보호(SKIP)
  expect(rb).toContain("(ps.items->0->>'name') = ps.name");
});

test('GUARD: 마이그는 단일 데이터 이관 — 신규 컬럼/enum 추가 없음(data-architect 게이트 비해당)', () => {
  const sql = read(MIG);
  expect(sql).not.toMatch(/ALTER TABLE prescription_sets\s+ADD COLUMN/i);
  expect(sql).not.toMatch(/CREATE TYPE/i);
});
