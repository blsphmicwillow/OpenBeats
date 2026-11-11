import type {
  AutomationCurve,
  AutomationLane,
  AutomationPoint,
  AutomationTarget,
  Project,
  Strip,
} from './types';

export const AUTOMATION_TARGETS: AutomationTarget[] = ['volume', 'pan'];
export type AutomationPresetId = 'fade-in' | 'tremolo' | 'ducking';

/** Safe ranges for the two supported strip targets. */
export function automationRange(target: AutomationTarget): { min: number; max: number } {
  return target === 'pan' ? { min: -1, max: 1 } : { min: 0, max: 1.25 };
}

export function clampAutomationValue(target: AutomationTarget, value: number): number {
  const { min, max } = automationRange(target);
  if (!Number.isFinite(value)) return target === 'pan' ? 0 : 0.8;
  return Math.max(min, Math.min(max, value));
}

/** Sorts, clamps and de-duplicates points by step. */
export function normalizeAutomationPoints(
  target: AutomationTarget,
  raw: unknown,
): AutomationPoint[] {
  if (!Array.isArray(raw)) return [];
  const byStep = new Map<number, AutomationPoint>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const point = entry as Partial<AutomationPoint>;
    if (typeof point.step !== 'number' || !Number.isFinite(point.step)) continue;
    const step = Math.max(0, Math.round(point.step));
    const curve: AutomationCurve =
      point.curve === 'hold' || point.curve === 'smooth' ? point.curve : 'linear';
    byStep.set(step, {
      id: typeof point.id === 'string' && point.id ? point.id : `ap_${step}`,
      step,
      value: clampAutomationValue(target, Number(point.value)),
      curve,
    });
  }
  return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
}

/** Always returns one lane per supported target, including empty lanes. */
export function normalizeAutomation(raw: unknown): AutomationLane[] {
  const lanes = Array.isArray(raw) ? raw : [];
  return AUTOMATION_TARGETS.map((target) => {
    const lane = lanes.find(
      (entry) => entry && typeof entry === 'object' && (entry as AutomationLane).target === target,
    ) as Partial<AutomationLane> | undefined;
    return { target, points: normalizeAutomationPoints(target, lane?.points) };
  });
}

export function laneFor(strip: Strip, target: AutomationTarget): AutomationLane {
  return (strip.automation ?? []).find((lane) => lane.target === target) ?? { target, points: [] };
}

export function fallbackFor(strip: Strip, target: AutomationTarget): number {
  return target === 'pan' ? strip.pan : strip.gain;
}

/**
 * Linear automation value at an arrangement step. Before the first point the
 * first value is held, and after the last point the last value is held.
 */
export function automationValueAt(
  lane: AutomationLane,
  step: number,
  fallback: number,
): number {
  const points = lane.points;
  if (!points.length) return fallback;
  if (step <= points[0].step) return points[0].value;
  const last = points[points.length - 1];
  if (step >= last.step) return last.value;
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i];
    if (step > right.step) continue;
    const left = points[i - 1];
    const span = right.step - left.step;
    if (span <= 0) return right.value;
    const t = Math.min(1, Math.max(0, (step - left.step) / span));
    if (t >= 1) return right.value;
    if (left.curve === 'hold') return left.value;
    const eased = left.curve === 'smooth' ? t * t * (3 - 2 * t) : t;
    return left.value + (right.value - left.value) * eased;
  }
  return last.value;
}

export interface AutomationPresetOptions {
  /** Length of the generated lane in 16th steps. */
  length: number;
  /** Steps in one bar, used to keep fade-in tempo-synced to bars. */
  barSteps: number;
}

/**
 * Builds grid-aligned, tempo-synced automation. The points are in 16th steps,
 * so changing the project BPM moves the audio but keeps the musical timing of
 * the fades, tremolo cycles and ducking pulses intact.
 */
export function buildAutomationPreset(
  target: AutomationTarget,
  preset: AutomationPresetId,
  opts: AutomationPresetOptions,
): AutomationPoint[] {
  const length = Math.max(1, Math.round(opts.length));
  const barSteps = Math.max(1, Math.round(opts.barSteps));
  const points: AutomationPoint[] = [];
  const add = (step: number, value: number, curve: AutomationCurve) => {
    const safeStep = Math.max(0, Math.min(length, Math.round(step)));
    if (points.some((point) => point.step === safeStep)) return;
    points.push({
      id: `ap_${preset}_${safeStep}`,
      step: safeStep,
      value: clampAutomationValue(target, value),
      curve,
    });
  };

  if (preset === 'fade-in') {
    // Pan fade-in would be arbitrary; the mixer disables it for pan lanes.
    if (target === 'pan') return [];
    const end = Math.min(length, barSteps * 4);
    add(0, 0, 'smooth');
    add(end, 1, 'linear');
    return points;
  }

  if (preset === 'tremolo') {
    const high = target === 'pan' ? 0.8 : 1;
    const low = target === 'pan' ? -0.8 : 0.2;
    for (let step = 0; step <= length; step += 2) {
      add(step, step % 4 === 0 ? high : low, 'smooth');
    }
    if (points[points.length - 1]?.step !== length) {
      add(length, points[points.length - 1]?.value ?? high, 'linear');
    }
    return points;
  }

  // Ducking is a volume gesture; a pan version would not have a defined target.
  if (target === 'pan') return [];
  for (let beat = 0; beat <= length; beat += 4) {
    add(beat, 1, 'smooth');
    add(beat + 1, 0.3, 'smooth');
    add(beat + 3, 1, 'smooth');
  }
  add(length, 1, 'linear');
  return points;
}

export function laneHasPoints(strip: Strip, target: AutomationTarget): boolean {
  return laneFor(strip, target).points.length > 0;
}

export function projectHasAutomation(project: Project): boolean {
  return project.strips.some((strip) =>
    (strip.automation ?? []).some((lane) => lane.points.length > 0),
  );
}
