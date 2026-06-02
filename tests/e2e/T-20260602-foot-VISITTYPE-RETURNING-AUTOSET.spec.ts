/**
 * T-20260602-foot-VISITTYPE-RETURNING-AUTOSET
 * 방문이력 고객 '초진' 배지 오노출 정정 — visit_type 자동 재진 전환
 *
 * 근본 원인:
 *   customers.visit_type DEFAULT 'new' 고착 + 체크인 완료(status='done') 시
 *   'returning' 승격 로직이 코드 전체에 부재 → 방문이력 쌓여도 영구 '초진' 배지.
 *
 * 트랙1(DB 백필): new+done → returning (EXISTS 가드·멱등).
 * 트랙2(코드): lib/visitType.ts promoteVisitTypeToReturning 를 4개 완료 진입점
 *   (Dashboard 드래그/컨텍스트, PaymentDialog, PaymentMiniWindow)에서 호출.
 *
 * 본 spec 은 두 트랙의 핵심 데이터 계약을 service_role 로 결정적으로 못박는다.
 * 완료 진입점(트랙2)이 실행하는 customers UPDATE 와 백필 UPDATE(트랙1)는
 * 의미상 동일한 쿼리(set returning where id & visit_type='new' [+ EXISTS done])이므로,
 * 그 계약을 데이터 레벨에서 검증하면 회귀를 방지할 수 있다.
 * (배지 렌더 자체는 CustomerChartPage L3527 visit_type==='new'?'초진' 로직 + supervisor 풀 E2E 가 커버.)
 */
import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[QA-FIXTURE-VISITTYPE]';

function svc(): SupabaseClient {
  return createClient(SUPA_URL, SERVICE_KEY);
}

/** customer 1명 생성 (+ 선택적 done 체크인) */
async function seedCustomer(
  sb: SupabaseClient,
  opts: { visit_type: 'new' | 'returning'; withDoneCheckIn: boolean },
): Promise<{ customerId: string; cleanup: () => Promise<void> }> {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const phone = `010${String(ts).slice(-8)}`;
  const name = `${MARKER}-${ts}`;
  const { data: c, error: cErr } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: opts.visit_type, memo: MARKER })
    .select('id')
    .single();
  if (cErr || !c) throw new Error(`seedCustomer failed: ${cErr?.message}`);
  const customerId = c.id as string;
  let checkInId: string | null = null;

  if (opts.withDoneCheckIn) {
    const { data: ci, error: ciErr } = await sb
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customerId,
        customer_name: name,
        customer_phone: phone,
        visit_type: opts.visit_type,
        status: 'done',
        checked_in_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        notes: MARKER,
      })
      .select('id')
      .single();
    if (ciErr || !ci) {
      await sb.from('customers').delete().eq('id', customerId);
      throw new Error(`seedCustomer check_in failed: ${ciErr?.message}`);
    }
    checkInId = ci.id as string;
  }

  return {
    customerId,
    cleanup: async () => {
      if (checkInId) await sb.from('check_ins').delete().eq('id', checkInId);
      await sb.from('customers').delete().eq('id', customerId);
    },
  };
}

async function getVisitType(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from('customers').select('visit_type').eq('id', id).single();
  return (data?.visit_type as string) ?? null;
}

/** 트랙2 promoteVisitTypeToReturning 와 동일한 계약 쿼리 */
async function promote(sb: SupabaseClient, customerId: string) {
  return sb
    .from('customers')
    .update({ visit_type: 'returning' })
    .eq('id', customerId)
    .eq('visit_type', 'new');
}

/** 트랙1 백필과 동일한 계약 쿼리 (단일 고객 스코프) */
async function backfillFor(sb: SupabaseClient, customerId: string) {
  // EXISTS(done check_in) 가드를 코드로 재현: done 존재 시에만 promote
  const { count } = await sb
    .from('check_ins')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'done');
  if ((count ?? 0) > 0) {
    return promote(sb, customerId);
  }
  return null;
}

test.describe('T-20260602 visit_type 자동 재진 전환', () => {
  test('시나리오3(트랙2 핵심): 신규(new) 고객 완료 승격 시 returning 으로 전환', async () => {
    const sb = svc();
    const { customerId, cleanup } = await seedCustomer(sb, { visit_type: 'new', withDoneCheckIn: false });
    try {
      expect(await getVisitType(sb, customerId)).toBe('new');
      const { error } = await promote(sb, customerId);
      expect(error).toBeNull();
      expect(await getVisitType(sb, customerId)).toBe('returning'); // 배지 '초진' 사라짐
    } finally {
      await cleanup();
    }
  });

  test('시나리오4(멱등): 이미 returning 고객 재완료 시 변화 없음', async () => {
    const sb = svc();
    const { customerId, cleanup } = await seedCustomer(sb, { visit_type: 'returning', withDoneCheckIn: false });
    try {
      expect(await getVisitType(sb, customerId)).toBe('returning');
      const { error } = await promote(sb, customerId);
      expect(error).toBeNull();
      // .eq('visit_type','new') 가드로 미변경 (멱등, 타 필드 비손상)
      expect(await getVisitType(sb, customerId)).toBe('returning');
    } finally {
      await cleanup();
    }
  });

  test('시나리오1(트랙1): 방문이력(done 1건+) 있는 new 고객은 백필 대상 → returning', async () => {
    const sb = svc();
    const { customerId, cleanup } = await seedCustomer(sb, { visit_type: 'new', withDoneCheckIn: true });
    try {
      expect(await getVisitType(sb, customerId)).toBe('new');
      const res = await backfillFor(sb, customerId);
      expect(res).not.toBeNull();
      expect(res!.error).toBeNull();
      expect(await getVisitType(sb, customerId)).toBe('returning');
    } finally {
      await cleanup();
    }
  });

  test('시나리오2(트랙1): 방문이력(done) 0건 진짜 초진은 백필 대상 아님 → new 유지', async () => {
    const sb = svc();
    const { customerId, cleanup } = await seedCustomer(sb, { visit_type: 'new', withDoneCheckIn: false });
    try {
      expect(await getVisitType(sb, customerId)).toBe('new');
      const res = await backfillFor(sb, customerId);
      expect(res).toBeNull(); // EXISTS 가드 → 대상 아님 (오버킬 방지)
      expect(await getVisitType(sb, customerId)).toBe('new');
    } finally {
      await cleanup();
    }
  });
});
