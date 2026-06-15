/**
 * E2E spec — T-20260614-foot-BUNDLERX-BUILDER-RESTRUCTURE
 *
 * 현장확정 (문지은 대표원장, MSG-20260615-001650-3c9y):
 *   "묶음처방에 숫자까지 넣어서 저장하고 처방할때 진료의가 수동으로 조정 가능. 빠른처방도 마찬가지임."
 *
 * = 묶음처방 빌더(PrescriptionSetsTab)에 1/3/2(용량·횟수·일수) baked default 입력 재도입.
 *   저장값은 default일 뿐 잠금 아님 → 적용(처방 흡수) 시 진료의가 use-time 수동 조정 가능.
 *   투여경로·용법(frequency)은 여전히 등록화면 미노출(use-time 입력 유지).
 *   약 라이브러리(prescription_codes/DrugFoldersTab) 등록면의 no-posology 규칙은 그대로 유지.
 *
 * NAMEDESC AC2-2 중 count/days/RxCountInput 부재 단언은 PARTIAL supersede → 본 spec으로 교체.
 * 스키마 변경 0 (items JSONB의 기존 count/days 필드 재사용) — data-architect/DB게이트 비해당.
 *
 * 본 spec 은 정본 소스(PrescriptionSetsTab/MedicalChartPanel/DrugFoldersTab)에 불변식을
 *   정적 단언으로 인코딩해 회귀를 가드한다(데이터/로그인 비의존, NAMEDESC spec 동형 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RXSET = 'src/components/admin/PrescriptionSetsTab.tsx';
const MEDCHART = 'src/components/MedicalChartPanel.tsx';
const DRUGFOLDERS = 'src/components/admin/DrugFoldersTab.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 — 빌더 진입·생성: 용량/횟수/일수(1/3/2) baked default 입력 재도입
// ─────────────────────────────────────────────────────────────────────────────
test('S1-1: 빌더 ItemRow 에 용량·횟수·일수 입력칸 존재 (1/3/2 baked default)', () => {
  const src = read(RXSET);
  expect(src).toContain('rx-set-item-dosage-input'); // 용량
  expect(src).toContain('rx-set-item-days-input');   // 일수
  expect(src).toContain('>횟수</Label>');             // 횟수 라벨 (RxCountInput)
  expect(src).toContain('>일수</Label>');             // 일수 라벨
  // 횟수는 RxCountInput(숫자만 + "회" suffix) 재사용
  expect(src).toContain('RxCountInput');
  expect(src).toContain("import RxCountInput from '@/components/admin/RxCountInput'");
});

test('S1-2: 입력값이 items JSONB 의 count/days 필드로 baked 저장 (추가 스키마 0)', () => {
  const src = read(RXSET);
  // count/days onChange 바인딩 존재 → 사용자 입력이 form.items 로 흘러감
  expect(src).toContain("onChange(idx, 'count', v)");
  expect(src).toContain("onChange(idx, 'days'");
  // items 배열 통째로 upsert (count/days 포함 영속) — 신규 컬럼 없이 기존 JSONB 사용
  expect(src).toContain('items: form.items as unknown as Record<string, unknown>[]');
  // PrescriptionItem 타입에 count/days 필드 존재
  expect(src).toMatch(/days:\s*number/);
  expect(src).toMatch(/count\?:\s*number\s*\|\s*null/);
});

test('S1-3: 신규 컬럼/테이블/enum 추가 없음 — 마이그 무대상(items JSONB 재사용)', () => {
  const src = read(RXSET);
  // 코드 레벨에서 DDL 흔적 없음(FE 컴포넌트)
  expect(src).not.toMatch(/ALTER TABLE/i);
  expect(src).not.toMatch(/CREATE TYPE/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 — 적용 무회귀 + use-time 수동 조정: 저장값=default(잠금 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('S2-1: 처방세트 적용 = set.items 누적 흡수 (loadPrescriptionSet → addRxItems → formRx)', () => {
  const src = read(MEDCHART);
  // 세트 전체 항목을 얕은복제해 적재(누적 정책 보존)
  expect(src).toContain('function loadPrescriptionSet');
  expect(src).toMatch(/addRxItems\(items\.map\(it\s*=>\s*\(\{\s*\.\.\.it\s*\}\)\)/);
  // 적재 = formRx append (replace 금지)
  expect(src).toContain('setFormRx(prev => [...prev, ...items.map(it => ({ ...it }))])');
});

test('S2-2: use-time 진료의 수동 조정 가능 — formRx 의 횟수/일수 편집 UI 존속(잠금 아님)', () => {
  const src = read(MEDCHART);
  // baked default 가 흡수된 뒤에도 차트에서 count/days 를 수정할 수 있어야 함
  expect(src).toContain("updateRxItem(idx, 'days'");
  expect(src).toContain('updateRxCount(idx, v)');
  // 차트 처방행에 일수·횟수 입력 컨트롤 렌더
  expect(src).toContain('rx-days-');
  expect(src).toContain('RxCountInput');
  // ⚠ SUPERSEDED by T-20260615-foot-RXTABLE-PRESCRIPTION-ALIGN AC4 (문지은 대표원장, reporter-explicit):
  //   차트 처방내역 테이블의 dosage(용량) 인라인 편집 UI 는 reporter 직접 요청으로 제거(이 테이블에서만 숨김).
  //   단, dosage 데이터는 무삭제 — updateRxItem 시그니처/세트 적재(...it 얕은복제)에 보존되어 영속/저장 무회귀.
  expect(src).toContain("field: 'frequency' | 'days' | 'dosage'"); // dosage 필드 처리 경로 보존
  expect(src).not.toContain('rx-dosage-'); // 인라인 편집 UI 는 차트 테이블에서 제거
});

test('S2-3: 빌더에 default 가 잠금 아님을 명시하는 안내 노출 (AC-3 투명성)', () => {
  const src = read(RXSET);
  expect(src).toContain('rx-set-baked-default-hint');
  expect(src).toMatch(/기본값/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 — 처방세트 등록 동선 분리: route/frequency 미노출 존속 + 약 라이브러리 no-posology 유지
// ─────────────────────────────────────────────────────────────────────────────
test('S3-1: 빌더는 투여경로·용법(frequency) 입력 미노출 존속 (use-time 입력 유지)', () => {
  const src = read(RXSET);
  expect(src).not.toContain('>투여경로</Label>');
  expect(src).not.toContain('>용법</Label>');
  expect(src).not.toContain("onChange(idx, 'route'");
  expect(src).not.toContain("onChange(idx, 'frequency'");
});

test('S3-2: 약 라이브러리(DrugFoldersTab)는 분류 전용 — posology(용량/횟수/일수/용법) 입력 없음', () => {
  const src = read(DRUGFOLDERS);
  // 약 라이브러리 등록면은 폴더 분류만 — posology 입력칸 부재(no-posology 규칙 불변)
  expect(src).not.toContain('RxCountInput');
  expect(src).not.toContain('>용량</Label>');
  expect(src).not.toContain('>횟수</Label>');
  expect(src).not.toContain('>일수</Label>');
  expect(src).not.toContain('>용법</Label>');
});

test('S3-3: 설명(notes) 필드는 빌더 상세화면 限 존속 — 공식문서 노출 surface 와 분리', () => {
  const src = read(RXSET);
  // 설명칸은 빌더에 존속(상세 관리화면 限). 공식문서/미니멀 라인 노출금지는 NAMEDESC AC-4 spec 소관.
  expect(src).toContain('rx-set-item-notes-input');
  expect(src).toContain('>설명</Label>');
});
