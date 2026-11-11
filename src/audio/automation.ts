import type { Graph } from './engine';
import type { Project } from '../model/types';
import { automationValueAt, fallbackFor, laneFor } from '../model/automation';

export interface MixerAutomationSchedule {
  fromStep: number;
  startAtSec: number;
  stepSec: number;
}

function volumeCurve(value: number): number {
  return Math.pow(Math.max(0, value), 1.5);
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
        param.setValueAtTime(
          target === 'volume' ? volumeCurve(startValue) : startValue,
          schedule.startAtSec,
        );
        for (const point of lane.points) {
          if (point.step <= schedule.fromStep) continue;
          const when = schedule.startAtSec + (point.step - schedule.fromStep) * schedule.stepSec;
          param.linearRampToValueAtTime(
            target === 'volume' ? volumeCurve(point.value) : point.value,
            when,
          );
        }
      } catch {
        // A parameter that refuses scheduling must not stop the transport.
      }
    }
  }
}
