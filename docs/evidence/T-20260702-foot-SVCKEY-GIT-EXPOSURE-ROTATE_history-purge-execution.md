# SVCKEY-GIT-EXPOSURE — git history purge 집행 증빙

- Ticket: `T-20260702-foot-SVCKEY-GIT-EXPOSURE-ROTATE`
- Executor: dev-foot (FIX-REQUEST `MSG-20260703-164054-i69m`, P0)
- Date: 2026-07-03
- 대상 누출: `tests/e2e/T-20260523-foot-CHARTSAVE-REGRESS.spec.ts` `SERVICE_KEY` 하드코딩 foot service_role JWT (ref `rxlomoozakkjesdqjtvd`)
- 방식: `git-filter-repo --replace-text` (literal 토큰 → `***REMOVED-LEAKED-SERVICE-KEY***` 치환). 파일은 유지, 히스토리 blob 내부의 시크릿 문자열만 소거.
- ⚠ 본 문서는 키 값/토큰 평문을 일절 포함하지 않는다.

## 안전조치 (force-push 전)
- foot mirror 백업: `~/svckey-purge-backup/foot-341422c0.git` (purge 이전 원본 전체, 미변경)
- women mirror 백업: `~/svckey-purge-backup/women-c2ee7711.git` (purge 이전 원본 전체, 미변경)
- 각 레포 로컬 `backup/pre-svckey-purge` 브랜치 생성(원격 미푸시 — 원격 오염 방지)
- 협업자 영향: 두 레포 히스토리 재작성됨 → 모든 clone/CI는 **re-clone 필수**(force-push로 non-fast-forward). 로컬 작업 브랜치는 rebase onto 재작성 히스토리 필요.

## obliv-foot-crm
- 재작성: 3,932 commits 파싱, 43개 로컬 ref 재작성
- 원격 반영: remote 19개 브랜치 전부 force-push (OK=19 FAIL=0) + tags(1) force-push
- 치환 검증(대상 파일 히스토리):
  - 대상 파일이 존재했던 히스토리 blob에서 `eyJ...` service_role JWT: **0건**
  - JWT를 담았던 2개 commit blob: 각 `***REMOVED-LEAKED-SERVICE-KEY***` marker 2건으로 치환됨
  - HEAD 대상 파일: sanitized 형태 유지(`process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''`)
- 로컬 reflog expire + `git gc --prune=now` 완료 (dangling secret blob 제거)
- purge 후 HEAD: `ba62cab7`

## obliv-women-crm
- 재작성: 3,542 commits 파싱, 전 ref 재작성
- 원격 반영: remote 3개 브랜치 전부 force-push (OK=3 FAIL=0) + tags(1) force-push
- 치환 검증(대상 파일 히스토리):
  - 대상 파일이 존재했던 히스토리 blob에서 `eyJ...` service_role JWT: **0건**
  - JWT를 담았던 2개 commit blob: 각 marker 2건으로 치환됨
  - HEAD: 대상 파일 부재(선행 `81ad7d03` git rm) — 유지
- 로컬 reflog expire + `git gc --prune=now` 완료
- purge 후 HEAD: `04cbd39e`

## 잔여/후속
- **AC1 (rotation, supervisor 단독)**: git 히스토리 purge는 노출 표면을 줄이지만, 원격 호스트(GitHub)는 unreachable 객체를 GC 전까지 SHA 직접 접근으로 잠시 보유할 수 있음. **노출된 구 service_role 키의 실질 무력화는 rotation+revoke가 유일** → AC1은 여전히 supervisor 키운영 게이트에서 집행 필요.
- GitHub 측 완전 GC가 필요하면 GitHub Support에 stale object 정리 요청 병행 권장.
