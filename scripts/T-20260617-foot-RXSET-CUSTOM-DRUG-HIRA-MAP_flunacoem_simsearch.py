#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — §16 신규 READ-ONLY 조회
'플루나코엠캡슐(플루코나졸, LEGACY-015b55130567)' 유사명칭 심평원 등재약 전체 조회.

★ READ-ONLY — DB 쓰기 0, DML/DDL 0, 코드변경 0. 후보 목록 산출 전용(총괄 review용).
★ 소스 = §13 v3 재사용: 심평원 의약품표준코드 master (data.go.kr 15067462, CSV EUC-KR).
  신규 외부 API 무단연결 없음. 무키 공개파일.

검색 채널(넓게):
  C1 명칭 부분문자열 — '플루나', '플루나코', '플루나코엠', '푸루나' 등 코어 substring
  C2 정규화 prefix — norm/brand core 가 '플루나코'/'플루코나' 로 시작
  C3 유사도 — difflib ratio(norm(cand), '플루나코엠') >= 0.6
  C4 성분(플루코나졸) — 명칭에 '플루코나졸' 포함 OR ATC J02AC01(fluconazole)
실행: python3 <this> /tmp/hira_drugmaster.csv
"""
import sys, re, csv, json, unicodedata
from difflib import SequenceMatcher
from collections import OrderedDict

NFC = lambda s: unicodedata.normalize('NFC', s)
DOSAGE = re.compile(r'\d+(\.\d+)?\s*(밀리그램|밀리리터|마이크로그램|그램|ml|mL|mg|g|％|%|iu|IU|단위|정|캡슐|매|포|병|관|튜브|cc)')
FORM = ['외용액','점안액','점이액','크림','연고','로션','시럽','과립','캡슐','패취','패치','주사','겔','젤','좌제','분말','정','액','산','환','주']

def norm(s):
    s = NFC(s)
    while True:
        s2 = re.sub(r'\([^()]*\)', '', s)
        s2 = re.sub(r'\[[^\[\]]*\]', '', s2)
        s2 = re.sub(r'〔[^〔〕]*〕', '', s2)
        if s2 == s: break
        s = s2
    s = re.sub(r'[()\[\]〔〕]', '', s)
    s = DOSAGE.sub('', s)
    s = re.sub(r'\s+', '', s)
    return s

def brand(s):
    n = norm(s)
    for f in sorted(FORM, key=len, reverse=True):
        if n.endswith(f):
            return n[:-len(f)]
    return n

TARGET_RAW = "플루나코엠캡슐(플루코나졸)"
TARGET_NORM = norm(TARGET_RAW)      # '플루나코엠'
TARGET_CORE = TARGET_NORM

# 명칭 substring 후보 코어(넓게)
NAME_SUBSTR = ['플루나코엠','플루나코','플루나','푸루나','플루코나졸','플루코나','후루나','풀루나']
# 성분(fluconazole) 신호
FLUCON_ATC = 'J02AC01'
FLUCON_ING = ['플루코나졸','플루코나']

def main(csv_path):
    rows = []
    with open(csv_path, encoding='cp949', errors='replace') as f:
        r = csv.reader(f)
        header = next(r)
        for row in r:
            if not row or not row[0].strip():
                continue
            rows.append(row)

    def get(row, i):
        return row[i].strip() if len(row) > i else ''

    hits = OrderedDict()  # 표준코드 or name -> record
    for row in rows:
        nm = NFC(row[0])
        n = norm(nm)
        b = brand(nm)
        atc = get(row, 19)
        reasons = []

        # C1 명칭 부분문자열
        for kw in NAME_SUBSTR:
            if kw in n:
                reasons.append(f'명칭substring:{kw}')
                break
        # C2 정규화 prefix
        if n.startswith('플루나코') or b.startswith('플루나코') or n.startswith('플루코나') or b.startswith('플루코나'):
            reasons.append('prefix:플루나코/플루코나')
        # C3 유사도
        ratio = SequenceMatcher(None, n, TARGET_NORM).ratio()
        rb = SequenceMatcher(None, b, TARGET_CORE).ratio()
        best = max(ratio, rb)
        if best >= 0.6:
            reasons.append(f'유사도:{best:.2f}')
        # C4 성분(플루코나졸 / ATC)
        ing_hit = any(x in nm for x in FLUCON_ING)
        atc_hit = (atc == FLUCON_ATC)
        if ing_hit or atc_hit:
            tag = []
            if atc_hit: tag.append('ATC J02AC01')
            if ing_hit: tag.append('명칭내 플루코나졸')
            reasons.append('성분(플루코나졸):' + '+'.join(tag))

        if not reasons:
            continue

        key = get(row, 10) or nm  # 표준코드 우선
        if key in hits:
            # merge reasons
            hits[key]['reasons'] = sorted(set(hits[key]['reasons'] + reasons))
            continue
        hits[key] = {
            'name': nm,
            'maker': get(row, 1),
            'spec': get(row, 2),          # 약품규격
            'form': get(row, 4),          # 제형구분
            'etc_otc': get(row, 8),       # 전문일반구분
            'item_code': get(row, 6),     # 품목기준코드
            'rep_code': get(row, 9),      # 대표코드
            'std_code': get(row, 10),     # 표준코드
            'ing_code': get(row, 12),     # 일반명코드(성분명코드)
            'atc': atc,
            'cancel_date': get(row, 14),  # 취소일자
            'sim': round(best, 3),
            'reasons': sorted(set(reasons)),
        }

    out = list(hits.values())
    # 정렬: 성분(플루코나졸) 우선 → 유사도 desc
    def sortkey(h):
        is_flucon = any('성분' in r for r in h['reasons'])
        return (0 if is_flucon else 1, -h['sim'], h['name'])
    out.sort(key=sortkey)

    print(json.dumps({
        'target': TARGET_RAW, 'target_norm': TARGET_NORM,
        'total_master_rows': len(rows), 'hit_count': len(out),
        'hits': out,
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/hira_drugmaster.csv')
