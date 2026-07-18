import fs from 'fs';
const {manifest:m}=JSON.parse(fs.readFileSync('scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_1_fresh_snapshot.out.json','utf8'));
const inList=a=>a.map(x=>`'${x}'`).join(',');
const sql=`-- ROLLBACK SQL — T-20260701-foot-STAFF-ROSTER-DEDUP #1 박소예 (post-COMMIT 재난복구용)
-- freeze 매니페스트 스냅샷 기반. 재귀속 fk 원상 + CANON active 원상 + DUP active/name 원상.
-- 실행 전 반드시 현 상태 확인. per-person 단일 txn 으로 감쌀 것.
BEGIN;
-- 재귀속 원상: CANON → DUP (freeze 매니페스트 id셋 명시)
UPDATE duty_roster      SET doctor_id='${m.dup}'        WHERE id IN (${inList(m.dup_duty_ids)});
UPDATE package_sessions SET performed_by='${m.dup}'     WHERE id IN (${inList(m.dup_pkg_ids)});
UPDATE room_assignments SET staff_id='${m.dup}'         WHERE id IN (${inList(m.dup_room_ids)});
${m.dup_customer_ids.length? `UPDATE customers SET assigned_staff_id='${m.dup}' WHERE id IN (${inList(m.dup_customer_ids)});` : '-- customers: 재귀속 0건 (원상 불요)'}
-- CANON active 원상: true → false
UPDATE staff SET active=false WHERE id='${m.canon}';
-- DUP active/name 원상: false → true, 중복정리 마킹 제거
UPDATE staff SET active=true, name=regexp_replace(name,' \\[중복정리 2026-07-18\\]$','') WHERE id='${m.dup}';
-- 검증: 롤백 후 상태 확인 후 COMMIT/ROLLBACK 결정
-- SELECT id,name,active,user_id FROM staff WHERE name LIKE '박소예%';
COMMIT;
`;
fs.writeFileSync('rollback/T-20260701-foot-STAFF-ROSTER-DEDUP_1_rollback.sql',sql);
console.log('✅ rollback SQL → rollback/T-20260701-foot-STAFF-ROSTER-DEDUP_1_rollback.sql');
console.log(sql);
