/**
 * E2E spec — T-20260606-foot-RX-DRUG-WHITELIST
 *
 * 현장(대표원장 문지은) 확정(2026-06-15, ts 1781494646.216569):
 *   - 진료차트 처방 가능 약 = 처방세트 등록약(= services category_label='처방약', active) 만.
 *   - 대표원장 포함 전직원 동일 규칙(역할 분기 없음, C안 배제).
 *   - 별도 화이트리스트 테이블/플래그 불요 — services 처방약 소스를 진료차트 처방에 공유(READ-ONLY).
 *   - depends_on: RXSET-DRUGSOURCE-SVCRX(searchServiceRxDrugs 단일 재바인딩 지점). 본 티켓 = 그 진료차트 적용.
 *
 * AC-0 (read-only 그라운딩, 무DB write):
 *   ①청구 무손실: 처방전(rx_standard) 청구는 PaymentMiniWindow 가 services.service_code 를 별도 사용 —
 *     진료차트 prescription_code_id 는 금기/급여 게이트 enrichment 전용이라 null화돼도 청구 연결 손실 0.
 *   ②services 처방약은 prescription_codes 와 0% 매핑(실측) → 검색 출처 스왑 시 prescription_code_id=null,
 *     금기/급여 게이트는 코드 보유 약만 대상이라 자유텍스트와 동일 skip(금기 등록 1건=비-화이트리스트, 급여 차단 0).
 *
 * 핵심 AC:
 *   AC-1: 진료차트 처방 약 검색 소스 = services 처방약(searchServiceRxDrugs). 임의 EDI 마스터 자유검색 제거.
 *   AC-2: 전직원 동일 — role 분기 없음(부원장 자유텍스트 차단 retire). 처방 가능 약 = 처방세트 등록약 only.
 *   AC-3: 무손실 — 기존 차트 처방(약·용법·용량) 표시 경로 불변(검색/추가 경로만 변경).
 *
 * 정본 소스 정적 단언으로 불변식 인코딩(데이터/로그인 비의존) + role 게이트는 모듈 직접 import.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRxRoleGate, isFreeTextRxBlockedRole, VICE_DIRECTOR_ROLE } from '../../src/lib/prescriptionGate';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CHART = 'src/components/MedicalChartPanel.tsx';
const LIB = 'src/lib/prescribableDrugs.ts';
const GATE = 'src/lib/prescriptionGate.ts';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 진료차트 처방 약 검색 출처 → services 처방약(처방세트 등록약)
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: 진료차트 검색(searchRxCodes)이 services 캡슐(searchServiceRxDrugs)로 위임', () => {
  const chart = read(CHART);
  expect(chart).toMatch(/import\s+\{[^}]*searchServiceRxDrugs[^}]*\}\s+from\s+['"]@\/lib\/prescribableDrugs['"]/);
  // searchRxCodes 본문에서 services 캡슐 호출
  const fn = chart.slice(chart.indexOf('const searchRxCodes'), chart.indexOf('const searchRxCodes') + 1200);
  expect(fn).toContain('await searchServiceRxDrugs(query)');
  // 진료차트 검색에서 전체 EDI 마스터 직접 자유검색(.from('prescription_codes') + name_ko.ilike) 제거
  expect(fn).not.toContain(".from('prescription_codes')");
});

test('AC1-2: services 소스 캡슐 불변식 — category_label=처방약 AND active', () => {
  const lib = read(LIB);
  expect(lib).toContain('export async function searchServiceRxDrugs');
  expect(lib).toContain(".from('services')");
  expect(lib).toContain("eq('category_label', '처방약')");
  expect(lib).toContain("eq('active', true)");
});

test('AC1-3: services.id를 prescription_code_id로 저장하지 않음(null) — 게이트 오염 방지', () => {
  const chart = read(CHART);
  // addRxFromCode: service 소스는 prescription_code_id=null(services.id ≠ prescription_codes FK)
  const fn = chart.slice(chart.indexOf('function addRxFromCode'), chart.indexOf('function addRxFromCode') + 700);
  expect(fn).toContain("code.code_source === 'service'");
  expect(fn).toContain('isServiceRx ? null : code.id');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 전직원 동일 — role 분기 없음(부원장 자유텍스트 차단 retire)
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: 부원장 포함 전직원 — 코드 없는 약(services 처방약)도 처방 통과', () => {
  const free = { name: '주블리아외용액', prescription_code_id: null };
  for (const role of ['director', 'manager', 'admin', VICE_DIRECTOR_ROLE, 'nurse', 'therapist']) {
    expect(checkRxRoleGate(role, [free]).allowed).toBe(true);
    expect(isFreeTextRxBlockedRole(role)).toBe(false);
  }
});

test('AC2-2: FREETEXT_BLOCKED_ROLES 빈 집합(역할 분기 제거) — 정본 소스 단언', () => {
  const gate = read(GATE);
  expect(gate).toContain('const FREETEXT_BLOCKED_ROLES = new Set<string>([]);');
  expect(gate).toContain('T-20260606-foot-RX-DRUG-WHITELIST');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 무손실 — 기존 차트 처방 표시/저장 경로 불변(검색·추가 경로만 변경)
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-1: 기존 처방 저장 경로(prescription_items JSONB) + 레거시 코드 보유 약 처리 불변', () => {
  const chart = read(CHART);
  // 처방내역 단일 진입점(addRxItems) 유지 + 폴더트리 다중추가(addRxFromCodes)는 레거시 code.id 보존(범위 밖)
  expect(chart).toContain('function addRxItems');
  const multi = chart.slice(chart.indexOf('function addRxFromCodes'), chart.indexOf('function addRxFromCodes') + 600);
  expect(multi).toContain('prescription_code_id: c.id'); // 폴더트리(PROCMENU-P0 캐노니컬)는 이번 범위 밖 — 불변
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: 무DB(services READ-ONLY) — 스키마 변경 0
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE) 없음 — services READ-ONLY 재사용', () => {
  expect(read(CHART)).not.toMatch(/alter\s+table/i);
  expect(read(LIB)).not.toMatch(/alter\s+table/i);
  expect(read(GATE)).not.toMatch(/alter\s+table/i);
});
