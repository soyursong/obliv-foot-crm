/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — CENSUS LIB (fixpoint 전이-closure + abort-if-grown)
 *
 * SOP §2-0 정본 (census 러너 commit 192700eb 계승) — 자식 FK 손열거 BAN.
 * 두 러너(Management-API dry-run / pg-direct apply)가 공유하는 SQL 빌더.
 *
 * ── fixpoint 전이-closure walk (DA 4차 하드조건 2) ──
 *   seed = frozen roots (customers PK-fixed + check_ins PK-fixed).
 *   pg_constraint 로 inbound FK edge 를 기계열거 → parent∈closure 인 edge 마다 NEW child row 계산
 *   → CASCADE(c) 는 closure 에 편입(손자까지 fixpoint 재귀), a/r·n 은 편입 없이 계상만.
 *   이미 closure 에 든 row 는 재계상 제외(check_ins 가 customers 의 'a' edge 자식이자 frozen root 인
 *   이중신분 정확 처리 — frozen 이므로 blocker 아님).
 *
 *   3항 증명 emit:
 *     (a) NEW row 보유 자식 전량 CASCADE(c) 且 closure total == 정확히 EXPECT_TOTAL(30)
 *     (b) RESTRICT/NO-ACTION(a/r) NEW row 보유 자식 == 0  (있으면 apply 원자실패 → dry-run 에서 선surface)
 *     (c) SET NULL(n) NEW row 보유 자식 == 0            (있으면 off-ledger 조용한 mutation → ABORT)
 *
 * ── abort-if-grown (DA 4차 Q2 하드조건 3) ──
 *   DELETE 직전 frozen 6 check_ins 의 CASCADE 자식 서명을 동적 재census → 편차 시 ABORT.
 */

const uuidArr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(',')}]::uuid[]`;

/**
 * fixpoint 전이-closure census (READ-ONLY). RAISE EXCEPTION 로 결과를 반송(무영속).
 * 반환 문자열은 `FIXPOINT ...` 마커를 포함 → 러너가 파싱.
 * @param {string[]} custIds  frozen customers PK
 * @param {string[]} ciIds    frozen check_ins PK
 */
export function buildFixpointClosureSql(custIds, ciIds) {
  return `DO $c$
DECLARE
  edge RECORD;
  parent_ids uuid[];
  new_ids uuid[];
  n bigint;
  changed boolean := true;
  rounds int := 0;
  cascade_rows bigint := 0;   -- seed 초과 CASCADE 편입행 누계
  bad_ar bigint := 0;         -- RESTRICT/NO-ACTION NEW row (blocker)
  bad_n bigint := 0;          -- SET NULL NEW row (off-ledger mutation)
  edges_txt text := '';
BEGIN
  CREATE TEMP TABLE _clo(relname text, id uuid, dt "char", PRIMARY KEY (relname, id)) ON COMMIT DROP;
  -- seed frozen roots (PK-fixed)
  INSERT INTO _clo SELECT 'customers', x, 'S' FROM unnest(${uuidArr(custIds)}) x;
  INSERT INTO _clo SELECT 'check_ins', x, 'S' FROM unnest(${uuidArr(ciIds)}) x;

  WHILE changed AND rounds < 64 LOOP
    changed := false;
    rounds := rounds + 1;
    FOR edge IN
      SELECT rel.relname AS child, att.attname AS fkcol, pf.relname AS parent,
             c.confdeltype AS dt, pk.attname AS pkcol
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_class pf  ON pf.oid  = c.confrelid
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
      -- child 단일컬럼 uuid PK (grandchild seed 수집용). 없으면 edge 제외(닫힌 스키마 전제).
      JOIN pg_index i   ON i.indrelid = c.conrelid AND i.indisprimary
      JOIN pg_attribute pk ON pk.attrelid = c.conrelid AND pk.attnum = i.indkey[0]
      JOIN pg_type pkt ON pkt.oid = pk.atttypid AND pkt.typname = 'uuid'
      WHERE c.contype = 'f'
        AND rel.relnamespace = 'public'::regnamespace
        AND pf.relname IN (SELECT DISTINCT relname FROM _clo)
    LOOP
      SELECT array_agg(id) INTO parent_ids FROM _clo WHERE relname = edge.parent;
      IF parent_ids IS NULL THEN CONTINUE; END IF;
      -- NEW child rows: parent-id 매칭 且 아직 closure 미포함
      EXECUTE format(
        'SELECT array_agg(t.%I) FROM public.%I t '
        || 'WHERE t.%I = ANY($1) '
        || 'AND NOT EXISTS (SELECT 1 FROM _clo w WHERE w.relname = $2 AND w.id = t.%I)',
        edge.pkcol, edge.child, edge.fkcol, edge.pkcol)
        INTO new_ids USING parent_ids, edge.child;
      n := COALESCE(array_length(new_ids, 1), 0);
      IF n > 0 THEN
        IF edge.dt = 'c' THEN
          INSERT INTO _clo SELECT edge.child, x, 'c' FROM unnest(new_ids) x
            ON CONFLICT DO NOTHING;
          cascade_rows := cascade_rows + n;
          changed := true;
          edges_txt := edges_txt || format(' +%s.%s=%s[c]', edge.child, edge.fkcol, n);
        ELSIF edge.dt IN ('a', 'r') THEN
          bad_ar := bad_ar + n;
          edges_txt := edges_txt || format(' !%s.%s=%s[%s-BLOCK]', edge.child, edge.fkcol, n, edge.dt);
        ELSIF edge.dt = 'n' THEN
          bad_n := bad_n + n;
          edges_txt := edges_txt || format(' ~%s.%s=%s[n-SETNULL]', edge.child, edge.fkcol, n);
        ELSE
          edges_txt := edges_txt || format(' ?%s.%s=%s[%s]', edge.child, edge.fkcol, n, edge.dt);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RAISE EXCEPTION 'FIXPOINT rounds=% total=% cascade_extra=% bad_ar=% bad_n=% edges:%',
    rounds, (SELECT count(*) FROM _clo), cascade_rows, bad_ar, bad_n,
    CASE WHEN edges_txt = '' THEN ' (none)' ELSE edges_txt END;
