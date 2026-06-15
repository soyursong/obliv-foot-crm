# T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — AC-1 감사 리포트 (READ-ONLY)

- 작성: dev-foot / 2026-06-15
- 대상 DB: prod `rxlomoozakkjesdqjtvd` (obliv-foot-crm) — **read-only 쿼리만, 쓰기 0건**
- 방법: 로컬 forward 마이그 298개 파일에서 핵심 DB 객체(함수/테이블/뷰/enum/컬럼)를 추출 →
  prod 객체 존재로 ground-truth 대조. (schema_migrations 기록은 118건뿐 = 다수 `apply_*.mjs` 수동적용으로 불완전 → 객체 존재가 진실원천)
- 원천 데이터: `scripts/audit_out/parity_audit_ac1.json`, 재현 스크립트: `scripts/T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT_ac1.mjs`

## 요약 집계

| verdict | 건수 | 의미 |
|---------|------|------|
| APPLIED | 196 | 선언 객체가 prod 에 모두 존재 |
| MISSING | 7 | 선언 객체가 prod 에 전무 (미적용 의심) |
| DRIFT | 3 | 일부만 존재 (부분 적용/구버전 잔존) |
| UNKNOWN | 92 | probe 대상 객체 미추출(RLS/GRANT/seed/data-only) — 별도 위험 낮음 |

> **DWELLSWAP(20260602230000_check_in_slot_dwell_fn) 은 이미 복구됨** — 재probe 시 `fn_check_in_slot_dwell` EXISTS 확인.

## MISSING 7건 — 위험도 재분류 (영향 화면·증상)

| # | 마이그 | 누락 객체 | FE참조 | FE graceful | 증상/영향 | 위험 |
|---|--------|-----------|:---:|:---:|-----------|:---:|
| 1 | `20260530000010_staff_user_id_backfill_for_notices` | `_backup_staff_user_id_20260530` (롤백용 백업테이블) | - | - | **스키마 갭 아님 — 데이터 백필**. 백업테이블은 정상 정리됨. prod staff(active) 33명 중 18 매핑. 미매핑 계정 공지는 created_by=null(FE graceful). | **INFO** |
| 2 | `20260606140000_chart_diagnoses` | table `chart_diagnoses` | **0** | N/A | 진료차트 다중상병 테이블. **FE 소비자 미배포(참조 0)** → live 영향 없음. | LOW |
| 3 | `20260607190000_pay_recon_port` | redpay 3테이블 + payments 4컬럼(external_trxid 등) | **0** | N/A | 결제대사(Redpay) 백엔드 스키마. FE 의존 0, recon EF 미가동. | LOW |
| 4 | `20260608130000_pkg_session_treatment_window` | column `treatment_started_at/ended_at` | - | - | **파일 헤더 "STATUS: DRAFT — 미적용" 명시. 의도적 미적용 → 정상.** | 제외 |
| 5 | `20260611210000_rx_audit_log` | table `rx_audit_log` | 1 | **Y** (fire-and-forget) | 처방변경 감사로그(대표원장 요청). 미적용 → 감사 silent 미수집. 진료 차단 없음. **헤더에 "supervisor db-gate 경유 필수" 명시**. | LOW-MED |
| 6 | `20260612120000_scheduled_messages` | table `scheduled_messages` + fn `dispatch_scheduled_messages` | 3 | **Y** (존재 probe→옵션 비활성) | SMS 예약발송. 미적용 → '예약' 옵션 비활성(즉시발송만 가능). hard 에러 없음. **+pg_cron 의존 + 헤더 "supervisor db-gate 경유" 명시**. | LOW-MED |
| 7 | `20260614130000_reservation_is_healer_intent` | column `reservations.is_healer_intent` | 4 | **Y** (42703/PGRST204 제외 재시도) | 영속 힐러분류 SSOT. 미적용 → healer_flag(1회성) fallback 으로 분류 degradation. FE 내성 확보(T-20260615 RESVPOPUP-3BUG AC2). DA스펙 정렬 완료. | **MED** |

## DRIFT 3건

