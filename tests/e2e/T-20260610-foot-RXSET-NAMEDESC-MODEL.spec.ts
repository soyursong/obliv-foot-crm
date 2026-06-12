/**
 * E2E spec — T-20260610-foot-RXSET-NAMEDESC-MODEL
 *
 * DECISION LOCK(dl53 Q1/Q2/Q3) 완료. 처방세트 항목 = [이름+용량] / [설명] 2필드 모델.
 *   Q1: route·용법(frequency)·횟수(count)·일수(days)·용량(dosage) 입력칸을 세트등록 화면에서 제거
 *       (값 보존·숨김, 손실0). 용법(1/3/2)은 묶음·빠른처방 '불러올 때'(MedicalChartPanel 인라인편집표) 입력.
 *   Q2: 설명(notes) 노출 = 세트관리·입력 상세화면 限. 공식문서(처방전/타임라인)·미니멀목록 미노출.
 *   Q3 = A-1 자동이관: set.name(약이름+용량) → items[0].name, 기존 items[0].name(분류) → items[0].notes(설명).
 *        동반 해소 Bug A(RXSET-DRUGNAME-DISPLAY): 세트 불러오기 시 약이름이 항목명으로 표시(분류/route 아님).
 *
 * 정적 소스 단언(데이터/로그인 비의존) — 본 레포 RXSET spec 컨벤션(MGMT-DRUG-SEARCH 등) 재사용.
 * 마이그는 supervisor DB 게이트(파괴적 write 0) — SQL 패키지 룰 불변식도 정적 단언으로 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RX = 'src/components/admin/PrescriptionSetsTab.tsx';
const MCP = 'src/components/MedicalChartPanel.tsx';
const DATAFIX = 'migration_packages/T-20260610-foot-RXSET-NAMEDESC-MODEL/datafix.sql';
const ROLLBACK = 'migration_packages/T-20260610-foot-RXSET-NAMEDESC-MODEL/rollback.sql';

// ─────────────────────────────────────────────────────────────────────────────
// Q1: 세트 등록 화면 = [이름+용량] / [설명] 2칸만
// ─────────────────────────────────────────────────────────────────────────────
test('Q1-1: 세트등록 항목에 [이름+용량] 라벨 + [설명] 입력칸 존재', () => {
  const src = read(RX);
  expect(src).toContain('이름+용량 *');
  expect(src).toContain('rx-set-item-notes-input');
  expect(src).toContain('>설명<'); // <Label>설명</Label>
});

test('Q1-2: route·용법·횟수·일수 입력칸이 세트등록 ItemRow 에서 제거', () => {
  const src = read(RX);
  // ItemRow 내부의 해당 onChange 바인딩 입력칸이 제거됨(값은 보존, 입력 UI만 제거)
  expect(src).not.toContain("onChange(idx, 'route'");
  expect(src).not.toContain("onChange(idx, 'frequency'");
  expect(src).not.toContain("onChange(idx, 'dosage'");
  // 횟수칸(RxCountInput) 제거 → import 도 제거
  expect(src).not.toContain('RxCountInput');
  // 일수 number input 제거
  expect(src).not.toContain("onChange(idx, 'days'");
});

test('Q1-3: 숨긴 필드 값 보존 — onChange spread 갱신 + EMPTY_ITEM 기본값 캐리', () => {
  const src = read(RX);
  // EMPTY_ITEM 이 route/frequency/days 기본값을 여전히 보유(신규 항목 캐리, 불러올 때 편집)
  expect(src).toContain('const EMPTY_ITEM');
  expect(src).toContain("route: '경구'");
  expect(src).toContain("frequency: '1일 3회'");
  // notes(설명) 는 입력칸과 바인딩 유지
  expect(src).toContain("onChange(idx, 'notes'");
});

test('Q1-4: 마스터 선택 시 route/classification 자동채움 유지(숨김 필드 채움 무회귀)', () => {
  const src = read(RX);
  expect(src).toContain('classificationToRoute(code.classification)');
  expect(src).toContain('prescription_code_id: code.id');
  // 약품명 검색 드롭다운 무회귀
  expect(src).toContain('rx-set-item-name-input');
  expect(src).toContain('rx-set-drug-search-dropdown');
});

// ─────────────────────────────────────────────────────────────────────────────
// Q2: 설명 노출 게이트 — 세트관리 카드 = [이름+용량] + [설명]만, 메타 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('Q2-1: 세트관리 카드 미리보기 = 이름 + 설명(notes)만 (route/frequency/days 메타 제거)', () => {
  const src = read(RX);
  // 카드 미리보기 블록에서 item.route / item.frequency / item.count / item.days 렌더 제거
  expect(src).not.toContain('{item.route}');
  expect(src).not.toContain('{item.frequency}');
  expect(src).not.toContain('{item.count}회');
  expect(src).not.toContain('{item.days}일');
  // 설명(notes)은 세트관리에서 노출 허용(Q2)
  expect(src).toMatch(/item\.notes &&/);
});

test('Q2-2: 공식문서/타임라인 미니멀 목록은 약명+용량만(설명 미노출) — MedicalChartPanel 무회귀', () => {
  const src = read(MCP);
  // 타임라인 처방 = 약명+용량만 (route/frequency/days/notes 숨김) 정책 주석·렌더 유지
  expect(src).toContain('약명 + 용량만');
  // 타임라인 렌더가 name + dosage 조합만
  expect(src).toContain('{rx.name}{rx.dosage');
});

// ─────────────────────────────────────────────────────────────────────────────
// #2: 용법 토큰(1/3/2) 입력 = 불러올 때(MedicalChartPanel 인라인 편집표) — 무회귀 공존
// ─────────────────────────────────────────────────────────────────────────────
test('#2-1: 불러온 처방 항목 용법/횟수/일수 인라인 편집 유지(비우면 빈칸 허용)', () => {
  const src = read(MCP);
  // 로드 후 인라인 편집 함수 + 컬럼 유지(RX-TOKEN-FORMAT 같은 줄 공존)
  expect(src).toContain('function updateRxItem');
  expect(src).toContain("updateRxItem(idx, 'frequency'");
  expect(src).toContain("updateRxItem(idx, 'dosage'");
  expect(src).toContain('rx-frequency-');
  expect(src).toContain('rx-dosage-');
});

// ─────────────────────────────────────────────────────────────────────────────
// Q3 = A-1 자동이관 SQL 룰 불변식 (supervisor DB 게이트 패키지)
// ─────────────────────────────────────────────────────────────────────────────
test('Q3-1: datafix 가 set.name→items[0].name, 기존 name→notes 이관 룰', () => {
  expect(existsSync(join(ROOT, DATAFIX))).toBeTruthy();
  const sql = read(DATAFIX);
  // notes := 기존 item name(분류), name := set.name(약이름)
  expect(sql).toContain("jsonb_set(items, '{0,notes}', to_jsonb(items->0->>'name'))");
  expect(sql).toContain("'{0,name}', to_jsonb(name)");
});

test('Q3-2: 멱등 + notes 충돌 가드 + 단약 한정', () => {
  const sql = read(DATAFIX);
  expect(sql).toContain('jsonb_array_length(items) = 1');
  expect(sql).toContain("items->0->>'name' IS DISTINCT FROM name"); // 멱등
  expect(sql).toContain("coalesce(items->0->>'notes', '') = ''");    // 충돌 가드
});

test('Q3-3: STEP0 백업 + 롤백 패키지 동반(데이터손실0 보장)', () => {
  const sql = read(DATAFIX);
  expect(sql).toContain('_datafix_bk_T20260610_rxset_namedesc');
  expect(existsSync(join(ROOT, ROLLBACK))).toBeTruthy();
  const rb = read(ROLLBACK);
  expect(rb).toContain('SET items      = bk.items');
  expect(rb).toContain('_datafix_bk_T20260610_rxset_namedesc bk');
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD: FE는 스키마 변경 없음(마이그는 데이터 정규화, ALTER 아님)
// ─────────────────────────────────────────────────────────────────────────────
test('GUARD: FE 스키마 변경(ALTER TABLE) 없음 + datafix 도 ALTER 아님(JSONB 데이터 정규화)', () => {
  expect(read(RX)).not.toMatch(/alter\s+table/i);
  expect(read(DATAFIX)).not.toMatch(/alter\s+table/i);
});
