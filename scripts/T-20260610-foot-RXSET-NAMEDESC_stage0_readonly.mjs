/**
 * T-20260610-foot-RXSET-NAMEDESC-MODEL — Stage 0 (READ-ONLY)
 *
 * 목적 (GO 전 파괴적 write 0):
 *   Q3 LOCK = A-1 자동이관 안전성 검증. 기존 prescription_sets 19행이
 *   - set.name 에 "약이름"을, items[].name 에 "분류"를 담고 있다는 감사 가설을
 *     실데이터로 재확인.
 *   - set.name → items[].name (이름+용량 칸), 기존 items[].name → notes (설명 칸)
 *     자동이관 룰이 데이터손실 0 으로 안전 변환되는지 검증.
 *   - 예외(set.name 비표준 / 다(多)약 세트 / 이미 정상 / notes 비어있지 않음) 식별.
 *
 * write 없음. 순수 SELECT. prod 안전.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const q = async (label, sql, params = []) => {
  const r = await client.query(sql, params);
  console.log(`\n=== ${label} (${r.rowCount} rows) ===`);
  console.table(r.rows);
  return r.rows;
};

await client.connect();
console.log(`DB 연결 (READ-ONLY)  ${new Date().toISOString()}`);

// 0) 총 세트수 + 활성여부
await q('0. prescription_sets 총괄',
  `SELECT count(*) AS total_sets,
          count(*) FILTER (WHERE is_active) AS active_sets,
          count(*) FILTER (WHERE jsonb_array_length(items) = 1) AS single_item_sets,
          count(*) FILTER (WHERE jsonb_array_length(items) > 1) AS multi_item_sets,
          count(*) FILTER (WHERE jsonb_array_length(items) = 0) AS empty_sets
   FROM prescription_sets`);

// 1) 전 세트 raw — set.name vs items[0].name / dosage / route / notes
await q('1. 전 세트: set.name vs items[0] (자동이관 매핑 미리보기)',
  `SELECT id,
          name AS set_name,
          jsonb_array_length(items) AS item_cnt,
          items->0->>'name'    AS item0_name,
          items->0->>'dosage'  AS item0_dosage,
          items->0->>'route'   AS item0_route,
          items->0->>'frequency' AS item0_freq,
          items->0->>'count'   AS item0_count,
          items->0->>'days'    AS item0_days,
          items->0->>'notes'   AS item0_notes,
          items->0->>'classification' AS item0_class
   FROM prescription_sets
   ORDER BY id`);

// 2) 예외 후보 A: 다약(item>1) 세트 — set.name 1개를 어느 item에 넣을지 모호
await q('2. [예외A] 다약(item>1) 세트 — 자동이관 모호 대상',
  `SELECT id, name AS set_name, jsonb_array_length(items) AS item_cnt,
          (SELECT string_agg(it->>'name', ' | ') FROM jsonb_array_elements(items) it) AS all_item_names
   FROM prescription_sets
   WHERE jsonb_array_length(items) > 1
   ORDER BY id`);

// 3) 예외 후보 B: notes 가 이미 채워진 세트 — 설명 칸 덮어쓰기 충돌
await q('3. [예외B] items[0].notes 가 비어있지 않은 세트 — 설명칸 충돌',
  `SELECT id, name AS set_name,
          items->0->>'name'  AS item0_name,
          items->0->>'notes' AS item0_notes
   FROM prescription_sets
   WHERE coalesce(items->0->>'notes','') <> ''
   ORDER BY id`);

// 4) 예외 후보 C: item0.name 이 이미 set.name 과 동일 = 이미 정상(이관 불필요/멱등)
await q('4. [멱등] item0.name == set.name (이미 약이름이 항목명) — 이관 skip 대상',
  `SELECT id, name AS set_name, items->0->>'name' AS item0_name
   FROM prescription_sets
   WHERE items->0->>'name' = name
   ORDER BY id`);

// 5) 예외 후보 D: item0.name 이 빈 값 — 이관 시 set.name 만 채우면 됨(손실 무)
await q('5. [참고] item0.name 이 빈 값/NULL 인 세트',
  `SELECT id, name AS set_name, items->0->>'name' AS item0_name
   FROM prescription_sets
   WHERE coalesce(items->0->>'name','') = ''
   ORDER BY id`);

// 6) prescription_code_id 연결 여부 — 마스터연결 세트는 이관 시 link 보존 필요
await q('6. items[0].prescription_code_id 연결 분포',
  `SELECT count(*) FILTER (WHERE items->0->>'prescription_code_id' IS NOT NULL) AS linked,
          count(*) FILTER (WHERE items->0->>'prescription_code_id' IS NULL)     AS unlinked
   FROM prescription_sets`);

// 7) 자동이관 시뮬레이션 (TX 없이 SELECT 만으로 변환 결과 미리보기)
//    룰: 각 item 에 대해 name := set.name(첫 item만) , notes := 기존 item.name(분류) + 기존 notes
//    다약은 첫 item 만 set.name 사용, 2번째+ 는 기존 item.name 유지(별도 약) — 예외 표기
await q('7. 자동이관 시뮬레이션 미리보기 (단약 세트 한정, write 없음)',
  `SELECT id,
          name AS old_set_name,
          items->0->>'name'  AS old_item0_name_분류,
          name AS new_item0_name_약이름,
          NULLIF(items->0->>'name','') AS new_item0_notes_설명,
          items->0->>'dosage' AS dosage_보존,
          items->0->>'route'  AS route_보존숨김
   FROM prescription_sets
   WHERE jsonb_array_length(items) = 1
   ORDER BY id`);

await client.end();
console.log('\nStage 0 READ-ONLY 완료. write 0.');
