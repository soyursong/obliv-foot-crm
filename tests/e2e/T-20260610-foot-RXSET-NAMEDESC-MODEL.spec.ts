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
test('AC2-1: ItemRow 에 용량(dosage)·설명(notes) 입력칸 존재 — 2필드 모델', () => {
  const src = read(RXSET);
  expect(src).toContain('rx-set-item-name-input');     // 약품명(검색 드롭다운)
  expect(src).toContain('rx-set-item-dosage-input');   // 용량
  expect(src).toContain('rx-set-item-notes-input');    // 설명
  // 설명 라벨로 노출(비고→설명 relabel)
  expect(src).toContain('>설명</Label>');
});

test('AC2-2: 투여경로·용법·횟수·일수 입력 UI 제거 — 등록화면 미노출', () => {
  const src = read(RXSET);
  // ItemRow 내 해당 입력 라벨/바인딩이 사라졌는지(텍스트 단언). 용법·횟수·일수 라벨 부재.
  expect(src).not.toContain('>투여경로</Label>');
  expect(src).not.toContain('>용법</Label>');
  expect(src).not.toContain('>횟수</Label>');
  expect(src).not.toContain('>일수</Label>');
  // onChange 바인딩도 제거(route/frequency/days/count 직접 편집 경로 없음)
  expect(src).not.toContain("onChange(idx, 'route'");
  expect(src).not.toContain("onChange(idx, 'frequency'");
  expect(src).not.toContain("onChange(idx, 'days'");
  expect(src).not.toContain("onChange(idx, 'count'");
  // 미사용이 된 RxCountInput import 제거
  expect(src).not.toContain('RxCountInput');
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
