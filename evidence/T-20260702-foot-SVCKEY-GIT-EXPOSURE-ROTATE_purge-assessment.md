# T-20260702-foot-SVCKEY-GIT-EXPOSURE-ROTATE — git 히스토리 purge 임팩트 평가 & 판단 (AC4)

> 작성: dev-foot · 2026-07-02 · **실행 아님 — 게이트 보고용 조사**
> 대상 시크릿: foot service_role JWT (ref=rxlomoozakkjesdqjtvd, role=service_role, exp=2092168219≈2036)
> 노출 위치(원): `tests/e2e/T-20260523-foot-CHARTSAVE-REGRESS.spec.ts` L22-26 하드코딩 const

## 0. 현재 상태 (HEAD)

| 레포 | HEAD 하드코딩 키 | 조치 |
|------|-----------------|------|
| obliv-foot-crm | **0건** ✅ (fc7d7132 에서 env ref+skip 교체) | dev-foot 완료·push |
| obliv-women-crm | **1건 잔존** ❌ `tests/e2e/T-20260523-foot-CHARTSAVE-REGRESS.spec.ts` (foot 하드포크 상속본) | **미조치 — 아래 §3** |

> ⚠ **AC3(두 레포 HEAD 재스캔 0건) 미충족**: women HEAD 에 동일 JWT 가 **라이브로 존재**. women 은 dev-women 도메인 → dev-foot 도메인 격리(§5)로 직접 write 불가. planner 라우팅 필요.

## 1. 히스토리 상주 범위

- **foot**: leak 도입 커밋 `fbfd0bc5`(2026-05-23 P0 hotfix) → HEAD 제거 `fc7d7132`. 그 사이 블롭 상주.
  - 누출 블롭 object id: `dfecd2e20fdb3d63786dd98f8fbc00b31a72d64e`
  - leak 이후 main 커밋 수: **2912** (rewrite 시 전부 SHA 변경)
  - 재지정 필요 refs(브랜치+태그): **43** (dev-preview/*, feat/*, T-* 작업 브랜치 다수 포함)
- **women**: 하드포크 상속 → 히스토리 블롭 히트 규모 훨씬 큼(rev 샘플 48k+). HEAD 라이브.

## 2. 임팩트 평가 (history rewrite = force-push)

| 축 | 영향 |
|----|------|
| 활성 clone | macstudio(현재), 타 개발머신 → 전부 `git reset --hard`/re-clone 강제 |
| 열린 브랜치/PR | foot 5+ 작업 브랜치·dev-preview·feat 브랜치 → 재작성 후 rebase/폐기·재생성 |
| CI | Vercel preview·GH Actions 캐시·커밋핀 무효화 |
| 협업자 로컬 | rewrite 이전 커밋 보유 시 재-push 로 leak 재유입 위험 → 전원 동기화 필요 |

## 3. 판단 (결론)

### 3-1. 1차 완화 = **키 rotation (supervisor 단독, 진행 중)** — 이것이 실질 봉쇄
service_role JWT 는 exp 2036 까지 유효 → **rotation 되면 히스토리의 옛 키는 즉시 무력화**. rotation 이후 히스토리 블롭은 "죽은 문자열"이며 노출 리스크 종결.

### 3-2. foot 히스토리 rewrite = **DEFER / SKIP 권고**
- rotation 후 블롭 무력 → 2912 커밋 재작성 + 43 refs 재지정 + force-push 는 **죽은 시크릿을 위한 고비용 파괴적 작업**.
- 권고: **rewrite 하지 않음.** 단, 컴플라이언스가 "히스토리 무-시크릿"을 요구할 경우에만:
  - 툴: `git-filter-repo` (설치 확인됨). BFG 미설치(java 는 있음).
  - dry-run 시나리오: `git filter-repo --replace-text <(echo '<LEAKED_SIG_FRAGMENT>==>REDACTED') --dry-run` 또는 블롭 `dfecd2e2` 타깃. (실 서명 조각은 문서에 미기재 — 키 값 노출 금지.)
  - 반드시: 코드 프리즈 창 + 전 협업자 re-clone + 전 refs force-push 조율 후.

### 3-3. women 레포 = **2조치 (dev-women 도메인 → planner 라우팅)**
- **(a) 긴급·HEAD**: foot 스펙은 women 에서 **dead weight**(발톱 하드포크 잔재, women 동선 무관). → **HEAD 에서 spec 파일 삭제**(plain commit, 히스토리 재작성 불요·경량). AC3 를 women 에서 충족시키는 최소 조치. **dev-foot 는 도메인 격리로 실행 불가 → dev-women 디스패치 필요.**
- **(b) history rewrite**: foot 과 동일 defer 논리(rotation 후 무력) + women 히스토리 규모 더 큼 → 비권고.

## 4. 게이트로 넘기는 결정
1. **rotation 완료 확인** (supervisor) — 실질 봉쇄 신호.
2. **women HEAD spec 삭제** — planner→dev-women 디스패치 (AC3 women 충족).
3. **양 레포 history rewrite 여부** — rotation 후에는 SKIP 권고. 컴플라이언스 요구 시에만 프리즈+re-clone 조율하 supervisor 승인 후 실행.

> **force-push/히스토리 재작성 실행은 본 임팩트평가 + 게이트 승인 이후에만.** 본 문서는 조사·판단까지.
