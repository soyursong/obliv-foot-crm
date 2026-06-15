-- T-20260615-foot-CALLLIST-ROOMSUMMARY-NUM-REORDER WS-C — 진료콜 명단 수기 순서 올림 영속화
--
-- 공유 realtime 화면(원장·직원 공용)이라 localStorage 불가 → check_ins ADDITIVE 컬럼으로 영속.
-- NULL = 자동 진입순(callEntryTime). 값 있으면 수기 override(asc 우선). 진료중(examination/in_treatment)은 항상 상단 고정.
--
-- 게이트/근거:
--   - data-architect CONSULT-REPLY MSG-20260615-192219-rbcg (판정 GO / ADDITIVE / contract_required:false)
--   - cross-CRM blast radius = 0 (check_ins는 contract 미등재 per-CRM local 테이블, 매출귀속 COALESCE 무관)
--   - WS-2(doctor_session_status/doctor_started_at)와 컬럼 충돌 0 — 서로 다른 컬럼, 둘 다 ADDITIVE → 적용 순서 무관, idempotent
--   - 별도 daily 리셋 트리거 불요 — 수기순서는 당일 check_in 행 라이프사이클. 다음날 새 check_in 행 → manual_order 자연 소멸
--   - ADD COLUMN IF NOT EXISTS: 재실행 안전(idempotent). default 無, nullable, backward-compatible.
--   - supervisor DDL-diff 게이트 검증 후 적용 (대표 게이트 면제 — autonomy §3.1, ADDITIVE+DA GO)
--
-- 롤백: 20260616000000_callist_manual_order.rollback.sql

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS call_list_manual_order integer NULL;

COMMENT ON COLUMN check_ins.call_list_manual_order IS
  'T-20260615-foot WS-C 진료콜 명단 수기 순서 override. NULL=자동 진입순, 값(asc)=수기 우선순위. 당일 check_in 행 단위(다음날 새 행에서 자연 소멸).';
