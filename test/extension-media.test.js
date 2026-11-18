import { describe, it, expect } from 'vitest';
import { detectMedia, cleanMediaTitle, splitYear } from '../extension/src/media';
import { buildMurmurDoc } from '../src/lib/murmurUtil';

// Сигналы сняты с настоящих страниц (ноябрь 2026), JSON-LD урезан до нужных полей.
const sig = (o) => ({ url: '', canonical: '', docTitle: '', ogTitle: '', ogType: '', ogImage: '', h1: '', ld: [], ...o });

describe('detectMedia — настоящие страницы', () => {
  it('IMDb, фильм', () => {
    expect(detectMedia(sig({
      url: 'https://www.imdb.com/title/tt15239678/',
      canonical: 'https://www.imdb.com/title/tt15239678/',
      ogTitle: 'Dune: Part Two (2024) ⭐ 8.4 | Action, Adventure, Drama',
      ogType: 'video.movie',
      ld: [{ '@type': 'Movie', name: 'Dune: Part Two', datePublished: '2024-03-01', image: 'https://m.media-amazon.com/p.jpg' }],
    }))).toEqual({ kind: 'movie', title: 'Dune: Part Two', year: 2024, poster: 'https://m.media-amazon.com/p.jpg', link: 'https://www.imdb.com/title/tt15239678/', source: 'imdb.com' });
  });

  it('IMDb, сериал', () => {
    const m = detectMedia(sig({
      url: 'https://www.imdb.com/title/tt11280740/',
      ogTitle: 'Severance (TV Series 2022– ) ⭐ 8.6 | Drama, Mystery, Sci-Fi',
      ogType: 'video.tv_show',
      ld: [{ '@type': 'TVSeries', name: 'Severance', datePublished: '2022-02-18' }],
    }));
    expect(m).toMatchObject({ kind: 'series', title: 'Severance', year: 2022 });
  });

  it('Кинопоиск, фильм', () => {
    const m = detectMedia(sig({
      url: 'https://www.kinopoisk.ru/film/409424/',
      canonical: 'https://www.kinopoisk.ru/film/409424/',
      docTitle: 'Дюна фильм, 2021, дата выхода трейлеры актеры отзывы описание на Кинопоиске',
      ogTitle: '«Дюна» (Dune: Part One, 2021)',
      ogType: 'website',
      ogImage: 'https://avatars.mds.yandex.net/og.jpg',
      h1: 'Дюна (2021)',
      ld: [{ '@type': 'Movie', name: 'Дюна', datePublished: '2021', image: 'https://cdn.yandex.net/poster.jpg' }, { '@type': 'BreadcrumbList' }],
    }));
    expect(m).toMatchObject({ kind: 'movie', title: 'Дюна', year: 2021, poster: 'https://cdn.yandex.net/poster.jpg', source: 'kinopoisk.ru' });
  });

  it('Кинопоиск: тип по адресу /series/ важнее разметки', () => {
    const m = detectMedia(sig({ url: 'https://www.kinopoisk.ru/series/464963/', h1: 'Игра престолов (сериал, 2011 – 2019)' }));
    expect(m).toMatchObject({ kind: 'series', title: 'Игра престолов', year: 2011 });
  });

  it('Steam: без разметки, тип по адресу, «on Steam» отрезается', () => {
    const m = detectMedia(sig({
      url: 'https://store.steampowered.com/app/1145350/Hades_II/',
      canonical: 'https://store.steampowered.com/app/1145350/Hades_II/',
      ogTitle: 'Hades II on Steam', ogType: 'website',
      ogImage: 'https://shared.fastly.steamstatic.com/capsule.jpg',
    }));
    expect(m).toEqual({ kind: 'game', title: 'Hades II', year: null, poster: 'https://shared.fastly.steamstatic.com/capsule.jpg', link: 'https://store.steampowered.com/app/1145350/Hades_II/', source: 'store.steampowered.com' });
  });

  it('Letterboxd: только og (JSON-LD не разобрался)', () => {
    const m = detectMedia(sig({ url: 'https://letterboxd.com/film/dune-part-two/', ogTitle: 'Dune: Part Two (2024)', ogType: 'video.movie', h1: 'Letterboxd — Your life in film' }));
    expect(m).toMatchObject({ kind: 'movie', title: 'Dune: Part Two', year: 2024 });
  });

  it('TMDB, сериал', () => {
    const m = detectMedia(sig({
      url: 'https://www.themoviedb.org/tv/95396-severance', ogTitle: 'Severance', ogType: 'video.tv_show',
      ld: [{ '@type': 'TVSeries', name: 'Severance', startDate: '2022-02-17T00:00:00Z' }, { '@type': 'WebSite', name: 'The Movie Database' }],
    }));
    expect(m).toMatchObject({ kind: 'series', title: 'Severance', year: 2022 });
  });

  it('GOG: VideoGame среди нескольких типов', () => {
    const m = detectMedia(sig({
      url: 'https://www.gog.com/en/game/the_witcher_3_wild_hunt_game_of_the_year_edition',
      ogTitle: 'The Witcher 3: Wild Hunt — Remastered | GOG.com', ogType: 'game',
      ld: [{ '@type': ['Product', 'VideoGame', 'SoftwareApplication'], name: 'The Witcher 3: Wild Hunt — Remastered', releaseDate: '2016-08-29T23:00:00+02:00' }],
    }));
    expect(m).toMatchObject({ kind: 'game', title: 'The Witcher 3: Wild Hunt — Remastered', year: 2016 });
  });

  it('эпизод сериала → название сериала', () => {
    const m = detectMedia(sig({ url: 'https://example.com/ep', ld: [{ '@type': 'TVEpisode', name: 'Pilot', partOfSeries: { '@type': 'TVSeries', name: 'Lost', startDate: '2004' } }] }));
    expect(m).toMatchObject({ kind: 'series', title: 'Lost', year: 2004 });
  });
});

