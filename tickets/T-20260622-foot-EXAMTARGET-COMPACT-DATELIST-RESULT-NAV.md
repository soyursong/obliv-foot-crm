---
ticket_id: T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV
id: T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-23
owner: agent-fdd-dev-foot
requester: 김주연 총괄 (치료 테이블 '균검사 & 피검사 대상자' 정밀화 — 스샷 F0BC7MN652M)
approved_by: planner NEW-TASK MSG-20260622-150813-wcgm
build_ok: true
spec_added: tests/e2e/T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV.spec.ts
db_changed: false
data_architect_consult: 면제 (AC-1/2/4/5 전부 기존 컬럼 read-only·FE/navigation only — 신규 컬럼/테이블/enum/RLS 0. §S2.4 미해당) / ⚠ AC-3(혈액검사 결과 저장모델 신설)은 본건 비포함 — 별도 CONSULT 대상으로 FOLLOWUP 발행
risk_level: GO_WARN (2/5 — AC-1/2/4/5 FE-only read·파괴변경 0. AC-2 검사신청일(checked_in_at) 윈도 조회만, 신청 boolean·발행본 저장모델 무변경. AC-3 discovery 결과 risk#1(혈액 결과 백엔드 부재) 재확인 — 신규 백엔드 0으로 본건 차단요소 아님)
qa_result: pass
---

# T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV

치료 테이블 → '균검사 & 피검사 대상자' 탭(TREATTABLE-ADDON-COMPACT-DATEFILTER 후속 정밀화).

## AC 처리 결과

- **AC-1 컴팩트화** — 행 패딩 px-2.5 py-1.5 → px-2 py-1, 섹션 gap 축소, 배지 py-0(leading-5). 내용 항목 삭제 0, 폰트 가독 최소(본문 13px·메타 11px) 유지. RESVCAL-COMPACT-CONTENT-KEEP 동일 원칙.
- **AC-2 일자별 리스트** — 단일 명단 → 검사신청일(check_ins.checked_in_at, KST seoulISODate) 기준 일자별 그룹핑. 부모 공통 날짜선택기의 date 를 윈도 끝으로 직전 14일을 그룹(최근 신청일 먼저, 그룹 내 가나다순). 환자×검사신청일 단위 1행.
  - **기준일자 DISCOVERY 확정**: '검사신청일' = checked_in_at. 진료콜 등재일은 자매 섹션(진료 환자 이력) 개념이며 검사신청에는 해당 timestamp 없음 → 검사신청일 채택.
- **AC-3 검사신청→검사결과(신규생성)** — ⚠ DISCOVERY 게이트(신규 백엔드 0, 본건 비포함):
  - KOH 결과: 별도 저장모델 존재(form_submissions form_key='koh_result') → 신청 boolean 비재사용. 발행본=결과 보기(KohResultDialog), 미발행=결과 생성(균검사 보고서 surface 재사용). ✓
  - 혈액검사 결과: 저장모델 **부재**. 신청 boolean(blood_test_requested) 재사용 금지(요구사항) → 별도 저장모델 신설 필요. '결과(준비중)' 비활성 유지. → data-architect CONSULT + responder 경유 1안 UX 총괄 confirm 후 별도 티켓.
- **AC-4 우클릭** — 기존 CRM 컨텍스트 메뉴 그대로(부모 nameInteraction.onContextMenu 위임, 신규 정의 0).
- **AC-5 좌클릭** — 2번차트 오픈(부모 nameInteraction.onLeftClick → useChart 재사용).

## 검증

- 빌드 OK. E2E 신규 9 PASS + 회귀(ADDON-COMPACT-DATEFILTER) 10 PASS = 19 PASS.
- 브라우저 렌더 확인(/admin/treatment-table → 균검사 탭): 일자별 그룹(6/20·6/17·6/15) + 컴팩트 행 + 결과 동작 정상. evidence/T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV_examtab.png
- NO-DDL. db_changed=false.

## 후속 (FOLLOWUP → planner)

AC-3 혈액검사 결과 저장모델 신설 — data-architect CONSULT + 1안 UX(폼/업로드/상태토글) 총괄 confirm 게이트. 별도 티켓 분리.
