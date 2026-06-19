---
ticket_id: T-20260619-foot-STAFF-MOONJIEUN-ROLE-DIRECTOR
id: T-20260619-foot-STAFF-MOONJIEUN-ROLE-DIRECTOR
status: blocked
priority: P1
domain: foot
created_at: 2026-06-19
owner: agent-fdd-dev-foot
requester: 문지은 대표원장 (소견서 발행 게이트 해소) — via planner
approved_by: planner NEW-TASK MSG-20260619-120208-lns3
build_ok: n/a (DB DML 단건 의도, FE 코드 변경 없음)
spec_added: n/a (db_only)
db_changed: false (UPDATE 미실행 — 티켓 내장 게이트 "회귀 발견 시 보류" 발동)
data_architect_consult: 불요 — role 단건 UPDATE(DML). 신규 컬럼·테이블·enum 0. (user_profiles CHECK 이미 director 허용)
blocked_reason: (1)대상테이블 전제오류 (2)publish_opinion_doc RPC prod 미배포 (3)admin→director GO_WARN 회귀 실측
followup: planner FOLLOWUP (table 정정 + 마이그 배포 + role-parity 결정 요청)
risk_level: HOLD (prod 광역 회귀 위험 — 단순치환 금지)
---

# T-20260619-foot-STAFF-MOONJIEUN-ROLE-DIRECTOR — 문지은 role admin→director (보류)

## 조사 결과 (read-only, prod DB rxlomoozakkjesdqjtvd)

### 1. 대상 테이블 전제 오류 (핵심)
티켓은 `staff.role` admin→director 정정을 지시했으나, 실측 결과 **게이트 소스 테이블이 다름**:

- `staff` 문지은 (id `b46abc6d-4a24-4776-b807-751b62f60fe3`): role = **이미 `director`** (updated_at 2026-05-25). 변경 불필요. 단, staff.role 은 듀티로스터/autoAssign 용 — 소견서 발행 게이트와 무관.
- FE 인증(`src/lib/auth.tsx:32`)은 `user_profiles` 에서 role 을 읽음. 발행 게이트 `is_doctor_role()` → `current_user_role()` = `SELECT role FROM user_profiles WHERE id=auth.uid()`.
- `user_profiles` 문지은 (id `d343769a-493a-49c9-b718-4c92c6f5db9a`, email mne@yonsei.ac.kr, clinic 74967aea, 단일행): role = **`admin`**, access_tier = `admin`.

→ 발행 게이트 해소엔 **`user_profiles.role`** 을 director 로 바꿔야 하며, 티켓이 지목한 staff 가 아님. (staff 는 이미 director라 손댈 것 없음.) user_profiles CHECK 제약은 director 허용 — DDL 불요.

### 2. publish_opinion_doc RPC prod 미배포 (별도 블로커)
FE `OpinionDocTab.tsx:347` 은 `supabase.rpc('publish_opinion_doc', ...)` 호출. 그러나 prod DB pg_proc 조회 결과 **`publish_opinion_doc` · `is_doctor_role` 함수 0개** — 마이그 `20260616160000_opinion_doc_form_stack.sql` 미적용(schema_migrations 부재).
→ role 을 director 로 바꿔도 RPC 호출이 PGRST202("function does not exist")로 실패. **42501 이전 단계에서 깨짐.** 티켓의 "게이트 deployed(T-20260618-OPINIONDOC-DLG-OVERHAUL)" 전제와 prod 실측 불일치. 소견서 발행은 role 무관하게 현재 불가.

### 3. GO_WARN 회귀 실측 — director ≠ admin superset
`user_profiles.role` admin→director 전환 시 문지은이 **잃는** admin-정확매칭 기능(director 미포함):

| 기능 | 게이트 위치 | director 손실 |
|------|------------|--------------|
| 직원 등록(register) | permissions.ts PERM_MATRIX `['admin','manager']` | ✗ 손실 |
| 고객 CSV 내보내기 | permissions.ts customer_export `['admin','manager']` | ✗ 손실 |
| 고객 삭제 | Customers.tsx:180 `role==='admin'` | ✗ 손실 |
| 패키지 관리/삭제 | Packages.tsx:45 `role==='admin'` | ✗ 손실 |
| 서비스 관리 | Services.tsx:233 `role==='admin'` | ✗ 손실 |
| 클리닉 관리 편집 | ClinicManagement.tsx:44 `role==='admin'` | ✗ 손실 |
| 설정 일부 섹션(0_connection) | AdminSettings.tsx:230 `role==='admin'` | ✗ 손실 |
| 예약상세 admin 기능 | Reservations.tsx:2019 `role==='admin'` | ✗ 손실 |

access_tier='admin' 컬럼은 위 게이트에 사용되지 않아 완화 안 됨. **대표원장 본인이 운영 권한을 광역 상실** → 단순 role 치환 금지(P2 #3 게이트 발동).

## 판단: 보류 + planner FOLLOWUP
티켓 내장 게이트("복수행/동명이인이면 보류" + "손실 있으면 단순치환 금지→FOLLOWUP") 충족. prod 무근거 UPDATE 미실행.

## 권고안 (planner 결정 요청)
- **A안(반려)**: user_profiles.role admin→director 단순치환 — 발행게이트는 통과하나 ①RPC 미배포로 여전히 실패 ②admin 8기능 회귀. 부적합.
- **B안(권고, 2-part)**:
  - B-1: 마이그 `20260616160000_opinion_doc_form_stack.sql` prod 배포(is_doctor_role + publish_opinion_doc 생성) — 별도 DB 마이그 티켓(supervisor 게이트, db_only 아님).
  - B-2: admin-정확매칭 8게이트에 `director` 추가(RLS-MENU-ROLE-PARITY = director를 경영 superset 화) → 그 후 user_profiles.role→director UPDATE. FE 멀티파일 변경 + E2E + supervisor QA 필요(db_only 아님).
- **C안(반려)**: role=admin 유지 + canPublish/is_doctor_role 에 admin 추가 — cross_crm_data_contract §C2 의료법 §17(진료의 전속) 위반(admin 設計상 발행불가). 부적합.

→ B안 권고. 단, 본 티켓 범위(db_only 단건 UPDATE)를 초과하므로 planner 재스코프 필요.