describe('detectMedia — что не должно распознаваться', () => {
  it('404 по адресу фильма', () => {
    expect(detectMedia(sig({ url: 'https://www.kinopoisk.ru/film/1294585/', docTitle: '404 - Страница не найдена', h1: '404. Страница не найдена' }))).toBeNull();
  });
  it('обычная статья', () => {
    expect(detectMedia(sig({ url: 'https://habr.com/ru/articles/1/', ogType: 'article', ogTitle: 'Как я писал расширение' }))).toBeNull();
  });
  it('главная Steam', () => {
    expect(detectMedia(sig({ url: 'https://store.steampowered.com/', ogTitle: 'Welcome to Steam' }))).toBeNull();
  });
});

describe('чистка названий', () => {
  it.each([
    ['Save 50% on Hades II on Steam', 'Hades II'],
    ['Сэкономьте 30% при покупке Hollow Knight в Steam', 'Hollow Knight'],
    ['Дюна (2021) — смотреть онлайн в хорошем качестве — Кинопоиск', 'Дюна (2021)'],
    ['Mission: Impossible – Dead Reckoning', 'Mission: Impossible – Dead Reckoning'],
    ['Disco Elysium | GOG.com', 'Disco Elysium'],
  ])('%s → %s', (a, b) => expect(cleanMediaTitle(a)).toBe(b));

  it('год в скобках уходит в year', () => {
    expect(splitYear('Ведьмак (сериал, 2019 – 2023)')).toEqual({ title: 'Ведьмак', year: 2019 });
    expect(splitYear('Blade Runner 2049')).toEqual({ title: 'Blade Runner 2049', year: null });
  });
});

describe('buildMurmurDoc', () => {
  const ts = { serverTimestamp: () => 'TS' };
  it('новая запись — в «Хотим», хочет добавивший', () => {
    expect(buildMurmurDoc({ kind: 'game', title: ' Hades II ', uid: 'a@x', poster: 'p.jpg', year: 2025, source: 'steam' }, ts)).toEqual({
      kind: 'game', title: 'Hades II', note: '', link: null, poster: 'p.jpg', year: 2025, source: 'steam',
      addedBy: 'a@x', wantedBy: ['a@x'], status: 'want', ratings: {}, reviews: {},
      createdAt: 'TS', doneAt: null, doneBy: null,
    });
  });
  it('найденное поиском в приложении (media) дописывается в запись', () => {
    const d = buildMurmurDoc({ kind: 'movie', title: 'Dune', uid: 'a@x', media: { poster: 'p.jpg', year: 2021, overview: 'Пески', extId: 438631 } }, ts);
    expect(d).toMatchObject({ title: 'Dune', poster: 'p.jpg', year: 2021, overview: 'Пески', extId: 438631, wantedBy: ['a@x'] });
  });
  it('пустое название — null', () => {
    expect(buildMurmurDoc({ kind: 'movie', title: '  ', uid: 'a@x' }, ts)).toBeNull();
  });
});
