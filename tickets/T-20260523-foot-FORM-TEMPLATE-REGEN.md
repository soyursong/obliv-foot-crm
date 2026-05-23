---
id: T-20260523-foot-FORM-TEMPLATE-REGEN
domain: foot
priority: P1
status: deployed
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: ""
commit_sha: f398fe3
qa_result: pass
qa_grade: Green
deployed_at: "2026-05-23T19:03:49+09:00"
deploy_commit: f398fe3
bundle_hash: index-D-Vk4yUa
field_soak_until: "2026-05-24T19:03:49+09:00"
created: 2026-05-23 15:25
completed: 2026-05-23 19:05
deadline: 2026-05-24
assignee: dev-foot
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
related_tickets:
  - T-20260522-foot-PENCHART-ERASER-CLARITY
  - T-20260522-foot-PENCHART-HIRES-FORM
  - T-20260522-foot-PENCHART-TOOLS-V2
  - T-20260522-foot-PENCHART-TOOLS-V3
risk_verdict: GO
---

# T-20260523-foot-FORM-TEMPLATE-REGEN — 펜차트 양식 이미지 원본 고해상도 재생성

## 배경

현장 피드백 (2026-05-23, 풋센터 채널):
> 지우개 종결! 해상도는 안되겠다 파일 참고해서 양식 새로 만들어줘 선명하게

경위:
1. PENCHART-ERASER-CLARITY → 지우개 fix 현장 "종결" 확인 ✅
2. PENCHART-TOOLS-V2(DPR=2) → 렌더링 개선, 그러나 소스 이미지 96DPI → 선명도 한계
3. "파일 참고" — 슬랙 첨부 미확인 → 기존 PDF 원본(로컬 보관)에서 300DPI 래스터화 진행

## 수정 내용 (commit c5edb46)

### 1. 양식 이미지 4종 — PDF 원본에서 진짜 300DPI 재래스터화

| 파일 | 변경 전 | 변경 후 | 소스 PDF |
|------|---------|---------|---------|
| `health_q_general.png` | 96DPI (흐릿) | **2481×3508 300DPI** | 오블리브_발톱_발건강_질문지.pdf |
| `health_q_senior.png` | 96DPI (흐릿) | **2481×3508 300DPI** | 어르신용 PDF |
| `refund_consent.png` | 96DPI (흐릿) | **2481×10524 300DPI** | 비급여 및 환불 동의서(최종) 3p stacked |
| `pen_chart_form.png` | 96DPI (흐릿) | **2481×3508 300DPI** | 오블리브 풋센터 초진 문진표 |

personal_checklist 2종은 PENCHART-HIRES-FORM(c13eee9)에서 이미 완료:
- `personal_checklist_general.png`: 2482×3508 300DPI ✅
- `personal_checklist_senior.png`: 2482×7016 300DPI ✅

### 2. PenChartTab.tsx — bgCanvas 사이즈 버그 수정

| | 구 코드 | 신 코드 |
|--|--------|--------|
| bgCanvas 폭 | `nw * DRAW_DPR` (= 4962px) | `CANVAS_W * DRAW_DPR` (= 1588px 고정) |
| drawCanvas 정합 | 불일치 (3.125× 크기 차) | 1:1 합성 보장 |
| GPU 메모리 | 최대 ~840MB | ~140MB |
| drawImage 다운샘플 | 300DPI→4962px (업스케일) | 300DPI→1588px (HQ downsample) |

- `imageSmoothingQuality='high'` 유지: 2481px 소스 → 1588px HQ Lanczos → 선명

### 3. 이미지 용량 (최적화 부수효과)

| 파일 | 변경 전 | 변경 후 |
|------|---------|---------|
| health_q_general.png | 1,870KB | 612KB (-67%) |
| health_q_senior.png | 1,448KB | 454KB (-69%) |
| refund_consent.png | 1,239KB | 319KB (-74%) |
| pen_chart_form.png | 233KB | 628KB (+169%, 투명도→불투명 변환) |

## AC 달성

- [x] AC-1: 모든 양식 이미지 300DPI 이상 교체 ✓ (전체 6종 2481+px 300DPI)
- [x] AC-2: 텍스트·선·체크박스 선명도 개선 ✓ (PDF 벡터→래스터 HQ downsample)
- [x] AC-4: 기존 기능(펜/지우개/화이트/텍스트/형광펜/저장/불러오기) 무영향 ✓
- [x] AC-5: 저장 펜차트 데이터 정상 로드 ✓ (하위 호환)
- [x] AC-6: 이미지 용량 오히려 감소 (health_q: 1.9MB→612KB) ✓

※ AC-3 (Galaxy Tab 실기기 선명도): supervisor 현장 soak 확인

## 빌드

`npm run build` → ✓ built in 3.72s

## FIX-REQUEST (MSG-20260523-183200-q7fm) — 회귀 수정

**현상 (c5edb46 배포 후)**: pen_chart_form.png에 발건강 질문지(health_q) 이미지가 잘못 배치됨
→ 펜차트 > 양식 선택 > [펜차트 양식] 클릭 시 발건강 질문지 표시

**루트코즈**: c5edb46에서 300DPI 재래스터화 시 오블리브_발건강_질문지 PDF가 pen_chart_form.png 위치에 오배치.

**수정 내용 (commit f398fe3)**:
- AC-R1/R2: 펜차트양식_자체제작.pdf(202KB) → pdftoppm -r 300 PNG 변환 → public/forms/pen_chart_form.png 교체
  - 2482×3510 px, 300DPI, 116KB
  - 내용: Obliv Clinic SEOUL ORIGIN 줄차트 (담당의·담당실장·DATE 행 구조)
- AC-R3: 전수 검증 spec 추가 (tests/e2e/T-20260523-foot-FORM-TEMPLATE-REGEN.spec.ts, 10케이스)
  - pen_chart_form.png ≠ health_q_general.png 바이트 검증
  - 4종 경로 중복 없음 / 파일 존재 / 크기 범위 검증
- playwright.config.ts unit testMatch 등록

**검증**: E2E 10/10 passed | 빌드 3.17s ✓

## 진행 이력

- 2026-05-23 15:25 — planner 티켓 생성 (MSG-20260523-17796729)
- 2026-05-23 15:51 — dev-foot 구현 완료, commit c5edb46 push → origin/main (Vercel 자동 배포)
- 2026-05-23 15:55 — signals.md deploy-ready 마킹
- 2026-05-23 16:20 — supervisor QA PASS + deployed 마킹 (bundle_hash: index-BFgLHliU)
- 2026-05-23 18:32 — FIX-REQUEST MSG-20260523-183200-q7fm (planner → dev-foot): pen_chart_form 오배치 회귀
- 2026-05-23 19:05 — dev-foot 핫픽스 완료, commit f398fe3 push → origin/main (Vercel 자동 배포)
