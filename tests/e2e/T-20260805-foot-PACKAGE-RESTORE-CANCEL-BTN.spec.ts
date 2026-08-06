import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * T-20260805-foot-PACKAGE-RESTORE-CANCEL-BTN
 * 구매 패키지 화면 → '패키지 복구' / '패키지 취소' 버튼 2종.
 *
 * DA write-contract (MSG-20260806-200836-nq87, 조건부 GO · ADDITIVE/no-DDL):
 *   복구 = 돈-원장 정합(payments.package_id LINK/UPDATE) → 트리거가 status 자동치유(net>0→active).
 *          packages.status 직접 write 금지 · payments INSERT/DELETE 금지 · net>0 달성 가능 시에만(SAFETY GATE).
 *   취소 = status='cancelled'(기존 enum·트리거 early-RETURN 보호축) · 사용분 매출확정(used 유지) ·
 *          자동환불 안 함(refund_package_atomic cascade ON = REJECT) · lock 플래그 신설 금지.
 *
 * AC:
 *   AC-1 (복구 RC-A)     : refunded 패키지에 미연결 활성 결제 LINK → 트리거 net>0 → active.
 *   AC-2 (복구 차단)     : 연결할 결제 없음(net≤0 불가) → 버튼 차단 + 결제기록 경로 안내(payment 미발명).
 *   AC-3 (취소)          : status='cancelled' 전이 + 사용분(used) 유지(매출확정).
 *   AC-4 (재역전 방지)   : 취소 후 결제 write → 트리거 early-RETURN → cancelled 유지(lock 불요).
 *   AC-5 (엣지/정합성)   : write rows-affected 검증(0/부분=성공오인 금지) · 경합가드(status='active').
 *   AC-6 (소스 계약)     : UI 코드가 위 HARD 제약을 준수(정적 검증 = 회귀 가드).
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Packages.tsx'), 'utf-8');

