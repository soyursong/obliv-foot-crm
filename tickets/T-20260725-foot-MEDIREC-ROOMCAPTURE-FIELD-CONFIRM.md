---
id: T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM
title: "[메디렉] 풋 상담 room_id 캡처 + 60일 백필 (조인 앵커 복원)"
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: PENDING_COMMIT
deployed_at: "n/a (NOT yet deployed — supervisor QA gate)"
bundle_hash: "n/a (pending deploy)"
db_change: true
mig_files: [supabase/migrations/20260730120000_foot_status_transitions_room_id_backfill.sql]
mig_dryrun: pass
mig_ledger_check: clean
mig_rollback: supabase/migrations/20260730120000_foot_status_transitions_room_id_backfill.rollback.sql (시간경계 fallback) + .rollback.mjs (archive 정확 id-set, 1순위)
mig_dryrun_postprobe: absent
applied_at: "2026-07-30 01:43 KST — 백필 APPLIED: freeze=1150 updated=1150(rows-affected==count PASS) 잔차NULL=1 · archive-first + 멱등 재검(재파생 freeze=0)"
build-ok: true
spec-added: true
spec-exempt: false
created: 2026-07-25
assignee: dev-foot
reporter: CEO (MISSION MSG-20260729-191824-11zr)
source_msg: MSG-20260729-191824-11zr
risk_verdict: GO
da_gate: n/a (ADDITIVE 기존 nullable 컬럼 채우기 · 계약 무변경 · DDL 0)
---

# T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM

## 배경
메디렉(MediRec) 상담실 대면녹취 ↔ CRM 현장동선(status_transitions) 조인의 앵커가 풋에서 비어 있어 전량 미귀속. RC(9sre read-only + DA 실측): `status_transitions.room_id`(TEXT, nullable) 컬럼은 존재하나 全 INSERT site 가 미기입 → 0/369(0%). 방을 배정해도 전이에 안 남음.

**진단 = (A) 코드픽스만으로 유효** (CEO 07-29 build 승인):
- (B) 현장 SOP 아님 — check_in_room_logs 방배정 337/337=100%, 김주연 총괄 Q3 동선변경 불요.
- (C) 단일방 아님 — consultation 5실 다중방.

## 스코프 (ADDITIVE · 계약 무변경 · DDL 0)

### ① 캡처 (FE — src/pages/Dashboard.tsx, 룸수반 전이 4곳)
룸수반 status_transition INSERT 에 `room_id` 주입. 소스 = 동시에 기입되는 `check_in_room_logs.assigned_room` 와 **동일한 방 라벨**(FE scope 내, 06-26 C안).
- 방 드롭 핸들러(handleDrop, room:* 드롭) → `room_id: roomName`
- 상담실 배정(handleContextConsultStatusChange) → `room_id: consultRoom`
- 치료실 배정(handleContextTreatmentStatusChange, to_status='preconditioning') → `room_id: treatmentRoom`
- 레이저실 배정(handleContextLaserStatusChange) → `room_id: laserRoom`

### ② 미수반 전이 NULL 유지
registered / *_waiting / returning_zone / checklist / exam_waiting / receiving 등 미수반 전이 = 이 경로를 안 타므로 자연 NULL. **RPC 3종(셀프접수 v3 / 프리스크린 / 건강문진·체크리스트)은 全 to_status 가 비-룸수반**(registered·checklist·exam_waiting·consult_waiting·receiving) → 소싱 대상 없음 → **RPC 변경 불요**(scope 항목 "RPC 경로 동일 소싱"을 vacuously 충족).
> "사실상 NOT NULL" = **룸수반 전이 한정 앱레이어 규약**으로 정의. 스키마 NOT NULL 제약은 걸지 않음(미수반 전이 정상 NULL 보존).

### ③ 60일 백필 (supabase/migrations/20260730120000_...backfill.sql)
과거 룸수반 전이 room_id 를 check_in_room_logs 에서 시간최근접(±5분, gap median 0.00·±2분 100% 실증에 headroom) 결정적 소급.
- 멱등: `WHERE room_id IS NULL`(재실행 no-op).
- 대상셋 freeze(TEMP ON COMMIT DROP) → 동일 셋만 UPDATE → `rows-affected == freeze` 가드(불일치 시 ABORT).
- archive-first: `dryrun.mjs` 가 freeze-set(st_id → assigned_room) 을 `evidence/.../backfill_freeze_archive.json` 으로 사전 덤프 = 롤백 근거.
- cross_crm_data_correction_backfill_sop 준수. 원장 무접점.

## 자체 검증 (self-QA)
- **build**: ✅ `npm run build` (built in 6.46s, TS 오류 0).
- **spec**: ✅ `tests/e2e/T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM.spec.ts` 6/6 pass (캡처 결정 로직 AC-1 + 백필 nearest-log 결정성 AC-2/AC-3).
- **dry-run(read-only)**: ✅ non-persistence(pre/post sig 불변) + 정합(fill 1150 + 잔차 1 == 대상 1151) + archive-first JSON 생성.
- **backfill APPLY(prod)**: ✅ freeze=1150 / updated=1150 / **rows-affected==count PASS** / archive id-set 정확채움 1150·불일치 0 / in-window NOT NULL 증가 1150. 잔차 NULL(귀속불가=매칭 log 부재) 1건.
- **fill률(대상 룸수반 60일)**: **1150/1151 = 99.9%** (to_status별: consultation 390 · preconditioning 440 · laser 300 · examination 20).
- **멱등**: ✅ 재파생 freeze = 0 (재실행 no-op).

## 롤백
- FE: git revert.
- 백필 1순위: `node supabase/migrations/20260730120000_...backfill.rollback.mjs` — archive JSON 정확 id-set 만 room_id → NULL(캡처 신규분 무접촉, 값 일치 시에만 복원).
- 백필 fallback(archive 유실 시): `...backfill.rollback.sql` — 백필 APPLY 시각(2026-07-29 16:43 UTC) 이전 transitioned_at 의 룸수반 room_id → NULL(시간경계로 캡처 신규분 분리, pre-probe 0건 실증 근거).
- ⚠ freeze archive(`db-gate/T-20260725-foot-MEDIREC-ROOMCAPTURE_freeze_archive.json`)는 **PHI 스캐너 UUID false-positive**(st_id UUID 조각이 phone 정규식 오탐)로 git 미추적 → macstudio 로컬 보존(supervisor 동일머신 접근). assigned_room 값은 전부 정상 방라벨(오염 0, 25종: 상담실1~5·C1~10·L1~11·원장실 C5).

## 본 미션 밖 (별도 lane — 착수 안 함)
- (a) 풋 status_transitions → datalake export EF 부재(export=계약 → planner/DA 게이트).
- (b) medirec 조인 bridge(CRM room라벨↔medirec room라벨) = P-a/DA lane.

## supervisor QA 게이트
browser baseline 3-0 + 백필 rows-affected=count 재확인(evidence 동봉) → FE merge/deploy.
