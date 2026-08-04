/**
 * T-20260804-foot-CLOSING-HERALD-PAYLOAD-RECONCILE
 *
 * 마감 전령 payload 패키지 누락 총액 SSOT conformance (post-apply 회귀 스펙).
 * SSOT: da_decision_foot_body_closing_herald_payload_pkg_reconcile_20260804.md
 *       + closing_payload_split_reconciliation_spec.md v1.5 §1-5 + §3 INV5.
 *
 * 확정 RC: 마감 전령 payload 의 total_amount_krw·split_source·split_insurance·month(MTD) 가 payments 단독
 *   (payments-only net) 으로 산출돼 package_payments(패키지 cash-in)를 통째 누락 → 매출 6~8배 과소
 *   (DA-20260715 undercount 의 payload-path 판본). 수납 유니버스 S = payments + package_payments 로 확장.
 *
 * 회귀가드:
 *  - AC-1: 3 split 함수(source/insurance/month) 정의에 package_payments 편입(유니버스 확장) 실재.
 *  - AC-2: 윈도잉 = created_at KST(Asia/Seoul) — Q1 권위(daily_closings 컬럼) 동축. accounting_date 미사용.
 *  - AC-3: enqueue_closing_confirmed 에 INV5(총액 3중 대조) 하드 게이트(inv5_divergence/v_hm) + total_amount_krw.
 *  - AC-4: 실 데이터 INV — 최근 closed 마감 전건: (source total==insurance total==sys_total)=INV5,
 *          (ad+organic==total)=INV1, (copay+nonins==total)=INV2.
 *  - AC-5: 패키지 편입 실증 — package_payments 실재 마감에서 source total 이 payments-only 를 초과(undercount 교정).
 *  - AC-6: Q5 불변(membership 유니버스 밖) + 원장 mutation 0(package_payments/payments 스키마 무접촉) + INV3(공단 total 밖).
 */

import { test, expect } from '@playwright/test';

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';

async function dbQuery(request: import('@playwright/test').APIRequestContext, query: string) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: { query },
    },
  );
  expect(resp.ok(), `DB query 실패: ${resp.status()}`).toBeTruthy();
  return resp.json();
}

async function fnDef(request: import('@playwright/test').APIRequestContext, signature: string): Promise<string> {
  const rows = await dbQuery(request, `SELECT pg_get_functiondef('${signature}'::regprocedure) AS def;`) as Array<{ def: string }>;
  return rows[0]?.def ?? '';
}

// ─── AC-1 / AC-2: 유니버스 확장(package_payments) + created_at KST 윈도잉 ───
test('AC-1/2: 3 split 함수가 package_payments 를 편입하고 created_at KST 로 윈도잉한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');

  const src = await fnDef(request, 'public.closing_source_split(uuid,date)');
  const ins = await fnDef(request, 'public.closing_insurance_split(uuid,date)');
  const mon = await fnDef(request, 'public.closing_month_projection(uuid,date)');

  for (const [name, def] of [['source', src], ['insurance', ins], ['month', mon]] as const) {
    expect(def, `${name}: package_payments 편입 부재(패키지 누락 미교정)`).toContain('package_payments');
    expect(def, `${name}: created_at KST 윈도잉 부재`).toContain(`AT TIME ZONE 'Asia/Seoul'`);
  }
  // Q5: membership 은 유니버스 밖(3함수 모두)
  expect(src).not.toContain('membership');
  expect(ins).not.toContain('membership');
});

// ─── AC-3: enqueue INV5 하드 게이트 + total_amount_krw ───
test('AC-3: enqueue_closing_confirmed 에 INV5 총액 3중 대조 게이트가 실재한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const enq = await fnDef(request, 'public.enqueue_closing_confirmed()');
  expect(enq, 'INV5 divergence 진단 부재').toContain('inv5_divergence');
  expect(enq, 'health_maintenance delta(v_hm) 미처리').toContain('health_maintenance');
  expect(enq, 'total_amount_krw 미방출').toContain('total_amount_krw');
  // 발산 시 emit-fail + DLQ(삼킴 금지)
  expect(enq).toContain('dlq');
});

