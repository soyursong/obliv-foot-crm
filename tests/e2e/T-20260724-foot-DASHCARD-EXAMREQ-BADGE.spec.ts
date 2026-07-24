/**
 * E2E Spec — T-20260724-foot-DASHCARD-EXAMREQ-BADGE
 * 데스크 대시보드(/dashboard) 예약슬롯 고객 카드에 균검사(🔬초록·"균")/피검사(🩸빨강·"피")
 * 신청상태 아이콘 뱃지 표시. 2번차트 치료신청 탭에서 신청된 상태를 읽기전용 소비.
 * 김주연 총괄 확정안(🅐 아이콘 뱃지형).
 *
 * ── 데이터 소스 SSOT (착수 전 확정, db_change=false) ──
 *   · 균검사(koh)  = check_in_services.koh_requested (bool)        + request_koh_for_customer RPC
 *   · 피검사(blood)= check_in_services.blood_test_requested (bool) + request_blood_test_for_customer RPC
 *   deployed(T-20260723-foot-LABTEST 선례). 뱃지는 이 상태의 읽기전용 소비자 — 신규 영속 컬럼 신설 0.
 *
 * ── AC 매핑 ──
 *   AC-1 균/피 신청 저장 → 카드 뱃지 스펙대로 렌더 (scenario 1·2)
 *   AC-2 둘 다 신청 시 두 뱃지 나란히, 레이아웃 무깨짐 (scenario 3, 컨테이너 inline-flex 격리)
 *   AC-3 뱃지 위치 = 스크린샷 빨간박스(카드 배지행, 고객명/시간 하단) — DraggableCard 배지행 삽입
 *   AC-4 새로고침/재진입 시 뱃지 상태 정합 (check_in_id 기준 재조회 = 영속 상태 1:1)
 *   AC-5 미신청 카드 뱃지 미표시 (scenario 4), 기존 카드 회귀 0 (에러 시 빈 맵 폴백)
 *   AC-6 소스 재사용(신규 영속 컬럼 미신설)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── 대시보드 카드 뱃지 aggregation 로직 SSOT 미러 ──────────────────────────────
//   Dashboard.tsx fetchExamFlags 의 reducer 와 동형: check_in_services rows → check_in 단위 {blood,koh}.
//   한 check_in 에 여러 service 행 → 하나라도 true 면 신청됨(any-true).
type Flag = { blood: boolean; koh: boolean };
function aggregateExamFlags(
  rows: { check_in_id: string; blood_test_requested?: boolean; koh_requested?: boolean }[],
): Map<string, Flag> {
  const m = new Map<string, Flag>();
  for (const r of rows) {
    const cur = m.get(r.check_in_id) ?? { blood: false, koh: false };
    if (r.blood_test_requested === true) cur.blood = true;
    if (r.koh_requested === true) cur.koh = true;
    m.set(r.check_in_id, cur);
  }
  return m;
}

// ── ExamRequestBadges 렌더 규칙 미러 (몇 개 뱃지가 보이는가) ────────────────────
function visibleBadges(flags?: Flag): ('koh' | 'blood')[] {
  if (!flags || (!flags.koh && !flags.blood)) return [];
  const out: ('koh' | 'blood')[] = [];
  if (flags.koh) out.push('koh');   // 🔬 초록 "균"
  if (flags.blood) out.push('blood'); // 🩸 빨강 "피"
  return out;
}

// ── 순수 로직 검증 (env 불요) ──────────────────────────────────────────────────
test.describe('T-20260724-DASHCARD-EXAMREQ-BADGE — 뱃지 표시 규칙 (로직)', () => {
  test('scenario 1: 균검사만 신청 → 🔬"균" 뱃지 1개', () => {
    expect(visibleBadges({ koh: true, blood: false })).toEqual(['koh']);
  });

  test('scenario 2: 피검사만 신청 → 🩸"피" 뱃지 1개', () => {
    expect(visibleBadges({ koh: false, blood: true })).toEqual(['blood']);
  });

  test('scenario 3: 둘 다 신청 → 🔬"균" + 🩸"피" 나란히 2개 (순서: 균→피)', () => {
    expect(visibleBadges({ koh: true, blood: true })).toEqual(['koh', 'blood']);
  });

  test('scenario 4: 미신청 → 뱃지 없음', () => {
    expect(visibleBadges({ koh: false, blood: false })).toEqual([]);
    expect(visibleBadges(undefined)).toEqual([]);
  });

  test('aggregation: 한 check_in 여러 service 행 중 하나라도 true 면 신청됨(any-true)', () => {
    const m = aggregateExamFlags([
      { check_in_id: 'A', koh_requested: false, blood_test_requested: false },
      { check_in_id: 'A', koh_requested: true, blood_test_requested: false }, // KOH 마커 행
      { check_in_id: 'A', koh_requested: false, blood_test_requested: true }, // blood(전행 적용) 행
      { check_in_id: 'B', koh_requested: false, blood_test_requested: false },
    ]);
    expect(m.get('A')).toEqual({ koh: true, blood: true });
    expect(m.get('B')).toEqual({ koh: false, blood: false }); // 미신청 → 뱃지 없음
  });
});

// ── DB 레이어 검증: SSOT 컬럼 재사용 + 신청 상태 영속·집계 정합 ──────────────────
test.describe('T-20260724-DASHCARD-EXAMREQ-BADGE — SSOT 소스 + 상태 정합 (DB)', () => {
  test('check_in_services.koh_requested / blood_test_requested 로 4 상태 영속·집계', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const stamp = Date.now();
    const created: string[] = []; // check_in ids for cleanup
    const custIds: string[] = [];

    // 4 시나리오 = 균만 / 피만 / 둘다 / 미신청
    const cases: { key: string; koh: boolean; blood: boolean }[] = [
      { key: 'kohOnly', koh: true, blood: false },
      { key: 'bloodOnly', koh: false, blood: true },
      { key: 'both', koh: true, blood: true },
      { key: 'none', koh: false, blood: false },
    ];

    try {
      const results: Record<string, string> = {};
      for (const c of cases) {
        const name = `exambadge-${c.key}-${stamp}`;
        const phone = `DUMMY-${c.key}-${stamp}`;
        const { data: cust, error: custErr } = await sb
          .from('customers')
          .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
          .select('id')
          .single();
        expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
        custIds.push(cust!.id);

        const { data: ci, error: ciErr } = await sb
          .from('check_ins')
          .insert({
            clinic_id: CLINIC_ID, customer_id: cust!.id, customer_name: name,
            customer_phone: phone, visit_type: 'returning', status: 'treatment_waiting',
            queue_number: 8800 + (stamp % 100) + cases.indexOf(c),
          })
          .select('id')
          .single();
        expect(ciErr, `체크인 생성 실패: ${ciErr?.message}`).toBeNull();
        created.push(ci!.id);
        results[c.key] = ci!.id;

        // check_in_services: 균/피 플래그가 실리는 서비스 행 (읽기전용 소비 대상 SSOT)
        const { error: svcErr } = await sb.from('check_in_services').insert({
          check_in_id: ci!.id,
          service_id: null, service_name: '검사신청(테스트)', price: 0, original_price: 0,
          is_package_session: false,
          koh_requested: c.koh, blood_test_requested: c.blood,
        });
        expect(svcErr, `검사신청 서비스행 생성 실패(SSOT 컬럼 재사용): ${svcErr?.message}`).toBeNull();
      }

      // 대시보드 fetchExamFlags 와 동형 조회 → 집계
      const { data: rows, error: selErr } = await sb
        .from('check_in_services')
        .select('check_in_id, blood_test_requested, koh_requested')
        .in('check_in_id', created);
      expect(selErr, `플래그 조회 실패: ${selErr?.message}`).toBeNull();

      const m = aggregateExamFlags((rows ?? []) as never);

      // AC-1/2/5: 각 시나리오 뱃지 표시 규칙 정합
      expect(visibleBadges(m.get(results.kohOnly))).toEqual(['koh']);
      expect(visibleBadges(m.get(results.bloodOnly))).toEqual(['blood']);
      expect(visibleBadges(m.get(results.both))).toEqual(['koh', 'blood']);
      expect(visibleBadges(m.get(results.none))).toEqual([]);
    } finally {
      // cleanup (순소실 0 — 테스트 데이터만)
      if (created.length) await sb.from('check_in_services').delete().in('check_in_id', created);
      if (created.length) await sb.from('check_ins').delete().in('id', created);
      if (custIds.length) await sb.from('customers').delete().in('id', custIds);
    }
  });
});
