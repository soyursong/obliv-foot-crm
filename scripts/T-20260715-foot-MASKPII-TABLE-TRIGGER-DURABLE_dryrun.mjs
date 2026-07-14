/**
 * T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — 무영속 dry-run (Migration Dry-Run No-Persistence Protocol)
 *   · up.sql 의 top-level BEGIN;/COMMIT; strip → 본 러너가 BEGIN…ROLLBACK 로 감싸 무영속 보장.
 *   · in-tx: 트리거 present 확인 + 8 행위테스트(가드 fire / 회귀 무 / grandfathered short-circuit / 정정 통과)
 *     + sentinel '미확인'·NULL/dummy-phone false-reject 無(DA 판정항1, §3.1 대표게이트 면제 실증).
 *   · post-tx introspection: prod 에 트리거 미영속 확증(has_trigger=false = 아직 supervisor 미apply).
 * 실제 prod apply 는 supervisor DDL-diff 게이트 소관 + DA CONSULT-REPLY GO 선행. author: dev-foot / 2026-07-15.
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let T=process.env.SUPABASE_ACCESS_TOKEN; if(!T){try{T=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
if(!T){console.error('❌ SUPABASE_ACCESS_TOKEN 필요');process.exit(1);}
const q=async s=>{const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},body:JSON.stringify({query:s})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t.slice(0,1500)}`);return JSON.parse(t);};
const rows=x=>x.result??x;

// up.sql 의 top-level txn-control 만 strip (plpgsql 내부엔 BEGIN; 세미콜론 형태 없음 → 미매치)
const up = readFileSync('supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql','utf8')
  .split('\n').filter(l => !/^BEGIN;\s*$/.test(l) && !/^COMMIT;\s*$/.test(l)).join('\n');

// unique phone 생성(무영속 tx 이지만 (clinic_id,phone) unique 충돌 회피 위해 매 실행 유일값)
const uniq = (Date.now() % 100000000).toString().padStart(8,'0');
const PH_CLEAN = `+8210${uniq}`;
const PH_FIX   = `+8210${(Number(uniq)+1).toString().padStart(8,'0').slice(-8)}`;
const PH_SENT  = `+8210${(Number(uniq)+2).toString().padStart(8,'0').slice(-8)}`;

const tests = `
CREATE TEMP TABLE _dr(t text, result text) ON COMMIT DROP;

DO $D$
DECLARE v_cid uuid; v_fid uuid; v_new uuid;
BEGIN
  SELECT clinic_id INTO v_cid FROM public.customers LIMIT 1;               -- 유효 FK 재사용
  SELECT id INTO v_fid FROM public.customers WHERE public._fn_is_masked_pii(name, phone) LIMIT 1;  -- grandfathered flagged 실행

  -- A: INSERT masked name → 거부(22023)
  BEGIN INSERT INTO public.customers(clinic_id,name,phone) VALUES(v_cid,'접****1','+821012345678');
        INSERT INTO _dr VALUES('A_insert_masked_name','NO_REJECT❌');
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('A_insert_masked_name','rejected '||SQLSTATE); END;

  -- B: INSERT masked phone(유효자릿수 4) → 거부
  BEGIN INSERT INTO public.customers(clinic_id,name,phone) VALUES(v_cid,'홍길동','7887');
        INSERT INTO _dr VALUES('B_insert_masked_phone','NO_REJECT❌');
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('B_insert_masked_phone','rejected '||SQLSTATE); END;

  -- C: INSERT clean → 통과(회귀 무)
  BEGIN INSERT INTO public.customers(clinic_id,name,phone) VALUES(v_cid,'김정상','${PH_CLEAN}') RETURNING id INTO v_new;
        INSERT INTO _dr VALUES('C_insert_clean','passed → inserted '||CASE WHEN v_new IS NOT NULL THEN 'ok' ELSE 'NULL' END);
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('C_insert_clean','UNEXPECTED '||SQLSTATE); END;

  -- D: clean 행을 masked phone 으로 UPDATE(정상행 corruption) → 거부
  BEGIN UPDATE public.customers SET phone='7887' WHERE id=v_new;
        INSERT INTO _dr VALUES('D_update_clean_to_masked_phone','NO_REJECT❌');
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('D_update_clean_to_masked_phone','rejected '||SQLSTATE); END;

  -- E: clean 행을 masked name 으로 UPDATE → 거부
  BEGIN UPDATE public.customers SET name='접****1' WHERE id=v_new;
        INSERT INTO _dr VALUES('E_update_clean_to_masked_name','NO_REJECT❌');
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('E_update_clean_to_masked_name','rejected '||SQLSTATE); END;

  -- F: grandfathered flagged 행 무관 UPDATE(name/phone 미변경, SET name=name) → 통과(short-circuit, 회귀0 실증)
  IF v_fid IS NOT NULL THEN
    BEGIN UPDATE public.customers SET name=name, memo=COALESCE(memo,'') WHERE id=v_fid;
          INSERT INTO _dr VALUES('F_grandfathered_unchanged','passed (short-circuit) — 회귀0');
    EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('F_grandfathered_unchanged','REGRESSION❌ '||SQLSTATE); END;
  ELSE INSERT INTO _dr VALUES('F_grandfathered_unchanged','skip(flagged 행 0)'); END IF;

  -- G: grandfathered flagged 행 정정 UPDATE(masked→raw) → 통과(정정 허용)
  IF v_fid IS NOT NULL THEN
    BEGIN UPDATE public.customers SET name='정정함', phone='${PH_FIX}' WHERE id=v_fid;
          INSERT INTO _dr VALUES('G_grandfathered_correction','passed (masked→raw 정정 허용)');
    EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('G_grandfathered_correction','BLOCKED❌ '||SQLSTATE); END;
  ELSE INSERT INTO _dr VALUES('G_grandfathered_correction','skip(flagged 행 0)'); END IF;

  -- H: grandfathered flagged 행을 또다른 masked 값으로 변경(changed & masked) → 거부(short-circuit 미적용)
  IF v_fid IS NOT NULL THEN
    -- G 에서 raw 로 바꾼 v_fid 를 다시 masked 로 SET 시도 → NEW masked & changed → 거부 기대
    BEGIN UPDATE public.customers SET phone='1234' WHERE id=v_fid;
          INSERT INTO _dr VALUES('H_change_to_masked','NO_REJECT❌');
    EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('H_change_to_masked','rejected '||SQLSTATE); END;
  ELSE INSERT INTO _dr VALUES('H_change_to_masked','skip(flagged 행 0)'); END IF;

  -- I: INSERT sentinel 성함 '미확인' + raw phone → 통과(sentinel false-reject 無, DA 판정항1)
  --    '미확인' 은 마스킹 아님(* 무·phone 유효) → 트리거 미차단 확증(정당 미확인고객 등록 회귀 방지).
  BEGIN INSERT INTO public.customers(clinic_id,name,phone) VALUES(v_cid,'미확인','${PH_SENT}') RETURNING id INTO v_new;
        INSERT INTO _dr VALUES('I_insert_sentinel_name','passed (sentinel 미확인 false-reject 無)');
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('I_insert_sentinel_name','FALSE_REJECT❌ '||SQLSTATE); END;

  -- I2: helper NULL/sentinel/dummy-phone NULL-safety in-tx (DA 판정항1: NULL·sentinel·미수집 false-reject 無)
  --     phone 은 NOT NULL 이라 리터럴 NULL INSERT 불가 → predicate NULL-safety 를 직접 검증(트리거 masked 판정의
  --     유일 근거). 셋 중 하나라도 flagged 면 false-reject 회귀.
  BEGIN
    IF public._fn_is_masked_pii('미확인', NULL)
       OR public._fn_is_masked_pii('미확인', '+821012345678')
       OR public._fn_is_masked_pii('전화없음', '+821000000000') THEN
      INSERT INTO _dr VALUES('I2_null_sentinel_helper','FALSE_REJECT❌ (NULL/sentinel/dummy flagged)');
    ELSE
      INSERT INTO _dr VALUES('I2_null_sentinel_helper','passed (NULL/sentinel/dummy false-reject 無)');
    END IF;
  EXCEPTION WHEN others THEN INSERT INTO _dr VALUES('I2_null_sentinel_helper','UNEXPECTED '||SQLSTATE); END;
END $D$;

-- in-tx 트리거 present 확인
INSERT INTO _dr
  SELECT 'TRIGGER_PRESENT', (count(*)>0)::text FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='customers' AND t.tgname='trg_customers_reject_masked_pii';

SELECT t, result FROM _dr ORDER BY t;
`;

async function main(){
  console.log('=== DRY-RUN (무영속: BEGIN…ROLLBACK) ===\n');
  const r = rows(await q(`BEGIN;\n${up}\n${tests}\nROLLBACK;`));
  console.log('in-tx 결과:');
  (Array.isArray(r)?r:[]).forEach(x=>console.log(`  [${x.t}] ${x.result}`));

  console.log('\n=== POST-TX 무영속 확증 (supervisor apply 前 has_trigger=false 기대) ===');
  const post = rows(await q(`SELECT (count(*)>0) AS has_trigger FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='customers' AND t.tgname='trg_customers_reject_masked_pii';`));
  const has = post[0]?.has_trigger;
  console.log(`  has_trigger=${has}  ${has?'⚠(이미 apply됨)':'✅(미영속=dry-run 무영속 확증)'}`);

  const map = Object.fromEntries((Array.isArray(r)?r:[]).map(x=>[x.t,x.result]));
  const pass =
    /rejected 22023/.test(map.A_insert_masked_name||'') &&
    /rejected 22023/.test(map.B_insert_masked_phone||'') &&
    /passed/.test(map.C_insert_clean||'') &&
    /rejected 22023/.test(map.D_update_clean_to_masked_phone||'') &&
    /rejected 22023/.test(map.E_update_clean_to_masked_name||'') &&
    /passed/.test(map.F_grandfathered_unchanged||'') &&
    /passed/.test(map.G_grandfathered_correction||'') &&
    /rejected 22023/.test(map.H_change_to_masked||'') &&
    /passed/.test(map.I_insert_sentinel_name||'') &&
    /passed/.test(map.I2_null_sentinel_helper||'') &&
    has === false;
  console.log(`\n판정: ${pass?'✅ PASS — 트리거 폐쇄 정상 + 회귀0(short-circuit) + sentinel/NULL false-reject 無 + 무영속':'❌ REVIEW 필요'}`);
  process.exit(pass?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
