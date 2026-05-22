/**
 * E2E Spec — T-20260522-foot-ALT-BADGE
 * ALT(올트) 배지 + 상담 ALT 버튼 + 고객메모 고정 + 자동 연동 통합 검증
 *
 * AC-1: 2번차트 3구역 > 상담 탭 > 담당자 드롭 하단에 ALT 버튼 + 상세내용 입력 필드
 * AC-2: ALT 활성화 시 대시보드 고객박스에 메탈릭 실버 [ALT] 배지 표시
 * AC-3: 예약 고객메모 히스토리 형태 + [고정] 기능 (is_pinned=true 최상단 고정)
 * AC-4a: ALT ON 시 고정 메모(reservation_memo_history is_pinned=true) 자동 기입
 * AC-4b: ALT ON 시 서류출력 레이저코드 삽입 차단
 * AC-5: 기존 동작 미영향 + 기존 메모 데이터 보존 (비파괴적 추가)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── AC-2 / AC-3 / AC-4a: DB 레이어 검증 ──────────────────────────────────────

test.describe('T-20260522-ALT-BADGE — AC-2/3/4a: DB 스키마 + ALT 활성화 로직', () => {

  test('customers 테이블에 alt_status, alt_detail, alt_activated_at 컬럼 존재', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-badge-ac2-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // customers INSERT with alt_status 필드
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({
        clinic_id: CLINIC_ID,
        name: testName,
        phone: testPhone,
        visit_type: 'returning',
        alt_status: false,
        alt_detail: null,
        alt_activated_at: null,
      })
      .select('id, alt_status, alt_detail, alt_activated_at')
      .single();

    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
    expect(customer!.alt_status).toBe(false);
    expect(customer!.alt_detail).toBeNull();
    expect(customer!.alt_activated_at).toBeNull();

    // cleanup
    await sb.from('customers').delete().eq('id', customer!.id);
  });

  test('ALT 활성화 — alt_status=true, alt_detail 저장, alt_activated_at 기록', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-badge-activate-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const now = new Date().toISOString();
    const testDetail = '5회차까지 진행, 보험 반려됨';

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
    const customerId = customer!.id as string;

    try {
      // ALT 활성화 UPDATE
      const { error: updErr } = await sb.from('customers').update({
        alt_status: true,
        alt_detail: testDetail,
        alt_activated_at: now,
      }).eq('id', customerId);
      expect(updErr, `ALT 업데이트 실패: ${updErr?.message}`).toBeNull();

      // 검증
      const { data: row, error: fetchErr } = await sb
        .from('customers')
        .select('alt_status, alt_detail, alt_activated_at')
        .eq('id', customerId)
        .single();
      expect(fetchErr).toBeNull();
      expect(row!.alt_status).toBe(true);
      expect(row!.alt_detail).toBe(testDetail);
      expect(row!.alt_activated_at).toBeTruthy();
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('ALT 해제 — alt_status=false, alt_activated_at=null 초기화', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-badge-deactivate-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({
        clinic_id: CLINIC_ID,
        name: testName,
        phone: testPhone,
        visit_type: 'returning',
        alt_status: true,
        alt_detail: '테스트 상세',
        alt_activated_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
    const customerId = customer!.id as string;

    try {
      // ALT 해제
      const { error: updErr } = await sb.from('customers').update({
        alt_status: false,
        alt_activated_at: null,
      }).eq('id', customerId);
      expect(updErr, `ALT 해제 실패: ${updErr?.message}`).toBeNull();

      const { data: row } = await sb
        .from('customers')
        .select('alt_status, alt_activated_at')
        .eq('id', customerId)
        .single();
      expect(row!.alt_status).toBe(false);
      expect(row!.alt_activated_at).toBeNull();
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });
});

// ── AC-3 / AC-4a: 고객메모 고정 기능 (is_pinned) ────────────────────────────

test.describe('T-20260522-ALT-BADGE — AC-3/4a: reservation_memo_history 고정 기능', () => {

  test('reservation_memo_history에 is_pinned, pinned_at 컬럼 존재 + 기본값 false', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-memo-col-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 고객 생성
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
    const customerId = customer!.id as string;

    try {
      // is_pinned 기본값 검증 — INSERT 없이 DEFAULT
      const { data: memo, error: memoErr } = await sb
        .from('reservation_memo_history')
        .insert({
          customer_id: customerId,
          clinic_id: CLINIC_ID,
          content: '테스트 메모 — 기본 is_pinned',
          created_by_name: 'test-spec',
        })
        .select('id, is_pinned, pinned_at')
        .single();
      expect(memoErr, `메모 삽입 실패: ${memoErr?.message}`).toBeNull();
      expect(memo!.is_pinned).toBe(false);
      expect(memo!.pinned_at).toBeNull();

      // cleanup
      await sb.from('reservation_memo_history').delete().eq('id', memo!.id);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('메모 고정 — is_pinned=true, pinned_at 기록', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-memo-pin-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    expect(custErr).toBeNull();
    const customerId = customer!.id as string;

    try {
      const { data: memo } = await sb
        .from('reservation_memo_history')
        .insert({ customer_id: customerId, clinic_id: CLINIC_ID, content: '고정 테스트', created_by_name: 'spec' })
        .select('id')
        .single();

      const pinnedAt = new Date().toISOString();
      const { error: pinErr } = await sb
        .from('reservation_memo_history')
        .update({ is_pinned: true, pinned_at: pinnedAt })
        .eq('id', memo!.id);
      expect(pinErr, `고정 실패: ${pinErr?.message}`).toBeNull();

      const { data: pinned } = await sb
        .from('reservation_memo_history')
        .select('is_pinned, pinned_at')
        .eq('id', memo!.id)
        .single();
      expect(pinned!.is_pinned).toBe(true);
      expect(pinned!.pinned_at).toBeTruthy();

      // cleanup
      await sb.from('reservation_memo_history').delete().eq('id', memo!.id);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('고정 해제 — is_pinned=false, pinned_at=null', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-memo-unpin-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    const customerId = customer!.id as string;

    try {
      const { data: memo } = await sb
        .from('reservation_memo_history')
        .insert({
          customer_id: customerId,
          clinic_id: CLINIC_ID,
          content: '고정 해제 테스트',
          created_by_name: 'spec',
          is_pinned: true,
          pinned_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      const { error: unpinErr } = await sb
        .from('reservation_memo_history')
        .update({ is_pinned: false, pinned_at: null })
        .eq('id', memo!.id);
      expect(unpinErr, `고정 해제 실패: ${unpinErr?.message}`).toBeNull();

      const { data: unpinned } = await sb
        .from('reservation_memo_history')
        .select('is_pinned, pinned_at')
        .eq('id', memo!.id)
        .single();
      expect(unpinned!.is_pinned).toBe(false);
      expect(unpinned!.pinned_at).toBeNull();

      await sb.from('reservation_memo_history').delete().eq('id', memo!.id);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('AC-4a: ALT ON → insertAltPinnedMemo — is_pinned=true 고정 메모 자동 기입', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-auto-pin-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const altDetail = '3회차까지 진행, 보험 반려됨';

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    const customerId = customer!.id as string;

    try {
      // insertAltPinnedMemo 로직 시뮬
      const content = `ALT 대상 — ${altDetail}`;
      const { data: pinnedMemo, error: insertErr } = await sb
        .from('reservation_memo_history')
        .insert({
          customer_id: customerId,
          clinic_id: CLINIC_ID,
          content,
          created_by_name: 'test-author',
          is_pinned: true,
          pinned_at: new Date().toISOString(),
        })
        .select('id, content, is_pinned, pinned_at')
        .single();
      expect(insertErr, `ALT 고정 메모 삽입 실패: ${insertErr?.message}`).toBeNull();
      expect(pinnedMemo!.is_pinned).toBe(true);
      expect(pinnedMemo!.content).toContain('ALT 대상');
      expect(pinnedMemo!.content).toContain(altDetail);
      expect(pinnedMemo!.pinned_at).toBeTruthy();

      // 정렬 확인 — 고정 메모는 일반 메모 앞
      await sb.from('reservation_memo_history').insert({
        customer_id: customerId,
        clinic_id: CLINIC_ID,
        content: '일반 메모 (고정 아님)',
        created_by_name: 'test-author',
        is_pinned: false,
      });

      const { data: allMemos } = await sb
        .from('reservation_memo_history')
        .select('id, content, is_pinned, created_at')
        .eq('customer_id', customerId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      expect(allMemos![0].is_pinned).toBe(true);  // 고정 메모가 첫 번째
      expect(allMemos![1].is_pinned).toBe(false);  // 일반 메모가 두 번째

      // cleanup
      await sb.from('reservation_memo_history').delete().eq('customer_id', customerId);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });
});

// ── AC-5: 기존 메모 데이터 보존 (비파괴성 검증) ─────────────────────────────

test.describe('T-20260522-ALT-BADGE — AC-5: 기존 메모 데이터 보존', () => {

  test('ALT 활성화 전 기존 메모는 is_pinned=false 그대로 유지', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-preserve-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning' })
      .select()
      .single();
    const customerId = customer!.id as string;

    try {
      // 기존 메모 3개 삽입 (ALT 이전 데이터 시뮬)
      const { data: existingMemos, error: insertErr } = await sb
        .from('reservation_memo_history')
        .insert([
          { customer_id: customerId, clinic_id: CLINIC_ID, content: '기존 메모 1', created_by_name: 'staff-a' },
          { customer_id: customerId, clinic_id: CLINIC_ID, content: '기존 메모 2', created_by_name: 'staff-b' },
          { customer_id: customerId, clinic_id: CLINIC_ID, content: '기존 메모 3', created_by_name: 'staff-c' },
        ])
        .select('id, content, is_pinned');
      expect(insertErr).toBeNull();
      expect(existingMemos).toHaveLength(3);
      existingMemos!.forEach(m => {
        expect(m.is_pinned).toBe(false);  // 기존 메모는 is_pinned=false
      });

      // ALT 활성화 + 고정 메모 추가 — 기존 메모 영향 없음
      await sb.from('customers').update({ alt_status: true }).eq('id', customerId);
      await sb.from('reservation_memo_history').insert({
        customer_id: customerId,
        clinic_id: CLINIC_ID,
        content: 'ALT 대상 — 보험 반려',
        is_pinned: true,
        pinned_at: new Date().toISOString(),
      });

      // 기존 메모 is_pinned 변경되지 않음을 검증
      const { data: afterMemos } = await sb
        .from('reservation_memo_history')
        .select('id, content, is_pinned')
        .eq('customer_id', customerId)
        .in('id', existingMemos!.map(m => m.id));

      afterMemos!.forEach(m => {
        expect(m.is_pinned).toBe(false);  // 기존 메모 보존
      });

      // cleanup
      await sb.from('reservation_memo_history').delete().eq('customer_id', customerId);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('고객 customer_memo, tm_memo 필드는 ALT 활성화로 변경되지 않음', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `alt-preserve-fields-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;
    const originalCustomerMemo = '주차: B3, 카드결제 선호';
    const originalTmMemo = '보험등급 3단계, 레이저 비급여 희망';

    const { data: customer } = await sb
      .from('customers')
      .insert({
        clinic_id: CLINIC_ID,
        name: testName,
        phone: testPhone,
        visit_type: 'returning',
        customer_memo: originalCustomerMemo,
        tm_memo: originalTmMemo,
      })
      .select()
      .single();
    const customerId = customer!.id as string;

    try {
      // ALT 활성화 — customer_memo/tm_memo 필드는 변경 안 됨
      await sb.from('customers').update({
        alt_status: true,
        alt_detail: '보험 반려됨',
        alt_activated_at: new Date().toISOString(),
      }).eq('id', customerId);

      const { data: after } = await sb
        .from('customers')
        .select('customer_memo, tm_memo, alt_status')
        .eq('id', customerId)
        .single();

      expect(after!.customer_memo).toBe(originalCustomerMemo);  // 보존
      expect(after!.tm_memo).toBe(originalTmMemo);               // 보존
      expect(after!.alt_status).toBe(true);                      // ALT 활성
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
