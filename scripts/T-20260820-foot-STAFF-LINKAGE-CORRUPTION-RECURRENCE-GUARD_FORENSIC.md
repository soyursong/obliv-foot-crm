# FORENSIC REPORT — T-20260820-foot-STAFF-LINKAGE-CORRUPTION-RECURRENCE-GUARD

- **type**: forensic_investigation (조사 전용 · 코드/DB 무변경 leg)
- **db_change**: FALSE — SELECT introspection only, WRITE 0 / DDL 0 / main 미머지
- **artifact_class**: web_fe (그러나 기능 코드 변경 0 = 조사 종결 · surgical 가드 불요 판정)
- **date**: 2026-08-20
- **runner**: `_probe-staff-linkage-forensic.mjs` (service_role read-only SELECT, ref rxlomoozakkjesdqjtvd)
- **parent**: T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED (done) · 인접: STAFF-USERID-LINK-COMPLETENESS-CENSUS (done)

---

## 조사 목표 (티켓 AC)
1. staff 행이 언제·어떤 경로로 linkage 조건(`user_id=profile.id AND clinic_id AND active=true AND deleted_at IS NULL`)을 이탈했는가 — **이탈 필드 확정**(user_id NULL화 vs active=false vs deleted_at 세팅 中).
2. 유력 가설(STAFF-DEACTIVATE-DELETE-SPLIT 8/14~17 배포 경로 active=false/deleted_at 우발세팅) 검증.
3. 재발성 판정(재발경로 실재 vs 1회성) → 실재 시 surgical 가드 / 1회성이면 조사 종결 + census 연계.

---

## RC 확정 (1줄)
**이탈 필드 = `user_id`(생성시점부터 NULL, 8/20 fix까지 링크된 적 없음). `active`·`deleted_at`는 정상 상태 유지 → deactivate/delete UI가 이 행을 건드린 적 없음. RC = 프로비저닝-링크 미완결(staff 행이 auth 계정과 연결되지 않은 채 생성) — corruption/재발 아님.**

### 증거 A — 최현희 staff 행(9172beb7) DB introspection
```
id:          9172beb7-1294-4153-b549-9eb45d337233
name:        최현희  role: consultant  clinic_id: 74967aea (jongno-foot)
user_id:     44a73b6d-...  (8/20 fix로 최초 링크 — 이전 NULL)
active:      true          (한 번도 false 된 적 없음)
deleted_at:  null          (한 번도 세팅된 적 없음)
created_at:  2026-07-27T02:05:36Z   ← 배포창(8/14~17) 이전
updated_at:  2026-08-20T07:17:24Z   = 16:17 KST = 부모 티켓 fix 시각과 정확히 일치
```
- **created_at(7/27) < 배포창(8/14)**: 행은 배포 이전 생성.
- **updated_at = 8/20 16:17 KST = fix 시각**: 이 행에 기록된 유일한 mutation = fix 그 자체. 8/14~17 배포창 내 write 흔적 **없음**.
- **active=true / deleted_at=null 유지**: deactivate(→active=false)나 delete(→deleted_at 세팅)가 이 행에 실행됐다면 그 상태가 남아야 함. 둘 다 정상 → **deactivate/delete 미실행 확정**.

### 증거 B — 코드 forensic (staff write-path 전수, src/**+functions/**)
| write-path | 건드리는 필드 | user_id 세팅? |
|---|---|---|
| `Staff.tsx:574` 신규 직원 등록(INSERT) | `{clinic_id, name, role, active:true}` | **없음 → user_id NULL로 생성** |
| `Staff.tsx:217/233` 활성/비활성 toggle | `{active}` | 없음 |
| `Staff.tsx:260` 삭제(soft-delete) `buildStaffSoftDeletePatch` | `{deleted_at, deleted_by, deleted_reason, active}` | **없음** |
| `Staff.tsx:697` 정보수정 | `{name, role}` | 없음 |
| `Assignments.tsx:3546` / `AssignmentSettingsTab.tsx` | `assign_sort_order` / `auto_assign_enabled` / `slack_user_id` | 없음 |
| `admin-register-staff` EF → `admin_register_user` RPC | (server-side) `user_id` **세팅**(auth↔staff 링크 유일 경로) | **YES (링크 전용)** |

