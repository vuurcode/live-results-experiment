import { describe, expect, it } from 'vitest';
import { swipeDirection } from './swipe.util';

const at = (x: number, y: number, time: number) => ({ x, y, time });

describe('swipeDirection', () => {
  it('a quick, long, flat stroke to the left goes on, to the right goes back', () => {
    expect(swipeDirection(at(300, 400, 0), at(120, 410, 250), 390)).toBe(1);
    expect(swipeDirection(at(60, 400, 0), at(260, 390, 250), 390)).toBe(-1);
  });

  it('a short stroke is no swipe, however flat', () => {
    expect(swipeDirection(at(200, 400, 0), at(150, 400, 100), 390)).toBe(0);
  });

  it('a stroke shorter than a quarter of the screen is no swipe', () => {
    expect(swipeDirection(at(300, 400, 0), at(210, 400, 100), 600)).toBe(0);
  });

  it('a diagonal stroke, as made when scrolling, is no swipe', () => {
    expect(swipeDirection(at(300, 300, 0), at(150, 400, 200), 390)).toBe(0);
  });

  it('a slow drag is no swipe', () => {
    expect(swipeDirection(at(300, 400, 0), at(100, 400, 1200), 390)).toBe(0);
  });
});