// ─── AC-4: 실 데이터 INV1/INV2/INV5 (최근 closed 마감 전건) ───
test('AC-4: 최근 closed 마감 전건에서 INV1/INV2/INV5 가 성립한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT dc.close_date::text AS close_date,
      (COALESCE(dc.package_card_total,0)+COALESCE(dc.single_card_total,0)
       +COALESCE(dc.package_cash_total,0)+COALESCE(dc.single_cash_total,0)
       +COALESCE(dc.package_transfer_total,0)+COALESCE(dc.single_transfer_total,0)) AS sys_total,
      (SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)
         FROM payments p LEFT JOIN check_ins ci ON ci.id=p.check_in_id
         WHERE COALESCE(p.clinic_id,ci.clinic_id)=dc.clinic_id AND p.is_simulation IS NOT TRUE
           AND p.status IS DISTINCT FROM 'deleted' AND p.method='health_maintenance'
           AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date=dc.close_date) AS hm,
      (public.closing_source_split(dc.clinic_id, dc.close_date)->>'total')::bigint AS src_total,
      (public.closing_source_split(dc.clinic_id, dc.close_date)->>'revenue_ad')::bigint AS ad,
      (public.closing_source_split(dc.clinic_id, dc.close_date)->>'revenue_organic')::bigint AS organic,
      (public.closing_insurance_split(dc.clinic_id, dc.close_date)->>'total')::bigint AS ins_total,
      (public.closing_insurance_split(dc.clinic_id, dc.close_date)->>'rev_copay_self')::bigint AS copay,
      (public.closing_insurance_split(dc.clinic_id, dc.close_date)->>'rev_noninsurance')::bigint AS nonins,
      (public.closing_insurance_split(dc.clinic_id, dc.close_date)->>'rev_insurance_covered')::bigint AS covered
    FROM daily_closings dc WHERE dc.status='closed' ORDER BY dc.close_date DESC LIMIT 10;
  `) as Array<Record<string, number | string>>;

  expect(rows.length, 'closed 마감 데이터 없음').toBeGreaterThan(0);
  for (const r of rows) {
    const sys = Number(r.sys_total), hm = Number(r.hm), src = Number(r.src_total), ins = Number(r.ins_total);
    const ad = Number(r.ad), org = Number(r.organic), copay = Number(r.copay), nonins = Number(r.nonins), covered = Number(r.covered);
    // INV1: 유입축이 수납 전체 2분할
    expect(ad + org, `INV1 위반 @${r.close_date}`).toBe(src);
    // INV2: 급여수납축이 수납 전체 2분할(공단 제외)
    expect(copay + nonins, `INV2 위반 @${r.close_date}`).toBe(ins);
    // INV3: 공단부담 >= 0, total 밖
    expect(covered, `INV3 위반(covered<0) @${r.close_date}`).toBeGreaterThanOrEqual(0);
    // INV5: (source total − hm) == system_totals == daily_closings 확정합. + source total == insurance total(동일 S)
    expect(src, `source≠insurance(동일 S 위반) @${r.close_date}`).toBe(ins);
    expect(src - hm, `INV5 위반: (src ${src} − hm ${hm}) ≠ sys ${sys} @${r.close_date}`).toBe(sys);
  }
});

// ─── AC-5: 패키지 편입 실증(undercount 교정) — package 실재 마감에서 신규 total > payments-only total ───
test('AC-5: package_payments 실재 마감에서 신규 유니버스가 payments-only 를 초과한다(undercount 교정)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    WITH pkgdays AS (
      SELECT dc.clinic_id, dc.close_date,
        (SELECT COALESCE(SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END),0)
           FROM package_payments pp
           WHERE pp.clinic_id=dc.clinic_id AND pp.is_simulation IS NOT TRUE AND pp.method IN ('card','cash','transfer')
             AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date=dc.close_date) AS pkg_net
      FROM daily_closings dc WHERE dc.status='closed'
    )
    SELECT close_date::text AS close_date, pkg_net,
      (public.closing_source_split(clinic_id, close_date)->>'total')::bigint AS new_total,
      (SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)
         FROM payments p LEFT JOIN check_ins ci ON ci.id=p.check_in_id
         WHERE COALESCE(p.clinic_id,ci.clinic_id)=pkgdays.clinic_id AND p.is_simulation IS NOT TRUE
           AND p.status IS DISTINCT FROM 'deleted' AND p.method IN ('card','cash','transfer','health_maintenance')
           AND (p.created_at AT TIME ZONE 'Asia/Seoul')::date=pkgdays.close_date) AS payments_only
    FROM pkgdays WHERE pkg_net > 0 ORDER BY close_date DESC LIMIT 5;
  `) as Array<{ close_date: string; pkg_net: number; new_total: number; payments_only: number }>;

  expect(rows.length, 'package_payments 실재 마감 없음(스킵 대상)').toBeGreaterThan(0);
  for (const r of rows) {
    // 신규 total = payments_only + package_net (패키지 편입) → 반드시 payments-only 초과
    expect(Number(r.new_total), `패키지 미편입 @${r.close_date}`).toBe(Number(r.payments_only) + Number(r.pkg_net));
    expect(Number(r.new_total), `undercount 미교정 @${r.close_date}`).toBeGreaterThan(Number(r.payments_only));
  }
});

