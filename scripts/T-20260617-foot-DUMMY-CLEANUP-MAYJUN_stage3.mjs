/**
 * T-20260617-foot-DUMMY-CLEANUP-MAYJUN — Stage 3 더미 전수 DELETE (GATED)
 *
 * ⚠ supervisor DML gate 필수. 기본 = DRY-RUN(trial-delete + ROLLBACK, prod 무변경).
 *   실삭제(COMMIT)는 `--apply` 명시 + supervisor 데이터게이트 GO 후에만.
 *
 * 삭제 범위 (planner TICKET-UPDATE MSG-20260617-192628-37jt, Stage2 HARD GATE 통과):
 *   delete_set = (Tier A 850 ∪ Tier B 428) − KEEP 17 − HOLD 3
 *     · Tier A/B id = Stage1 SSOT db-gate/..._stage1_tiered.json (READ-ONLY 산출)
 *     · KEEP 17 = 현장 김주연 총괄 확정(차트번호 SSOT) + Stage1 자동제외 2(김진화·이시형) + 윤민희
 *     · HOLD 3 = 신지아(체험단)·강혜인(치료사)·최다혜(치료사) — 잔여 오삭제 가드, 이번 sweep 보류 + FOLLOWUP
 *
 * 안전장치(fail-closed):
 *   1) Stage1 JSON 로드 → candidate(=A∪B) 수 EXPECT 대조(850/428).
 *   2) KEEP 15 chart_number 라이브 resolve → 이름 cross-check, 미해소/이름불일치 시 ABORT.
 *   3) delete_set ∩ KEEP_IDS == ∅, delete_set ∩ HOLD_IDS == ∅ (교집합 1건이라도 ABORT).
 *   4) delete_set 전원 clinic_id = jongno-foot 확인(타지점 혼입 0).
 *   5) real_guard(윤민희·김진화·이시형) 이름 delete_set 미포함 재확인.
 *   6) delete_set 수 EXPECT(=1261) 대조. 불일치 시 ABORT(키 재검토).
 *   7) FK 그래프 라이브 introspection(pg_constraent) → 자식→부모 위상정렬 삭제순서.
 *      - CASCADE/RESTRICT/NO-ACTION 엣지 통해 타겟 전파(명시 삭제), SET NULL/DEFAULT 엣지는 미전파(행 보존·null화).
 *   8) 단일 트랜잭션. DRY-RUN=ROLLBACK / APPLY=COMMIT. 어떤 assert 실패도 ROLLBACK.
 *   9) 삭제 전 대상 전 행(customers + 타겟 자식행) 백업 JSON 보존.
 *  10) 사후검증: KEEP/HOLD 전원 잔존 + delete_set customers 0건. 위반 시 ROLLBACK.
 *
 * 실행:
 *   node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs           # DRY-RUN (trial+rollback)
 *   node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs --apply   # 실삭제(COMMIT) — supervisor GO 후
 */
import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const TICKET = 'T-20260617-foot-DUMMY-CLEANUP-MAYJUN';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── EXPECT 게이트 (Stage1/Stage2 확정값) ──
const EXPECT = { tier_a: 850, tier_b: 428, keep_in_candidate: 14, hold_in_candidate: 3, delete_set: 1261 };

// KEEP 15 (차트번호 SSOT) — chart_number → 기대 이름
const KEEP_CHARTS = {
  'F-1190': '최영낭', 'F-0155': '양종필', 'F-0156': '이영현', 'F-0154': '김창재',
  'F-0187': '류복화', 'F-0158': '허다교', 'F-0157': '이정연', 'F-0455': '손효욱',
  'F-1089': '김상곤', 'F-0896': '김수연', 'F-0521': '김나영', 'F-1236': '유예슬',
  'F-1237': '안주연', 'F-3904': '서호영', 'F-4067': '윤민희',
};
// KEEP 자동제외 2 (Stage1 real_guard) — 차트 없음, 이름으로 보존
const KEEP_GUARD_NAMES = ['김진화', '이시형'];
// HOLD 3 (잔여 오삭제 가드) — phone E.164로 정밀 식별 (이름은 테스트와 충돌)
const HOLD_PHONES = {
  '+821094611240': '신지아', // 체험단/도수 실장님
  '+821022211444': '강혜인', // 치료샘
  '+821031414010': '최다혜', // 다혜 치료사 선생님
};

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) ENV[m[1]] = m[2].trim();
}
const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };
const q = (sql, params) => client.query(sql, params);

