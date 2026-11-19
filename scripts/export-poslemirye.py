"""Выгрузка видов «Послемирья» для игры.

Источник — набор species.json из заготовки systemsetup:
  python3 scripts/export-poslemirye.py <путь>/systemsetup/src/content/seeds/poslemirye/data
Пишет src/game/species.json (статы ★1–★6, семейство, регион, группа навыка) и src/game/giants.json: только то, что нужно автобаттлеру (статы ★1–★3,
формы, приёмы, картинки, стихия, класс, редкость, слабость).
"""
import json, sys, os

src = sys.argv[1]
species = json.load(open(os.path.join(src, 'species.json')))['entries']
out = []
for e in species:
    v = e['values']
    forms = [f['value'] for f in v.get('forms', [])][:3]
    imgs = [f['value'] for f in v.get('images', [])][:3]
    moves = [m['value'] for m in v.get('combat', [])][:3]
    while len(imgs) < 3:
        imgs.append(imgs[-1] if imgs else v.get('portrait', ''))
    out.append({
        'id': e['key'], 'name': e['name'], 'form': v.get('form', ''),
        'el': v['element'], 'cls': v['class'], 'rar': v['rarity'],
        'weak': v.get('weaknessElement') or None,
        'pow': v.get('power', 5), 'acc': v.get('accuracy', 4),
        's': [[v[f'{k}{i}'] for k in ('atk', 'def', 'hp', 'spd')] for i in range(1, 7)],
        'fam': v.get('animalType', 'other'), 'reg': v.get('region', ''), 'skill': v.get('skillGroup', 'damage'),
        'forms': forms, 'moves': moves, 'img': imgs,
        'home': v.get('habitat', ''),
    })
dst = os.path.join(os.path.dirname(__file__), '..', 'src', 'game', 'species.json')
json.dump(out, open(dst, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'видов →', os.path.normpath(dst))

# Гиганты — боссы недельных ранов.
giants = json.load(open(os.path.join(src, 'giants.json')))['entries']
gout = []
for e in giants:
    v = e['values']
    kids = v.get('childrenRefs') or []
    if isinstance(kids, str):
        kids = json.loads(kids.replace("'", '"'))
    gout.append({
        'id': e['key'], 'name': e['name'], 'kind': v.get('subtitle', '').replace('гигант, ', ''),
        'el': v['element'], 'epithet': v.get('epithet', ''), 'where': v.get('where', ''),
        'aura': v.get('auraName', ''), 'kids': kids, 'img': v.get('portrait') or '',
        'wrath': v.get('wrathFull', ''),
    })
gdst = os.path.join(os.path.dirname(__file__), '..', 'src', 'game', 'giants.json')
json.dump(gout, open(gdst, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(gout), 'гигантов →', os.path.normpath(gdst))
