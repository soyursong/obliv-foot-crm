#!/usr/bin/env bash
# phi-scan.sh — §4 pre-commit PHI content 스캐너 (phi_redaction_standard v2.3 §4·§4.3·§5.4)
#   실명(연락처-인접)/phone(E.164 parity)/RRN(내·외국인) 평문을 staged diff content 에서 BLOCK.
#   claude-sync guard(§4.2) / dev-crm rule#4 parity 이식. T-20260716-foot-PHI-SCANNER-PARITY-ROOTFIX.
#
# 설계 (§4·§4.2):
#   - 내용 기반(파일명 무관) → migration 디렉터리 충돌 0. 정규 migration이라도 평문 PHI = BLOCK(올바른 동작).
#   - 스캔 표면: migration/주석/evidence/tickets/소스 등 텍스트 표면 전반 (§4.3 emitter 규약 백스톱).
#   - phone/RRN = 구조적·결정적 → 즉시 BLOCK. good-set allowlist(scripts/phi-allowlist.txt) 밖 전량 차단
#     (§4.2.1 fail-closed toward privacy: 환자번호 열거 아닌 정당 KEEP 값만 permit).
#   - 실명 = regex 단독 불가(§5.4 축C roster 반전은 별트랙). 여기서는 phone/RRN 인접 실명형 토큰만 enrich-flag.
#   - .gitignore 는 위생, 본 스캐너가 실효 게이트(§3 rule#1 / §4).
#   - CI(server-side) 보강은 별트랙(§4 한계 주). 본 훅은 로컬 pre-commit.
#
# 사용:
#   scripts/phi-scan.sh            # 스테이징 변경분 (pre-commit)
#   scripts/phi-scan.sh --all      # 전체 git-tracked 파일 (감사)
# 호환: macOS 기본 bash 3.2 + perl 5(코어). ubuntu CI 동일.
set -euo pipefail

MODE="${1:-staged}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
ALLOWLIST="$REPO_ROOT/scripts/phi-allowlist.txt"

red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

EXT=( '*.sql' '*.json' '*.csv' '*.md' '*.mjs' '*.js' '*.ts' '*.tsx' '*.sh' '*.txt' '*.yml' '*.yaml' )

if [ "$MODE" = "--all" ]; then
  FILES=$(git ls-files -- "${EXT[@]}")
else
  FILES=$(git diff --cached --name-only --diff-filter=ACM -- "${EXT[@]}")
fi
[ -z "$FILES" ] && { grn "[phi-scan] 스캔 대상 없음"; exit 0; }

