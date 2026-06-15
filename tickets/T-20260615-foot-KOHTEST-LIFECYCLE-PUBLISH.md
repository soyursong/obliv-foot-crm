---
ticket_id: T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH
status: in-progress
priority: P2
domain: foot
created_at: 2026-06-15
build_ok: true
spec_added: null
db_changed: true
rollback_sql: supabase/migrations/20260615190000_koh_lifecycle_publish.rollback.sql
data_architect_consult: CONSULT-REPLY MSG-20260615-125238-lfmy (정본 스키마 4건 ADDITIVE) + FOLLOWUP-REPLY MSG-20260615-233727-a00u (자동채번 포맷 확정)
db_gate: supabase/migrations/20260615190000_koh_lifecycle_publish.sql (supervisor DDL-diff Gate 대기)
risk_level: GO (1/5 — 전부 ADDITIVE: 컬럼 ADD + RPC + CHECK 확장 + seed, 파괴요소 0)
deploy_ready: false
---

## 요청 (NEW-TASK + CONSULT, planner/DA P2)

균검사지 라이프사이클 (KOH 신청 → 리스트업 → 발행 → 결과지·차트연동).
기존 KOHSHEET-NAILSYNC-CHARTOPEN(0768607) · koh_nail_sites(20260612160000) 무손상 그 위 확장.

## Acceptance Criteria

- **AC-1** KOH 신청 플래그 — `check_in_services.koh_requested boolean` + `set_koh_requested` RPC.
  2번차트 패키지탭 토글. ON=균검사지 목록 active / OFF=inactive(행 유지·회색).
- **AC-2** 균검사지 리스트업 — koh_requested active 행이 균검사지 명단에 노출.
- **AC-3** 검체종류(채취 조갑부위) 필수 — koh_nail_sites 미선택 시 발행 차단.
  검사결과 라인(보험코드 D6201002 / KOH mount / Hyphae·Yeast)은 양식 고정값(모든 환자 동일) → field_data 미주입, 템플릿 HTML 고정.
- **AC-4** 결과지 발행 — `publish_koh_result` RPC(자동채번 + published insert) + 인쇄(`printKohResult` + `KOH_RESULT_HTML`).
- **AC-5** 비가역 발행 — 발행(published) 후 재발행·취소·수정 차단. `form_submissions.status`에 `published` 추가.

## 스키마 (마이그 20260615190000, 전부 ADDITIVE)

1. `check_in_services.koh_requested boolean NOT NULL DEFAULT false` (AC-1)
2. `set_koh_requested(uuid, boolean)` RPC — set_koh_nail_sites 동형, 승인 사용자 한 필드 (AC-1)
3. `form_submissions.status` CHECK 에 `published` 추가 (AC-3/AC-5)
4. `koh_result` form_template seed — OPINIONCERT 패턴(html + field_map) (AC-4)
5. `publish_koh_result(uuid, jsonb)` RPC — 자동채번 + 비가역 atomic insert (AC-4/AC-5)
6. `next_koh_request_no` / `next_koh_specimen_no` 자동채번 RPC (검체번호는 default OFF·격리 보존)

연결키 = `field_data.koh_service_id` (form_submissions 신규 컬럼 신설 안 함, 스키마 무변경).

## DA 자동채번 포맷 판정 (FOLLOWUP-REPLY MSG-20260615-233727-a00u, 2026-06-15 23:37)

추정 금지 준수 — 정본 양식(검사결과 양식.png, F0BA2NJLJH5) 의뢰번호 샘플 `20260501`(=YYYYMMDD) 증거 우선.
초기 "F-#### 트리거 준용" 지침은 SUPERSEDED (F-####는 고객 chart_number 전역 단조 시퀀스로 의미체계 다름).

- **[Q1 의뢰번호] = YYYYMMDD + 3자리 per-day 일련 (GO, 임시구현 그대로 확정)**
  - 일자 base = **검체채취일/진료일** 기준 (insert 시각 아님, 자정경계 = 진료일).
    → 구현: `(cis.created_at AT TIME ZONE 'Asia/Seoul')::date`.
  - 일련 reset = **per-day** (매일 001~), zero-pad 3자리. 초과 시 lpad 자리수 자동확장(F-#### 9999 확장 동형).
  - scope = foot 단일 클리닉 DB 전역. F-#### chart_number도 clinic 미스코프 확인.
- **[Q2 검체번호] = default OFF, nullable manual-input 출고 (변경 반영 완료)**
  - 샘플 공란 = "CRM 미생성(외부 검사실 기입)" 가능성 → 자동채번 단정 불가.
  - 외부랩 부여 검체번호 ↔ CRM 자동생성 충돌 시 dual-identity 사고 차단.
  - `next_koh_specimen_no` RPC는 격리 보존하되 `publish_koh_result`에서 **미호출**(주석 처리, L262).
    `specimen_no`는 FE/수기 입력값 그대로 보존(자동 override 안 함).
  - **원내 자체수행 확정 시 ON 토글 = L262 주석 1줄 해제.** 현장확인(원내 vs 외부랩 위탁, 검체번호 부여 주체)은 DA가 responder 라우팅 → 회신 받는 대로 ON/OFF 최종 통지.
- **[Q3 dedup·동시성]**
  - dedup key = `UNIQUE(의뢰번호)` per-day prefix count. 검체번호 ON 시 동일하게 UNIQUE.
  - 동시성 race(MAX+1 동일) = `pg_advisory_xact_lock(hashtext('koh_req_no:'||clinic||':'||prefix))` 직렬화. low-load 가정.

**판정**: 의뢰번호 YYYYMMDD+3자리 per-day = **GO (확정, 추가 회신 대기 불요)**. 검체번호만 default OFF로 변경 후 AC-1~5 선구현 진행. 검체번호 자동채번 ON 여부만 DA 후속 통지로 L262 1줄 교체.

**SSOT**: 단일 CRM 아티팩트라 cross_crm_data_contract 편입 보류. derm/scalp 균배양 결과지 재발 시 lab-numbering convention codify.

## 게이트 위치

- ① 엔티티 식별 + SQL/롤백 ✅ + 자동채번 포맷 DA 확정 ✅ → ② **supervisor DDL-diff Gate 대기** → ③ DB 적용 후 활성.
- 잔여(FE 와이어링): AC-1 패키지탭 토글(set_koh_requested 호출) · AC-2 명단 노출 · AC-4 발행버튼(publish_koh_result) · AC-5 비가역 UI · E2E spec. → FE 완료 + spec 추가 후 deploy-ready 마킹.

## 진행 로그

- 2026-06-15 23:42 dev-foot: 마이그 20260615190000 작성(스키마 4건 + 채번 RPC 2종). DA FOLLOWUP-REPLY 23:37 반영 — 의뢰번호 검체채취일 base, 검체번호 OFF.
- 2026-06-16 dev-foot: DA FOLLOWUP-REPLY 판정 본문 기록(DA 권고). 마이그·인쇄 helper·HTML 템플릿 빌드그린 커밋. **status=in-progress** (FE 와이어링·spec 잔여 → deploy-ready 아님).