// ─── AC-6: 원장 mutation 0 — package_payments/payments 스키마 무접촉(ADDITIVE 검증) ───
test('AC-6: 원장(payments/package_payments) 스키마 무접촉 — 결합은 emit 쿼리 UNION(물리병합 아님)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  // package_payments 는 여전히 독립 원장(payments 에 병합 안 됨) — method CHECK 불변(card/cash/transfer)
  const pp = await dbQuery(request, `
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conname='package_payments_method_check' AND conrelid='public.package_payments'::regclass;
  `) as Array<{ def: string }>;
  if (pp.length > 0) {
    expect(pp[0].def).toContain('card');
    expect(pp[0].def).not.toContain('membership'); // 원장 스키마 무변(오확장 없음)
  }
  // enqueue 는 SECURITY DEFINER 함수 교체만 — 트리거 자체는 pilot 소유(재생성 불요)
  const trg = await dbQuery(request, `
    SELECT tgname FROM pg_trigger WHERE tgname='trg_enqueue_closing_confirmed';
  `) as Array<{ tgname: string }>;
  expect(trg.length, 'enqueue 트리거 소실(pilot 배선 파손)').toBe(1);
});

// ─── AC-8: reemit self-supersede 결함 회귀 가드(FIX MSG-20260804-195718-bxx1) ───
//   결함: enqueue 가 신규 outbox 행을 superseded=(NEW.revision>0) 로 세팅 → rev≥1(재emit) 신규 행이 자기 자신을
//   superseded=true 로 마킹 → 리더(WHERE superseded=false) 가 영구 불가시. 구본(rev0)만 가시(의미 역전).
//   가드: enqueue 정의에 (a)supersede-UPDATE(revision<NEW.revision→true) 실재 (b)신규 행 self-supersede 부재.
test('AC-8: enqueue 는 신규 행을 self-supersede 하지 않고 구 rev 를 UPDATE supersede 한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const enq = await fnDef(request, 'public.enqueue_closing_confirmed()');
  // (a) 구 rev supersede-UPDATE 실재
  expect(enq, 'supersede-UPDATE(revision<NEW.revision) 부재 — 구 rev 미수렴').toContain('revision < NEW.revision');
  expect(enq, 'superseded=true UPDATE 부재').toMatch(/SET\s+superseded\s*=\s*true/);
  // (b) self-supersede 결함식 `(NEW.revision > 0)` 잔재 0 (버그 재현식이 정의에서 완전 제거)
  expect(enq, 'self-supersede 결함식 (NEW.revision > 0) 잔재 — supersede 방향 역전 재발').not.toContain('NEW.revision > 0');
});

