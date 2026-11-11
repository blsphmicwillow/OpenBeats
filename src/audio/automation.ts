import type { Graph } from './engine';
import type { AutomationPoint, AutomationTarget, Project } from '../model/types';
import { automationValueAt, fallbackFor, laneFor } from '../model/automation';

export interface MixerAutomationSchedule {
  fromStep: number;
  startAtSec: number;
  stepSec: number;
}

function volumeCurve(value: number): number {
  return Math.pow(Math.max(0, value), 1.5);
}

function scale(target: AutomationTarget, value: number): number {
  return target === 'volume' ? volumeCurve(value) : value;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Schedules one segment. A hold segment changes at the destination point;
 * a smooth segment is approximated with short Web Audio ramps because
 * `AudioParam` has no native cubic curve primitive.
 */
function scheduleSegment(
  param: AudioParam,
  target: AutomationTarget,
  left: AutomationPoint,
  right: AutomationPoint,
  schedule: MixerAutomationSchedule,
): void {
  const span = right.step - left.step;
  if (span <= 0) return;
  const fromRatio = Math.max(0, (schedule.fromStep - left.step) / span);
  if (fromRatio >= 1) return;
  const whenEnd = schedule.startAtSec + (right.step - schedule.fromStep) * schedule.stepSec;
  const curve = left.curve ?? 'linear';

  if (curve === 'hold') {
    param.setValueAtTime(scale(target, right.value), whenEnd);
    return;
  }

  if (curve === 'linear') {
    param.linearRampToValueAtTime(scale(target, right.value), whenEnd);
    return;
  }

  const samples = 24;
  for (let i = 1; i <= samples; i += 1) {
    const ratio = fromRatio + (1 - fromRatio) * (i / samples);
    const value = left.value + (right.value - left.value) * smoothstep(ratio);
    const when =
      schedule.startAtSec + (left.step + span * ratio - schedule.fromStep) * schedule.stepSec;
    param.linearRampToValueAtTime(scale(target, value), Math.max(schedule.startAtSec, when));
  }
}

/**
 * ENGINE: Web Audio only.
 *
 * Schedules the strip fader and panner parameters on a Web Audio graph. The
 * native CPAL transport cannot accept these ramps, so callers must keep the
 * transport on Web Audio while automation lanes contain points.
 */
export function scheduleMixerAutomation(
  graph: Graph,
  project: Project,
  schedule: MixerAutomationSchedule,
): void {
  for (const strip of project.strips) {
    const node = graph.strips.get(strip.id);
    if (!node) continue;
    for (const target of ['volume', 'pan'] as const) {
      const lane = laneFor(strip, target);
      if (!lane.points.length) continue;
      const param = target === 'volume' ? node.fader.gain : node.panner.pan;
      const fallback = fallbackFor(strip, target);
      const startValue = automationValueAt(lane, schedule.fromStep, fallback);
      try {
        param.cancelScheduledValues(schedule.startAtSec);
        param.setValueAtTime(scale(target, startValue), schedule.startAtSec);
        for (let index = 0; index < lane.points.length; index += 1) {
          const point = lane.points[index];
          if (point.step <= schedule.fromStep) continue;
          const left = index > 0 ? lane.points[index - 1] : null;
          if (!left) {
            const when = schedule.startAtSec + (point.step - schedule.fromStep) * schedule.stepSec;
            param.setValueAtTime(scale(target, point.value), when);
            continue;
          }
          scheduleSegment(param, target, left, point, schedule);
        }
      } catch {
        // A parameter that refuses scheduling must not stop the transport.
      }
    }
  }
}
