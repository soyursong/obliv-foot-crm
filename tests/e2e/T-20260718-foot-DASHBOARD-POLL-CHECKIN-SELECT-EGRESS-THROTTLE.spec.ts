/**
 * E2E Spec — T-20260718-foot-DASHBOARD-POLL-CHECKIN-SELECT-EGRESS-THROTTLE
 * 대시보드 egress 절감 (TOP2: 30초 무조건 폴 fallback + check_ins select('*'))
 *
 * AC-1: 폴 fallback 을 realtime 단절 시에만(또는 60~120s 완화) 발화
 *        → realtimeHealthy 게이트 + healthy 구간 120초 safety-net / unhealthy 30초 fast fallback
 * AC-2: fetchCheckIns / fetchSelfCheckIns select 표시컬럼 축소
 *        → treatment_photos / prescription_items / document_content 3종 목록 fetch 제외(상세 패널 id 재조회)
 * AC-3: 잔여 fetch 5종 점검 (fetchStageStarts 등은 이미 최소 컬럼 — 회귀 없음)
 * AC-4: 신선도 회귀0 — 축소 select 가 목록 소비 컬럼 전량을 그대로 반환
 *
 * ⚠ GO_WARN: 라이브 렌더 회귀0 게이트는 7/19 빌링 리셋(또는 spend cap 해제) 이후 수행.
 *   본 spec 의 소스-정적 가드(§A)는 env 불요 상시 실행. 라이브 DB 정합(§B)은 env-gated.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SRC = resolve(__dirname, '../../src/pages/Dashboard.tsx');

// ── §A 소스-정적 가드 (env 불요, 상시 실행) ──────────────────────────────────

test.describe('T-20260718 §A — 소스 정적 가드 (egress 축소 불변식)', () => {
  const src = readFileSync(DASHBOARD_SRC, 'utf-8');

  test('AC-2: 목록 select 에 대용량 3종 컬럼이 제외된다', () => {
    // CHECKIN_LIST_COLS 상수 존재
    expect(src).toContain('const CHECKIN_LIST_COLS');
    const constMatch = src.match(/const CHECKIN_LIST_COLS\s*=\s*([\s\S]*?);/);
    expect(constMatch, 'CHECKIN_LIST_COLS 상수를 찾지 못함').not.toBeNull();
    const cols = constMatch![1];
    // 드롭 3종은 목록 컬럼 문자열에 없어야 함
    for (const dropped of ['treatment_photos', 'prescription_items', 'document_content']) {
      expect(cols, `${dropped} 는 목록 fetch 에서 제외되어야 함`).not.toContain(dropped);
    }
  });

  test('AC-4: 목록 row 에서 소비되는 컬럼은 유지된다 (신선도 회귀 방지)', () => {
    const constMatch = src.match(/const CHECKIN_LIST_COLS\s*=\s*([\s\S]*?);/);
    const cols = constMatch![1];
    // CheckInDetailSheet 가 prop 으로 읽는 컬럼 + getCallTime(status_flag_history) + 카드 렌더 필수 컬럼
    const mustKeep = [
      'id', 'clinic_id', 'customer_id', 'customer_name', 'customer_phone',
      'visit_type', 'status', 'status_flag', 'status_flag_history',
      'notes', 'treatment_memo', 'doctor_note', 'treatment_contents',
      'queue_number', 'checked_in_at', 'treating_doctor_id', 'call_list_manual_order',
      'doctor_status', 'doctor_ack_at', 'prescription_status',
    ];
    for (const keep of mustKeep) {
      expect(cols, `${keep} 는 목록 fetch 에 유지되어야 함`).toContain(keep);
    }
  });

  test('AC-2: 두 목록 fetch(check_ins) 가 select(*) 대신 CHECKIN_LIST_COLS 를 쓴다', () => {
    // check_ins 목록 fetch 의 select('*, customers(name, chart_number)') 잔존 없어야 함
    //   (designated_therapist_id 변형은 fetchTimelineReservations=reservations 테이블에서 계속 사용 — 범위 외)
    expect(src).not.toContain(".select('*, customers(name, chart_number)')");
    // CHECKIN_LIST_COLS 를 embed 와 함께 쓰는 check_ins 목록 fetch 2개소(fetchCheckIns + fetchSelfCheckIns)
    const usages = src.match(/\$\{CHECKIN_LIST_COLS\}, customers\(/g) ?? [];
    expect(usages.length, 'CHECKIN_LIST_COLS 를 쓰는 목록 fetch 가 2개소여야 함').toBe(2);
  });

  test('AC-1: 폴링이 realtimeHealthy 게이트로 조건부 실행된다', () => {
    // realtimeHealthy 플래그 정의
    expect(src).toContain('let realtimeHealthy = false');
    // SUBSCRIBED → healthy, 단절 → unhealthy 전환
    expect(src).toMatch(/realtimeHealthy = true/);
    expect(src).toMatch(/realtimeHealthy = false/);
    // pollTimer 가 realtimeHealthy 를 검사(무조건 실행이 아님)
    const pollBlock = src.match(/const pollTimer = setInterval\(\(\) => \{([\s\S]*?)\}, POLL_TICK_MS\);/);
    expect(pollBlock, 'pollTimer 블록을 찾지 못함').not.toBeNull();
    expect(pollBlock![1], '폴 콜백이 realtimeHealthy 를 게이트로 검사해야 함').toContain('realtimeHealthy');
  });

  test('AC-1: healthy 구간 완화 주기(120초) safety-net 이 설정된다', () => {
    // 30초 tick 유지(빠른 복구) + healthy 4tick(=120초) 완화
    expect(src).toContain('POLL_TICK_MS = 30000');
    expect(src).toContain('HEALTHY_POLL_EVERY_TICKS = 4');
  });
});

// ── §B 라이브 DB 정합 (env-gated, 7/19 빌링 리셋 이후 수행) ────────────────────

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

test.describe('T-20260718 §B — 라이브 목록 fetch 정합 (신선도 회귀0)', () => {
  test('축소 select 가 목록 소비 컬럼을 반환하고 드롭 3종은 부재', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 / 402 우산 — 7/19 이후 수행');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    // Dashboard 목록 fetch 와 동일 컬럼셋으로 조회 (embed 포함)
    const CHECKIN_LIST_COLS =
      'id, clinic_id, customer_id, reservation_id, queue_number, customer_name, customer_phone, ' +
      'visit_type, status, consultant_id, therapist_id, technician_id, consultation_room, treatment_room, ' +
      'laser_room, package_id, notes, treatment_memo, doctor_note, examination_room, checked_in_at, ' +
      'called_at, completed_at, priority_flag, sort_order, skip_reason, created_at, consultation_done, ' +
      'treatment_kind, preconditioning_done, pododulle_done, laser_minutes, doctor_confirm_charting, ' +
      'doctor_confirm_prescription, doctor_confirm_document, doctor_confirmed_at, healer_laser_confirm, ' +
      'prescription_status, status_flag, status_flag_history, assigned_counselor_id, treatment_category, ' +
      'treatment_contents, doctor_call_memo, doctor_ack_at, doctor_status, doctor_started_at, doctor_ended_at, ' +
      'call_list_manual_order, treating_doctor_id';

    const { data, error } = await sb
      .from('check_ins')
      .select(`${CHECKIN_LIST_COLS}, customers(name, chart_number)`)
      .eq('clinic_id', CLINIC_ID)
      .limit(1);
    expect(error, `축소 select 실패: ${error?.message}`).toBeNull();

    if (data && data.length > 0) {
      const row = data[0] as Record<string, unknown>;
      // 소비 컬럼 존재
      expect(row).toHaveProperty('status_flag_history');
      expect(row).toHaveProperty('doctor_note');
      expect(row).toHaveProperty('treatment_memo');
      // 드롭 3종 부재 (egress 절감 확인)
      expect(Object.keys(row)).not.toContain('treatment_photos');
      expect(Object.keys(row)).not.toContain('prescription_items');
      expect(Object.keys(row)).not.toContain('document_content');
    }
  });
});
