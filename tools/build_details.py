#!/usr/bin/env python3
"""Generate the frontend detail table from harvested caches."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def cafes():
    source = (ROOT / 'src/data/cafes.ts').read_text(encoding='utf-8')
    result = []
    for chunk in source.split('\n  {\n    id: ')[1:]:
        header, _, _ = chunk.partition('\n  },')
        id_match = re.match(r"'([^']+)',\n", header)
        if not id_match:
            continue
        body = header
        def get(pattern, default=None):
            found = re.search(pattern, body)
            return found.group(1) if found else default
        result.append({
            'id': id_match.group(1),
            'seats': int(get(r'seats:\s*(\d+)', '0')),
            'opens': float(get(r'opens:\s*([\d.]+)', '0')),
            'closes': float(get(r'closes:\s*([\d.]+)', '24')),
            'focus': int(get(r'axes:\s*\{\s*focus:\s*(\d+)', '0')),
            'archetype': get(r'archetype:\s*' + r"'([^']+)'", ''),
        })
    return result


def parse_hour(value):
    found = re.fullmatch(r'\s*(\d{1,2})(?::(\d{2}))?\s*', str(value))
    if not found:
        return None
    return int(found.group(1)) + int(found.group(2) or 0) / 60


def parse_hours(text):
    if not text or not isinstance(text, str):
        return None
    ranges = []
    for days, opening, closing in re.findall(
        r'(周一至周六|周一至周日|周一至周五|周六至周日|周[一二三四五六日])\s*'
        r'(\d{1,2}(?::\d{2})?)\s*[-至]\s*(\d{1,2}(?::\d{2})?)', text
    ):
        open_hour, close_hour = parse_hour(opening), parse_hour(closing)
        if open_hour is None or close_hour is None:
            continue
        if days == '周一至周六':
            day_set = range(1, 7)
        elif days == '周一至周日':
            day_set = range(0, 7)
        elif days == '周一至周五':
            day_set = range(1, 6)
        elif days == '周六至周日':
            day_set = (0, 6)
        else:
            day_set = ({'一': (1,), '二': (2,), '三': (3,), '四': (4,), '五': (5,), '六': (6,), '日': (0,)}.get(days[-1], ()))
        ranges.extend({'day': day, 'open': open_hour, 'close': close_hour} for day in day_set)
    return ranges or None


def amap_dishes(value):
    if not value:
        return []
    return [part.strip() for part in re.split(r'[,，、/；;|]', str(value)) if part.strip()]


def main():
    tags = load(ROOT / 'tools/cache/tags.json', {})
    dp_dir = ROOT / 'tools/cache/dianping'
    amap_dir = ROOT / 'tools/cache/amap-detail'
    records = []
    raw_values = {}
    for cafe in cafes():
        amap = load(amap_dir / f"{cafe['id']}.json", {}) or {}
        dp = load(dp_dir / f"{cafe['id']}.json", {}) or {}
        photos = [url for url in amap.get('photos', []) if isinstance(url, str) and url]
        if dp.get('defaultPic'):
            photos.append(dp['defaultPic'])
        dishes = []
        for dish in sorted(dp.get('dishes', []), key=lambda item: item.get('count', 0) if isinstance(item, dict) else 0, reverse=True):
            name = dish.get('name') if isinstance(dish, dict) else str(dish)
            if name and name not in dishes:
                dishes.append(name)
        for name in amap_dishes(amap.get('tag')):
            if name not in dishes:
                dishes.append(name)
        hours = parse_hours(amap.get('opentime2')) or parse_hours(amap.get('open_time'))
        scores = dp.get('scoreTextList') or []
        dp_scores = {'taste': scores[0], 'env': scores[1], 'service': scores[2]} if len(scores) >= 3 else None
        popularity = dp.get('picCountStr') or dp.get('reviewCountText')
        if popularity is not None:
            match = re.search(r'[\d.]+', str(popularity).replace('万', ''))
            if match:
                number = float(match.group()) * (10000 if '万' in str(popularity) else 1)
                raw_values[cafe['id']] = math.log1p(number)
        elif amap.get('rating') is not None:
            raw_values[cafe['id']] = float(amap['rating']) / 5
        raw = {
            'photos': photos[:4],
            'dishes': dishes[:6],
            'hours': hours,
            'tags': tags.get(cafe['id'], []),
            'tables': round(cafe['seats'] / 2.4) if cafe['seats'] > 0 else None,
            'dpScores': dp_scores,
        }
        records.append((cafe['id'], raw))
    ordered = sorted(raw_values.items(), key=lambda item: item[1])
    ranks = {key: (index / (len(ordered) - 1) if len(ordered) > 1 else 1) for index, (key, _) in enumerate(ordered)}
    out = {}
    for cafe_id, raw in records:
        if cafe_id in raw_values:
            raw['popularity'] = round(ranks[cafe_id], 3)
        raw = {key: value for key, value in raw.items() if value not in (None, [])}
        raw.setdefault('photos', [])
        raw.setdefault('dishes', [])
        raw.setdefault('tags', [])
        out[cafe_id] = raw
    lines = ["import type { Detail } from './types'", '', 'export const DETAILS: Record<string, Detail> = {']
    separators = (', ', ': ')
    for cafe_id, detail in out.items():
        encoded = json.dumps(detail, ensure_ascii=False, separators=separators)
        lines.append(f'  {json.dumps(cafe_id, ensure_ascii=False)}: {encoded},')
    lines.extend(['}', ''])
    (ROOT / 'src/data/details.ts').write_text('\n'.join(lines), encoding='utf-8')
    print(f'generated {len(out)} café details')


if __name__ == '__main__':
    main()