async function main() {
  out(`== ${TICKET} Stage3 ${APPLY ? '[APPLY=COMMIT]' : '[DRY-RUN=trial+ROLLBACK]'} == ${new Date().toISOString()}`);

  // 0) Stage1 SSOT 로드
  const j = JSON.parse(readFileSync(join(REPO, 'db-gate', `${TICKET}_stage1_tiered.json`), 'utf8'));
  const tierA = j.tier_a.map((r) => r.id);
  const tierB = j.tier_b.map((r) => r.id);
  if (tierA.length !== EXPECT.tier_a) throw new Error(`ABORT: tier_a ${tierA.length} ≠ EXPECT ${EXPECT.tier_a}`);
  if (tierB.length !== EXPECT.tier_b) throw new Error(`ABORT: tier_b ${tierB.length} ≠ EXPECT ${EXPECT.tier_b}`);
  const candidate = [...new Set([...tierA, ...tierB])];
  out(`Stage1 SSOT: TierA ${tierA.length} + TierB ${tierB.length} → candidate ${candidate.length} (중복제거)`);
  const realGuardNames = j.real_guard.map((r) => r.name);

  await client.connect();
  await q('BEGIN');
  // dry-run 도 trial-delete 위해 read-write txn 사용하되 마지막에 ROLLBACK → prod 무변경 보장.

  try {
    // 1) KEEP chart resolve + 이름 cross-check
    const chartList = Object.keys(KEEP_CHARTS);
    const { rows: keepRows } = await q(
      `SELECT id, name, phone, chart_number FROM customers WHERE clinic_id = $1 AND chart_number = ANY($2::text[])`,
      [CLINIC, chartList],
    );
    const keepByChart = {}; keepRows.forEach((r) => { keepByChart[r.chart_number] = r; });
    const keepResolveReport = [];
    const keepIds = new Set();
    for (const ch of chartList) {
      const r = keepByChart[ch];
      if (!r) { keepResolveReport.push(`  ⚠ ${ch} (${KEEP_CHARTS[ch]}): 라이브 미해소`); continue; }
      const nameOk = (r.name || '').trim() === KEEP_CHARTS[ch];
      keepResolveReport.push(`  ${nameOk ? '✓' : '⚠불일치'} ${ch}: ${r.name} (기대 ${KEEP_CHARTS[ch]}) | ${r.phone} | ${r.id}`);
      keepIds.add(r.id);
    }
    // KEEP guard names (김진화·이시형) + 윤민희 — real_guard id 로 보존
    const { rows: guardRows } = await q(
      `SELECT id, name FROM customers WHERE clinic_id = $1 AND name = ANY($2::text[])`,
      [CLINIC, [...KEEP_GUARD_NAMES, '윤민희']],
    );
    guardRows.forEach((r) => keepIds.add(r.id));
    out(`\n── KEEP resolve (chart 15) ──`); keepResolveReport.forEach((l) => out(l));
    out(`  guard-name resolve(김진화·이시형·윤민희): ${guardRows.map((r) => `${r.name}=${r.id}`).join(', ')}`);
    const missingChart = chartList.filter((ch) => !keepByChart[ch]);
    const nameMismatch = keepRows.filter((r) => (r.name || '').trim() !== KEEP_CHARTS[r.chart_number]);
    if (missingChart.length) throw new Error(`ABORT: KEEP chart 미해소 ${missingChart.join(',')} — 현장 재확인 필요`);
    if (nameMismatch.length) throw new Error(`ABORT: KEEP chart 이름불일치 ${nameMismatch.map((r) => r.chart_number).join(',')}`);

    // 2) HOLD 3 resolve (phone)
    const holdPhones = Object.keys(HOLD_PHONES);
    const { rows: holdRows } = await q(
      `SELECT id, name, phone FROM customers WHERE clinic_id = $1 AND phone = ANY($2::text[])`,
      [CLINIC, holdPhones],
    );
    const holdIds = new Set(holdRows.map((r) => r.id));
    out(`\n── HOLD 3 resolve (phone) ──`);
    holdRows.forEach((r) => out(`  ${r.name} | ${r.phone} | ${r.id} (기대 ${HOLD_PHONES[r.phone]})`));

    // 3) delete_set = candidate − keep − hold
    const keepInCand = candidate.filter((id) => keepIds.has(id));
    const holdInCand = candidate.filter((id) => holdIds.has(id));
    const deleteIds = candidate.filter((id) => !keepIds.has(id) && !holdIds.has(id));
    out(`\n── delete_set 산출 ──`);
    out(`  candidate ${candidate.length} − keep(후보내 ${keepInCand.length}) − hold(후보내 ${holdInCand.length}) = ${deleteIds.length}`);

    // 3-b) HOLD 3 의 candidate 포함 여부(planner FOLLOWUP 트리거용) 명시
    out(`\n── ⚠ 잔여 오삭제 가드 (신지아·강혜인·최다혜) ──`);
    for (const r of holdRows) {
      const inCand = candidate.includes(r.id);
      out(`  ${HOLD_PHONES[r.phone]} (${r.id}): candidate포함=${inCand} · delete_set포함=${deleteIds.includes(r.id)} → ${inCand ? 'HOLD(이번 sweep 제외) + FOLLOWUP' : 'candidate 외(영향없음)'}`);
    }

    // ── ASSERTS (fail-closed) ──
    const ix1 = deleteIds.filter((id) => keepIds.has(id));
    const ix2 = deleteIds.filter((id) => holdIds.has(id));
    if (ix1.length) throw new Error(`ABORT: delete_set ∩ KEEP ${ix1.length}건 — KEEP 오삭제 위험`);
    if (ix2.length) throw new Error(`ABORT: delete_set ∩ HOLD ${ix2.length}건 — HOLD 오삭제 위험`);
    if (keepInCand.length !== EXPECT.keep_in_candidate) throw new Error(`ABORT: keep_in_candidate ${keepInCand.length} ≠ EXPECT ${EXPECT.keep_in_candidate}`);
    if (holdInCand.length !== EXPECT.hold_in_candidate) throw new Error(`ABORT: hold_in_candidate ${holdInCand.length} ≠ EXPECT ${EXPECT.hold_in_candidate}`);
    if (deleteIds.length !== EXPECT.delete_set) throw new Error(`ABORT: delete_set ${deleteIds.length} ≠ EXPECT ${EXPECT.delete_set} — 키/명단 재검토`);

    // 4) clinic 한정 확인 + real_guard 이름 미포함
    const { rows: clinicChk } = await q(
      `SELECT count(*)::int AS n FROM customers WHERE id = ANY($1::uuid[]) AND clinic_id <> $2`, [deleteIds, CLINIC]);
    if (clinicChk[0].n !== 0) throw new Error(`ABORT: delete_set 중 타지점 ${clinicChk[0].n}건 — 혼입`);
    const { rows: rgChk } = await q(
      `SELECT name FROM customers WHERE id = ANY($1::uuid[]) AND name = ANY($2::text[])`, [deleteIds, realGuardNames]);
    if (rgChk.length) throw new Error(`ABORT: real_guard 이름 delete_set 포함 ${rgChk.map((r) => r.name).join(',')}`);
    out(`\n✓ ASSERT 통과: clinic 한정 OK · KEEP/HOLD 교집합 0 · real_guard 미포함 · delete_set=${deleteIds.length}`);

    // 5) FK 그래프 introspection (customers reachable subgraph)
    const { rows: fks } = await q(`
      SELECT (con.conrelid::regclass)::text AS child, (con.confrelid::regclass)::text AS parent,
             att.attname AS fkcol, con.confdeltype AS deltype
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND array_length(con.conkey,1) = 1
        AND con.connamespace = 'public'::regnamespace`);
    const clean = (s) => s.replace(/^public\./, '').replace(/"/g, '');
    const edges = fks.map((e) => ({ child: clean(e.child), parent: clean(e.parent), fkcol: e.fkcol, deltype: e.deltype }));
    // single-col PK map
    const { rows: pks } = await q(`
      SELECT c.relname AS tbl, a.attname AS pk
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary AND c.relnamespace = 'public'::regnamespace`);
    const pkCount = {}; pks.forEach((r) => { pkCount[r.tbl] = (pkCount[r.tbl] || 0) + 1; });
    const pkMap = {}; pks.forEach((r) => { if (pkCount[r.tbl] === 1) pkMap[r.tbl] = r.pk; });

    // reachable from customers via deltype in (a,r,c) reverse edges (parent→child)
    const PROP = new Set(['a', 'r', 'c']); // SET NULL('n')/DEFAULT('d') 미전파
    const reachable = new Set();
    let frontier = new Set(['customers']);
    while (frontier.size) {
      const next = new Set();
      for (const e of edges) {
        if (e.child === e.parent) continue;
        if (frontier.has(e.parent) && PROP.has(e.deltype) && !reachable.has(e.child) && e.child !== 'customers') {
          if (!next.has(e.child) && !reachable.has(e.child)) next.add(e.child);
        }
      }
      next.forEach((t) => reachable.add(t));
      frontier = next;
    }
    out(`\n── FK subgraph: customers reachable child 테이블 ${reachable.size}개 ──`);

    // 위상정렬 (parent-first): table 은 자기 parent(타겟) 전부 처리 후 계산 가능
    const nodes = ['customers', ...reachable];
    const nodeSet = new Set(nodes);
    const prereq = {}; // table → set(parents in nodeSet via PROP edge)
    nodes.forEach((t) => { prereq[t] = new Set(); });
    for (const e of edges) {
      if (e.child === e.parent) continue;
      if (nodeSet.has(e.child) && nodeSet.has(e.parent) && PROP.has(e.deltype)) prereq[e.child].add(e.parent);
    }
    const parentFirst = []; const done = new Set();
    let guard = 0;
    while (done.size < nodes.length && guard++ < nodes.length + 5) {
      for (const t of nodes) {
        if (done.has(t)) continue;
        if ([...prereq[t]].every((p) => done.has(p))) { parentFirst.push(t); done.add(t); }
      }
    }
    const leftover = nodes.filter((t) => !done.has(t));
    if (leftover.length) { out(`  ⚠ 위상정렬 잔여(cycle 의심): ${leftover.join(',')} → 끝에 append`); parentFirst.push(...leftover); }
    const childFirst = [...parentFirst].reverse(); // 삭제 순서

    // ── DEBUG: 트리거 점검 (customers 소실 anomaly RC 규명) ──
    const { rows: trg } = await q(`
      SELECT (tg.tgrelid::regclass)::text AS tbl, tg.tgname AS trigger, p.proname AS func
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND tg.tgrelid::regclass::text NOT LIKE 'pg_%'`);
    out(`\n── DEBUG: 사용자 트리거 ${trg.length}개 ──`);
    trg.forEach((r) => out(`  ${r.tbl} · ${r.trigger} → ${r.func}()`));
    const custAlive0 = await q(`SELECT count(*)::int n FROM customers WHERE id = ANY($1::uuid[])`, [deleteIds]);
    out(`  [t0] delete_set customers 생존(삭제 전): ${custAlive0.rows[0].n}`);

    // Phase 1: parent-first 로 타겟 id temp 생성
    await q(`CREATE TEMP TABLE "_t_customers" ON COMMIT DROP AS SELECT id FROM customers WHERE id = ANY($1::uuid[])`, [deleteIds]);
    const tc0 = await q(`SELECT count(*)::int n FROM "_t_customers"`);
    out(`  [t1] _t_customers 적재: ${tc0.rows[0].n}`);
    const noPkTables = [];
    for (const t of parentFirst) {
      if (t === 'customers') continue;
      const inEdges = edges.filter((e) => e.child === t && e.parent !== t && nodeSet.has(e.parent) && PROP.has(e.deltype));
      const conds = inEdges
        .filter((e) => e.parent === 'customers' || pkMap[e.parent]) // parent 에 temp(_t_) 존재해야
        .map((e) => `"${e.fkcol}" IN (SELECT id FROM "_t_${e.parent}")`);
      if (!conds.length) continue;
      if (pkMap[t]) {
        await q(`CREATE TEMP TABLE "_t_${t}" ON COMMIT DROP AS SELECT "${pkMap[t]}" AS id FROM "${t}" WHERE ${conds.join(' OR ')}`);
      } else {
        noPkTables.push({ t, conds }); // PK 없는 테이블은 Phase2에서 직접 조건 삭제
      }
    }

    // Phase 2: child-first 삭제 (dry-run 도 실행 후 ROLLBACK)
    //   ⚠ 삭제 직전 대상 전 행 백업(backup[table]=rows) → rollback JSON (gate 요건 #2).
    out(`\n── 삭제 실행(자식→부모) ──`);
    const counts = {};
    const backup = {};
    for (const t of childFirst) {
      if (t === 'customers') continue;
      const before = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
      if (pkMap[t]) {
        const exists = await q(`SELECT 1 FROM pg_class WHERE relname = $1 AND relnamespace = pg_my_temp_schema()`, [`_t_${t}`]);
        if (!exists.rows.length) continue;
        const bk = await q(`SELECT * FROM "${t}" WHERE "${pkMap[t]}" IN (SELECT id FROM "_t_${t}")`);
        if (bk.rows.length) backup[t] = bk.rows;
        const r = await q(`DELETE FROM "${t}" WHERE "${pkMap[t]}" IN (SELECT id FROM "_t_${t}")`);
        if (r.rowCount) { counts[t] = r.rowCount; out(`  ${t}: ${r.rowCount}`); }
      } else {
        const np = noPkTables.find((x) => x.t === t);
        if (!np) continue;
        const bk = await q(`SELECT * FROM "${t}" WHERE ${np.conds.join(' OR ')}`);
        if (bk.rows.length) backup[t] = bk.rows;
        const r = await q(`DELETE FROM "${t}" WHERE ${np.conds.join(' OR ')}`);
        if (r.rowCount) { counts[t] = r.rowCount; out(`  ${t}(no-pk): ${r.rowCount}`); }
      }
      const after = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
      if (after.rows[0].n !== before.rows[0].n) out(`  ⚠⚠ [${t}] 삭제 후 customers 생존 ${before.rows[0].n}→${after.rows[0].n} — 이 테이블이 customers 연쇄삭제 유발`);
    }
    const tcBeforeSoft = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
    out(`  [t2] Phase2 후 delete_set customers 생존: ${tcBeforeSoft.rows[0].n}`);
    // Phase 2-b: soft-link / SET NULL 정리 — customer_id 컬럼 보유 but FK그래프 미전파(soft link or SET NULL)
    //   FK 없음(medical_charts·chart_doctor_memos·aicc_crm_phone_match) → dangling 방지
    //   SET NULL(notification_logs) → 더미 알림 행 nulled orphan 방지 (명시 삭제)
    //   customers 보다 먼저 삭제(삭제 후엔 식별 불가). medical_charts 자식은 medical_chart_id CASCADE 로 자동.
    //   ⚠ relkind='r'(일반 테이블)만 — VIEW(예: aicc_crm_phone_match = customers 자동갱신뷰) 제외.
    //     뷰에 DELETE 하면 customers 로 rewrite 되어 최종 명시삭제 전에 customers 가 사라짐(이중카운트·순서혼란).
    const { rows: custCols } = await q(
      `SELECT c.relname AS table_name
       FROM information_schema.columns ic
       JOIN pg_class c ON c.relname = ic.table_name AND c.relnamespace = 'public'::regnamespace
       WHERE ic.table_schema='public' AND ic.column_name='customer_id' AND c.relkind='r'`);
    const extraTables = [...new Set(custCols.map((r) => r.table_name))].filter((t) => t !== 'customers' && !reachable.has(t));
    out(`\n── soft-link / SET NULL 정리 (FK그래프 외 customer_id 보유 ${extraTables.length}개) ──`);
    const softCounts = {};
    for (const t of extraTables) {
      const before = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
      const bk = await q(`SELECT * FROM "${t}" WHERE customer_id IN (SELECT id FROM "_t_customers")`);
      if (bk.rows.length) backup[t] = bk.rows;
      const r = await q(`DELETE FROM "${t}" WHERE customer_id IN (SELECT id FROM "_t_customers")`);
      if (r.rowCount) { softCounts[t] = r.rowCount; out(`  ${t}: ${r.rowCount}`); }
      const after = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
      if (after.rows[0].n !== before.rows[0].n) out(`  ⚠⚠ [soft:${t}] 삭제 후 customers 생존 ${before.rows[0].n}→${after.rows[0].n} — 이 테이블이 customers 연쇄삭제 유발`);
    }

    const tcBeforeFinal = await q(`SELECT count(*)::int n FROM "_t_customers"`);
    const custBeforeFinal = await q(`SELECT count(*)::int n FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
    out(`  [t3] 최종삭제 직전: _t_customers=${tcBeforeFinal.rows[0].n} · customers 생존=${custBeforeFinal.rows[0].n}`);
    const custBk = await q(`SELECT * FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
    backup['customers'] = custBk.rows;
    const rc = await q(`DELETE FROM customers WHERE id IN (SELECT id FROM "_t_customers")`);
    counts['customers'] = rc.rowCount; out(`  customers: ${rc.rowCount}`);

    // 백업 JSON 보존 (gate 요건 #2) — 삭제 대상 전 행 + 테이블별 카운트
    const backupCounts = Object.fromEntries(Object.entries(backup).map(([k, v]) => [k, v.length]));
    writeFileSync(join(REPO, 'rollback', `${TICKET}_stage3_backup.json`), JSON.stringify({
      ticket: TICKET, stage: 3, mode: APPLY ? 'apply' : 'dry-run', backed_up_at: new Date().toISOString(),
      clinic_id: CLINIC, delete_set: deleteIds.length, table_counts: backupCounts, rows: backup,
    }, null, 2));
    out(`  ✓ 백업 보존: rollback/${TICKET}_stage3_backup.json (${Object.keys(backup).length}개 테이블)`);

    // 6) 사후검증 (txn 내) — KEEP/HOLD 잔존 + delete_set customers 0
    const allKeep = [...keepIds]; const allHold = [...holdIds];
    const { rows: keepAlive } = await q(`SELECT count(*)::int n FROM customers WHERE id = ANY($1::uuid[])`, [allKeep]);
    const { rows: holdAlive } = await q(`SELECT count(*)::int n FROM customers WHERE id = ANY($1::uuid[])`, [allHold]);
    const { rows: delGone } = await q(`SELECT count(*)::int n FROM customers WHERE id = ANY($1::uuid[])`, [deleteIds]);
    out(`\n── 사후검증(txn 내) ──`);
    out(`  KEEP 잔존: ${keepAlive[0].n}/${allKeep.length} (전원 잔존이어야)`);
    out(`  HOLD 잔존: ${holdAlive[0].n}/${allHold.length} (전원 잔존이어야)`);
    out(`  delete_set customers 잔존: ${delGone[0].n} (0이어야)`);
    if (keepAlive[0].n !== allKeep.length) throw new Error(`ABORT: KEEP 일부 소실 ${keepAlive[0].n}/${allKeep.length}`);
    if (holdAlive[0].n !== allHold.length) throw new Error(`ABORT: HOLD 일부 소실 ${holdAlive[0].n}/${allHold.length}`);
    if (delGone[0].n !== 0) throw new Error(`ABORT: delete_set customers 잔존 ${delGone[0].n}`);

    // 산출물 (dry-run/apply 공통)
    mkdirSync(join(REPO, 'db-gate'), { recursive: true });
    mkdirSync(join(REPO, 'rollback'), { recursive: true });
    const dry = {
      ticket: TICKET, stage: 3, mode: APPLY ? 'apply' : 'dry-run', measured_at: new Date().toISOString(),
      clinic_id: CLINIC, expect: EXPECT,
      candidate: candidate.length, keep_ids: allKeep.length, hold_ids: allHold.length, delete_set: deleteIds.length,
      keep_in_candidate: keepInCand.length, hold_in_candidate: holdInCand.length,
      keep_resolve: keepResolveReport, hold_resolve: holdRows.map((r) => ({ name: HOLD_PHONES[r.phone], phone: r.phone, id: r.id, in_candidate: candidate.includes(r.id) })),
      fk_reachable: [...reachable], delete_order_childfirst: childFirst.filter((t) => t !== 'customers'),
      deleted_counts: counts, soft_link_counts: softCounts, soft_link_tables: extraTables, delete_set_ids: deleteIds,
    };
    writeFileSync(join(REPO, 'db-gate', `${TICKET}_stage3_dryrun.json`), JSON.stringify(dry, null, 2));

    if (APPLY) {
      await q('COMMIT');
      out(`\n✅ COMMIT 완료 (실삭제). customers ${rc.rowCount}건 + 연관행 삭제.`);
    } else {
      await q('ROLLBACK');
      out(`\n[DRY-RUN] ROLLBACK 완료 — prod 무변경. 전체 삭제 계획이 라이브 데이터에서 FK 위반 없이 검증됨.`);
      out(`  실삭제: --apply (supervisor 데이터게이트 GO 후).`);
    }
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    out(`\n❌ ${e.message} → ROLLBACK (prod 무변경)`);
    throw e;
  } finally {
    writeFileSync(join(REPO, 'db-gate', `${TICKET}_stage3_runlog.txt`), log.join('\n') + '\n');
    await client.end();
  }
}
main().catch(() => process.exit(1));
