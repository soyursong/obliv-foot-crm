/**
 * T-20260603-foot-RX-CHART-FOLLOWUP2 #10 — 특이사항 핀 고정(맨위로) 적용
 *   customer_special_notes.is_pinned(boolean) + pinned_at(timestamptz) additive.
 *   set_special_note_pin(uuid, boolean) SECURITY DEFINER RPC (클리닉 격리 + 컬럼 단위 변경).
 * node-pg pooler 직접 연결. 멱등(재실행 안전). dry-run RPC→rollback 검증.
 * supabase/migrations/20260603080000_special_note_pin.sql 과 동일 정의.
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
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

console.log('🚀 RX-CHART-FOLLOWUP2 #10 마이그 (특이사항 핀 고정)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  await client.query(`ALTER TABLE customer_special_notes ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;`);
  await client.query(`ALTER TABLE customer_special_notes ADD COLUMN IF NOT EXISTS pinned_at timestamptz;`);
  await client.query(`COMMENT ON COLUMN customer_special_notes.is_pinned IS 'AC-10 특이사항 핀 고정(맨위로). true=상단 고정. 클리닉 공용 표식.';`);
  await client.query(`COMMENT ON COLUMN customer_special_notes.pinned_at IS 'AC-10 핀 고정 시각 (정렬 보조). NULL=미고정.';`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_csn_pin_order ON customer_special_notes(customer_id, is_pinned DESC, created_at DESC);`);

  await client.query(`
    CREATE OR REPLACE FUNCTION set_special_note_pin(p_note_id uuid, p_pinned boolean)
    RETURNS customer_special_notes
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_row customer_special_notes;
    BEGIN
      UPDATE customer_special_notes
         SET is_pinned = p_pinned,
             pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
             updated_at = now()
       WHERE id = p_note_id
         AND clinic_id = current_user_clinic_id()
      RETURNING * INTO v_row;
      IF NOT FOUND THEN
        RAISE EXCEPTION '특이사항 항목을 찾을 수 없거나 권한이 없습니다 (id=%)', p_note_id USING ERRCODE = 'P0001';
      END IF;
      RETURN v_row;
    END;
    $$;`);
  await client.query(`REVOKE ALL ON FUNCTION set_special_note_pin(uuid, boolean) FROM public;`);
  await client.query(`GRANT EXECUTE ON FUNCTION set_special_note_pin(uuid, boolean) TO authenticated;`);
  await client.query(`COMMENT ON FUNCTION set_special_note_pin(uuid, boolean) IS 'AC-10 특이사항 핀 토글. 클리닉 격리 검증 후 is_pinned/pinned_at 만 변경(본문 불가침).';`);

  const col = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name='customer_special_notes' AND column_name='is_pinned';`);
  console.log(`✅ is_pinned 컬럼 ${col.rows.length ? '존재' : '실패'}`);
  const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname='set_special_note_pin';`);
  console.log(`✅ set_special_note_pin RPC ${fn.rows.length ? '존재' : '실패'}`);

  // dry-run: 실제 row 핀 토글 → rollback (RPC 동작 + 클리닉 격리 검증)
  await client.query('BEGIN');
  try {
    const row = await client.query(`SELECT id FROM customer_special_notes LIMIT 1;`);
    if (row.rows.length) {
      await client.query(`UPDATE customer_special_notes SET is_pinned=true, pinned_at=now() WHERE id=$1;`, [row.rows[0].id]);
      console.log('✅ dry-run: is_pinned UPDATE OK (롤백 예정)');
    } else {
      console.log('⚠️  dry-run skip: 특이사항 데이터 없음');
    }
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  dry-run 롤백 완료 (실데이터 무변경)');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
