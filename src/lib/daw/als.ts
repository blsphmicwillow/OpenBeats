/**
 * Ableton Live Set (.als) import.
 *
 * Since Live 8.2 an .als is a gzip-compressed XML document. We read the tempo,
 * MIDI tracks, clips and note events. Devices, automation and audio clips are
 * intentionally ignored — there is no safe way to translate Live's device
 * graph into OpenBeats instruments.
 */
import { clamp, type ExchangeNote, type ExchangeSong, type ExchangeTrack } from './types';

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .als files');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function attrNumber(el: Element | null, name: string): number | null {
  if (!el) return null;
  const raw = el.getAttribute(name) ?? el.getAttribute('Value');
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function valueOf(scope: ParentNode, selector: string): string | null {
  const el = scope.querySelector(selector);
  return el?.getAttribute('Value') ?? null;
}

function trackName(track: Element, index: number): string {
  const effective = valueOf(track, 'Name > EffectiveName');
  const plain = valueOf(track, 'Name');
  const name = (effective || plain || '').trim();
  return name || `Live Track ${index + 1}`;
}

export async function parseAls(input: ArrayBuffer | Uint8Array): Promise<ExchangeSong> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let xml: string;
  try {
    xml = await gunzip(bytes);
  } catch {
    throw new Error('That file is not a gzip-compressed Ableton Live Set');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'Ableton') {
    throw new Error('The Ableton XML inside this file could not be parsed');
  }

  const manual = doc.querySelector('MasterTrack Tempo Manual') ?? doc.querySelector('Tempo Manual');
  const bpm = clamp(Math.round((attrNumber(manual, 'Value') ?? 120) * 10) / 10, 20, 300);

  const tracks: ExchangeTrack[] = [];
  const warnings: string[] = [];
  let skippedAudio = 0;

  const midiTracks = Array.from(doc.querySelectorAll('Tracks MidiTrack'));
  midiTracks.forEach((track, index) => {
    const notes: ExchangeNote[] = [];
    const clips = Array.from(track.querySelectorAll('MidiClip'));
    for (const clip of clips) {
      const clipStartBeats = attrNumber(clip, 'Time') ?? attrNumber(clip, 'CurrentStart') ?? 0;
      const keyTracks = Array.from(clip.querySelectorAll('KeyTrack'));
      for (const keyTrack of keyTracks) {
        const pitch =
          attrNumber(keyTrack.querySelector('MidiKey'), 'Value') ??
          attrNumber(keyTrack.querySelector('MidiKey'), 'Note') ??
          null;
        const events = Array.from(keyTrack.querySelectorAll('MidiNoteEvent'));
        for (const event of events) {
          const eventPitch = pitch ?? attrNumber(event, 'NoteId') ?? null;
          if (eventPitch === null) continue;
          const time = attrNumber(event, 'Time') ?? 0;
          const duration = attrNumber(event, 'Duration') ?? 0.25;
          let velocity = attrNumber(event, 'Velocity') ?? 100;
          if (velocity <= 1) velocity *= 127;
          notes.push({
            pitch: clamp(Math.round(eventPitch), 0, 127),
            start: (clipStartBeats + time) * 4,
            len: Math.max(1 / 16, duration * 4),
            vel: clamp(velocity / 127, 0.05, 1),
          });
        }
      }
    }
    if (notes.length) {
      notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
      tracks.push({ name: trackName(track, index), notes });
    }
  });

  skippedAudio = doc.querySelectorAll('Tracks AudioTrack').length;
  if (skippedAudio) warnings.push(`${skippedAudio} audio track${skippedAudio === 1 ? '' : 's'} skipped (devices and audio do not translate)`);

  if (!tracks.length) throw new Error('No MIDI notes were found in this Live Set');
  return { name: 'Imported Live Set', bpm, tracks, source: 'als', notes: warnings };
}
