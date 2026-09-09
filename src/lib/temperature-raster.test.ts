import { describe, it, expect } from 'vitest';
import { paintField, imageSize, imageCorners, mercY, mercLat } from './temperature-raster';
import { tempColor } from './isotherms';
import type { TempGrid } from './temperature-grid';

const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
const px = (img: ReturnType<typeof paintField>, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('the temperature picture', () => {
  it('spaces rows in Mercator, and the inverse agrees', () => {
    expect(mercLat(mercY(45))).toBeCloseTo(45, 9);
    expect(mercY(0)).toBeCloseTo(0, 12);
    expect(mercY(60)).toBeGreaterThan(2 * mercY(30)); // the poles stretch
  });

  it('sizes the picture to the grid, within bounds, square in Mercator', () => {
    const grid: TempGrid = { cols: 12, rows: 8, bbox: [-123, 45, -122, 46], time: 't', values: new Array(96).fill(10) };
    const small = imageSize(grid);
    expect(small.width).toBe(1024);
    expect(small.height).toBeGreaterThan(1024 * 1.3); // at 45° a degree of latitude is ~1.4 degrees of longitude in Mercator
    const globe: TempGrid = { cols: 241, rows: 115, bbox: [-180, -85.5, 180, 85.5], time: 't', values: new Array(241 * 115).fill(10) };
    const big = imageSize(globe);
    expect(big.width).toBe(1440);
    expect(big.height).toBeLessThanOrEqual(2048);
  });

  it('paints each pixel the colour of its 2°C band', () => {
    // Two columns, 10°C on the west and 16°C on the east: the middle interpolates through 12 and 14.
    const grid: TempGrid = { cols: 2, rows: 2, bbox: [0, 0, 10, 10], time: 't', values: [10, 16, 10, 16] };
    const img = paintField(grid, 2, 1024);
    const y = Math.floor(img.height / 2);
    expect(px(img, 0, y)).toEqual([...rgb(tempColor(10)), 255]);
    expect(px(img, img.width - 1, y)).toEqual([...rgb(tempColor(14)), 255]); // 15.99 is still the 14 band
    expect(px(img, Math.floor(img.width / 2), y)).toEqual([...rgb(tempColor(12)), 255]);
    // The bands step where the contours would have been: a third of the way over, 12 begins.
    const first12 = Array.from({ length: img.width }, (_, x) => x).find(x => px(img, x, y)[0] === rgb(tempColor(12))[0] && px(img, x, y)[1] === rgb(tempColor(12))[1]);
    expect(first12! / img.width).toBeCloseTo(1 / 3, 1);
  });

  it('fills a missing cell from the mean and paints nothing for an empty grid', () => {
    const grid: TempGrid = { cols: 2, rows: 2, bbox: [0, 0, 10, 10], time: 't', values: [20, null, 20, 20] };
    const img = paintField(grid, 2, 1024);
    expect(px(img, 0, 0)[3]).toBe(255);
    expect(px(img, img.width - 1, 0)).toEqual([...rgb(tempColor(20)), 255]);
    const empty = paintField({ ...grid, values: [null, null, null, null] }, 2, 1024);
    expect(empty.data.every(b => b === 0)).toBe(true);
  });

  it('hands the map its corners clockwise from the north-west', () => {
    expect(imageCorners([-10, 40, 20, 60])).toEqual([[-10, 60], [20, 60], [20, 40], [-10, 40]]);
  });
});
