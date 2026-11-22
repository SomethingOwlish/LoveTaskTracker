import { describe, it, expect } from 'vitest';
import { parseTaskList, parseLine, extractDeadline, toTaskData } from '../src/lib/taskImport.js';

// среда, 18 ноября 2026
const now = new Date(2026, 10, 18, 12, 0);
const people = [{ key: 'me', name: 'Совушка' }, { key: 'partner', name: 'Гусик' }];
const opts = { now, people };
const ymd = (d) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('parseTaskList', () => {
  it('артефакт Claude: заголовки, пункты, подпункты, чекбоксы', () => {
    const text = `Вот план на неделю:

## Переезд
- [ ] Заказать грузчиков @Гусик до 20.11
  - сравнить цены
  - [x] спросить у соседей
- [x] Купить коробки
  - этот подпункт не нужен
- [ ] **Упаковать книги** !

## Дом
1. Позвонить в управляющую завтра
2) Починить кран

Если что — пиши.`;
    const r = parseTaskList(text, opts);
    expect(r.map((t) => t.title)).toEqual(['Заказать грузчиков', 'Упаковать книги', 'Позвонить в управляющую', 'Починить кран']);
    expect(r[0]).toMatchObject({ who: 'partner', projectTags: ['Переезд'] });
    expect(ymd(r[0].deadline)).toBe('2026-11-20');
    expect(r[0].checklist.map((c) => [c.text, c.done])).toEqual([['сравнить цены', false], ['спросить у соседей', true]]);
    expect(r[1].important).toBe(true);
    expect(r[2].projectTags).toEqual(['Дом']);
    expect(ymd(r[2].deadline)).toBe('2026-11-19');
    expect(r[3].deadline).toBeNull();
  });

  it('без пунктов — каждая строка задача', () => {
    expect(parseTaskList('Купить хлеб\n\nВынести мусор\n', opts).map((t) => t.title)).toEqual(['Купить хлеб', 'Вынести мусор']);
  });

  it('код в ``` пропускаем', () => {
    const r = parseTaskList('- Один\n```js\n- не задача\n```\n- Два', opts);
    expect(r.map((t) => t.title)).toEqual(['Один', 'Два']);
  });

  it('блок lovetasks — точный формат', () => {
    const text = 'Держи:\n```lovetasks\n[{"title":"Билеты","who":"Гусик","deadline":"2026-11-25","important":true,"checklist":["туда","обратно"],"project":"Отпуск"},"Просто строка"]\n```\n- это игнорируем';
    const r = parseTaskList(text, opts);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ title: 'Билеты', who: 'partner', important: true, projectTags: ['Отпуск'] });
    expect(ymd(r[0].deadline)).toBe('2026-11-25');
    expect(r[0].checklist.map((c) => c.text)).toEqual(['туда', 'обратно']);
    expect(r[1].title).toBe('Просто строка');
  });

  it('ссылка из markdown уходит в link', () => {
    const [t] = parseTaskList('- Прочитать [статью](https://example.com/a) про сон', opts);
    expect(t.title).toBe('Прочитать статью про сон');
    expect(t.link).toBe('https://example.com/a');
  });
});

describe('parseLine', () => {
  it('@себе и падежи имени', () => {
    expect(parseLine('Помыть посуду @Совушке', opts).who).toBe('me');
    expect(parseLine('@гусику вынести мусор', opts)).toMatchObject({ who: 'partner', title: 'вынести мусор' });
    expect(parseLine('Написать @кому-то', opts).who).toBeNull();
  });
  it('«!» отдельно — важно, в конце слова — нет', () => {
    expect(parseLine('!! Оплатить квартиру', opts)).toMatchObject({ important: true, title: 'Оплатить квартиру' });
    expect(parseLine('Ура!', opts).important).toBe(false);
  });
});

describe('extractDeadline', () => {
  it('дни недели — ближайший следующий', () => {
    expect(ymd(extractDeadline('сдать отчёт к пятнице', now).deadline)).toBe('2026-11-20');
    expect(ymd(extractDeadline('в среду', now).deadline)).toBe('2026-11-25');
  });
  it('прошедшая дата без года — следующий год', () => {
    expect(ymd(extractDeadline('до 10.01', now).deadline)).toBe('2027-1-10');
    expect(ymd(extractDeadline('до 10.11', now).deadline)).toBe('2026-11-10');
  });
  it('не путает с числами и словами', () => {
    expect(extractDeadline('Купить 2.5 кг яблок', now).deadline).toBeNull();
    expect(extractDeadline('сходить в магазин', now).deadline).toBeNull();
    expect(extractDeadline('купить завтрак', now).deadline).toBeNull();
    expect(extractDeadline('сделать 31.02', now).deadline).toBeNull();
  });
});

describe('toTaskData', () => {
  it('исполнитель и срок по умолчанию', () => {
    const me = { uid: 'a' }; const partner = { uid: 'b' };
    const [t] = parseTaskList('- Задача', opts);
    const d = toTaskData(t, { me, partner, authorUid: 'a', defaults: { who: 'partner', deadline: now } });
    expect(d).toMatchObject({ assigneeUid: 'b', deadline: now, importance: 0, title: 'Задача' });
  });
});

describe('domToListText', async () => {
  const { domToListText } = await import('../src/lib/taskImport.js');
  const t = (s) => ({ nodeType: 3, nodeValue: s });
  const el = (tagName, kids = [], extra = {}) => ({ nodeType: 1, tagName, childNodes: kids, ...extra });
  it('списки, вложенность, заголовки, галочки, ссылки', () => {
    const root = el('DIV', [
      el('H2', [t('Переезд')]),
      el('UL', [
        el('LI', [el('INPUT', [], { type: 'checkbox', checked: false }), t('Грузчики '), el('A', [t('сайт')], { href: 'https://x.ru/' }),
          el('UL', [el('LI', [t('сравнить')]), el('LI', [t('позвонить')])])]),
        el('LI', [el('STRONG', [t('Коробки')])]),
      ]),
      el('P', [t('Удачи!')]),
    ]);
    const text = domToListText(root);
    expect(text).toBe('## Переезд\n- [ ] Грузчики [сайт](https://x.ru/)\n  - сравнить\n  - позвонить\n- Коробки\nУдачи!');
    const r = parseTaskList(text, opts);
    expect(r.map((x) => [x.title, x.checklist.length, x.link])).toEqual([['Грузчики сайт', 2, 'https://x.ru/'], ['Коробки', 0, null]]);
  });
});
