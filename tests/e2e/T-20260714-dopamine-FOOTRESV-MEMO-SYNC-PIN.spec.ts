/**
 * T-20260714-dopamine-FOOTRESV-MEMO-SYNC-PIN (lane B: obliv-foot-crm)
 * 도파민→풋CRM 예약메모 수신 write + 예약상세 팝업 예약메모 '고정(📌 핀)' 렌더
 *
 * ─ 스코프 (lane B, dev-foot) ───────────────────────────────────────
 *   1. reservation-ingest-from-dopamine EF 가 lane A push payload 의 memo 를
 *      풋CRM 예약메모(reservation_memo_history=rmh)에 write (예약등록 시점, AC3).
 *      → 旣존 syncReservationMemoToTimeline(source_system='dopamine' provenance) 재사용.
 *   2. ReservationMemoTimeline: source_system 비-NULL(도파민 유래) 메모를 예약상세
 *      팝업>예약메모 상단에 '고정(📌 핀)' 노출(AC4). 고정=상단정렬+핀 마커만(AC5):
 *      배지/시각강조(teal 박스) 미적용·편집/삭제 잠금 아님.
 *
 * ─ 현장 클릭 시나리오 2 (E2E 변환) ─────────────────────────────────
 *   1. 풋CRM 예약관리 → 도파민 예약건 예약상세 팝업 열기.
 *   2. 예약메모 영역에 도파민 memo 반영(AC3, EF write 경로).
 *   3. 해당 메모 '고정(핀)' 상단 노출(AC4).
 *   4. 핀=시각표시일 뿐, 수정/삭제 가능(잠금 아님, AC5).
 *
 * 스펙: 티켓 T-20260714-dopamine-FOOTRESV-MEMO-SYNC-PIN §AC1~5 / §현장 클릭 시나리오(2)
 *   자매 승계: BODYRESV(9429ded6) + RESVROUTE-DOPAMINE-SEED(ingest EF, b128c2ee).
 *   db_change=false (source_system 컬럼 旣존, 마이그 20260701020000). DA CONSULT 불요.
 *
 * 검증 방식: 정적 소스 인스펙션(dev-foot 표준 — DOPAINGEST-PHONE-HOVER-MISSING 라인).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EF_PATH = path.resolve(
  __dirname,
  '../../supabase/functions/reservation-ingest-from-dopamine/index.ts',
);
const TIMELINE_PATH = path.resolve(
  __dirname,
  '../../src/components/ReservationMemoTimeline.tsx',
);
const POPUP_PATH = path.resolve(
  __dirname,
  '../../src/components/ReservationDetailPopup.tsx',
);

const readEf = () => fs.readFileSync(EF_PATH, 'utf-8');
const readTimeline = () => fs.readFileSync(TIMELINE_PATH, 'utf-8');
const readPopup = () => fs.readFileSync(POPUP_PATH, 'utf-8');

// ── AC3: EF 가 예약등록 시점에 memo 를 rmh(예약메모)에 write ─────────────────────
test('AC3: reservation-ingest EF 가 memo 를 reservation_memo_history 에 write', () => {
  const ef = readEf();
  // 신규 INSERT 성공 후 예약메모 timeline sync 호출 존재
  expect(ef).toContain('syncReservationMemoToTimeline(admin, newRsv.id');
  // helper 가 rmh 테이블에 insert 하며 source_system provenance 착지
  expect(ef).toContain("from('reservation_memo_history')");
  expect(ef).toMatch(/source_system:\s*sourceSystem/);
});

test('AC3: memo helper 가 도파민 provenance 라벨을 남긴다', () => {
  const ef = readEf();
  // 사람 저작(NULL)과 구분되는 외부 유래 라벨
  expect(ef).toContain("created_by_name: '도파민TM'");
});

// ── lane A 정합: payload memo 필드명 = reservation.memo (divergence 방지) ───────
test('lane-align: EF 가 reservation.memo 필드를 읽는다', () => {
  const ef = readEf();
  expect(ef).toMatch(/reservation\['memo'\]/);
});

// ── AC4: source_system 유래 메모가 상단 고정 정렬 ──────────────────────────────
test('AC4: sortMemoItems 가 source_system 유래 메모를 최상단에 정렬', () => {
  const src = readTimeline();
  // 도파민 유래 판정 helper
  expect(src).toContain('function isSourcePinned');
  expect(src).toMatch(/source_system\b/);
  // 정렬: sourcePinned 그룹이 pinned/rest 보다 먼저 spread
  const sortBody = src.slice(
    src.indexOf('function sortMemoItems'),
    src.indexOf('function sortMemoItems') + 800,
  );
  expect(sortBody).toContain('const sourcePinned = items.filter(isSourcePinned)');
  expect(sortBody).toMatch(/return\s*\[\s*\.\.\.sourcePinned\s*,\s*\.\.\.pinned\s*,\s*\.\.\.rest\s*\]/);
});

// ── AC4: 조회 쿼리가 source_system 컬럼을 select ──────────────────────────────
test('AC4: rmh 조회 select 에 source_system 포함', () => {
  const src = readTimeline();
  // 타임라인 fetch + insert 반환 select 양쪽에 source_system
  const selects = src.match(/\.select\('id, reservation_id[^']*'\)/g) ?? [];
  expect(selects.length).toBeGreaterThanOrEqual(1);
  for (const s of selects) expect(s).toContain('source_system');
});

// ── AC4: 도파민 유래 메모에 📌 핀 마커 렌더 ───────────────────────────────────
test('AC4: source-pinned 메모에 Pin 아이콘 + testid 노출', () => {
  const src = readTimeline();
  expect(src).toContain('const sourcePinned = isSourcePinned(item)');
  expect(src).toContain("data-testid=\"memo-source-pin-icon\"");
  // 리스트 항목 testid 로 도파민 유래 메모 식별
  expect(src).toContain("'memo-source-pinned'");
});

// ── AC5: 고정=표시만 — 배지/시각강조(teal 박스) 미적용, neutral 톤 ──────────────
test('AC5: source-pinned 은 teal 박스 강조 없이 neutral 렌더', () => {
  const src = readTimeline();
  // 도파민 유래 메모는 manualPinnedOnly 가 아니므로 teal 박스(bg-teal-50) 미적용
  expect(src).toContain('const manualPinnedOnly = item.is_pinned && !sourcePinned');
  // box 클래스는 manualPinnedOnly 일 때만 teal, 그 외(도파민 포함) neutral
  expect(src).toMatch(/manualPinnedOnly\s*\?\s*'border-teal-300 bg-teal-50'\s*:\s*'border-border bg-card'/);
  // 핀 마커는 muted(강조 아님)
  expect(src).toMatch(/text-muted-foreground[^\n]*data-testid="memo-source-pin-icon"/);
});

// ── AC5: 잠금 아님 — 수정/삭제/고정 토글 로직 보존(제거되지 않음) ──────────────
test('AC5: 도파민 유래 메모도 잠금 아님 — CRUD 핸들러 보존', () => {
  const src = readTimeline();
  // 편집/삭제/고정 토글 로직이 sourcePinned 도입으로 제거되지 않음
  expect(src).toContain('const saveEdit');
  expect(src).toContain('const deleteMemo');
  expect(src).toContain('const togglePin');
  // source_system 을 이유로 disabled/readonly 처리하는 잠금 분기 없음
  expect(src).not.toMatch(/sourcePinned\s*&&[^\n]*disabled/);
  expect(src).not.toMatch(/disabled=\{[^}]*sourcePinned/);
});

// ── 시나리오 2 착지면: 예약상세 팝업이 예약메모 타임라인을 렌더 ────────────────
test('시나리오2: ReservationDetailPopup 예약메모 영역이 타임라인 렌더', () => {
  const popup = readPopup();
  expect(popup).toContain('ReservationMemoTimeline');
  // 예약메모 섹션 존재
  expect(popup).toContain('예약메모');
});
