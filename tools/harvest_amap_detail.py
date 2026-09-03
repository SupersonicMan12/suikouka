#!/usr/bin/env python3
"""Resumable Amap detail enrichment for every café in cafes.ts."""

from __future__ import annotations

import difflib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAFES = ROOT / 'src' / 'data' / 'cafes.ts'
CACHE = ROOT / 'tools' / 'cache' / 'amap-detail'
API = 'https://restapi.amap.com/v3/place'
DELAY = 0.36


def cafes() -> list[dict]:
    source = CAFES.read_text(encoding='utf-8')
    result = []
    for chunk in source.split('\n  {\n    id: ')[1:]:
        header, _, _ = chunk.partition('\n  },')
        id_match = re.match(r"'([^']+)',\n", header)
        if not id_match:
            continue
        body = header
        def field(pattern: str, default=None):
            found = re.search(pattern, body)
            return found.group(1) if found else default
        amap = re.search(r'amap:\s*\{\s*id:\s*\'([^\']+)\'', body, re.S)
        result.append({
            'id': id_match.group(1),
            'name': field(r"name:\s*'([^']*)'"),
            'nameZh': field(r"nameZh:\s*'([^']*)'"),
            'lat': float(field(r'lat:\s*([\d.]+)', '0')),
            'lng': float(field(r'lng:\s*([\d.]+)', '0')),
            'amapId': amap.group(1) if amap else None,
        })
    return result


def get(path: str, params: dict[str, str]) -> dict:
    query = urllib.parse.urlencode({'key': os.environ['AMAP_WEB_API_KEY'], **params})
    with urllib.request.urlopen(f'{API}/{path}?{query}', timeout=30) as response:
        return json.loads(response.read().decode('utf-8'))


def detail_record(cafe: dict, payload: dict, matched: bool = True, source_id: str | None = None) -> dict:
    pois = payload.get('pois') or []
    poi = pois[0] if pois else {}
    biz = poi.get('biz_ext') or {}
    photos = [p.get('url') for p in poi.get('photos') or [] if p.get('url')][:3]
    return {
        'cafeId': cafe['id'],
        'matched': matched,
        'amapId': source_id or cafe.get('amapId'),
        'photos': photos,
        'opentime2': biz.get('opentime2') or poi.get('opentime2'),
        'open_time': biz.get('open_time') or poi.get('open_time'),
        'rating': biz.get('rating') or poi.get('rating'),
        'cost': biz.get('cost') or poi.get('cost'),
        'tag': poi.get('tag'),
        'type': poi.get('type'),
        'address': poi.get('address'),
        'business_area': poi.get('business_area'),
        'name': poi.get('name'),
    }


def fuzzy_match(cafe: dict, poi: dict) -> bool:
    candidates = [str(poi.get('name') or '')]
    targets = [str(cafe.get('name') or ''), str(cafe.get('nameZh') or '')]
    for candidate in candidates:
        for target in targets:
            if difflib.SequenceMatcher(None, candidate.lower(), target.lower()).ratio() >= 0.6:
                return True
    return False


def main() -> None:
    if not os.environ.get('AMAP_WEB_API_KEY'):
        raise SystemExit('AMAP_WEB_API_KEY is required')
    CACHE.mkdir(parents=True, exist_ok=True)
    all_cafes = cafes()
    matched = 0
    skipped = 0
    for cafe in all_cafes:
        path = CACHE / f"{cafe['id']}.json"
        if path.exists():
            skipped += 1
            continue
        record: dict
        try:
            if cafe['amapId']:
                payload = get('detail', {'id': cafe['amapId'], 'output': 'json'})
                record = detail_record(cafe, payload)
            else:
                payload = get('around', {
                    'location': f"{cafe['lng']},{cafe['lat']}",
                    'radius': '150',
                    'types': '050500',
                    'sortrule': 'distance',
                    'offset': '20',
                    'page': '1',
                    'output': 'json',
                })
                poi = next((p for p in payload.get('pois') or [] if fuzzy_match(cafe, p)), None)
                if poi is None:
                    record = {'cafeId': cafe['id'], 'matched': False, 'photos': []}
                else:
                    detail = get('detail', {'id': poi.get('id', ''), 'output': 'json'})
                    record = detail_record(cafe, detail, True, poi.get('id'))
            path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            matched += int(record.get('matched', False))
            print(f"{cafe['id']}: {'matched' if record.get('matched') else 'not matched'}")
        except Exception as exc:  # noqa: BLE001 - one bad POI must not stop a resumable run
            print(f"{cafe['id']}: {exc}")
        time.sleep(DELAY)
    print(f'processed={len(all_cafes) - skipped} skipped={skipped} matched={matched}')


if __name__ == '__main__':
    main()
