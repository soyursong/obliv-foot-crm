/**
 * E2E spec — T-20260615-foot-RXSET-DRUGSOURCE-SVCRX
 *
 * 현장(김주연 총괄) 요청: 처방세트(서비스관리>진료관리>처방세트) 약 추가 출처를
 *   전체 EDI 약품 마스터(prescription_codes) 자유검색 → [서비스관리>처방약] 리스트로 제한.
 *   목적: 근방 약국에서 실제 처방 가능한 약(services category_label='처방약' AND active=true)으로만 세트 구성.
 *   결정: 김주연 총괄 A(공유) 회신(ts 1781492592.956039).
 *
 * AC-0 (read-only 그라운딩 결과, 무DB):
 *   §C 보험청구코드: services 처방약 행은 service_code(EDI 청구코드) 보유·prescription_codes FK 미보유.
 *     실제 처방전/청구(rx_items_html·rx_standard)는 이미 services.service_code 사용 → 청구 무손실.
 *     prescription_code_id는 진료차트 게이트(금기/급여) 전용 enrichment → 본 스왑으로 null화돼도 자유텍스트와 동일 skip.
 *   PROCMENU 정합: services 처방약은 prescription_codes와 별도 소스(FK 없음) → 세트 빌더 소스만 분기, 하드 충돌 없음.
 *   BUNDLERX: 묶음처방 빌더는 기존 세트(약 라이브러리) 소비 → 기존 세트 약 무변경(AC-3)이라 후보군 무회귀.
 *
 * 핵심 AC:
 *   AC-1: 처방세트 약 추가 출처 = services 처방약 리스트(searchServiceRxDrugs). 처방약 외 임의 EDI 약명 안 뜸.
 *   AC-2: getPrescribableCodeIds(진료차트/금기 소스)·진료차트 처방(QuickRxBar/MedicalChartPanel) 런타임 약 출처 불변.
 *          services 소스는 단일 재바인딩 캡슐(searchServiceRxDrugs)로 분리 — 진료차트 적용은 이번 변경에서 안 함.
 *   AC-3: 기존 세트에 담긴 약·용법·용량 무손실(items JSONB 전체 저장 경로 유지).
 *
 * 정본 소스 정적 단언으로 불변식을 인코딩(데이터/로그인 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RX = 'src/components/admin/PrescriptionSetsTab.tsx';
const LIB = 'src/lib/prescribableDrugs.ts';
const CONTRA = 'src/components/admin/ContraindicationsTab.tsx';
const CHART = 'src/components/MedicalChartPanel.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 약 출처 스왑 — services 처방약 리스트
// ─────────────────────────────────────────────────────────────────────────────
test('AC1-1: searchServiceRxDrugs 캡슐이 services 처방약(active)만 조회', () => {
  const lib = read(LIB);
  expect(lib).toContain('export async function searchServiceRxDrugs');
  expect(lib).toContain(".from('services')");
  expect(lib).toContain("eq('category_label', '처방약')");
  expect(lib).toContain("eq('active', true)");
  // 빈 쿼리 → 전체 리스트('리스트 선택' UX), 쿼리 있으면 name/service_code ilike 필터
  expect(lib).toContain('name.ilike.%${esc}%,service_code.ilike.%${esc}%');
});

test('AC1-2: 세트 빌더 searchRxMaster 가 services 캡슐로 위임 — prescription_codes 자유검색 제거', () => {
  const src = read(RX);
  expect(src).toContain('searchServiceRxDrugs');
  expect(src).toMatch(/from\s+['"]@\/lib\/prescribableDrugs['"]/);
  // 세트 빌더에서 전체 EDI 마스터 직접 검색 제거(처방약 외 임의 약명 안 뜸)
  expect(src).not.toContain(".from('prescription_codes')");
});

test('AC1-3: 빈 쿼리(포커스)도 전체 리스트 노출 — 리스트 선택 UX', () => {
  const src = read(RX);
  // 빈 입력 포커스 시 드롭다운 열고 검색 실행(이전엔 1글자 미만이면 미오픈)
  expect(src).toContain('onFocus={() => { setOpen(true); runSearch(item.name); }}');
  // 드롭다운 렌더 조건이 입력 길이≥1 게이트 제거(open만)
  expect(src).toContain('{open && (');
  expect(src).toContain('rx-set-drug-search-dropdown');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 진료차트/금기 소스 불변 + services 캡슐은 단일 재바인딩 지점으로만 분리
// ─────────────────────────────────────────────────────────────────────────────
test('AC2-1: services.id를 prescription_code_id로 저장하지 않음(null화) — 게이트 오염 방지', () => {
  const src = read(RX);
  expect(src).toContain('function handleSelectDrug');
  // services 선택 → name 채우되 prescription_code_id=null(서비스 id ≠ prescription_codes id)
  expect(src).toContain('prescription_code_id: null');
  expect(src).not.toContain('prescription_code_id: code.id');
});

test('AC2-2: [SUPERSEDED by T-20260606-foot-RX-DRUG-WHITELIST] 진료차트 처방 검색 출처 → services 재바인딩', () => {
  // RXSET 시점엔 진료차트 런타임 불변(보류)이었으나, 대표원장 문지은 확정(2026-06-15)으로
  // RX-DRUG-WHITELIST 가 RXSET AC-2 보류분(진료차트 적용)을 수행 → 검색 박스가 services 캡슐로 재바인딩됨.
  const chart = read(CHART);
  expect(chart).toContain('searchServiceRxDrugs'); // 진료차트 검색 박스가 단일 재바인딩 지점 소비
  // 폴더 트리(DrugFolderTree=PROCMENU-P0 캐노니컬)는 이번 범위 밖 → prescription_codes 참조 잔존(정상)
  expect(chart).toContain('prescription_codes');
});

test('AC2-3: 금기증관리 약 출처(getPrescribableCodeIds/searchPrescribableDrugs) 불변', () => {
  const lib = read(LIB);
  // 금기증관리 소스 함수는 그대로 prescription_sets 등록 약 기반 — services로 바꾸지 않음
  expect(lib).toContain('export async function getPrescribableCodeIds');
  expect(lib).toContain(".from('prescription_sets')");
  const contra = read(CONTRA);
  expect(contra).toContain('searchPrescribableDrugs');
  // 금기증관리는 services 처방약 캡슐을 쓰지 않음
  expect(contra).not.toContain('searchServiceRxDrugs');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 무손실 — 기존 세트 약·용법·용량 보존(items JSONB 전체 저장)
// ─────────────────────────────────────────────────────────────────────────────
test('AC3-1: upsert payload 가 items(JSONB) 전체 저장 → 기존 약·용법·용량 영속', () => {
  const src = read(RX);
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  expect(src).toContain("from('prescription_sets')");
  // 기존 세트가 보유한 prescription_code_id 필드 타입 유지(레거시 링크 약 표시 무손실)
  expect(src).toContain('prescription_code_id?: string | null');
  expect(src).toContain('item.prescription_code_id != null'); // 레거시 '연결됨' 배지 유지
});

// ─────────────────────────────────────────────────────────────────────────────
// 무DB 가드 — 본 변경은 FE only(services READ-ONLY 조회), 스키마 변경 0
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: 스키마 변경(ALTER TABLE) 없음 — services READ-ONLY 조회만', () => {
  expect(read(RX)).not.toMatch(/alter\s+table/i);
  expect(read(LIB)).not.toMatch(/alter\s+table/i);
});
