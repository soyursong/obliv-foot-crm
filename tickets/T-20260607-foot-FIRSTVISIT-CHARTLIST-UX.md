---
id: T-20260607-foot-FIRSTVISIT-CHARTLIST-UX
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
qa_result: pass
deploy_commit: b12d743
deployed_at: 2026-06-07T22:19:00+09:00
e2e-spec: tests/e2e/T-20260607-foot-FIRSTVISIT-CHARTLIST-UX.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-07
deadline: 2026-06-14
reporter: 문지은 대표원장 (C0ATE5P6JTH / U0ALGAAAJAV)
---

# T-20260607-foot-FIRSTVISIT-CHARTLIST-UX — 상담 우측탭 초진차트 목록 UX 개선

문지은 대표원장 요청. 진료차트(MedicalChartPanel) 우측 "📋 상담" 탭(ConsultRecordTab)의
초진차트 목록 UX 개선. **FE-only, DB 무변경.**

## AC-0 (선행) — 초진 다중 노출 원인 그라운딩
코드/데이터 그라운딩으로 판정 완료.
- **코드**: ConsultRecordTab은 check_ins(visit_type별)을 그대로 렌더만 함 — 중복 초진을 만드는 경로 없음.
  `check_ins.visit_type`은 NewCheckInDialog에서 직원이 수동 선택(신규/재진). `customers.visit_type`만
  완료 시 'new'→'returning' 자동승격(visitType.ts). 즉 같은 고객을 반복 '신규' 체크인하면 'new' check_in 다발.
- **데이터(운영 DB rxlomoozakkjesdqjtvd 읽기조회)**: 818 고객 중 `new` check_in >1 = **10명**.
  대부분 테스트/더미명(초진환자1·신규·테스트123·김팔번·김이번·김구번·분홍이). 실명 후보 김민경(3, 단
  2건은 **동일 날짜 2026-06-01** 중복=소크 운영자오류), 김규리(2). + customer_id NULL 고아 check_in 5건.
- **판정**: 더미/소크 운영자오류 데이터 기인. **시스템적 실데이터 정합성 결함 아님.** UX 티켓 그대로 진행.
- **FOLLOWUP**: 소수 실데이터 동일날짜 중복 건은 planner에 통보(데이터 후속티켓 분기 판단용).

## 변경 (FE-only, DB 무변경)
ConsultRecordTab.tsx — 모두 기존 `records` 상태의 클라이언트 정렬/그룹핑. 새 fetch축·새 컬럼 없음.

1. **날짜순 정렬 양방향 토글** (`consult-sort-toggle`): 최신순(기본, 내림차순) ↔ 오래된순(오름차순).
   그룹 순서와 그룹 내부 항목 순서 모두 동일 방향 적용.
2. **날짜 그룹 접기/펼치기** (`consult-date-group` / `consult-date-group-header`): 같은 날짜(yyyy-MM-dd)
   방문을 한 그룹으로 묶음. 헤더 클릭 → 접기/펼치기(접히면 날짜 헤더+건수만 노출). 그룹별 독립 토글.
3. **초진차트 색 구분**: visit_type='new' 카드는 앰버 톤(bg-amber-50/70) + 좌측 액센트(border-l-amber-400).
   기존 ⭐초진 배지 유지 + 초진 포함 그룹은 헤더에도 ⭐ 배지. 초진 여부는 기존 visit_type 필드 기준.

## 검증
- build OK (tsc 포함, 3.60s)
- E2E 신규 `T-...FIRSTVISIT-CHARTLIST-UX.spec.ts` 13 pass (정렬 토글 4 / 그룹핑·접기 3 / 색구분 3 / 회귀 2 + 무변경 불변식)
- 회귀: `T-20260607-foot-MEDCHART-CONSULT-DRAWER.spec.ts` 14 pass
- DB 변경: **없음**
- commit b12d743 (push main)

> ⚠️ supervisor: UI 변경이므로 실 브라우저 렌더 QA 권장(데이터 충분한 고객 차트에서 우측 📋 상담 탭 →
> 정렬 토글/그룹 접기/초진 카드 색 확인). 단계별 브라우저 테스트 정책 준수.