| # | 마이그 | 부재 객체 | 존재 객체 | FE참조 | FE graceful | 증상/영향 | 위험 |
|---|--------|-----------|-----------|:---:|:---:|-----------|:---:|
| A | `20260520000010_insurance_claims_schema` | `insurance_claims`, `claim_items`, `edi_submissions` | `claim_diagnoses`(別마이그 20260515000010로 적용) | 3 | **N (직접 upsert)** | **보험 본인부담 산출저장 — PaymentDialog 에 live 렌더.** 저장 시 `insurance_claims` upsert → `42P01 relation does not exist` → 화면에 "청구 생성 실패…" 노출. 직전 service_charges 는 먼저 insert 되어 **부분저장** 발생. | **MED-HIGH** |
| B | `20260606160000_diagnosis_folder_and_favorites` | table `doctor_diagnosis_favorites` | `diagnosis_folder` 컬럼 | 2 | **Y** (빈집합 graceful) | 원장별 상병 즐겨찾기. 미적용 → 빈 목록. hard 에러 없음. | LOW |
| C | `20260611220000_room_assignments_staff_write_scoped` | fn `can_assign_rooms()` + 신규 RLS | `save_room_assignments`(**구버전 잔존** — is_admin_or_manager 가드) | 0(RLS내부) | N/A | 방배정 권한확대(운영 8 role) 미적용. prod 는 구가드(admin/manager만) 유지 → 비관리자 staff 방배정 시 권한거부 가능. **보안 완화 아님(더 제한적)**, 기능 drift. | MED |

## 위험 패턴 메모
- MISSING #5/#6 은 **"supervisor db-gate 경유 필수"가 마이그 헤더에 명시**된 건 — dev-foot 직접적용 금지 대상. FE는 deploy-tolerant fallback 을 미리 깔고 배포됨(건강한 패턴). parity 갭은 일부 "프로세스 산물"(FE 선배포 + supervisor 게이트 대기).
- 진짜 사용자-영향 버그는 **DRIFT #A (insurance_claims)** — FE 가 graceful 처리 없이 직접 upsert 하는 유일 케이스. DWELLSWAP 과 동형(마이그 미적용 + FE 호출 → live 에러).

## AC-2/AC-3 진행 제안 (planner 판단 대기)

### AC-2 후보 (additive·회귀0·롤백SQL 보유 — 모두 .down/.rollback 확인됨)
- **#A insurance_claims_schema** — 신규 빈 테이블 3개 생성, 기존 테이블/데이터 무영향. live 에러 해소. *(RLS 포함 feature 스키마 — 적용 전후 ANON 경로 포함 ground-truth 검증)*
- **#7 is_healer_intent (column add 부분)** — additive 컬럼. FE 이미 기대. *(단, 동봉 backfill UPDATE 는 데이터변경 → AC-3 경계, 분리 적용 권고)*
- #5 rx_audit_log / #2 chart_diagnoses / #B doctor_diagnosis_favorites — 신규 테이블 additive (urgency 낮음, FE graceful/미연동)
- **#C can_assign_rooms()** — read-only SECURITY 함수(DWELLSWAP 동형) but RLS 정책 교체 동반 → 권한 회귀 검증 필수

### AC-3 (즉시 적용 금지 → planner 보고 + DA CONSULT + 대표 게이트)
- #6 scheduled_messages — 테이블 + **pg_cron 디스패처 의존** + supervisor db-gate 명시
- #3 pay_recon_port — 결제 도메인 + payments 컬럼 변경 → DA/대표 게이트
- #5 rx_audit_log·#6 scheduled_messages — **둘 다 헤더 "supervisor 경유" → supervisor 라우팅**
- #7 backfill UPDATE 부분(reservations 데이터 변경)

## AC-4 (게이트 강화 제안 — 채택은 supervisor/data-architect 소관)
1. **배포-마이그 순서 강제**: FE가 신규 객체 참조하는 PR 은 "해당 마이그 prod 적용 확인"을 deploy-precheck 항목으로 차단(현재 FE 선배포 + 마이그 후행이 parity 갭 양산).
2. **객체-존재 parity 체크 정례화**: 본 AC-1 스크립트를 일일/주간 CI 로 돌려 MISSING/DRIFT 0 강제 (schema_migrations 신뢰 금지 — 객체 존재로 판정).
3. **graceful-fallback 필수화**: 신규 DB 객체 참조 FE 는 미적용 환경 graceful 의무 (insurance_claims 처럼 직접 upsert 금지). lint/리뷰 게이트.
4. **supervisor-gate 마이그 추적표**: 헤더에 "supervisor 경유" 명시된 마이그의 미적용 잔존을 supervisor 보드에서 명시 추적(현재 FE만 선배포되고 적용이 누락 방치됨).