// ─── AC-9: reader-visibility 불변식(FIX item 4) — 재emit 후 신 rev 가시 / 구 rev 전건 supersede ───
//   ①신 rev superseded=false ②read_closing_confirmed_events 반환 포함 ③구 rev 전건 superseded=true.
//   ★post-apply + post-reemit 회귀. 각 (clinic_id, close_date) 그룹에서 최대 revision 만 가시(superseded=false,
//   dlq=false)이며 리더 RPC 반환집합과 정확히 일치. 하위 revision 전건 superseded=true.
test('AC-9: 재emit 후 각 마감 그룹에서 최신 rev 만 리더 가시·구 rev 전건 supersede', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');

  // (1) multi-revision 그룹: 최신 rev 는 superseded=false, 구 rev 는 전건 superseded=true 여야 함
  const groups = await dbQuery(request, `
    WITH g AS (
      SELECT clinic_id, close_date, MAX(revision) AS max_rev, COUNT(*) AS n
      FROM public.closing_confirmed_outbox
      GROUP BY clinic_id, close_date
    )
    SELECT o.clinic_slug, o.close_date::text AS close_date, o.revision, o.superseded, o.dlq,
           g.max_rev, g.n
    FROM public.closing_confirmed_outbox o
    JOIN g ON g.clinic_id=o.clinic_id AND g.close_date=o.close_date
    WHERE g.n > 1
    ORDER BY o.close_date DESC, o.revision;
  `) as Array<{ clinic_slug: string; close_date: string; revision: number; superseded: boolean; dlq: boolean; max_rev: number; n: number }>;

  for (const r of groups) {
    if (Number(r.revision) === Number(r.max_rev)) {
      // ① 신(최대) rev = superseded=false (dlq=false 인 정상 emit 에 한함)
      if (!r.dlq) {
        expect(r.superseded, `③역전: 최신 rev${r.revision} @${r.clinic_slug}/${r.close_date} 가 superseded=true(리더 불가시)`).toBe(false);
      }
    } else {
      // ③ 구 rev = 전건 superseded=true
      expect(r.superseded, `③미수렴: 구 rev${r.revision} @${r.clinic_slug}/${r.close_date} 가 superseded=false(구본 잔존)`).toBe(true);
    }
  }

  // (2) ② 리더 RPC 반환집합 = 가시행(superseded=false AND dlq=false)과 정확 일치 (skip0/dup0)
  const recon = await dbQuery(request, `
    WITH visible AS (
      SELECT event_id FROM public.closing_confirmed_outbox
      WHERE COALESCE(superseded,false)=false AND dlq=false
    ),
    reader AS (
      SELECT event_id FROM public.read_closing_confirmed_events(NULL, NULL, 1000)
    )
    SELECT
      (SELECT COUNT(*) FROM visible) AS visible_n,
      (SELECT COUNT(*) FROM reader)  AS reader_n,
      (SELECT COUNT(*) FROM visible v WHERE NOT EXISTS (SELECT 1 FROM reader r WHERE r.event_id=v.event_id)) AS visible_not_read,
      (SELECT COUNT(*) FROM reader r WHERE NOT EXISTS (SELECT 1 FROM visible v WHERE v.event_id=r.event_id)) AS read_not_visible;
  `) as Array<{ visible_n: number; reader_n: number; visible_not_read: number; read_not_visible: number }>;

  const c = recon[0];
  // 리더가 못 읽는 가시행 0(영구 불가시 결함 재발 방지) + 리더가 읽는데 superseded/dlq 인 행 0
  expect(Number(c.visible_not_read), '가시행인데 리더 미반환(영구 불가시 결함 재발)').toBe(0);
  expect(Number(c.read_not_visible), '리더 반환인데 superseded/dlq(필터 파손)').toBe(0);
  // 단, reader LIMIT 1000 미만일 때만 정확 일치(과도 데이터 시 페이지네이션 — 실측 소규모라 일치 기대)
  if (Number(c.visible_n) <= 1000) {
    expect(Number(c.reader_n), '가시행 수 ≠ 리더 반환 수').toBe(Number(c.visible_n));
  }
});

// ─── AC-7: SECDEF grant-seal 회귀 가드(C23) — 4함수 전건 anon/authenticated EXECUTE = false, service_role = true ───
//   FIX-REQUEST MSG-20260804-084254-pa6t: CREATE OR REPLACE 는 기존 ACL(PUBLIC EXECUTE) 보존 → 봉인 없으면
//   미인증 anon 이 SECDEF 매출집계 함수를 RLS 우회 실행 가능(C23-2 급성 anon축). 4함수 backend-only 봉인 상시 검증.
test('AC-7: SECDEF grant-seal — 4함수 anon/authenticated EXECUTE 봉인(backend-only), service_role만 허용', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT p.proname,
      p.prosecdef,
      has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('closing_source_split','closing_insurance_split','closing_month_projection','enqueue_closing_confirmed')
    ORDER BY p.proname;
  `) as Array<{ proname: string; prosecdef: boolean; anon_exec: boolean; auth_exec: boolean; svc_exec: boolean }>;

  expect(rows.length, 'SECDEF 4함수 census 불일치').toBe(4);
  for (const r of rows) {
    expect(r.prosecdef, `${r.proname}: SECURITY DEFINER 아님(전제 붕괴)`).toBe(true);
    expect(r.anon_exec, `${r.proname}: anon EXECUTE 노출(C23-2 급성 이빨 미봉인)`).toBe(false);
    expect(r.auth_exec, `${r.proname}: authenticated EXECUTE 잔차(C23 미봉인)`).toBe(false);
    expect(r.svc_exec, `${r.proname}: service_role EXECUTE 부재(backend 호출 파손)`).toBe(true);
  }
});
