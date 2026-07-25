---
id: T-20260725-foot-NOTIF-TEMPLATE-UNIQUE-CONSTRAINT
domain: foot
status: blocked   # Part B 완료·커밋. Part A(DDL) 적용보류 — prod 기존 full-unique 중복 발견, planner FOLLOWUP MSG-20260725-140329-2aao 답 대기
qa_result: pending
priority: P2
db_change: pending-decision (요청=partial-unique INDEX 신설(ADDITIVE) but prod 기존 full-unique 중복 → DA/planner 재판정 대기)
da_consult: GO/ADDITIVE (MSG-20260725-132908-m1on, SSOT da_decision_notif_tmpl_active_unique_20260725) — 단 실행시점 divergence 발견으로 A 재확인 요청
parent: T-20260725-foot-SOLAPI-NO-TEMPLATE-RESOLVE-FAIL (no-template 진단 권고 ①)
e2e_exempt: db_only (단 Part B EF 로직변경 — 검증면제 아님)

# ── Part 진행상태 ──
partC_gate: PASS (channel = text NOT NULL DEFAULT 'sms', null_channel 0행. prod rxlomoozakkjesdqjtvd 실측)
partB_readpath: done (send-notification EF .eq("channel","sms") 명시필터. deno check PASS. 회귀0 — 전 12행 sms 단일)
partB_commit: 3754d923 (branch chore/T-20260725-foot-NOTIF-TEMPLATE-UNIQUE-CONSTRAINT, push완료, main 미머지·EF 미배포)
partA_ddl: HOLD — prod 기존 uq_notif_tmpl_clinic_event_channel UNIQUE(clinic_id,event_type,channel)가 요청 partial-unique WHERE is_active 를 strictly imply → 100% redundant. planner 회신 후 (a)DROP-A/(b)DESTRUCTIVE-교체 결정
census: clean (0건, WHERE is_active GROUP BY clinic,event,channel HAVING >1)

# ── deploy-ready 마킹 前 채울 evidence (MIG-GATE, Part A 진행 확정 시) ──
mig_files: pending
mig_dryrun: pending
mig_ledger_check: pending
mig_rollback: pending (DROP INDEX ux_notif_tmpl_active;)
applied_at: pending
---

# T-20260725-foot-NOTIF-TEMPLATE-UNIQUE-CONSTRAINT

부모 no-template 진단 권고 ①. notification_templates 활성 템플릿 유일성 하드닝.

## 스코프
- A. partial-unique INDEX `ux_notif_tmpl_active (clinic_id,event_type,channel) WHERE is_active` — **적용보류**
- B. 읽기경로 channel 필터 하드닝 (send-notification EF) — **완료**
- C. channel NOT NULL 게이트 확인 — **PASS**

## 실행시점 divergence (2026-07-25 dev-foot 실측)
prod에 이미 FULL unique `uq_notif_tmpl_clinic_event_channel UNIQUE (clinic_id, event_type, channel)` 존재
(messaging_module.sql 20260525030000 생성분, 이후 미삭제). 요청 partial-unique 는 이에 의해 함의됨 → redundant.
또한 partial-unique(채널포함)·full-unique 모두 DA 기술 재발("2번째 채널 활성 시 활성행 2개")을 막지 못함 —
서로 다른 채널이라 인덱스상 distinct. 실 재발차단 = Part B(발송채널 명시조회) 뿐.
→ planner FOLLOWUP MSG-20260725-140329-2aao 로 (a)Part A DROP 권장 / (b)DESTRUCTIVE 교체(별건) 택1 요청.

## 범위 밖
cross-CRM 표준화(longre/derm/body/scalp/scalp2 복제) = foot 파일럿 GO 확증 후 planner 별건.
