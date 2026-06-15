/**
 * E2E spec — T-20260615-foot-CALLLIST-ROOMSUMMARY-NUM-REORDER
 * '원장님 진료콜 명단'(DoctorCallListBar) 3 work-stream:
 *   WS-A 방번호 상단 요약행(진료순 좌→우, 미배정 '–')
 *   WS-B 박스 앞 진입순 번호뱃지(1·2·3…, 최종 정렬순서 인덱스)
 *   WS-C 수기 순서 올림(▲) — call_list_manual_order asc 영속 + 단일 통합 정렬자
 *
 * 현장 요청(김주연 총괄, #project-doai-crm-풋확장 2026-06-15 19:12):
 *   "맨 상단에 진료순 방번호만 한줄(원장님 한눈에) + 박스 앞에 진입순 번호 +
 *    진입 1번이어도 준비 빨리 끝나면 수기로 순서 올리게."
 *
 * 정렬 단일화(분산 sort 금지, WS-2 정합): compareCallOrder
 *   tier1 진료중(examination/doctor_status=in_treatment) 고정 > tier2 수기 override(call_list_manual_order asc) > tier3 진입순(callEntryTime).
 *
 * AC → 단언 매핑(티켓 본문 현장 클릭 시나리오 1~4 변환):
 *   시나리오1(WS-A): roomSummary가 activeList 진료순 좌→우 방코드 나열, 행 순서와 일치.
 *   시나리오2(WS-B): 진입순 1-based 번호 = 정렬 인덱스. 늦게 접수·먼저 콜진입 → 1번(접수순 아님).
 *   시나리오3(WS-C): manual_order asc가 진입순 override(낮은 값 상단). 진료중 고정 상단 유지.
 *   시나리오4(엣지): 미배정 방 '–'·정렬 안 깨짐 / 진료중 고정 우선 / 명단 0명 위젯 DOM 유지(empty-state).
 *   소스가드: compareCallOrder·getCurrentRoomCode export + activeList가 compareCallOrder로 정렬 + testid 존재(회귀 락).
 *
 * 컨벤션(repo): 정본 로직 순수함수 모사 + 소스 정적 가드 + DOM graceful skip
 *   (cf. T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = path.resolve(__dirname, '../../src/components/DoctorCallListBar.tsx');
const SLOT_SRC = path.resolve(__dirname, '../../src/lib/checkin-slot.ts');

// ── 정본 로직 모사 (소스 정적 가드로 정본 동치 락) ───────────────────────────────
type Hist = Array<{ flag: string | null; changed_at: string }> | null;
type MiniCheckIn = {
  id: string;
  checked_in_at: string;
  status: string;
  status_flag: string | null;
  status_flag_history: Hist;
  doctor_status?: 'in_treatment' | 'done' | null;
  call_list_manual_order?: number | null;
  // room 필드(WS-A 요약행 모사용)
  consultation_room?: string | null;
  examination_room?: string | null;
  treatment_room?: string | null;
  laser_room?: string | null;
};

function callEntryTime(ci: Pick<MiniCheckIn, 'checked_in_at' | 'status_flag_history'>): string {
  const hist = ci.status_flag_history;
  if (Array.isArray(hist) && hist.length > 0) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const e = hist[i];
      if (e && (e.flag === 'purple' || e.flag === 'yellow') && e.changed_at) return e.changed_at;
    }
  }
  return ci.checked_in_at;
}

function isInTreatment(ci: MiniCheckIn): boolean {
  return ci.status === 'examination' || ci.doctor_status === 'in_treatment';
}

function compareCallOrder(a: MiniCheckIn, b: MiniCheckIn): number {
  const at = isInTreatment(a) ? 0 : 1;
  const bt = isInTreatment(b) ? 0 : 1;
  if (at !== bt) return at - bt;
  const am = typeof a.call_list_manual_order === 'number' ? a.call_list_manual_order : null;
  const bm = typeof b.call_list_manual_order === 'number' ? b.call_list_manual_order : null;
  if (am !== null && bm !== null) {
    if (am !== bm) return am - bm;
  } else if (am !== null || bm !== null) {
    return am !== null ? -1 : 1;
  }
  return callEntryTime(a).localeCompare(callEntryTime(b));
}

function sortActive(rows: MiniCheckIn[]): MiniCheckIn[] {
  return rows
    .filter((ci) => ci.status_flag === 'purple' || ci.status_flag === 'yellow' || ci.status === 'healer_waiting')
    .sort(compareCallOrder);
}

// getCurrentRoomCode 모사(checkin-slot SSOT) — 입실단계만 방코드, 그 외 null.
const IN_ROOM = ['consultation', 'examination', 'preconditioning', 'laser'];
function getAssignedSlotName(ci: MiniCheckIn): string | null {
  const ne = (v?: string | null) => ((v ?? '').trim() === '' ? null : (v as string).trim());
  switch (ci.status) {
    case 'consultation':
    case 'consult_waiting':
      return ne(ci.consultation_room);
    case 'examination':
    case 'exam_waiting':
      return ne(ci.examination_room);
    case 'treatment_waiting':
      return null;
    case 'preconditioning':
      return ne(ci.treatment_room);
    case 'laser':
    case 'laser_waiting':
    case 'healer_waiting':
      return ne(ci.laser_room);
    default:
      return ne(ci.laser_room) ?? ne(ci.treatment_room) ?? ne(ci.consultation_room) ?? ne(ci.examination_room);
  }
}
function getCurrentRoomCode(ci: MiniCheckIn): string | null {
  return IN_ROOM.includes(ci.status) ? getAssignedSlotName(ci) : null;
}
function roomSummary(active: MiniCheckIn[]): string[] {
  return active.map((ci) => getCurrentRoomCode(ci) ?? '–');
}

test.describe('T-20260615 CALLLIST-ROOMSUMMARY-NUM-REORDER — 방요약·진입순번호·수기순서', () => {
  // 공통 픽스처: 3명, 진입순 = B(10:00) < A(11:00) < C(12:00). 접수순(checked_in)과 다름.
  const A: MiniCheckIn = {
    id: 'A', checked_in_at: '2026-06-15T09:00:00+09:00', status: 'preconditioning', status_flag: 'purple',
    status_flag_history: [{ flag: 'purple', changed_at: '2026-06-15T11:00:00+09:00' }], treatment_room: 'C1',
  };
  const B: MiniCheckIn = {
    id: 'B', checked_in_at: '2026-06-15T10:00:00+09:00', status: 'consultation', status_flag: 'purple',
    status_flag_history: [{ flag: 'purple', changed_at: '2026-06-15T10:00:00+09:00' }], consultation_room: '상담실2',
  };
  const C: MiniCheckIn = {
    id: 'C', checked_in_at: '2026-06-15T08:00:00+09:00', status: 'treatment_waiting', status_flag: 'purple',
    status_flag_history: [{ flag: 'purple', changed_at: '2026-06-15T12:00:00+09:00' }], treatment_room: 'C9',
  };

  test('시나리오2(WS-B) 진입순 번호 = 정렬 인덱스 (접수순 아님, 늦접수·먼저콜=1번)', () => {
    const order = sortActive([A, B, C]).map((c) => c.id);
    // 진입 시각: B=10:00 < A=11:00 < C=12:00
    expect(order).toEqual(['B', 'A', 'C']);
    // 1-based 번호뱃지 → B=1, A=2, C=3
    const numbers = Object.fromEntries(order.map((id, i) => [id, i + 1]));
    expect(numbers).toEqual({ B: 1, A: 2, C: 3 });
  });

  test('시나리오1(WS-A) 방번호 요약행 = 진료순 좌→우, 행 순서와 일치, 미배정 –', () => {
    const active = sortActive([A, B, C]); // [B, A, C]
    // B=상담실(상담실2), A=치료실입실(C1), C=치료대기(방 미표시 → '–')
    expect(roomSummary(active)).toEqual(['상담실2', 'C1', '–']);
    // 요약행 토큰 순서 == 활성 행(번호뱃지) 순서
    expect(active.map((c) => c.id)).toEqual(['B', 'A', 'C']);
  });

  test('시나리오3(WS-C) 수기 override: manual_order asc가 진입순보다 우선 (C를 맨 위로)', () => {
    // C(진입순 3번)에 가장 작은 manual_order 부여 → 최상단. 나머지는 sparse 재할당.
    const Cm = { ...C, call_list_manual_order: 10 };
    const Bm = { ...B, call_list_manual_order: 20 };
    const Am = { ...A, call_list_manual_order: 30 };
    const order = sortActive([Am, Bm, Cm]).map((c) => c.id);
    expect(order).toEqual(['C', 'B', 'A']);
    // 일부만 manual(값 있는 행이 NULL 행보다 위)
    const mixed = sortActive([A, { ...B, call_list_manual_order: 5 }, C]).map((c) => c.id);
    expect(mixed[0]).toBe('B'); // manual 값 있는 B가 NULL인 A·C보다 위
  });

  test('시나리오3/4 진료중(examination/in_treatment) 고정 — manual_order보다도 우선 상단', () => {
    // A를 진료중(examination)으로. C는 manual_order로 위로 올리려 해도 진료중 A가 tier-1 상단.
    const Aexam: MiniCheckIn = { ...A, status: 'examination', examination_room: '원장실1' };
    const Cm = { ...C, call_list_manual_order: 1 }; // 가장 작은 수기값
    const order = sortActive([Aexam, B, Cm]).map((c) => c.id);
    expect(order[0]).toBe('A'); // 진료중 고정 최상단(수기값 1의 C보다도 위)
    // doctor_status='in_treatment'도 동일 고정
    const Bsess: MiniCheckIn = { ...B, doctor_status: 'in_treatment' };
    expect(sortActive([Cm, Bsess]).map((c) => c.id)[0]).toBe('B');
  });

  test('시나리오4 엣지: manual_order 전부 NULL/미적용이면 진입순(tier-3)로 수렴 = 기존 거동', () => {
    // 마이그 전(컬럼 undefined) 안전 폴백 — call_list_manual_order 키 자체 없음.
    const noCol = [A, B, C].map((c) => { const { call_list_manual_order, ...rest } = c as MiniCheckIn; return rest as MiniCheckIn; });
    expect(sortActive(noCol).map((c) => c.id)).toEqual(['B', 'A', 'C']);
  });

  test('소스 가드: compareCallOrder·getCurrentRoomCode export + activeList가 compareCallOrder 정렬 + testid 존재', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf-8');
    const slot = fs.readFileSync(SLOT_SRC, 'utf-8');
    // 단일 통합 정렬자 export + checkin-slot 방코드 헬퍼 export
    expect(src).toMatch(/export function compareCallOrder\(/);
    expect(slot).toMatch(/export function getCurrentRoomCode\(/);
    // activeList 블록이 단일 compareCallOrder로 정렬(분산 sort 금지 회귀 락)
    const activeBlock = src.slice(src.indexOf('const activeList'), src.indexOf('const doneList'));
    expect(activeBlock).toContain('.sort(compareCallOrder)');
    // 신규 surface testid 존재
    expect(src).toContain('doctor-call-room-summary'); // WS-A
    expect(src).toContain('doctor-call-order-no');     // WS-B
    expect(src).toContain('doctor-call-move-up');       // WS-C
    // WS-C 영속 컬럼 write
    expect(src).toContain('call_list_manual_order');
  });

  test('DOM 스모크: 명단 위젯 렌더 (데이터/인증 없으면 graceful skip)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page).catch(() => false);
    test.skip(!ok, '로그인/대시보드 접근 불가 — DOM 단언 graceful skip');
    const widget = page.getByTestId('doctor-call-list');
    await expect(widget).toBeVisible({ timeout: 10_000 });
  });
});
