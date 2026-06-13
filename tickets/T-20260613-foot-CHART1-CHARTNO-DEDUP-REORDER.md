---
ticket_id: T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-13
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CHART1-CHARTNO-DEDUP-REORDER.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (2/5)
commit_sha: c8c3ac4   # §D(AC-5/AC-6) 추가 반영. A~C=c9dd3c4
---

## 요청

원천: NEW-TASK MSG-20260613-231633-xy3r (planner, P2).
1번차트(CheckInDetailSheet) 구성 변경 3건 + 치료부위 조건부 연동.

대상: src/components/CheckInDetailSheet.tsx 단일. UI-only, DB 무변경.

## 수행 (4 AC)

- **AC-1/2 차트번호 중복 제거** — 이름 하단 단독 차트번호 div 제거, 이름 옆
  차트번호(`data-testid="chartno-inline"`)만 유지 → 화면당 1회 노출.
- **AC-3 섹션 순서 재정렬** — 치료부위(조건부) → 금일동선 → 패키지 → 예약메모 →
  고객메모 → 기타메모 → 진료이미지 → 결제 → 서류발행.
  (경과분석지·KOH균검사는 선행 T-20260522-foot-CHART1-TRIM에서 비노출 처리됨 →
  현 코드엔 미렌더, 순서 체인에서 자연 제외. 결제>서류발행 = 기존
  CHART1-PAYMENT-ORDER 유지, 회귀 아님.)
  방문경로/예약메모/고객메모/기타메모 블록을 패키지 섹션 아래로 이동.
- **AC-4 치료부위 조건부 연동** — 2번차트에서 생성된 경우(`treatment_memo.foot_sites`
  존재)에만 1번차트에 read-only 표시(`data-testid="chart1-toe-readonly"`,
  `FootToeIllustration readOnly`). 단방향 read 바인딩 — 1번차트는 표시만, 편집 UI 없음.
  위치는 맨 위 유지(순서 이동 없음). foot_sites 없으면 미렌더(현행 유지).

구현은 선행 commit c9dd3c4(item4 치료부위 일러스트 + dedup/reorder 동시 반영)에
포함. 본 deploy-ready는 spec 추가·라이브 검증·아티팩트 확정.

## 검증

- `npm run build` (tsc 포함) 통과.
- E2E spec 4 시나리오 — 라이브 시딩(service key) 전부 GREEN (5 passed):
  - S-1: 차트번호 — 이름 옆 배지 1개 + 발번값 포함, 하단 단독 div 0개 (AC-1/AC-2).
  - S-2: 섹션 순서 — (치료부위 조건부) < 금일동선 < 예약메모 < 고객메모 < 기타메모 < 결제 (AC-3).
  - S-3: 회귀 없음 — Sheet 정상 오픈, JS 에러 0, 차트번호 배지 유지.
  - S-4: 치료부위 — 2번차트 생성분(foot_sites)만 read-only 표시 + 금일동선보다 위(맨 위 유지) + 편집 컨트롤 0 (AC-4).
  - 음성 케이스(foot_sites 부재 → 미렌더)는 S-2 공용 핸들이 검증.

spec 핵심 보정: 칸반 카드 클릭이 1번차트(440px)+2번차트(wide·lazy)를 동시에 열어
role=dialog first()가 2번차트(로딩 중)를 잡던 문제 → chartno-inline 보유 dialog로
1번차트 정확 스코프 + 콘텐츠 풀-렌더 대기로 결정성 확보.

db_change 없음. UI-only·기존 testid/데이터 불변 → GO(2/5).

## §D 추가 (FIX-REQUEST MSG-20260613-233229-2hau, 김주연 총괄 보강)

⚠ surface 분리: §D 코드 위치는 1번차트(CheckInDetailSheet) **아님** →
`src/pages/Reservations.tsx`(주간 캘린더 슬롯/명단 카드). CheckInDetailSheet 무접촉.
(commit c8c3ac4)

### 현상
예약 카드에 차트번호 배지가 2곳 렌더 — ① CustomerHoverCard 트리거 인라인,
② Reservations.tsx 별도 배지(resvChartMap). hover 전엔 ①이 `#미발번`
(resvAsCheckIn이 chart_number 미전달) → hover 시 fetch로 차트번호 덮어쓰기 →
활성 카드에서 차트번호 2개 동시 표기.

### AC-5 (표기 분기) — 완료
- `resvAsCheckIn`이 `resvChartMap`(=customers.chart_number SSOT)을
  `customers.chart_number`로 미리 주입 → hover 전/후 배지 안정(미발번이면 null
  유지 → `#미발번` 그대로, 변경/깜빡임 0).
- 활성 카드의 별도 배지(②) 제거, **취소건**(plain span 분기·hovercard 미사용)에만
  PAIRING-AUDIT(환자명 단독노출 0) 유지용으로 잔존 → 카드당 차트번호 표기 1회.
- 결과: 차트번호 있음 → 1개만(미발번 숨김) / 없음 → `#미발번`만 / hover 중복 0.
- E2E §D 2 spec 추가(hover 전/후 카드당 배지 ≤1, 동시 표기 0).

### AC-6 (미발번 발생 원인 조사) — dev 진단 완료, 발번로직 무변경
- **차트번호 발번 시점 = 고객 등록(customers BEFORE INSERT 트리거,
  `assign_foot_customer_chart_number`), 예약 생성 아님.** customers.chart_number는
  NOT NULL + UNIQUE(partial) 제약 + 기존행 백필 완료
  (migration 20260505000000_chart_number_auto.sql).
- 앱 정상 경로(Customers.tsx insert)는 chart_number 미지정 → 트리거 자동 채번.
  빈 문자열('')로 쓰는 코드 경로 없음.
- ∴ 현장이 본 `#미발번`은 대부분 **hover 트리거의 UI 아티팩트**(resvAsCheckIn이
  chart_number를 안 실어 hover 전 기본값 `#미발번` → hover 시 진짜 번호로 변경)였고,
  **발번 누락(진짜 버그)이 아님** → 본 §D AC-5 수정으로 해소.
- 진짜 미발번이 남을 수 있는 잔여 경우: (a) 고객 미연결 예약(customer_id null →
  애초에 배지 미렌더, #미발번도 안 뜸), (b) orphan customer_id(고객행 삭제) 또는
  (c) 마이그 이전 레거시 import의 ''/NULL chart_number 잔존 — 모두 발번 로직 결함이
  아니라 데이터 정합성 edge.
- **결론: 발번 로직 정상 → 별도 수정 티켓 불요.** 배포 후에도 특정 카드 #미발번이
  지속 보고되면 data audit(`customers WHERE chart_number IS NULL OR chart_number=''`)
  +해당 customer_id orphan 점검을 별도 P2로 권고(코드 아닌 데이터 점검). DB 무변경(조사 단계).
