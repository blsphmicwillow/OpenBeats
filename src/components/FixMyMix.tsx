import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { analyzeBuffer, type MixReport } from '../lib/analysis';
import { renderSongToBuffer } from '../audio/export';
import type { Effect } from '../model/types';

const BAND_LABELS: Record<string, string> = {
  sub: 'Sub 20–60',
  bass: 'Bass 60–140',
  lowmid: 'Low-mid',
  mid: 'Mid',
  highmid: 'High-mid',
  high: 'High',
  air: 'Air',
};

/**
 * Fix My Mix: renders the master, measures it, and offers reversible
 * corrections. “A/B” flips between the original master chain and the fix.
 */
export function FixMyMix() {
  const open = useApp((s) => s.ui.fixMixOpen);
  const project = useApp((s) => s.project);
  const [report, setReport] = useState<MixReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [applied, setApplied] = useState(false);
  const [side, setSide] = useState<'fixed' | 'original'>('fixed');
  const [error, setError] = useState<string | null>(null);
  const original = useRef<Effect[] | null>(null);
  const fixed = useRef<Effect[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    setError(null);
    setApplied(false);
    setSide('fixed');
    original.current = null;
    fixed.current = null;
    (async () => {
      try {
        const buffer = await renderSongToBuffer(useApp.getState().project, { tailSeconds: 0.4 });
        if (!alive) return;
        setReport(analyzeBuffer(buffer));
      } catch (err) {
        console.error(err);
        if (alive) setError('The master could not be rendered in this window.');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const close = () => useApp.getState().setUI({ fixMixOpen: false });
  const master = project.strips.find((s) => s.id === 0);

  const apply = () => {
    if (!report) return;
    const s = useApp.getState();
    original.current = structuredClone(master?.effects ?? []);
    const params = Object.fromEntries(report.eq.map((g, i) => [`g${i}`, g]));
    s.addEffectWithParams(0, 'eq10', params);
    if (report.findings.some((f) => f.id === 'clip')) {
      s.addEffectWithParams(0, 'limiter', { threshold: -1, release: 0.2 });
    }
    if (report.findings.some((f) => f.id === 'squash')) {
      s.addEffectWithParams(0, 'comp', { threshold: -18, ratio: 2.5, makeup: 1, attack: 0.1, release: 0.3 });
    }
    const updated = useApp.getState().project.strips.find((x) => x.id === 0);
    fixed.current = structuredClone(updated?.effects ?? []);
    setApplied(true);
    setSide('fixed');
    s.toast('Corrections applied to the Master');
  };

  const flip = () => {
    if (!original.current || !fixed.current) return;
    const target = side === 'fixed' ? original.current : fixed.current;
    useApp.getState().patchProject(
      (p) => {
        const strip = p.strips.find((x) => x.id === 0);
        if (strip) strip.effects = structuredClone(target);
      },
      { history: false },
    );
    setSide(side === 'fixed' ? 'original' : 'fixed');
  };

  return (
    <Modal
      title="Fix My Mix"
      subtitle="Local analysis of the rendered master — nothing leaves this machine"
      onClose={close}
      footer={
        <>
          <span className="tiny-note">Corrections are ordinary native effects; undo removes them.</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={flip} disabled={!applied}>
            A/B: {side === 'fixed' ? 'fixed' : 'original'}
          </button>
          <button className="btn primary" onClick={apply} disabled={!report}>
            Apply corrections
          </button>
        </>
      }
    >
      {busy && <div className="mix-loading">Rendering and analysing the master…</div>}
      {error && <div className="mix-error">{error}</div>}
      {report && !busy && (
        <div className="mix">
          <div className="mix-metrics">
            <div>
              <span>Peak</span>
              <b>{report.peakDb.toFixed(1)} dB</b>
            </div>
            <div>
              <span>Loudness</span>
              <b>{report.loudness.toFixed(1)} LUFS</b>
            </div>
            <div>
              <span>Crest</span>
              <b>{report.crest.toFixed(1)} dB</b>
            </div>
            <div>
              <span>Stereo</span>
              <b>{report.stereo.toFixed(2)}</b>
            </div>
          </div>

          <div className="mix-bands">
            {Object.entries(report.bands).map(([key, value]) => (
              <div className="mix-band" key={key}>
                <span>{BAND_LABELS[key] ?? key}</span>
                <div className="mix-band-bar">
                  <i style={{ width: `${Math.max(3, Math.min(100, ((value + 30) / 30) * 100))}%` }} />
                </div>
                <em>{value.toFixed(1)}</em>
              </div>
            ))}
          </div>

          <div className="mix-suggestion">
            <b>Suggested master curve</b>
            <span>{report.suggestion}</span>
          </div>

          <div className="mix-findings">
            {report.findings.map((f) => (
              <div className={`mix-finding ${f.severity}`} key={f.id}>
                <span className="mf-dot" />
                <div>
                  <b>{f.title}</b>
                  <p>{f.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {applied && (
            <div className="mix-applied">
              Corrections are live on the Master strip. Use <b>A/B</b> to compare, or undo to remove them.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