- **FE/EF 전 경로에 `staff.user_id`를 NULL로 쓰는 코드 = 0건** (grep `user_id` in Staff.tsx = 0 match). user_id를 세팅하는 유일 경로 = 원자 프로비저닝 EF(`admin-register-staff`)뿐.
- 즉 수동 "신규 직원 등록" UI로 만든 staff 행은 항상 user_id=NULL로 태어나며, 원자 EF를 거치지 않으면 auth 계정과 영영 링크되지 않음 = **census의 (A) 진성 미링크와 동일 class**.

### 증거 C — soft-delete가 user_id를 보존함 (deactivate/delete ⊥ user_id)
- soft-deleted(deleted_at NOT NULL) staff 42행 中: **user_id 보존(NOT NULL) 3 · NULL 39**.
- 링크가 있던 3행은 soft-delete 후에도 user_id를 **그대로 유지** → soft-delete/deactivate는 user_id를 절대 NULL화하지 않음(코드 증거 B와 정합). 나머지 39행은 애초에 링크 없이 생성(수동 UI)된 행.

---

## 가설 검증 결과
**STAFF-DEACTIVATE-DELETE-SPLIT(8/14~17) 우발세팅 가설 = REJECTED.**
1. 이탈 필드 = user_id인데, 해당 배포 코드(deactivate/delete)는 active/deleted_at만 write하고 user_id는 구조적으로 절대 건드리지 않음(증거 B·C).
2. 최현희 행은 배포창 이전(7/27) 생성, 배포창 내 write 흔적 없음, active/deleted_at 정상 유지(증거 A).
3. deactivate/delete UI는 `.eq('id', target.id)` 단일행 스코프 + rows-affected 검증 + `.is('deleted_at', null)` 멱등가드 → **인접행 오염 경로 부재**(티켓 2차 우려도 해소).

## 재발성 판정
- **deactivate/delete UI가 linkage(active/deleted_at/user_id)를 오염시키는 재발경로 = 실재하지 않음.**
- 진짜 상시 노출 = **프로비저닝 시점 decoupling**(수동 등록이 user_id 없이 staff 생성 / 원자 EF 미경유). 이는 "corruption 재발"이 아니라 **생성시점 미완결**이며, 이미 census(done) + backfill 티켓(STAFF-USERID-LINK-BACKFILL)이 소유.

---

## 결론 / 권고 (AC 분기: 1회성 → 조사 종결 + census 연계)
1. **surgical 가드 착수 불요**: deactivate/delete UI는 이미 단일행 스코프·rows-affected·멱등 가드 완비 = 회귀0 유지(건드릴 것 없음·blind 가드 금지 준수).
2. **코드/DB 변경 0 · 배포 불요**: 기능 코드 무변경, db_change=false, main 미머지(조사 산출물만).
3. **census/backfill 연계 권고**: 상시 노출은 프로비저닝-링크 미완결 축 → STAFF-USERID-LINK-BACKFILL(김주연 총괄 게이트) 및 향후 "수동 신규 직원 등록 = user_id 미링크 태생" 구조를 원자 EF(admin-register-staff)로 수렴하는 별건이 근본 대응(본 guard 티켓 scope 밖·재발원인 봉인 완료).
4. **forensic 한계 명시**: staff 행 prior-value history 테이블 부재로 8/14~17 내 write 후 8/20 fix가 덮어썼을 이론적 가능성은 updated_at 단독으로 완전 배제 불가하나, active=true·deleted_at=null 상태 잔존 + 코드에 user_id NULL화 경로 부재(증거 B/C)로 실질 배제됨.