# perl 디텍터: STDIN=파일내용, argv=(파일명, allowlist경로). 위반 라인 출력(값은 마스킹).
detect() {
  local fname="$1" allow="$2"
  perl -CSD -Mstrict -Mwarnings -e '
    my ($fname, $allow) = @ARGV;
    # ── good-set allowlist (permit 정규식) 로드 ──
    my @permit;
    if (open(my $ah, "<", $allow)) {
      while (my $l = <$ah>) { chomp $l; $l =~ s/^\s+|\s+$//g;
        next if $l eq "" || $l =~ /^#/; push @permit, $l; }
      close $ah;
    }
    our $allow_re = @permit ? "(?:" . join("|", @permit) . ")" : "(?!x)x";

    # ── 패턴 (§5.4 detection contract) ──
    # 국내 모바일 010/011/016/018/019
    my $ph_dom  = qr/(?<![0-9])0(?:10|1[1689])[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])/;
    # E.164 KR (+82, 0 탈락)
    my $ph_e164 = qr/(?<![0-9])\+?82[-. ]?1(?:0|[1689])[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])/;
    # RRN 하이픈 (내국인 1-4 / 외국인 5-8)
    my $rrn_h   = qr/(?<![0-9])([0-9]{2})([0-9]{2})([0-9]{2})-[1-8][0-9]{6}(?![0-9])/;
    # RRN 무하이픈 (13자리) — YYMMDD 유효성 가드로 FP 억제
    my $rrn_nh  = qr/(?<![0-9])([0-9]{2})([0-9]{2})([0-9]{2})[1-8][0-9]{6}(?![0-9])/;
    my $name_tok= qr/[가-힣]{2,4}/;

    sub valid_date { my ($mm,$dd)=@_; return ($mm>=1 && $mm<=12 && $dd>=1 && $dd<=31); }
    sub permitted  { my ($s)=@_; our $allow_re; return $s =~ /^$allow_re$/; }
    sub mask_ph    { my ($s)=@_; (my $d=$s) =~ s/[^0-9+]//g; my $h=substr($d,0,3); return "$h***-****-**** (phone)"; }

    my $n = 0;
    while (my $line = <STDIN>) {
      $n++; chomp $line;
      my %hit;   # 라인당 중복 억제
      my $line_has_contact = 0;

      # RRN 하이픈
      while ($line =~ /$rrn_h/g) {
        if (valid_date($2+0,$3+0)) { $hit{"[PHI:RRN] $1$2$3-******* (주민번호)"} = 1; $line_has_contact=1; }
      }
      # RRN 무하이픈
      while ($line =~ /$rrn_nh/g) {
        if (valid_date($2+0,$3+0)) { $hit{"[PHI:RRN] $1$2$3******* (주민번호 무하이픈)"} = 1; $line_has_contact=1; }
      }
      # phone 국내
      while ($line =~ /($ph_dom)/g) {
        my $m=$1; next if permitted($m); $hit{"[PHI:PHONE] ".mask_ph($m)}=1; $line_has_contact=1;
      }
      # phone E.164
      while ($line =~ /($ph_e164)/g) {
        my $m=$1; next if permitted($m); $hit{"[PHI:PHONE] ".mask_ph($m)}=1; $line_has_contact=1;
      }
      # 실명(연락처 인접) — phone/RRN 이 같은 라인에 있고 한글 실명형 토큰 존재 시 enrich
      if ($line_has_contact && $line =~ /$name_tok/) {
        $hit{"[PHI:NAME?] 연락처-인접 한글 실명형 토큰 (§4.3 실명+연락처 병존 RC)"}=1;
      }

      for my $h (sort keys %hit) { print "  L$n: $h\n"; }
    }
  ' "$fname" "$allow"
}

FAIL=0
REPORT=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  case "$f" in
    node_modules/*|dist/*|*.lock|package-lock.json|*/i18n/*|*/locale/*|*/locales/*) continue;;
    scripts/phi-scan.sh|scripts/phi-allowlist.txt) continue;;   # 스캐너 자신(예시/permit 포함)
  esac
  if [ "$MODE" = "--all" ]; then
    content=$(cat "$f" 2>/dev/null || true)
  else
    content=$(git show ":$f" 2>/dev/null || true)
  fi
  [ -z "$content" ] && continue
  out=$(printf '%s\n' "$content" | detect "$f" "$ALLOWLIST" || true)
  if [ -n "$out" ]; then
    FAIL=1
    REPORT="${REPORT}\n${f}:\n${out}\n"
  fi
done <<EOF
$FILES
EOF

if [ "$FAIL" -eq 1 ]; then
  red "[phi-scan] ✗ 평문 PHI(실명/phone/RRN) 감지 — commit 차단 (phi_redaction_standard §4·§4.3):"
  printf '%b\n' "$REPORT" >&2
  red "→ 환자 참조는 UUID-PK-only(§4.3): 실명·phone·RRN 대신 reservation_id/customer_id/checkin_id 로만 기록."
  red "→ 합성/센티넬 값 오탐이면 scripts/phi-allowlist.txt 에 permit 추가(리뷰 게이트, 실환자값 금지)."
  red "→ 부득이한 우회는 supervisor 승인 후 'git commit --no-verify' (지양)."
  exit 1
fi
grn "[phi-scan] 통과 — 평문 PHI 없음"
exit 0
