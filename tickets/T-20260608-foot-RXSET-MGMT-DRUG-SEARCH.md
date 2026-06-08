---
id: T-20260608-foot-RXSET-MGMT-DRUG-SEARCH
title: "[처방세트관리] 약 검색 미작동 → 드롭다운 검색 + 마스터 연결"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 5dbde89
created: 2026-06-08
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260608-194628-5ohl
needs_field_confirm: true
related_tickets:
  - T-20260608-foot-RXSET-CONTRA-DRUG-LOAD
  - T-20260607-foot-CONTRAINDICATION-MGMT
risk_verdict: pending-supervisor
---

# T-20260608-foot-RXSET-MGMT-DRUG-SEARCH — 처방세트관리 약 검색(드롭다운)

## 배경

현장(문지은 대표원장) 신고: "처방세트관리에서 약이 검색 자체가 안 되는 듯. 드롭다운으로 검색 열리면 좋겠다."

★ RXSET-CONTRA-DRUG-LOAD가 발견한 '처방세트에 약 0건'의 **상류 근본 원인**.
세트관리(`PrescriptionSetsTab`)의 약품명 필드가 순수 자유텍스트 `Input`이라
약품 마스터(`prescription_codes`)를 검색·연결할 수단이 전혀 없었음
→ `prescription_code_id`가 항상 null로 저장 → 하류(금기증 로드 등)가 빈손.

## STEP1 그라운딩 (무DB 우선)

| 가설 | 판정 | 근거 |
|------|------|------|
| FE 검색UI 미연결 | **근인 ✅** | 약품명 필드 = 자유텍스트 Input, 마스터 검색 수단 없음 |
| 쿼리 단절 | 아님 | `prescription_codes`는 MedicalChartPanel에서 동일 쿼리로 정상 동작 |
| 데이터/RLS | 아님 | 마스터 테이블 데이터·접근 정상(차트 검색 정상) |

→ **순수 FE 변경**. DB 스키마 변경 불필요(db-change=false).

## AC

- **AC1** ✅ 처방세트관리 약품명 필드가 드롭다운 검색(약품명·보험코드 ilike) — `searchRxMaster`(전체 마스터 직접 검색).
  - ⚠️ `prescribableDrugs.searchPrescribableDrugs`는 출처를 '처방세트 등록 약'으로 제한 → 세트관리에서 쓰면 0건 순환이므로 사용 안 함.
- **AC2** ✅ 검색 결과 선택 → name·route(classification 파생)·classification·`prescription_code_id` 자동채움. 수기변경 시 마스터 연결 해제.
- **AC3** ✅ 저장 세트가 `prescription_code_id` 보유 상태로 영속(`items` JSONB) → CONTRA-DRUG-LOAD 실데이터 경로 충족. "연결됨" 배지로 확인 가능.
- **AC4** ✅ 빈 결과 명확한 빈 상태("검색 결과가 없습니다." + 수기 등록 안내).

## 구현

- `src/components/admin/PrescriptionSetsTab.tsx`
  - `searchRxMaster()` 추가 — `prescription_codes` 전체 카탈로그 ilike 검색(MedicalChartPanel 패턴 재사용, custom 우선).
  - `ItemRow` 약품명 필드 → 검색 인풋 + 디바운스 250ms 드롭다운 + 빈 상태.
  - `handleSelectDrug()` — 선택 시 code_id/route/classification 자동채움.
  - `handleItemChange()` — name 수기변경 시 code 연결 해제(잘못된 code_id 잔존 방지).
  - "연결됨" 배지(마스터 연결 시각 표식).
- `tests/e2e/T-20260608-foot-RXSET-MGMT-DRUG-SEARCH.spec.ts` — 10 정적 단언(데이터/로그인 비의존), 전 통과.

## 현장 확인 필요 (needs_field_confirm)

현장 멘트 "이 말하는거 맞나?" → responder가 "처방세트관리 화면에서 약 추가 시 드롭다운 검색" 해석 확정 회신 병행.
