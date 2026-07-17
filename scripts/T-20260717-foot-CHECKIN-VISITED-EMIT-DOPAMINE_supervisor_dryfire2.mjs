/**
 * AC-4 foot-leg dry-fire (NO-PERSISTENCE, capture-via-RAISE).
 * 합성 check_in INSERT → 트리거 발화 → visited_stage outbox envelope 캡처 → RAISE로 강제 abort(무영속).
 * post-probe: 합성 check_in / 신규 outbox 잔존 0 확증.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const TOKEN = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1].trim().replace(/^["']|["']$/g,'');
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  const t=await r.text(); return {ok:r.ok,status:r.status,body:t};
}
const CLINIC='74967aea-a60b-4da3-a0e7-9c997a930bc8';
const RESV='e5b9b814-1ea9-4d7d-895e-2d5bf64dc0b8';
const SENTINEL='ZZ_DRYFIRE_SUPERVISOR_T20260717';

const dofire = `
DO $$
DECLARE ci_id uuid; msg text;
BEGIN
  INSERT INTO public.check_ins (clinic_id, customer_name, reservation_id, status)
    VALUES ('${CLINIC}','${SENTINEL}','${RESV}','registered')
    RETURNING id INTO ci_id;
  SELECT string_agg(event_type||' event_id='||event_id||' cue_card_id='||coalesce(cue_card_id::text,'∅')||' payload='||coalesce(payload::text,'∅'), ' || ')
    INTO msg
    FROM public.dopamine_callback_outbox
    WHERE event_id = ci_id::text;
  RAISE EXCEPTION 'DRYFIRE_CAPTURE ci=% ||| %', ci_id, coalesce(msg,'<<NO_OUTBOX_ROW_ENQUEUED>>');
END $$;`;

const r = await dofire && await q(dofire);
console.log('=== DRY-FIRE (expect abort w/ DRYFIRE_CAPTURE) ===');
console.log('http', r.status, 'ok', r.ok);
console.log(r.body);

// post-probe (무영속 확증)
const probe = await q(`SELECT
  (SELECT count(*) FROM public.check_ins WHERE customer_name='${SENTINEL}') sentinel_checkins,
  (SELECT count(*) FROM public.dopamine_callback_outbox) outbox_total,
  (SELECT count(*) FROM public.dopamine_callback_outbox WHERE event_type='visited_stage') visited_stage_total;`);
console.log('=== POST-PROBE (expect sentinel=0, outbox_total=167, visited_stage_total=0) ===');
console.log(probe.body);
