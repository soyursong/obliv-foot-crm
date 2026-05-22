---
id: T-20260522-foot-RESV-CAL-COLWIDTH
domain: foot
status: deploy-ready
priority: P2
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260522-foot-RESV-CAL-COLWIDTH.spec.ts
created: 2026-05-22
---

# T-20260522-foot-RESV-CAL-COLWIDTH — 예약관리 주간 캘린더 칸 너비 균등화

## 문제

주간 캘린더(`/reservations` 주간 뷰)에서 월~토 6개 칼럼의 너비가 테이블 auto 레이아웃으로 인해
내용량에 따라 불균등하게 배분됨. 예약이 많은 금요일 칼럼이 좁아지고 토요일이 화면 밖으로 밀려남.

## 원인

- `table` 기본 레이아웃(auto)이 셀 내용 기반으로 너비를 결정
- `min-w-[700px]`이 너무 작아 6칸+시간축이 최소 너비 미달
- 카드 내부 `flex` 컨테이너에 `min-w-0` 없어 셀 밖으로 overflow

## 해결 (FE-only CSS)

| 변경 | 내용 |
|------|------|
| `table-fixed` 추가 | 헤더 기준 균등 배분 강제 (auto → fixed) |
| `min-w-[700px]` → `min-w-[800px]` | 시간축80 + 6×120 = 800px 최소 보장 |
| `th` `overflow-hidden` | table-fixed 전환 시 헤더 텍스트 넘침 방지 |
| 셀 내 flex `min-w-0` | 카드·이름행·상태행이 셀 너비 이하로 수축 허용 |
| 카드 `w-full overflow-hidden` | 카드가 셀 너비에 맞게 수축, 내용 클립 |

## AC 검증

- [x] AC-1: 월~토 6칸 너비 동일(균등 배분) — `table-fixed` 적용
- [x] AC-2: 고객 이름(4글자) 잘림 없음 — `min-w-0` + `overflow-hidden` 방어
- [x] AC-3: 1920px+ / 태블릿 가로에서 토요일까지 한 화면 — `min-w-[800px]` 보장
- [x] AC-4: 카드 내 정보 가독성 유지 — flex 수축 허용으로 layout 안정화

## 커밋

- `8335159` fix(reservations): 주간 캘린더 칸 너비 균등화 T-20260522-foot-RESV-CAL-COLWIDTH
