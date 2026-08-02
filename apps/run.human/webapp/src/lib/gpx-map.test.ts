import { describe, expect, it } from 'vitest';

import { GPX_MAP_URL, gpxMapUrl } from './gpx-map';

describe('gpxMapUrl', () => {
  it('targets the terminal /studio/app map path, never a redirecting parent', () => {
    expect(GPX_MAP_URL).toMatch(/\/studio\/app$/);
  });

  it('always forces the official routes layer on', () => {
    expect(gpxMapUrl()).toBe(`${GPX_MAP_URL}?layers=routes`);
  });

  it('puts the query first and the camera hash last', () => {
    const url = gpxMapUrl({ lat: 36.135189, lon: -115.158541 });
    expect(url).toBe(`${GPX_MAP_URL}?layers=routes#16/36.135189/-115.158541`);
    expect(url.indexOf('?')).toBeLessThan(url.indexOf('#'));
  });

  it('honours an explicit zoom', () => {
    expect(gpxMapUrl({ lat: 1, lon: 2, zoom: 12 })).toBe(
      `${GPX_MAP_URL}?layers=routes#12/1/2`
    );
  });
});
