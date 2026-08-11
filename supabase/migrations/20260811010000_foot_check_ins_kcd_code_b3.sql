-- T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — up (상병 청구 연결: 스태프 캡처 컬럼 신설)
--
-- 문제: insurance_claim_diagnoses = 0건. 발톱은 급여 상병(KCD)을 청구에 실을 캡처면이 사실상 부재
--   (차트 49건 中 KCD 4건). 유일한 상병 입력면 = DiagnosisFolderPicker → medical_charts.diagnosis
--   = 의사 진료차트(§11 medical_confirm_gate) 종속 → 의사 차트가 없으면 급여방문 상병 미포착.
--   건보 명세는 방문당 상병 1건 이상 필수 → 스태프(비의사) 캡처 경로가 필요.
--
-- 최소변경: 동일 요양기관(13328581) body(도수) 패턴 이식 — check_ins.kcd_code 단일 컬럼.
--   ref: obliv-body-crm/supabase/migrations/20260515000010_kcd_codes.sql (check_ins.kcd_code TEXT)
--
--   ★ foot 고유 발산(body와 다른 점): body는 kcd_codes 마스터 테이블을 함께 두지만, foot 은
--     KCD 소스를 정적 번들(src/lib/kcd/kcdData.ts, T-20260611-foot-DIAG-KCD-BUNDLE-LOCKDOWN,
--     "DB 무변경" AC-0)로 확정했다 → foot 은 kcd_codes 마스터를 신설하지 않는다(최소 표면).
--     따라서 본 마이그레이션의 신규 스키마 = check_ins.kcd_code 단 1컬럼.
--
--   ★ KCD 발명 금지: 컬럼은 저장소일 뿐. FE 는 foot 정적 KCD 번들(isKnownKcdCode)에서 스태프가
--     '선택'한 값만 기록한다(자동 추론/발명 금지). 미입력 → 상병 결핍 표식(FE deficiency marker).
--
-- 런타임 통합(claim 생성 시 상병 → insurance_claim_diagnoses 복사)은 B-2(청구 명세 자동생성)가
--   claim 을 생성하는 것을 전제로 한다 → 본 티켓 병렬 착수, 런타임 join(diagnosis-link) 은 B-2 이후.
--
--   ★ diagnosis-link 통합 계약 (DA CONSULT-REPLY MSG-20260810-203221-2zrw, H2/H3/H6 · 3축 분리):
--     이 컬럼은 캡처면(H1: 캡처면=check_ins.kcd_code only, insurance_claim_diagnoses 직서 금지)일 뿐,
--     claim 에 실릴 상병은 claim-assembly(B-2) 가 아래 결정적(deterministic) precedence 로 FEED 한다:
--       ① chart_diagnoses (의사 진료차트 = authoritative 주/부상병)   ← 최우선
--       ② check_ins.kcd_code (스태프 캡처 = fallback 단일 주상병)      ← ①부재 시에만
--       ③ 상병결핍표식 (deficiency flag · B-2 귀속)                    ← ①②부재 시 청구 보류/flag
--     · H2 fallback(②)은 authoritative(①)를 절대 overwrite 금지.
--     · H3 결핍(③)=placeholder/unknown KCD 자동합성 금지(발명금지). 사람 resolution 전까지 청구 보류.
--     · H6 server-side backstop: foot 는 KCD 마스터 미신설(정적번들)→DB FK/CHECK 불가 →
--       claim-assembly(B-2) 가 미검증/unknown kcd_code 를 정식청구에서 reject/flag(FE isKnownKcdCode
--       단독 불충분·우회가능). H9 단일컬럼=방문당 단일 KCD(다중상병 구조화는 ①chart_diagnoses 전용).
--
-- change_class = ADDITIVE (신규 컬럼 1 · nullable · DEFAULT 없음 · backfill 0 · 기존행 무변경 ·
--   DROP 0 · txn-control(BEGIN/COMMIT) 없음). §S2.4 DA CONSULT(스키마 게이트) = GO 수신(조건부 GO,
--   ADDITIVE — DA CONSULT-REPLY MSG-20260810-203221-2zrw). ADDITIVE+DA GO → §3.1 대표(파괴) 게이트
--   면제. BUT DDL-0 carve 아님(ADD COLUMN + check_ins=PHI + kcd_code=상병PHI) → 적용 게이트 =
--   supervisor DDL-diff(up/down) + 물리 DB-GATE GO-token 선행 REQUIRED(H8).
--
-- ⚠️ 본 파일은 PROD 미적용 상태로 스테이징된다. supervisor DDL-diff + 물리 GO-token 발행 전 prod DDL
--    apply 금지(apply_before_go 클래스·H8: ADDITIVE·DDL-0 을 GO-token 면제로 오분류 금지). db_apply_guard.sh lane 경유.
--
-- ⚠️ 버전 재채번: 20260811000000 → 20260811010000 (B-2 T-...-INS-CLAIM-AUTODRAFT 가 20260811000000
--    선점·deploy-ready → ledger version 충돌 회피. B-3 는 독립 DDL(check_ins ADD COLUMN)·B-2(function+trigger)
--    와 DDL 의존 없음, 순서 무관·distinct version 만 필요).
--
-- dry-run  : 20260811010000_foot_check_ins_kcd_code_b3.dryrun.sql
-- rollback : 20260811010000_foot_check_ins_kcd_code_b3.rollback.sql

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS kcd_code TEXT;

COMMENT ON COLUMN public.check_ins.kcd_code IS
  'KCD 상병코드 (예: M72.2 족저근막염) — 스태프가 정적 KCD 번들에서 선택 시 저장. 건보 청구 상병 캡처 원천(방문 단위). B-2 claim 생성 시 insurance_claim_diagnoses 로 복사. (T-20260810-foot-INS-CLAIM-DIAGLINK / body 20260515000010 패턴 이식, kcd_codes 마스터 미신설=foot 정적번들 lockdown)';
