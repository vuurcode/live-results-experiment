import { describe, expect, it } from 'vitest';
import { swipeDirection, WheelSwipe } from './swipe.util';

const at = (x: number, y: number, time: number) => ({ x, y, time });

describe('swipeDirection', () => {
  it('a quick, long, flat stroke to the left goes on, to the right goes back', () => {
    expect(swipeDirection(at(300, 400, 0), at(120, 410, 250), 390)).toBe(1);
    expect(swipeDirection(at(60, 400, 0), at(260, 390, 250), 390)).toBe(-1);
  });

  it('a short stroke is no swipe, however flat', () => {
    expect(swipeDirection(at(200, 400, 0), at(150, 400, 160), 390)).toBe(0);
  });

  it('a stroke shorter than a quarter of the screen is no swipe', () => {
    expect(swipeDirection(at(300, 400, 0), at(210, 400, 300), 600)).toBe(0);
  });

  it('a short but fast flick is a swipe, a short and slower stroke is not', () => {
    expect(swipeDirection(at(300, 400, 0), at(240, 402, 80), 600)).toBe(1);
    expect(swipeDirection(at(240, 400, 0), at(300, 402, 80), 600)).toBe(-1);
    expect(swipeDirection(at(300, 400, 0), at(240, 402, 200), 600)).toBe(0);
  });

  it('a diagonal stroke, as made when scrolling, is no swipe', () => {
    expect(swipeDirection(at(300, 300, 0), at(150, 400, 200), 390)).toBe(0);
  });

  it('a slow drag is no swipe', () => {
    expect(swipeDirection(at(300, 400, 0), at(100, 400, 1200), 390)).toBe(0);
  });
});

describe('WheelSwipe', () => {
  it('steps once for a stroke, however long the inertia lasts', () => {
    const wheel = new WheelSwipe();
    const steps = [0, 16, 32, 48, 64, 80, 96, 112].map((t) => wheel.feed(20, 1, t));
    expect(steps.filter((s) => s !== 0)).toEqual([1]);
  });

  it('steps back for a stroke the other way, and again after a pause', () => {
    const wheel = new WheelSwipe();
    expect([0, 16, 32, 48].map((t) => wheel.feed(-30, 0, t)).filter((s) => s !== 0)).toEqual([-1]);
    expect(wheel.feed(40, 0, 1000)).toBe(0);
    expect(wheel.feed(40, 0, 1016)).toBe(1);
  });

  it('leaves a vertical stroke to the scrolling', () => {
    const wheel = new WheelSwipe();
    expect([0, 16, 32, 48].map((t) => wheel.feed(20, 40, t))).toEqual([0, 0, 0, 0]);
    expect(WheelSwipe.horizontal(20, 40)).toBe(false);
  });
});
