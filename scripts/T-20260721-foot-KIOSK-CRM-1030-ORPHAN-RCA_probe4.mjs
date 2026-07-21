/**
 * T-20260721-foot-KIOSK-CRM-1030-ORPHAN-RCA — READ-ONLY RCA probe #4 (NFD 확증)
 * 가설 확증: ㄱ*******ㄴ = 강승은(실환자, dopamine)이 NFD(자모분해) 로 저장 →
 *   서버측 마스킹 char_length/left/right 가 codepoint(자모) 단위로 동작 → ᄀ*******ᆫ 로 깨짐.
 *   대시보드는 마스킹 안 함(raw 렌더) → 강승은 정상 표시. 키오스크만 깨져 orphan 오인.
 * 검증: 금일 jongno 예약 이름의 NFC/NFD 정합 + 마스킹 함수 raw vs NFC 대조.
 * READ-ONLY. mutation 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1].trim();
const REF = 'rxlomoozakkjesdqjtvd';
const JONGNO = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// A) 금일 jongno 예약 이름: char_length(codepoint) vs NFC-normalize 후 length 대조.
//    NFD 저장이면 char_length > NFC length. 마스킹 함수 결과를 raw / NFC 로 각각 계산.
out.nfd_audit = await q(`
  WITH x AS (
    SELECT r.id AS reservation_id, r.reservation_time, r.status,
           COALESCE(r.customer_name, c.name) AS nm
    FROM reservations r LEFT JOIN customers c ON c.id=r.customer_id
    WHERE r.clinic_id='${JONGNO}' AND r.reservation_date='2026-07-21'
  )
  SELECT reservation_id, reservation_time, status,
    nm AS shown_raw,
    char_length(btrim(nm))                       AS len_raw_codepoints,
    char_length(normalize(btrim(nm), NFC))       AS len_nfc,
    (char_length(btrim(nm)) <> char_length(normalize(btrim(nm), NFC))) AS is_nfd,
    -- 현행 마스킹(raw, codepoint 기준) = 키오스크가 실제 뿌리는 값
    CASE
      WHEN nm IS NULL OR btrim(nm)='' THEN nm
      WHEN char_length(btrim(nm))=1 THEN btrim(nm)
      WHEN char_length(btrim(nm))=2 THEN left(btrim(nm),1)||'*'
      ELSE left(btrim(nm),1)||repeat('*',char_length(btrim(nm))-2)||right(btrim(nm),1)
    END AS mask_raw,
    -- NFC 정규화 후 마스킹(기대값) = 홍*동 형태
    CASE
      WHEN nm IS NULL OR btrim(normalize(nm,NFC))='' THEN nm
      WHEN char_length(btrim(normalize(nm,NFC)))=1 THEN btrim(normalize(nm,NFC))
      WHEN char_length(btrim(normalize(nm,NFC)))=2 THEN left(btrim(normalize(nm,NFC)),1)||'*'
      ELSE left(btrim(normalize(nm,NFC)),1)||repeat('*',char_length(btrim(normalize(nm,NFC)))-2)||right(btrim(normalize(nm,NFC)),1)
    END AS mask_nfc
  FROM x
  ORDER BY reservation_time;`);

// B) NFD 로 저장된 고객이 전 clinic 얼마나 되나 (오염 규모)
out.nfd_scope = await q(`
  SELECT clinic_id, count(*) n
  FROM customers
  WHERE name IS NOT NULL AND char_length(name) <> char_length(normalize(name, NFC))
  GROUP BY clinic_id;`);

// C) 강승은 정밀: NFC normalize 로 매칭 + codepoint hex dump
out.kang_precise = await q(`
  SELECT id, name, is_simulation, phone,
         char_length(name) AS cp_len,
         char_length(normalize(name,NFC)) AS nfc_len,
         encode(convert_to(name,'UTF8'),'hex') AS utf8_hex
  FROM customers
  WHERE clinic_id='${JONGNO}' AND normalize(name,NFC) = normalize('강승은',NFC);`);

console.log(JSON.stringify(out, null, 2));
