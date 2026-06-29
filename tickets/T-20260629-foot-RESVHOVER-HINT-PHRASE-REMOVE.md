---
id: T-20260629-foot-RESVHOVER-HINT-PHRASE-REMOVE
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 1ca7f9b739
deployed_at: 2026-06-29T10:50:53+09:00
bundle_hash: CcseBH06
summary: "예약관리 캘린더 성함 hover 카드(CustomerHoverCard) 네이티브 title 툴팁('클릭→고객차트·우클릭/롱프레스→메뉴·호버→간단정보')이 간단정보 카드와 겹쳐 고객번호/메모를 가림 → title 속성(도움말 한 줄)만 제거. 동작(onClick=고객차트/onContextMenu=메뉴/hover=간단정보 포털) 전부 무변경. FE-only NO-DDL. 빌드 5.15s OK. 선례 T-20260620-CUSTLIST-HINT-PHRASE-REMOVE 동일 패턴."
created: 2026-06-29
assignee: dev-foot
---

# T-20260629-foot-RESVHOVER-HINT-PHRASE-REMOVE — 예약관리 hover 도움말 문구 제거

## 배경
김주연 총괄 "고객 정보 안보임" — 성함 hover 시 네이티브 title 툴팁 한 줄이
간단정보 카드(포털)와 겹쳐 고객번호/간략메모가 가려짐. P2→P1 상향, 현장 ETA 30분.

## 작업 (제거 only · 동작 절대 무변경)
- `src/components/CustomerHoverCard.tsx` 성함 span 의 `title` 속성 제거.
  - 제거 문구: `클릭 → 고객차트 열기 · 우클릭/롱프레스 → 메뉴 · 호버 → 간단정보`
    (및 비-onClick 분기 `우클릭/롱프레스 → 고객차트·예약 · 호버 → 간단정보`)
  - title 속성(네이티브 툴팁) 한 줄만 삭제. onClick/onContextMenu/hover 포털 코드 무변경.
- 공유 컴포넌트(예약관리 + 대시보드 사용) — 동일 툴팁 겹침이 양 surface 공통이라 일괄 제거(behavior-preserving).

## 회귀가드 (전부 유지)
- 클릭 → 고객차트 (onClick 핸들러 생존)
- 우클릭·롱프레스 → 메뉴 (onContextMenu 생존)
- hover → 간단정보 카드 (#차트번호/성함/전화/간략메모/예약메모 포털 생존)

## 검증
- 빌드: `npm run build:verify` → ✓ 5.15s
- e2e spec: `tests/e2e/T-20260629-foot-RESVHOVER-HINT-PHRASE-REMOVE.spec.ts`
  - S1(소스): 도움말 문구/title 속성 부재 — 직접 grep 검증 0건 통과
  - S2(소스): onClick/onContextMenu/createPortal/onMouseEnter 배선 5종 생존 통과
  - S3(DOM, best-effort): 예약관리 성함 span title 부재 + hover 간단정보 카드 표시 (auth+데이터 의존 → supervisor 풀 E2E)

## 비고
- FE-only, DDL 0, 발송 0. 데이터 정책 자문 게이트 비대상.
- 진료대시보드/진료관리 의료 컨펌 게이트(§11) 비대상 — 예약/접수 화면.
- 머지 주의: T-20260620-foot-RESVCAL-COMPACT-HALFSIZE / RESVCAL-HOURLY-GROUPING 은 Reservations.tsx(캘린더 셀) 변경 — 본 변경은 CustomerHoverCard.tsx 단일 파일이라 충돌 없음.
