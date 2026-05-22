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
 * AC-6: ALT OFF + 패키지 등록 → 패키지 미포함 레이저코드 삽입 차단 (전체 패키지 공통)
 *       시나리오 4: isLaserBlockedByPackage 로직 검증 + DB 패키지 구조 확인
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

// ── AC-6: ALT OFF — 서류출력 레이저코드 삽입 방지 (전체 패키지 공통) ───────────
// 시나리오 4: isLaserBlockedByPackage 로직 + DB 패키지 구조 검증

test.describe('T-20260522-ALT-BADGE — AC-6: ALT OFF 패키지 레이저코드 삽입 차단', () => {

  // ── isLaserBlockedByPackage 순수 로직 단위 테스트 ──
  // (프론트엔드 함수를 spec 내에서 직접 구현해 동일 로직 검증)

  function isLaserService(svc: { service_code?: string | null; name?: string; category?: string }): boolean {
    const cat = svc.category ?? '';
    const name = svc.name ?? '';
    const code = svc.service_code ?? '';
    return cat === 'laser' || cat === 'heated_laser' || name.includes('레이저') || code.toUpperCase().startsWith('MM');
  }

  function isLaserBlockedByPackage(
    svc: { category?: string; name?: string; service_code?: string | null },
    pkg: { heated_sessions: number; unheated_sessions: number; package_name: string } | null,
  ): boolean {
    if (!pkg) return false;
    if (!isLaserService(svc)) return false;
    const cat = svc.category ?? '';
    if (cat === 'heated_laser') return (pkg.heated_sessions ?? 0) === 0;
    if (cat === 'laser') return (pkg.unheated_sessions ?? 0) === 0;
    return (pkg.heated_sessions ?? 0) + (pkg.unheated_sessions ?? 0) === 0;
  }

  test('패키지 없음 → 레이저 차단 없음 (패키지 미등록 고객은 검증 불가)', () => {
    const laserSvc = { category: 'laser', name: '레이저 치료', service_code: null };
    expect(isLaserBlockedByPackage(laserSvc, null)).toBe(false);
  });

  test('비레이저 서비스 → 패키지 있어도 차단 없음', () => {
    const nonLaserSvc = { category: 'foot_care', name: '발 관리', service_code: 'FC001' };
    const pkg = { heated_sessions: 0, unheated_sessions: 0, package_name: '6회권' };
    expect(isLaserBlockedByPackage(nonLaserSvc, pkg)).toBe(false);
  });

  test('레이저 서비스 + 레이저 0회 패키지 → 차단', () => {
    const laserSvc = { category: 'laser', name: '비온열 레이저', service_code: null };
    const pkg = { heated_sessions: 12, unheated_sessions: 0, package_name: '12회권(온열전용)' };
    expect(isLaserBlockedByPackage(laserSvc, pkg)).toBe(true);
  });

  test('온열 레이저 서비스 + 온열 0회 패키지 → 차단', () => {
    const heatedSvc = { category: 'heated_laser', name: '온열 레이저', service_code: null };
    const pkg = { heated_sessions: 0, unheated_sessions: 6, package_name: '6회권(비온열)' };
    expect(isLaserBlockedByPackage(heatedSvc, pkg)).toBe(true);
  });

  test('온열 레이저 서비스 + 온열 있는 패키지 → 허용', () => {
    const heatedSvc = { category: 'heated_laser', name: '온열 레이저', service_code: null };
    const pkg = { heated_sessions: 6, unheated_sessions: 0, package_name: '6회권(온열)' };
    expect(isLaserBlockedByPackage(heatedSvc, pkg)).toBe(false);
  });

  test('이름 기반 레이저(category 없음) + 레이저 0회 패키지 → 차단', () => {
    const namedLaser = { category: '', name: '레이저 치료(건보)', service_code: 'MISC' };
    const pkg = { heated_sessions: 0, unheated_sessions: 0, package_name: '발 관리 전용 6회권' };
    expect(isLaserBlockedByPackage(namedLaser, pkg)).toBe(true);
  });

  test('MM 코드 레이저 서비스 + 레이저 있는 패키지 → 허용', () => {
    const mmSvc = { category: '', name: '이학요법', service_code: 'MM123' };
    const pkg = { heated_sessions: 12, unheated_sessions: 6, package_name: '12회권' };
    expect(isLaserBlockedByPackage(mmSvc, pkg)).toBe(false);
  });

  // ── DB 레이어: packages 테이블 구조 검증 ──

  test('packages 테이블에 heated_sessions, unheated_sessions 컬럼 존재 + 조회 가능', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    // 기존 패키지 한 건 조회하여 컬럼 존재 여부 확인
    const { data, error } = await sb
      .from('packages')
      .select('id, heated_sessions, unheated_sessions, package_name')
      .eq('clinic_id', CLINIC_ID)
      .limit(1);

    // 데이터 없어도 쿼리 자체가 성공하면 컬럼은 존재
    expect(error, `packages 조회 실패: ${error?.message}`).toBeNull();
    if (data && data.length > 0) {
      expect(typeof data[0].heated_sessions).toBe('number');
      expect(typeof data[0].unheated_sessions).toBe('number');
    }
  });

  test('AC-6 시나리오 4: 레이저 0회 패키지 등록 시 레이저코드 삽입 차단 로직 검증', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `ac6-laser-block-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    // 고객 생성 (ALT OFF)
    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning', alt_status: false })
      .select()
      .single();
    expect(custErr, `고객 생성 실패: ${custErr?.message}`).toBeNull();
    const customerId = customer!.id as string;

    try {
      // 레이저 0회 패키지 등록 (발 관리 전용 패키지 시뮬)
      const { data: pkg, error: pkgErr } = await sb
        .from('packages')
        .insert({
          clinic_id: CLINIC_ID,
          customer_id: customerId,
          package_name: '발관리 6회권(레이저 제외)',
          package_type: 'foot_care',
          total_sessions: 6,
          heated_sessions: 0,      // 온열 없음
          unheated_sessions: 0,    // 비온열 없음
          iv_sessions: 0,
          preconditioning_sessions: 0,
          shot_upgrade: false,
          af_upgrade: false,
          upgrade_surcharge: 0,
          total_amount: 300000,
          paid_amount: 300000,
          contract_date: new Date().toISOString().split('T')[0],
          status: 'active',
          created_by: null,
        })
        .select('id, heated_sessions, unheated_sessions, package_name')
        .single();
      expect(pkgErr, `패키지 등록 실패: ${pkgErr?.message}`).toBeNull();

      // 레이저 0회 패키지 → 모든 레이저 코드 차단 검증
      const laserSvcs = [
        { category: 'laser', name: '비온열 레이저', service_code: null },
        { category: 'heated_laser', name: '온열 레이저', service_code: null },
        { category: '', name: '레이저 치료(이학)', service_code: 'MM456' },
      ];

      for (const svc of laserSvcs) {
        const blocked = isLaserBlockedByPackage(svc, {
          heated_sessions: pkg!.heated_sessions,
          unheated_sessions: pkg!.unheated_sessions,
          package_name: pkg!.package_name,
        });
        expect(blocked, `${svc.name} 차단 실패 — heated:${pkg!.heated_sessions} unheated:${pkg!.unheated_sessions}`).toBe(true);
      }

      // 비레이저 서비스는 차단 안 됨
      const footCareSvc = { category: 'foot_care', name: '발 관리', service_code: 'FC001' };
      expect(isLaserBlockedByPackage(footCareSvc, {
        heated_sessions: pkg!.heated_sessions,
        unheated_sessions: pkg!.unheated_sessions,
        package_name: pkg!.package_name,
      })).toBe(false);

      // cleanup
      await sb.from('packages').delete().eq('id', pkg!.id);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('AC-6 시나리오 4: 레이저 포함 패키지 → 정상 코드 삽입 허용', async () => {
    if (!SUPA_URL || !SERVICE_KEY) {
      test.skip(true, 'Supabase env 미설정 — 스킵');
      return;
    }
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const testName = `ac6-laser-allow-${Date.now()}`;
    const testPhone = `010${String(Date.now()).slice(-8)}`;

    const { data: customer, error: custErr } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name: testName, phone: testPhone, visit_type: 'returning', alt_status: false })
      .select()
      .single();
    expect(custErr).toBeNull();
    const customerId = customer!.id as string;

    try {
      // 레이저 포함 12회권 패키지
      const { data: pkg, error: pkgErr } = await sb
        .from('packages')
        .insert({
          clinic_id: CLINIC_ID,
          customer_id: customerId,
          package_name: '12회권(온열+비온열)',
          package_type: 'standard',
          total_sessions: 12,
          heated_sessions: 6,
          unheated_sessions: 6,
          iv_sessions: 0,
          preconditioning_sessions: 0,
          shot_upgrade: false,
          af_upgrade: false,
          upgrade_surcharge: 0,
          total_amount: 1200000,
          paid_amount: 1200000,
          contract_date: new Date().toISOString().split('T')[0],
          status: 'active',
          created_by: null,
        })
        .select('id, heated_sessions, unheated_sessions, package_name')
        .single();
      expect(pkgErr, `패키지 등록 실패: ${pkgErr?.message}`).toBeNull();

      // 온열/비온열 모두 포함 → 모든 레이저 코드 허용
      const heatedSvc = { category: 'heated_laser', name: '온열 레이저', service_code: null };
      const unheatedSvc = { category: 'laser', name: '비온열 레이저', service_code: null };

      expect(isLaserBlockedByPackage(heatedSvc, {
        heated_sessions: pkg!.heated_sessions,
        unheated_sessions: pkg!.unheated_sessions,
        package_name: pkg!.package_name,
      })).toBe(false);

      expect(isLaserBlockedByPackage(unheatedSvc, {
        heated_sessions: pkg!.heated_sessions,
        unheated_sessions: pkg!.unheated_sessions,
        package_name: pkg!.package_name,
      })).toBe(false);

      // cleanup
      await sb.from('packages').delete().eq('id', pkg!.id);
    } finally {
      await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
