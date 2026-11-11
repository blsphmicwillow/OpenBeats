import { describe, expect, it } from 'vitest';
import {
  automationValueAt,
  clampAutomationValue,
  laneFor,
  normalizeAutomation,
  projectHasAutomation,
} from './model/automation';
import { blankProject } from './model/defaults';

describe('mixer automation', () => {
  it('clamps volume and pan into their engine ranges', () => {
    expect(clampAutomationValue('volume', -1)).toBe(0);
    expect(clampAutomationValue('volume', 9)).toBe(1.25);
    expect(clampAutomationValue('pan', -4)).toBe(-1);
    expect(clampAutomationValue('pan', 4)).toBe(1);
  });

  it('sorts, deduplicates and normalizes corrupted lane data', () => {
    const lanes = normalizeAutomation([
      {
        target: 'volume',
        points: [
          { id: 'b', step: 32, value: 2 },
          { id: 'a', step: 0, value: 0.2 },
          { id: 'a2', step: 0, value: 0.3 },
        ],
      },
    ]);
    expect(lanes[0].target).toBe('volume');
    expect(lanes[0].points.map((p) => [p.step, p.value])).toEqual([
      [0, 0.3],
      [32, 1.25],
    ]);
    expect(lanes[1]).toEqual({ target: 'pan', points: [] });
  });

  it('linearly interpolates and holds the outer values', () => {
    const lane = {
      target: 'pan' as const,
      points: [
        { id: 'a', step: 0, value: -1 },
        { id: 'b', step: 16, value: 1 },
      ],
    };
    expect(automationValueAt(lane, 0, 0)).toBe(-1);
    expect(automationValueAt(lane, 8, 0)).toBe(0);
    expect(automationValueAt(lane, 99, 0)).toBe(1);
    expect(automationValueAt({ target: 'pan', points: [] }, 8, 0.25)).toBe(0.25);
  });

  it('holds a value until the next point and eases smooth segments', () => {
    const held = {
      target: 'volume' as const,
      points: [
        { id: 'a', step: 0, value: 0.2, curve: 'hold' as const },
        { id: 'b', step: 16, value: 1 },
      ],
    };
    expect(automationValueAt(held, 8, 0)).toBe(0.2);
    expect(automationValueAt(held, 16, 0)).toBe(1);

    const smooth = {
      target: 'volume' as const,
      points: [
        { id: 'a', step: 0, value: 0.2, curve: 'smooth' as const },
        { id: 'b', step: 16, value: 1 },
      ],
    };
    expect(automationValueAt(smooth, 4, 0)).toBeCloseTo(0.325, 5);
    expect(automationValueAt(smooth, 8, 0)).toBeCloseTo(0.6, 5);
    expect(automationValueAt(smooth, 12, 0)).toBeCloseTo(0.875, 5);
  });

  it('preserves segment curves when normalizing saved data', () => {
    const lanes = normalizeAutomation([
      {
        target: 'volume',
        points: [
          { id: 'a', step: 0, value: 0.2, curve: 'hold' },
          { id: 'b', step: 16, value: 1, curve: 'smooth' },
        ],
      },
    ]);
    expect(lanes[0].points[0].curve).toBe('hold');
    expect(lanes[0].points[1].curve).toBe('smooth');
  });

  it('detects whether a project has any automation points', () => {
    const project = blankProject();
    expect(projectHasAutomation(project)).toBe(false);
    project.strips[1].automation = [
      { target: 'volume', points: [{ id: 'a', step: 4, value: 0.5 }] },
      { target: 'pan', points: [] },
    ];
    expect(laneFor(project.strips[1], 'volume').points).toHaveLength(1);
    expect(projectHasAutomation(project)).toBe(true);
  });
});
