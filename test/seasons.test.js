import { describe, it, expect } from 'vitest';
import {
  parseTmdbSeasons, seriesProgress, progressLabel, toggleEpisode, toggleSeason, watchedUpTo, hasSeasons,
} from '../src/lib/seasons';

// Ответ TMDB /tv/{id}, урезанный до нужных полей (Severance, ноябрь 2026 — условно)
const tv = {
  status: 'Returning Series',
  last_episode_to_air: { season_number: 2, episode_number: 7 },
  seasons: [
    { season_number: 0, episode_count: 3, air_date: '2022-01-01' }, // спецвыпуски — не берём
    { season_number: 2, episode_count: 10, air_date: '2025-01-17' },
    { season_number: 1, episode_count: 9, air_date: '2022-02-18' },
    { season_number: 3, episode_count: 8, air_date: null },
    { season_number: 4, episode_count: 0, air_date: null }, // пустой анонс — не берём
  ],
};

describe('parseTmdbSeasons', () => {
  it('сезоны по порядку, без спецвыпусков, вышедшие серии по последней серии', () => {
    expect(parseTmdbSeasons(tv)).toEqual({
      seasons: [{ n: 1, eps: 9, aired: 9 }, { n: 2, eps: 10, aired: 7 }, { n: 3, eps: 8, aired: 0 }],
      tvStatus: 'ongoing',
    });
  });
  it('закончившийся сериал', () => {
    const r = parseTmdbSeasons({ status: 'Ended', last_episode_to_air: { season_number: 1, episode_number: 6 }, seasons: [{ season_number: 1, episode_count: 6 }] });
    expect(r).toEqual({ seasons: [{ n: 1, eps: 6, aired: 6 }], tvStatus: 'ended' });
  });
  it('Canceled тоже «закончился»', () => {
    expect(parseTmdbSeasons({ status: 'Canceled', seasons: [] }).tvStatus).toBe('ended');
  });
  it('без last_episode_to_air: сезон без даты выхода — ещё не вышел', () => {
    const r = parseTmdbSeasons({ seasons: [{ season_number: 1, episode_count: 5, air_date: '2020-01-01' }, { season_number: 2, episode_count: 5, air_date: null }] });
    expect(r.seasons).toEqual([{ n: 1, eps: 5, aired: 5 }, { n: 2, eps: 5, aired: 0 }]);
    expect(r.tvStatus).toBeNull();
  });
  it('пустой/битый ответ не падает', () => {
    expect(parseTmdbSeasons(null)).toEqual({ seasons: [], tvStatus: null });
    expect(parseTmdbSeasons({ seasons: [{ foo: 1 }, null] })).toEqual({ seasons: [], tvStatus: null });
  });
});

const show = (watched) => ({ kind: 'series', seasons: [{ n: 1, eps: 9, aired: 9 }, { n: 2, eps: 10, aired: 7 }, { n: 3, eps: 8, aired: 0 }], watched });

describe('прогресс сериала', () => {
  it('старая запись без сезонов — null', () => {
    expect(seriesProgress({ kind: 'series', title: 'Lost' })).toBeNull();
    expect(hasSeasons({ seasons: [] })).toBe(false);
    expect(progressLabel(null)).toBeNull();
  });
  it('ничего не смотрели — следующая S1E1, подписи нет', () => {
    const p = seriesProgress(show());
    expect(p).toMatchObject({ seen: 0, total: 16, pct: 0, last: null, next: { s: 1, e: 1 }, complete: false });
    expect(progressLabel(p)).toBeNull();
  });
  it('S2E2 — «S2E2 · 69%», дальше S2E3', () => {
    const p = seriesProgress(show({ s1: [1, 2, 3, 4, 5, 6, 7, 8, 9], s2: [1, 2] }));
    expect(p).toMatchObject({ seen: 11, total: 16, last: { s: 2, e: 2 }, next: { s: 2, e: 3 } });
    expect(progressLabel(p)).toBe('S2E2 · 69%');
  });
  it('пропуск в начале не тормозит «дальше»', () => {
    const p = seriesProgress(show({ s1: [2, 3] }));
    expect(p.next).toEqual({ s: 1, e: 4 });
  });
  it('конец сезона → первая серия следующего', () => {
    expect(seriesProgress(show({ s1: [1, 2, 3, 4, 5, 6, 7, 8, 9] })).next).toEqual({ s: 2, e: 1 });
  });
  it('всё вышедшее посмотрели — complete, следующей нет', () => {
    const p = seriesProgress(show({ s1: [1, 2, 3, 4, 5, 6, 7, 8, 9], s2: [1, 2, 3, 4, 5, 6, 7] }));
    expect(p).toMatchObject({ pct: 100, complete: true, next: null });
  });
  it('без aired считаем все серии вышедшими', () => {
    expect(seriesProgress({ seasons: [{ n: 1, eps: 4 }], watched: { s1: [1] } })).toMatchObject({ total: 4, pct: 25 });
  });
});

describe('отметки серий', () => {
  it('toggleEpisode', () => {
    expect(toggleEpisode([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleEpisode([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleEpisode(undefined, 5)).toEqual([5]);
  });
  it('toggleSeason: весь вышедший сезон, повторно — снять', () => {
    expect(toggleSeason(show(), 2)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(toggleSeason(show({ s2: [1, 2, 3, 4, 5, 6, 7] }), 2)).toEqual([]);
    expect(toggleSeason(show(), 9)).toEqual([]);
  });
  it('watchedUpTo: всё до S2E3, прошлые отметки остаются', () => {
    expect(watchedUpTo(show({ s3: [] , s2: [6] }), 2, 3)).toEqual({ s1: [1, 2, 3, 4, 5, 6, 7, 8, 9], s2: [1, 2, 3, 6], s3: [] });
  });
});
