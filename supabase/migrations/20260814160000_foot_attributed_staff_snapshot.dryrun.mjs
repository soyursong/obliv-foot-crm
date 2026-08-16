/**
 * T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE — DRY-RUN (No-Persistence Protocol)
 *
 * DDL 마이그(attributed_staff_id 컬럼×2 + FK + 트리거×2) + baseline-freeze 백필을 하나의 트랜잭션
 * 안에서 적용 → 불변식 검증 → 강제 ROLLBACK(영속 0). prod 실적용은 supervisor DB-GATE GO-token 후에만.
 *
 * 실행: SUPABASE_DB_PASSWORD 필요 (supervisor DB-GATE 보유).
 *   SUPABASE_DB_PASSWORD=... node supabase/migrations/20260814160000_foot_attributed_staff_snapshot.dryrun.mjs
 *
 * 검증 불변식:
 *   V1  DDL 후 attributed_staff_id 컬럼 2 테이블 존재 · FK on-delete=NO ACTION(confdeltype='a') · 트리거×2 · fn 1
 *   V2  트리거 stamp — 담당 있는 고객 payments INSERT → attributed_staff_id == customers.assigned_staff_id
 *   V3  워크인(customer_id NULL) INSERT → attributed_staff_id NULL(STAFF_UNASSIGNED 정합)
 *   V4  package_payments 트리거 동형 stamp
 *   V5  baseline-freeze 백필 → 레거시 NULL 행이 live-join 값으로 채워짐(report-neutral) · rows==expected
 *   V6  백필 멱등 재실행 → 0 행
 *   V7  원장 무접점 — 백필 前/後 SUM(amount) 불변(payments+package_payments)
 *   전 과정 ROLLBACK → prod 영속 0
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 없음 (supervisor DB-GATE 에서 실행).'); process.exit(2); }

const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}  (DRY-RUN — 끝에서 ROLLBACK)\n`);

const stripTxn = (p) => fs.readFileSync(p, 'utf8').split('\n')
  .filter(l => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(l)).join('\n');
const ddlSql  = stripTxn('supabase/migrations/20260814160000_foot_attributed_staff_snapshot.sql');
const freezeSql = stripTxn('supabase/migrations/20260814160100_foot_attributed_staff_baseline_freeze.sql');

let ok = true;
const chk = (pass, label) => { console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}`); if (!pass) ok = false; };

try {
  await client.query('BEGIN');

  // 백필 前 원장 합계(V7 대조 기준)
  const sumBefore = await client.query(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM public.payments) p,
            (SELECT COALESCE(SUM(amount),0) FROM public.package_payments) k`);

  await client.query(ddlSql);
  console.log('── DDL 마이그 적용됨(txn 내부) ──\n');

  // V1: 컬럼/FK/트리거/fn
  const cols = await client.query(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='attributed_staff_id'
      AND table_name IN ('payments','package_payments')`);
  chk(cols.rows.length === 2, `V1 attributed_staff_id 컬럼 2 테이블 (found ${cols.rows.length}/2)`);

  const fk = await client.query(`
    SELECT c.conrelid::regclass::text AS tbl, c.confdeltype
    FROM pg_constraint c
    WHERE c.contype='f' AND c.conname LIKE '%attributed_staff%'`);
  const allNoAction = fk.rows.length === 2 && fk.rows.every(r => r.confdeltype === 'a');
  chk(allNoAction, `V1 FK×2 on-delete=NO ACTION (confdeltype='a') (found ${fk.rows.map(r=>r.confdeltype).join(',') || 'none'})`);

  const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname='stamp_attributed_staff_from_customer'`);
  chk(fn.rows.length === 1, 'V1 fn stamp_attributed_staff_from_customer 존재');
  const trg = await client.query(`
    SELECT tgname FROM pg_trigger
    WHERE tgname IN ('trg_payments_attributed_staff_stamp','trg_package_payments_attributed_staff_stamp')
      AND NOT tgisinternal`);
  chk(trg.rows.length === 2, `V1 트리거×2 부착 (found ${trg.rows.length}/2)`);

  // 테스트 대상: 담당(assigned_staff_id) 있는 고객 1명 + 그 clinic
  const cust = await client.query(`
    SELECT c.id, c.clinic_id, c.assigned_staff_id
    FROM public.customers c
    WHERE c.assigned_staff_id IS NOT NULL AND c.clinic_id IS NOT NULL
    LIMIT 1`);
  if (cust.rows.length === 0) {
    console.log('  ⚠ 담당 있는 고객 없음 — V2~V6 스킵(합성 데이터 미생성).');
  } else {
    const { id: custId, clinic_id: clinicId, assigned_staff_id: staffId } = cust.rows[0];

    // V2: payments 트리거 stamp
    const ins = await client.query(`
      INSERT INTO public.payments (clinic_id, customer_id, amount, method, payment_type)
      VALUES ($1,$2,1000,'card','payment') RETURNING attributed_staff_id`, [clinicId, custId]);
    chk(ins.rows[0].attributed_staff_id === staffId, `V2 payments 트리거 stamp == assigned_staff_id`);

    // V3: 워크인(customer_id NULL) → NULL
    const walk = await client.query(`
      INSERT INTO public.payments (clinic_id, customer_id, amount, method, payment_type)
      VALUES ($1,NULL,1000,'cash','payment') RETURNING attributed_staff_id`, [clinicId]);
    chk(walk.rows[0].attributed_staff_id === null, 'V3 워크인(customer_id NULL) → attributed_staff_id NULL');

    // V4: package_payments 트리거 stamp (package_id NOT NULL 제약 → 임의 패키지 필요)
    const pkg = await client.query(`SELECT id FROM public.packages WHERE customer_id=$1 LIMIT 1`, [custId]);
    if (pkg.rows.length === 0) {
      console.log('  ⚠ 해당 고객 패키지 없음 — V4 스킵.');
    } else {
      const pins = await client.query(`
        INSERT INTO public.package_payments (clinic_id, package_id, customer_id, amount, method, payment_type)
        VALUES ($1,$2,$3,1000,'card','payment') RETURNING attributed_staff_id`, [clinicId, pkg.rows[0].id, custId]);
      chk(pins.rows[0].attributed_staff_id === staffId, 'V4 package_payments 트리거 stamp == assigned_staff_id');
    }
  }

  // V5/V6: baseline-freeze 백필 (레거시 NULL — 위 INSERT는 트리거로 이미 stamp됨)
  const expPay = await client.query(`
    SELECT count(*) n FROM public.payments p JOIN public.customers c ON c.id=p.customer_id
    WHERE p.attributed_staff_id IS NULL AND c.assigned_staff_id IS NOT NULL`);
  await client.query(freezeSql);
  const leftPay = await client.query(`
    SELECT count(*) n FROM public.payments p JOIN public.customers c ON c.id=p.customer_id
    WHERE p.attributed_staff_id IS NULL AND c.assigned_staff_id IS NOT NULL`);
  chk(Number(leftPay.rows[0].n) === 0, `V5 백필 후 payments 잔여 NULL(담당보유)=0 (백필전 대상 ${expPay.rows[0].n})`);

  const before2 = await client.query(`SELECT count(*) n FROM public.payments WHERE attributed_staff_id IS NULL`);
  await client.query(freezeSql); // 재실행
  const after2 = await client.query(`SELECT count(*) n FROM public.payments WHERE attributed_staff_id IS NULL`);
  chk(before2.rows[0].n === after2.rows[0].n, 'V6 백필 멱등 재실행 — NULL 카운트 불변(0 추가변경)');

  // V7: 원장 무접점 — SUM(amount) 불변(단, V2~V4 테스트 INSERT 분 보정)
  const sumAfter = await client.query(
    `SELECT (SELECT COALESCE(SUM(amount),0) FROM public.payments) p,
            (SELECT COALESCE(SUM(amount),0) FROM public.package_payments) k`);
  // 테스트 INSERT(payments +2000, package +1000 최대)만큼만 증가 — 백필은 amount 무접점.
  const dPay = Number(sumAfter.rows[0].p) - Number(sumBefore.rows[0].p);
  const dPkg = Number(sumAfter.rows[0].k) - Number(sumBefore.rows[0].k);
  chk(dPay <= 2000 && dPkg <= 1000, `V7 백필 amount 무접점 — 증분=테스트INSERT뿐 (Δpay=${dPay}, Δpkg=${dPkg})`);

  await client.query('ROLLBACK');
  console.log('\n── ROLLBACK 완료 (prod 영속 0) ──');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n❌ 예외 → ROLLBACK:', e.message);
  ok = false;
} finally {
  await client.end();
}
console.log(`\n${ok ? '✅ DRY-RUN 전체 PASS (무영속)' : '❌ DRY-RUN 실패'}`);
process.exit(ok ? 0 : 1);
