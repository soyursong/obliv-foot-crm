---
id: T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON
domain: foot
priority: P2
status: blocked
block_reason: asset_missing — HJ한전서A/B 상용폰트 파일 로컬/디자인스택/레포 미보유. responder 경유 현장 조달 대기(비차단).
qa_result: n/a
db_change: false
db_migration: none
db_gate: N/A (정적 PNG render-time 비영속 + seal_image_url 旣존 컬럼 재세팅 — DDL 0, data-write 3행. DA CONSULT 불요)
build: n/a (asset_only, FE 코드 무변경)
scenario_count: 0
e2e_spec: exempt
e2e_spec_exempt_reason: asset_only (로직 무변경 — 폰트만 교체. 클릭 시나리오 대상 아님)
spec: exempt
bundle_hash: n/a (FE 무변경 — 도장 PNG 에셋 + seal_image_url 재세팅만)
render_script: scripts/T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON_seals.mjs
created: 2026-07-13
completed:
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260713-233353-idso)
depends_on: T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED (baseline, 별개 P0 — 본 티켓이 blocking 안 함)
slack_thread: 1783936723.351989
---

# T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON — 원장 3인 도장 폰트 한전서체 교체

## 요청
현장 김주연 총괄. 원장 3인 도장(한동훈印/김윤기印/김상은印) **폰트만** 한전서체(HJ한전서A 또는 B)로
교체 재제작 → 실직인 느낌. 대표 1차 시안 디자인 방향 이미 승인('좋은데?','간지 좔좔'). **폰트 1축만** 변경.

## 유지 (건드리지 않음)
- 진료의 선택 → 서류 자동 삽입 연동 로직 그대로
- 형태(붉은 네모 이중 테두리)·배치(세로 성함 위/印 아래)·붉은 인장 톤(#C8102E)·크기(≈88×86px)
  — 승인 시안 F0BGR7XAPDZ 기준
- 진료의↔도장 1:1 매핑, clinic_doctors.seal_image_url 컬럼·{{doctor_seal_html}} 렌더 경로

## 진행 상태 (2026-07-13, dev-foot)
1. ✅ baseline 파이프라인 분석 (UNLINKED `_seals.mjs`/`_seals_reopen.mjs`) — 폰트=`AppleMyungjo` 세리프.
2. ✅ 폰트 조달 게이트 판정: HJ한전서A/B **미보유** (fc-list·~/Library/Fonts·/Library/Fonts·레포 bundled 전수 확인, 0건).
   → 상용폰트, 다운로드 불가. 현장 조달 필요.
3. ✅ 착수 준비: 폰트-파라미터화 render 스크립트 작성·syntax 검증 완료.
   - `--a=` / `--b=` (또는 FONT_A_FILE/FONT_B_FILE)로 .ttf/.otf 경로 지정 → @font-face base64 임베드
     (시스템 설치 불요, 런타임 외부 의존 0 — 정적 PNG로 구움).
   - `gen`: A·B 후보 3종씩 시안 PNG 생성(무DB변경) → slack thread confirm 용.
   - `apply A|B`: 확정 후보로 storage 재업로드 + seal_image_url 3행 재세팅(정본 파일명).
   - `verify`: 3행 seal_image_url + signed URL 라이브 실측.
4. ⏸ **BLOCKED**: HJ한전서A/B 폰트 파일 수령 대기(responder 경유 현장 요청 발행).

## 폰트 수령 후 재개 절차 (RUNBOOK)
```
# 1) 후보 시안 (A/B 둘 다 있으면 현장이 고르게)
FONT_A_FILE=/path/HJhanjeonA.ttf FONT_B_FILE=/path/HJhanjeonB.otf \
  node scripts/T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON_seals.mjs gen
#    → src/assets/forms/stamps/doctor-seal-{name}-A.png / -B.png 3종씩
# 2) slack thread(1783936723.351989) 업로드 → 대표/현장 confirm (실직인 근접 후보 선택)
# 3) 확정 후보로 apply (예: A 확정)
FONT_A_FILE=/path/HJhanjeonA.ttf \
  node scripts/T-20260713-foot-DOCPRINT-STAMP-FONT-HANJEON_seals.mjs apply A
# 4) 라이브 렌더 실측: 서류 출력 화면에서 3인 도장이 올바른 원장에 찍히는지 확인
#    (성함 오탈자 0 + 진료의↔도장 오매핑 0 — code-inspection 단독 종결 금지, UNLINKED field-soak FAIL 교훈)
```

## 종결 기준
- 시안 confirm (대표/현장) + apply 후 **라이브 렌더 실측** (성함 정확성·매핑 정확성).
- db_change=false / e2e_spec_exempt=asset_only. supervisor QA는 라이브 실측 결과로 갈음.