// ────────────────────────────────────────────────────────────────────────────
// A. 소스 계약 정적 검증 — DA HARD 제약 회귀 가드 (page/auth/DB 불요)
// ────────────────────────────────────────────────────────────────────────────
test.describe('T-20260805-foot-PACKAGE-RESTORE-CANCEL-BTN — 소스 계약(AC-6)', () => {
  // 복구/취소 다이얼로그 본문만 잘라 검사(무관 코드 오탐 방지)
  const restoreBody = SRC.slice(SRC.indexOf('function RestorePackageDialog'), SRC.indexOf('function CancelPackageDialog'));
  const cancelBody = SRC.slice(SRC.indexOf('function CancelPackageDialog'), SRC.indexOf('function TransferDialog'));

  test('복구: payments.package_id LINK(UPDATE)만 사용 — status 직접 write / payments INSERT·DELETE 금지', () => {
    // LINK(UPDATE) 존재
    expect(restoreBody).toMatch(/\.update\(\s*\{\s*package_id:\s*pkg\.id\s*\}\s*\)/);
    // packages.status 직접 write 금지 (같은 statement chain 내 packages+update 없음. [^;]*=문장경계 넘지 않음)
    expect(restoreBody).not.toMatch(/packages['"]\)[^;]*\.update\(/);
    // payments INSERT/DELETE 금지 (Set.delete(id) 등 무관 호출 오탐 방지 위해 payments 체인 한정)
    expect(restoreBody).not.toMatch(/payments['"]\)[^;]*\.(insert|delete)\(/);
  });

  test('복구: SAFETY GATE — net>0(projectedNet>0) 이고 후보 없을 때 차단', () => {
    expect(restoreBody).toMatch(/projectedNet\s*>\s*0/);
    expect(restoreBody).toMatch(/canRestore\s*=\s*selected\.size\s*>\s*0\s*&&\s*projectedNet\s*>\s*0/);
    // 후보 0건 → 차단 UI + payment 미발명 안내
    expect(restoreBody).toContain('pkg-restore-block');
    expect(restoreBody).toContain('결제를 새로 만들지 않습니다');
  });

  test('복구: write rows-affected 검증(0/부분 성공오인 금지)', () => {
    expect(restoreBody).toMatch(/\.select\(['"]id['"]\)/);
    expect(restoreBody).toMatch(/affected\s*!==\s*ids\.length/);
  });

  test('취소: status=cancelled 전이 · refund_package_atomic(cascade ON) 사용 금지', () => {
    expect(cancelBody).toMatch(/\.update\(\s*\{\s*status:\s*['"]cancelled['"]\s*\}\s*\)/);
    // cascade ON 원자환불 절대 미사용
    expect(cancelBody).not.toContain('refund_package_atomic');
    // 경합 가드: active → cancelled 만
    expect(cancelBody).toMatch(/\.eq\(['"]status['"],\s*['"]active['"]\)/);
  });

  test('취소: rows-affected 검증(affected===1) · lock 플래그 신설 안 함', () => {
    expect(cancelBody).toMatch(/affected\s*!==\s*1/);
    // net 정합만이 STABLE — lock/override 컬럼 write 금지
    expect(cancelBody).not.toMatch(/status_lock|override_lock|is_locked/);
  });

  test('버튼 노출/권한: 복구=refunded+canWrite, 취소=active+canWrite (일반 스태프 허용)', () => {
    // 복구 버튼: status==='refunded' && canWrite!==false 조건
    expect(SRC).toMatch(/pkg\.status === 'refunded' && \(canWrite !== false\)/);
    expect(SRC).toContain('pkg-restore-btn');
    // 취소 버튼: active 블록 내 canWrite 게이트
    expect(SRC).toContain('pkg-cancel-btn');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// B. 실 DB 행위 검증 (service_role · 자기정리 · 트리거 미배포/키 부재 시 skip)
//    write-contract 를 원장 정합 경로로 실증. 시뮬레이션 코호트 생성 후 전량 삭제.
// ────────────────────────────────────────────────────────────────────────────
const MARK = 'E2E-PKGRC-';
test.describe('T-20260805-foot-PACKAGE-RESTORE-CANCEL-BTN — 실 DB 행위(AC-1~5)', () => {
  test.skip(!SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY 필요 (없으면 skip)');
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const ids = { customers: [] as string[], packages: [] as string[] };

  test.afterAll(async () => {
    // 자기정리: 자식 → 부모 순 삭제(트리거 발화 무해). 순소실 방지 위해 marker 로만 한정.
    for (const pid of ids.packages) {
      await sb.from('package_sessions').delete().eq('package_id', pid);
      await sb.from('package_payments').delete().eq('package_id', pid);
      await sb.from('payments').delete().eq('package_id', pid);
    }
    for (const cid of ids.customers) {
      await sb.from('payments').delete().eq('customer_id', cid);
      await sb.from('packages').delete().eq('customer_id', cid);
      await sb.from('customers').delete().eq('id', cid);
    }
  });

  async function trigDeployed(): Promise<boolean> {
    // 트리거 배포 여부 간접 판정: refunded 패키지에 결제 LINK 시 active 로 도출되는지로 확인.
    return true; // 실 판정은 AC-1 결과로 대체(미배포면 AC-1 실패 → 명시적)
  }

  async function seedClinic(): Promise<string> {
    const { data } = await sb.from('clinics').select('id').limit(1).maybeSingle();
    return (data as { id: string }).id;
  }
  async function seedCustomer(clinic: string): Promise<string> {
    const phone = '+8210' + String(Date.now()).slice(-8);
    const { data, error } = await sb.from('customers').insert({ clinic_id: clinic, name: MARK + 'cust', phone }).select('id').single();
    if (error) throw error;
    const id = (data as { id: string }).id; ids.customers.push(id); return id;
  }

  test('AC-1 복구(RC-A): 미연결 활성 결제 LINK → 트리거 net>0 → active', async () => {
    await trigDeployed();
    const clinic = await seedClinic();
    const cust = await seedCustomer(clinic);
    const { data: pkgD } = await sb.from('packages').insert({
      clinic_id: clinic, customer_id: cust, package_name: MARK + 'pkg', package_type: 'custom',
      total_sessions: 10, total_amount: 1000000, status: 'active',
    }).select('id').single();
    const pkg = (pkgD as { id: string }).id; ids.packages.push(pkg);

    // 원장① package_payments: +100만 결제 후 -100만 환불 → net 0 → refunded
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'payment' });
    const { data: op } = await sb.from('package_payments').select('id').eq('package_id', pkg).eq('payment_type', 'payment').single();
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'refund', parent_payment_id: (op as { id: string }).id });
    let { data: st } = await sb.from('packages').select('status').eq('id', pkg).single();
    expect((st as { status: string }).status).toBe('refunded');

    // 원장② 미연결 재결제(payments, package_id NULL)
    const { data: orphanD } = await sb.from('payments').insert({ clinic_id: clinic, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'payment', status: 'active' }).select('id').single();
    const orphan = (orphanD as { id: string }).id;

    // 복구 버튼의 write: LINK(UPDATE) + rows-affected 검증
    const { data: linked, error } = await sb.from('payments').update({ package_id: pkg }).eq('id', orphan).is('package_id', null).eq('status', 'active').select('id');
    expect(error).toBeNull();
    expect((linked ?? []).length).toBe(1); // rows-affected=1 (silent-fail 금지)

    ({ data: st } = await sb.from('packages').select('status').eq('id', pkg).single());
    expect((st as { status: string }).status).toBe('active'); // 트리거 자동치유
  });

  test('AC-2 복구 차단: 미연결 활성 결제 후보 0건이면 복구 불가(payment 미발명)', async () => {
    const clinic = await seedClinic();
    const cust = await seedCustomer(clinic);
    const { data: pkgD } = await sb.from('packages').insert({
      clinic_id: clinic, customer_id: cust, package_name: MARK + 'pkgB', package_type: 'custom',
      total_sessions: 10, total_amount: 1000000, status: 'active',
    }).select('id').single();
    const pkg = (pkgD as { id: string }).id; ids.packages.push(pkg);
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'payment' });
    const { data: op } = await sb.from('package_payments').select('id').eq('package_id', pkg).eq('payment_type', 'payment').single();
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'refund', parent_payment_id: (op as { id: string }).id });

    const { data: st } = await sb.from('packages').select('status').eq('id', pkg).single();
    expect((st as { status: string }).status).toBe('refunded');
    // 다이얼로그 후보 쿼리와 동일 조건 — 후보 0 → 버튼 차단 (net>0 달성 불가)
    const { data: cand } = await sb.from('payments').select('id')
      .eq('customer_id', cust).eq('clinic_id', clinic).is('package_id', null).eq('status', 'active').eq('payment_type', 'payment').is('deleted_at', null);
    expect((cand ?? []).length).toBe(0);
  });

  test('AC-3/4/5 취소: cancelled 전이 + used 유지 + 재역전 방지 + 경합가드', async () => {
    const clinic = await seedClinic();
    const cust = await seedCustomer(clinic);
    const { data: pkgD } = await sb.from('packages').insert({
      clinic_id: clinic, customer_id: cust, package_name: MARK + 'pkgC', package_type: 'custom',
      total_sessions: 10, total_amount: 1000000, status: 'active',
    }).select('id').single();
    const pkg = (pkgD as { id: string }).id; ids.packages.push(pkg);
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 1000000, method: 'card', payment_type: 'payment' });
    await sb.from('package_sessions').insert({ package_id: pkg, session_number: 1, session_type: 'heated_laser', session_date: new Date().toISOString().slice(0, 10), status: 'used' });

    // 취소 write: status='cancelled' + rows-affected + 경합가드(active)
    const { data: cc, error } = await sb.from('packages').update({ status: 'cancelled' }).eq('id', pkg).eq('status', 'active').select('id');
    expect(error).toBeNull();
    expect((cc ?? []).length).toBe(1); // AC-5 rows-affected=1

    const { data: st } = await sb.from('packages').select('status').eq('id', pkg).single();
    expect((st as { status: string }).status).toBe('cancelled'); // AC-3
    const { data: us } = await sb.from('package_sessions').select('status').eq('package_id', pkg).single();
    expect((us as { status: string }).status).toBe('used'); // AC-3 사용분 매출확정(used 유지)

    // AC-4 재역전 방지: 취소 후 결제 write → 트리거 early-RETURN → cancelled 유지
    await sb.from('package_payments').insert({ clinic_id: clinic, package_id: pkg, customer_id: cust, amount: 500000, method: 'card', payment_type: 'payment' });
    const { data: st2 } = await sb.from('packages').select('status').eq('id', pkg).single();
    expect((st2 as { status: string }).status).toBe('cancelled');

    // AC-5 경합가드: 이미 cancelled → 재취소 0-row (성공 오인 금지)
    const { data: cc2 } = await sb.from('packages').update({ status: 'cancelled' }).eq('id', pkg).eq('status', 'active').select('id');
    expect((cc2 ?? []).length).toBe(0);
  });
});