END $c$;`;
}

/** FIXPOINT RAISE 문자열 → 구조화 파싱 (Management-API JSON body / pg-direct 실개행+CONTEXT 양형식) */
export function parseFixpoint(body) {
  const m = body.match(/FIXPOINT rounds=(\d+) total=(\d+) cascade_extra=(\d+) bad_ar=(\d+) bad_n=(\d+) edges:([^"\n]*)/);
  if (!m) return null;
  return {
    rounds: +m[1], total: +m[2], cascade_extra: +m[3],
    bad_ar: +m[4], bad_n: +m[5], edges: m[6].trim(),
  };
}

/**
 * 3항 증명 판정.
 * @returns {{pass:boolean, reasons:string[]}}
 */
export function adjudicateFixpoint(fp, expectTotal) {
  const reasons = [];
  if (!fp) return { pass: false, reasons: ['FIXPOINT 마커 파싱 실패'] };
  // (b) RESTRICT/NO-ACTION NEW row 0
  const bOk = fp.bad_ar === 0;
  reasons.push(`(b) a/r NEW row(blocker) == ${fp.bad_ar} ${bOk ? '✅' : '❌ apply 원자실패 선surface → ABORT'}`);
  // (c) SET NULL NEW row 0
  const cOk = fp.bad_n === 0;
  reasons.push(`(c) SET NULL NEW row == ${fp.bad_n} ${cOk ? '✅' : '❌ off-ledger 조용한 mutation → ABORT'}`);
  // (a) NEW row 보유 자식 전량 CASCADE + total 정확히 expectTotal
  const aOk = bOk && cOk && fp.total === expectTotal;
  reasons.push(`(a) NEW row 자식 전량 CASCADE 且 closure total == ${fp.total} (expect ${expectTotal}) ${aOk ? '✅' : '❌'}`);
  return { pass: aOk && bOk && cOk, reasons };
}

/**
 * abort-if-grown 재census (DELETE 직전, DA 4차 Q2). frozen 6 check_ins 만 seed 로 한
 * fixpoint 전이-closure 를 재실행 → CASCADE 자식 서명·손자 성장 여부를 동적 재측정.
 * customers 를 seed 에서 배제하므로 순수 check_ins-CASCADE-closure 만 계상됨.
 * 야간 cron 이 frozen check_in 에 신규 aa 부착 or 신규 grandchild 생성 시
 * closure total / edge 서명이 커져(grown) 서명 불일치 → ABORT.
 *
 * → 별도 SQL 을 새로 만들지 않고 buildFixpointClosureSql(ci-only) 을 그대로 재사용.
 *   (custIds=[] → customers seed 0행. check_ins 는 seed root.)
 */
export function buildAbortIfGrownSql(ciIds) {
  return buildFixpointClosureSql([], ciIds);
}

/**
 * abort-if-grown 판정: ci-only closure total == expectTotal(21 = 6 ci + 15 CASCADE) 且
 * edge 서명이 정확히 {st,aa,crl} 且 a/r·n·손자 = 0.
 * @param {object} fp        parseFixpoint 결과 (ci-only 실행)
 * @param {object} signature { status_transitions, assignment_actions, check_in_room_logs }
 * @param {number} ciSeed    frozen check_ins 수 (6)
 */
export function adjudicateAbortIfGrown(fp, signature, ciSeed) {
  if (!fp) return { pass: false, reason: 'FIXPOINT(ci-only) 파싱 실패' };
  const sigSum = signature.status_transitions + signature.assignment_actions + signature.check_in_room_logs;
  const expectTotal = ciSeed + sigSum; // 6 + 15 = 21
  // edge 서명 파싱: `+<table>.<col>=<n>[c]`
  const found = {};
  for (const m of fp.edges.matchAll(/\+(\w+)\.\w+=(\d+)\[c\]/g)) found[m[1]] = +m[2];
  const sigOk =
    found.status_transitions === signature.status_transitions &&
    found.assignment_actions === signature.assignment_actions &&
    found.check_in_room_logs === signature.check_in_room_logs &&
    Object.keys(found).length === 3; // 정확히 3 CASCADE edge (신규 자식 테이블 없음)
  const totalOk = fp.total === expectTotal && fp.cascade_extra === sigSum;
  const cleanOk = fp.bad_ar === 0 && fp.bad_n === 0;
  const pass = sigOk && totalOk && cleanOk;
  const reason =
    `서명 {${Object.entries(found).map(([k, v]) => `${k}:${v}`).join(',') || '없음'}} ` +
    `(expect st:${signature.status_transitions},aa:${signature.assignment_actions},crl:${signature.check_in_room_logs}) ${sigOk ? '✅' : '❌ cron drift(freeze grown/신규자식)'} · ` +
    `total=${fp.total}/expect ${expectTotal} ${totalOk ? '✅' : '❌'} · a/r=${fp.bad_ar} n=${fp.bad_n} ${cleanOk ? '✅' : '❌'}`;
  return { pass, reason };
}

export { uuidArr };
