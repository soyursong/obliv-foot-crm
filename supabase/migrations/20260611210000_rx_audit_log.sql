-- T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK
-- 차트변경(처방) 내부로그 — 진료대시보드/진료환자목록 인플레이스 처방 mutate 감사.
-- 대표원장(U0ALGAAAJAV) 요청: "처방 적용/취소/확정 다 내부로그 남겨야 함. 차단된 시도도."
--
-- ⚠️ supervisor DB 게이트 경유 필수(SQL초안+롤백+RLS). data-architect CONSULT 동반.
-- rollback: 20260611210000_rx_audit_log.rollback.sql
--
-- 설계 원칙:
--   · 기존 clinic_events 재사용 검토 → 부적합(캘린더 일정 테이블: event_date/title/event_type). 신규 1개.
--   · PII·RRN 평문 금지 — 환자 식별은 check_in_id/customer_id(FK)로만. 본문엔 약물요약(임상)만.
--   · append-only 감사로그(수정/삭제 정책 없음 — FE는 INSERT만). 차단된 시도(*_blocked)도 적재.
--   · FE 는 best-effort(fire-and-forget) — 적재 실패가 진료(처방 적용/취소)를 막지 않음.

create table if not exists public.rx_audit_log (
  id             uuid primary key default gen_random_uuid(),
  check_in_id    uuid not null references public.check_ins(id) on delete cascade,
  customer_id    uuid references public.customers(id) on delete set null,
  clinic_id      uuid references public.clinics(id) on delete set null,
  -- 액션: 성공(rx_apply/rx_cancel/rx_undo/rx_confirm) + 차단된 시도(*_blocked)
  action         text not null check (action in (
                   'rx_apply', 'rx_cancel', 'rx_undo', 'rx_confirm',
                   'rx_apply_blocked', 'rx_cancel_blocked', 'rx_confirm_blocked'
                 )),
  -- 발생 화면(추적): 어느 동선에서 차트변경이 일어났는지
  surface        text not null default 'unknown' check (surface in (
                   'doctor_call_dashboard', 'doctor_patient_list',
                   'doctor_treatment_panel', 'chart', 'unknown'
                 )),
  -- 처리자(actor) — 스냅샷(staff 행 삭제·개명과 무관하게 그 시점 기록 보존)
  actor_id       uuid,
  actor_name     text,
  actor_role     text,
  -- 변경 전/후 약물요약(PII/RRN 금지 — 약물명/용법/건수만)
  before_summary text,
  after_summary  text,
  -- 차단 사유(*_blocked 액션일 때): discharged/not_today/cancelled/missing
  blocked_reason text,
  created_at     timestamptz not null default now()
);

-- 조회 인덱스: 환자별·클리닉/일자별 추적
create index if not exists idx_rx_audit_log_check_in on public.rx_audit_log(check_in_id);
create index if not exists idx_rx_audit_log_clinic_date on public.rx_audit_log(clinic_id, created_at desc);
create index if not exists idx_rx_audit_log_actor on public.rx_audit_log(actor_id, created_at desc);

-- RLS — clinic_events 패턴 준용. check_in 소유 클리닉 = 직원 소속 클리닉일 때만 INSERT/SELECT.
--   clinic_id 미전달(FE 누락) 케이스를 위해 check_in_id 소유로 판정(우회 0).
alter table public.rx_audit_log enable row level security;

-- INSERT: 본인 클리닉의 check_in 에 대해서만 감사로그 적재 허용(차단된 시도 포함).
create policy "rx_audit_log_insert" on public.rx_audit_log
  for insert with check (
    check_in_id in (
      select ci.id from public.check_ins ci
      where ci.clinic_id in (select clinic_id from public.staff where id = auth.uid())
    )
  );

-- SELECT: 같은 클리닉 직원이 조회. (감사 조회 화면은 추후 — 우선 적재만)
create policy "rx_audit_log_select" on public.rx_audit_log
  for select using (
    check_in_id in (
      select ci.id from public.check_ins ci
      where ci.clinic_id in (select clinic_id from public.staff where id = auth.uid())
    )
  );

-- UPDATE/DELETE 정책 없음 → append-only(감사 무결성). service_role 만 정리 가능.
