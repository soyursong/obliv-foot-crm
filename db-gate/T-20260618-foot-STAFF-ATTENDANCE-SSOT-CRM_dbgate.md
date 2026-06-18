# T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM — DB GATE 증거 (supervisor 이관)

> dev-foot / 2026-06-18 · db_change=true (ADDITIVE) · 대표 게이트 면제(autonomy §3.1)
> 근거: data-architect CONSULT-REPLY (MSG-20260618-173142-dajh) — Q1=S2 신설 GO / S1 재사용 NO_GO, Q2=단일 sync 통합 GO

## 1. 변경 개요
출근 SSOT 테이블 `staff_attendance` 신설(ADDITIVE). 배정화면 '출근 N명' + AUTOASSIGN-SERVERSIDE 옵션 B/C trigger 가
read 하는 단일 출근 원천. duty_roster(원장 고용 roster_type)와 의미축 분리(semantic overload 방지).

- forward: `supabase/migrations/20260618200000_staff_attendance_ssot.sql`
- rollback: `supabase/migrations/20260618200000_staff_attendance_ssot.rollback.sql`
- dry-run: `scripts/T-20260618-foot-STAFF-ATTENDANCE-SSOT_dryrun.mjs` (외부 TX ROLLBACK, 무커밋)

**범위 한정**: 본 게이트 = 테이블 신설(DDL)만. sheet→table sync EF + 배정화면 read 전환은
`T-20260618-foot-AUTOASSIGN-SERVERSIDE-REVIEW`와 sync 메커니즘 공유(직렬화 가드) → 별 게이트. 본 마이그는 소비처 0(무해 단독).

## 2. 모델 (DA 권고 반영)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| clinic_id | uuid NOT NULL FK→clinics ON DELETE CASCADE | foot 단일클리닉이나 cross-CRM parity 유지 |
| date | date NOT NULL | 출근 일자(grain) |
| staff_id | uuid NOT NULL FK→staff ON DELETE CASCADE | 시트 직원명→staff_id 결정적 매핑은 sync EF 책임 |
| source | text NOT NULL DEFAULT 'google_sheet' CHECK(google_sheet/manual/crm) | 동기 출처 |
| status | text NOT NULL DEFAULT 'present' CHECK(present/off/leave) | 출근 N명 = status=present 카운트 |
| synced_at | timestamptz NULL | freshness/stale 모니터 기준 |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |

- **UNIQUE(clinic_id, date, staff_id)** — 일/직원당 1행(중복 sync 멱등) ✅
- INDEX(clinic_id, date) — '출근 N명'/배정 후보 조회
- RLS: select=clinic active+approved 전체 / insert·update·delete=admin·manager (duty_roster 동형). sync EF는 service_role bypass.

## 3. dry-run 실측 (prod, 2026-06-18, 외부 TX ROLLBACK — 무커밋)
- **0. 충돌 가드**: `to_regclass('public.staff_attendance')` = **null** → 신설 ADDITIVE 성립(기존 테이블 무접촉).
- **0b. FK 대상**: clinics / staff / user_profiles 전부 존재 ✅
- **0c. staff 마스터 규모**: clinic `74967aea…` staff 54건(active 35) = 시트 직원명→staff_id 매핑 모집단.
- **2a. 컬럼 9개** DA 모델 일치 ✅
- **2b. 제약**: source CHECK·status CHECK·FK(clinic/staff)·PK·UNIQUE(clinic_id,date,staff_id) 전부 성립 ✅
- **2c. RLS 정책 4종**(select/insert/update/delete) 성립 ✅
- **2d. 인덱스 3종**(pkey, unique 3-key, clinic_date) 성립 ✅
- **3. 멱등**: 마이그 재실행 무해(CREATE IF NOT EXISTS / DROP POLICY 후 재생성) ✅
- **4. 원복**: ROLLBACK 후 `to_regclass` = null → **prod 무변경** ✅

## 4. 코드 변경
- **없음** (DB DDL only). FE/EF 무변경. 소비처 0(read 전환은 별 티켓).

## 5. E2E
- spec exempt: DB-only ADDITIVE 신설, 런타임 동작 변경 0, 소비처 0(UI/code 무변경). 회귀 표면 없음.

## 6. 적용 절차 (게이트 통과 후)
- supervisor DDL-diff QA 통과 → dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행', 대시보드 수동 금지).
- ADDITIVE·소비처 0 → 무중단. rollback = DROP TABLE staff_attendance(원천=구글시트, sync 재실행으로 재구성 가능 → 영구 손실 아님).

## 7. 후속 (별 게이트)
- sheet→table sync EF(cron) 단일화 — AUTOASSIGN-SERVERSIDE-REVIEW와 메커니즘 공유, planner 시퀀싱 조율.
- ★신원 매핑 결정성: 시트 직원명 정규화 → staff.id 안정 매핑 키 확보(미확보 시 stale·오매핑 회귀) — sync 설계 1급 포함.
- synced_at 신선도 모니터(stale 알람) — sync DoD 포함.
