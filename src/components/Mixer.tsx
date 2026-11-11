import { useRef, useState } from 'react';
import { useApp } from '../store';
import { Knob } from '../ui/Knob';
import { Fader } from '../ui/Fader';
import { Meter } from '../ui/Meter';
import { EFFECT_DEFS, effectLabel, uid } from '../model/defaults';
import { IconPlus, IconPower, IconTrash } from '../ui/icons';
import type {
  AutomationCurve,
  AutomationPoint,
  AutomationTarget,
  Effect,
  EffectType,
  MenuItem,
  Strip,
} from '../model/types';
import {
  automationValueAt,
  buildAutomationPreset,
  laneFor,
  type AutomationPresetId,
} from '../model/automation';
import { songLengthSteps } from '../audio/sequencer';

function EqCurve({ effect, onChange }: { effect: Effect; onChange: (index: number, gain: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const W = 320;
  const H = 58;
  const mid = H / 2;
  const scale = 1.35;
  const gains = Array.from({ length: 10 }, (_, i) => effect.params[`g${i}`] ?? 0);
  const points = gains.map((g, i) => [i * (W / 9), mid - g * scale]);
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const cx = (px + x) / 2;
    d += ` C ${cx} ${py} ${cx} ${y} ${x} ${y}`;
  }

  const paint = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const index = Math.max(0, Math.min(9, Math.round((x / W) * 9)));
    onChange(index, Math.max(-18, Math.min(18, (mid - y) / scale)));
  };

  return (
    <svg
      ref={ref}
      className="fx-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        paint(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) paint(e);
      }}
    >
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--border)" strokeWidth={1} />
      <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill="var(--accent)" opacity={0.12} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.4} fill="var(--accent)" />
      ))}
    </svg>
  );
}

function EffectCard({ strip, effect }: { strip: Strip; effect: Effect }) {
  const { updateEffect, removeEffect, pushHistory, hint } = useApp.getState();
  const def = EFFECT_DEFS[effect.type];
  return (
    <div className={`fx-card ${effect.bypass ? 'bypassed' : ''}`}>
      <div className="fx-card-head">
        <IconPower size={11} />
        <span>{def.name}</span>
        <span className="fx-type">{def.category}</span>
        <div className="spacer" />
        <button
          className="tbtn small flat"
          title={effect.bypass ? 'Enable' : 'Bypass'}
          onClick={() =>
            useApp.getState().patchProject((p) => {
              const fx = p.strips.find((s) => s.id === strip.id)?.effects.find((e) => e.id === effect.id);
              if (fx) fx.bypass = !fx.bypass;
            })
          }
        >
          {effect.bypass ? 'off' : 'on'}
        </button>
        <button className="tbtn small flat" title="Remove effect" onClick={() => removeEffect(strip.id, effect.id)}>
          <IconTrash size={10} />
        </button>
      </div>
      <div className="fx-card-body">
        {def.params.map((param) => (
          <Knob
            key={param.key}
            value={effect.params[param.key] ?? param.def}
            min={param.min}
            max={param.max}
            step={param.step}
            defaultValue={param.def}
            label={param.label}
            size={30}
            format={(v) => `${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(param.step >= 1 ? 0 : 1)}${param.unit ?? ''}`}
            hintText={`${def.name} · ${param.label}`}
            onGestureStart={() => pushHistory(`fx:${effect.id}:${param.key}`)}
            onChange={(v) => updateEffect(strip.id, effect.id, { [param.key]: v }, `fx:${effect.id}:${param.key}`)}
          />
        ))}
        {effect.type === 'eq10' && (
          <span className="tiny-note" style={{ width: '100%' }}>
            drag the curve to shape all ten bands
          </span>
        )}
        <span className="tiny-note" style={{ width: '100%' }} onMouseEnter={() => hint(def.blurb)}>
          {def.blurb}
        </span>
      </div>
      {effect.type === 'eq10' && (
        <EqCurve
          effect={effect}
          onChange={(index, gain) => {
            pushHistory(`eq:${effect.id}`);
            updateEffect(strip.id, effect.id, { [`g${index}`]: gain }, `eq:${effect.id}`);
          }}
        />
      )}
    </div>
  );
}

const AUTO_W = 1000;
const AUTO_H = 92;
const AUTO_PAD = 8;

function AutomationEditor({
  value,
  target,
  length,
  barSteps,
  fallback,
  onChange,
}: {
  value: AutomationPoint[];
  target: AutomationTarget;
  length: number;
  barSteps: number;
  fallback: number;
  onChange: (points: AutomationPoint[]) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const dragId = useRef<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const min = target === 'pan' ? -1 : 0;
  const max = target === 'pan' ? 1 : 1.25;
  const toX = (step: number) => (Math.max(0, Math.min(length, step)) / Math.max(1, length)) * (AUTO_W - AUTO_PAD * 2) + AUTO_PAD;
  const toY = (raw: number) => {
    const v = Math.max(min, Math.min(max, raw));
    return AUTO_PAD + ((max - v) / (max - min || 1)) * (AUTO_H - AUTO_PAD * 2);
  };
  const fromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(AUTO_W, ((e.clientX - rect.left) / rect.width) * AUTO_W));
    const y = Math.max(0, Math.min(AUTO_H, ((e.clientY - rect.top) / rect.height) * AUTO_H));
    const step = Math.max(0, Math.min(length, Math.round(((x - AUTO_PAD) / (AUTO_W - AUTO_PAD * 2)) * length)));
    const raw = max - ((y - AUTO_PAD) / (AUTO_H - AUTO_PAD * 2)) * (max - min);
    return { step, value: Math.max(min, Math.min(max, raw)) };
  };
  const points = [...value].sort((a, b) => a.step - b.step);
  const line = (() => {
    if (!points.length) return '';
    let path = `M ${toX(points[0].step)} ${toY(points[0].value)}`;
    for (let i = 1; i < points.length; i += 1) {
      const left = points[i - 1];
      const right = points[i];
      if (left.curve === 'hold') {
        path += ` L ${toX(right.step)} ${toY(left.value)} L ${toX(right.step)} ${toY(right.value)}`;
      } else if (left.curve === 'smooth') {
        for (let sample = 1; sample <= 16; sample += 1) {
          const ratio = sample / 16;
          const value = left.value + (right.value - left.value) * (ratio * ratio * (3 - 2 * ratio));
          path += ` L ${toX(left.step + (right.step - left.step) * ratio)} ${toY(value)}`;
        }
      } else {
        path += ` L ${toX(right.step)} ${toY(right.value)}`;
      }
    }
    return path;
  })();
  const selectedIndex = points.findIndex((point) => point.id === selectedPoint);
  const selected = selectedIndex >= 0 ? points[selectedIndex] : null;
  const segmentEditable = selectedIndex >= 0 && selectedIndex < points.length - 1;
  const selectedCurve: AutomationCurve = selected?.curve ?? 'linear';
  const readout = points.length
    ? `${points.length} point${points.length === 1 ? '' : 's'} · ${target === 'pan' ? 'L/R' : '0–125%'} · ${selectedCurve} segment`
    : 'Click the lane to add a point';
  const presets: { id: AutomationPresetId; label: string; disabled: boolean }[] = [
    { id: 'fade-in', label: 'Fade in · 4 bars', disabled: target === 'pan' },
    { id: 'tremolo', label: 'Tremolo · 1/8', disabled: false },
    { id: 'ducking', label: 'Ducking · 1/4', disabled: target === 'pan' },
  ];
  const applyPreset = (preset: AutomationPresetId) => {
    const next = buildAutomationPreset(target, preset, { length, barSteps });
    if (!next.length) return;
    setSelectedPoint(null);
    onChange(next);
  };

  return (
    <div className="automation-editor">
      <svg
        ref={ref}
        className="automation-lane"
        viewBox={`0 0 ${AUTO_W} ${AUTO_H}`}
        preserveAspectRatio="none"
        role="application"
        aria-label={`${target === 'pan' ? 'Pan' : 'Volume'} automation lane`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const next = fromPointer(e);
          if (!next) return;
          const id = uid('ap');
          setSelectedPoint(id);
          onChange([...points, { id, step: next.step, value: next.value, curve: 'linear' }]);
        }}
        onPointerMove={(e) => {
          if (!dragId.current) return;
          const next = fromPointer(e);
          if (!next) return;
          onChange(points.map((p) => (p.id === dragId.current ? { ...p, step: next.step, value: next.value } : p)));
        }}
        onPointerUp={() => {
          dragId.current = null;
        }}
        onPointerCancel={() => {
          dragId.current = null;
        }}
      >
        <line x1={AUTO_PAD} y1={toY(fallback)} x2={AUTO_W - AUTO_PAD} y2={toY(fallback)} stroke="var(--border)" strokeDasharray="3 4" />
        {points.length > 0 && (
          <>
            <path d={`${line} L ${toX(points[points.length - 1].step)} ${AUTO_H - AUTO_PAD} L ${toX(points[0].step)} ${AUTO_H - AUTO_PAD} Z`} fill="var(--accent)" opacity="0.12" />
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {points.map((point) => (
          <g key={point.id}>
            <circle
              cx={toX(point.step)}
              cy={toY(point.value)}
              r="7"
              fill="var(--accent)"
              stroke="var(--bg)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                setSelectedPoint(point.id);
                dragId.current = point.id;
                (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selectedPoint === point.id) setSelectedPoint(null);
                onChange(points.filter((p) => p.id !== point.id));
              }}
            >
              <title>{`${Math.round(point.value * 100)} · step ${point.step} · right-click to remove`}</title>
            </circle>
          </g>
        ))}
        <text x={AUTO_PAD} y={AUTO_H - 2} fill="var(--dim)" fontSize="9">1</text>
        <text x={AUTO_W - AUTO_PAD} y={AUTO_H - 2} fill="var(--dim)" fontSize="9" textAnchor="end">
          {length}
        </text>
      </svg>
      <div className="automation-presets">
        <span className="lbl">Preset</span>
        {presets.map((preset) => (
          <button
            key={preset.id}
            className="tbtn small flat"
            disabled={preset.disabled}
            title={
              preset.disabled
                ? `${preset.label} applies to volume lanes`
                : `Replace this lane with ${preset.label} — tempo-synced to the 16th grid`
            }
            onClick={() => applyPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
        <span className="tiny-note">replaces lane · tempo-synced</span>
      </div>
      <div className="automation-segment-tools">
        <span className="lbl">Segment</span>
        {(['linear', 'hold', 'smooth'] as const).map((curve) => (
          <button
            key={curve}
            className={`tbtn small flat ${segmentEditable && selectedCurve === curve ? 'active' : ''}`}
            disabled={!segmentEditable}
            title={segmentEditable ? `Use ${curve} interpolation for this segment` : 'Select a point with a following point'}
            onClick={() => {
              if (!segmentEditable || !selected) return;
              onChange(points.map((point) => (point.id === selected.id ? { ...point, curve } : point)));
            }}
          >
            {curve}
          </button>
        ))}
        <span className="tiny-note">
          {segmentEditable ? `point ${selected?.step} → ${points[selectedIndex + 1].step}` : 'select a point to edit its outgoing segment'}
        </span>
      </div>
      <span className="tiny-note">{readout}</span>
    </div>
  );
}

export function Mixer() {
  const project = useApp((s) => s.project);
  const chains = useApp((s) => s.settings.fxChains);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [automationTarget, setAutomationTarget] = useState<AutomationTarget>('volume');
  const [fxView, setFxView] = useState<'chain' | 'effects'>('chain');
  const {
    updateStrip,
    setAutomation,
    selectStrip,
    addStrip,
    removeStrip,
    addEffect,
    saveFxChain,
    applyFxChain,
    removeFxChain,
    setRoute,
    addSend,
    updateSend,
    removeSend,
    openMenu,
    pushHistory,
    hint,
    patchProject,
  } = useApp.getState();

  const selected = project.strips.find((s) => s.id === project.selectedStrip) ?? project.strips[0];
  const fxCategories = Array.from(new Set(Object.values(EFFECT_DEFS).map((d) => d.category)));
  const channelsOnStrip = (stripId: number) => project.channels.filter((c) => c.mixer === stripId);
  const colorFor = (strip: Strip) => (strip.id === 0 ? 'var(--accent)' : strip.color);

  const insertMenu = (e: React.MouseEvent, strip: Strip) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const categories = Array.from(new Set(Object.values(EFFECT_DEFS).map((d) => d.category)));
    const items: MenuItem[] = [{ label: 'Add effect', disabled: true }];
    categories.forEach((cat) => {
      items.push({ separator: true });
      items.push({ label: cat, disabled: true });
      Object.values(EFFECT_DEFS)
        .filter((d) => d.category === cat)
        .forEach((d) => items.push({ label: d.name, onClick: () => addEffect(strip.id, d.type as EffectType) }));
    });
    openMenu(rect.left, rect.bottom + 3, items);
  };

  const chainMenu = (e: React.MouseEvent, strip: Strip) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = [
      {
        label: strip.effects.length ? 'Save current insert chain' : 'Add an effect to save a chain',
        disabled: strip.effects.length === 0,
        onClick: () => saveFxChain(strip.id),
      },
    ];
    if (chains.length) {
      items.push({ separator: true }, { label: 'Load saved chain', disabled: true });
      chains.forEach((chain) => {
        items.push({ label: `${chain.name} · ${chain.effects.length} fx`, onClick: () => applyFxChain(strip.id, chain.id) });
      });
      items.push({ separator: true }, { label: 'Delete saved chain', disabled: true });
      chains.forEach((chain) => {
        items.push({ label: chain.name, danger: true, onClick: () => removeFxChain(chain.id) });
      });
    }
    openMenu(rect.left, rect.bottom + 3, items);
  };

  const stripMenu = (e: React.MouseEvent, strip: Strip) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: 'Rename strip', onClick: () => { setRenaming(strip.id); setDraft(strip.name); } },
      { label: strip.collapsed ? 'Expand strip' : 'Collapse strip', onClick: () => updateStrip(strip.id, { collapsed: !strip.collapsed }) },
      { label: strip.id === 0 ? 'Master stays on the output' : 'Route to master', disabled: strip.id === 0, onClick: () => setRoute(strip.id, 0) },
      { separator: true },
      { label: 'Add effect…', onClick: () => insertMenu(e, strip) },
      { label: 'Reset fader and pan', onClick: () => updateStrip(strip.id, { gain: 0.8, pan: 0 }) },
      { separator: true },
      { label: 'Delete strip', danger: true, disabled: strip.id === 0, onClick: () => removeStrip(strip.id) },
    ]);
  };

  const fxTargets = project.strips.filter((s) => s.id !== selected.id && !selected.sends.some((x) => x.to === s.id));

  const flow = (() => {
    const chain: string[] = [];
    let cursor: Strip | undefined = selected;
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(`${cursor.id === 0 ? 'Master' : cursor.name || `Insert ${cursor.id}`} → ${cursor.route === 0 && cursor.id !== 0 ? 'Master' : cursor.id === 0 ? 'Output' : `Insert ${cursor.route}`}`);
      cursor = project.strips.find((s) => s.id === cursor?.route);
      if (cursor?.id === 0) {
        chain.push('Master → Output');
        break;
      }
    }
    return chain.join(' · ');
  })();

  return (
    <div className="mixer" data-tour="mixer">
      <div className="toolbar">
        <span className="lbl">inserts</span>
        <button className="tbtn small" onClick={addStrip} title="Add an insert / bus channel">
          <IconPlus size={10} /> Insert
        </button>
        <button
          className="tbtn small"
          onClick={() => {
            project.strips.forEach((s) => updateStrip(s.id, { collapsed: !s.collapsed }));
          }}
          title="Collapse or expand every strip"
        >
          Collapse all
        </button>
        <div className="sep" />
        <span className="lbl">selected</span>
        <span className="chip">{selected.id === 0 ? 'Master' : `${selected.id}. ${selected.name}`}</span>
        <span className="flow-line">{flow}</span>
        <div className="spacer" />
        <span className="tiny-note">
          {project.strips.length - 1} inserts · click a strip to edit its effects below
        </span>
      </div>

      <div className="mx-scroll">
        <div className="mx-strips">
          {project.strips.map((strip) => {
            const feeds = channelsOnStrip(strip.id);
            return (
              <div
                key={strip.id}
                className={`strip ${strip.collapsed ? 'collapsed' : ''} ${selected.id === strip.id ? 'selected' : ''} ${strip.id === 0 ? 'master' : ''}`}
                style={{ ['--strip-color' as string]: colorFor(strip) }}
                onClick={() => selectStrip(strip.id)}
                onContextMenu={(e) => stripMenu(e, strip)}
                title={feeds.length ? `Fed by ${feeds.map((c) => c.name).join(', ')}` : 'No direct channel input'}
              >
                <span className="strip-num">{strip.id === 0 ? 'M' : strip.id}</span>
                {renaming === strip.id ? (
                  <input
                    autoFocus
                    className="strip-name"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      updateStrip(strip.id, { name: draft.trim() || strip.name });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span
                    className="strip-name"
                    onDoubleClick={() => {
                      setRenaming(strip.id);
                      setDraft(strip.name);
                    }}
                  >
                    {strip.id === 0 ? 'Master' : strip.name || `Insert ${strip.id}`}
                  </span>
                )}
                <span
                  className="strip-route"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (strip.id === 0) return;
                    openMenu(e.clientX, e.clientY, [
                      { label: 'Route to', disabled: true },
                      ...project.strips
                        .filter((s) => s.id !== strip.id)
                        .map((s) => ({ label: s.id === 0 ? 'Master' : `${s.id}. ${s.name}`, checked: strip.route === s.id, onClick: () => setRoute(strip.id, s.id) })),
                    ]);
                  }}
                  title="Click to change the output route"
                >
                  → {strip.route === 0 ? 'Master' : `Insert ${strip.route}`}
                </span>
                {!strip.collapsed && (
                  <div className="strip-inserts">
                    {strip.effects.slice(0, 4).map((fx) => (
                      <button
                        key={fx.id}
                        className={`insert-slot ${fx.bypass ? 'bypassed' : ''}`}
                        title={`${effectLabel(fx.type)} — click to edit, shift-click to bypass`}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectStrip(strip.id);
                          if (e.shiftKey) {
                            patchProject((p) => {
                              const target = p.strips.find((s) => s.id === strip.id)?.effects.find((f) => f.id === fx.id);
                              if (target) target.bypass = !target.bypass;
                            });
                          }
                        }}
                      >
                        {effectLabel(fx.type)}
                      </button>
                    ))}
                    {strip.effects.length > 4 && <span className="tiny-note">+{strip.effects.length - 4} more</span>}
                    <button className="insert-slot empty" onClick={(e) => { e.stopPropagation(); insertMenu(e, strip); }}>
                      + FX
                    </button>
                  </div>
                )}

                <div className="strip-body">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                    <button
                      className={`led ${strip.mute ? 'on mute' : ''}`}
                      onClick={(e) => { e.stopPropagation(); updateStrip(strip.id, { mute: !strip.mute }); }}
                      title="Mute strip"
                    >
                      M
                    </button>
                    <button
                      className={`led ${strip.solo ? 'on solo' : ''}`}
                      onClick={(e) => { e.stopPropagation(); updateStrip(strip.id, { solo: !strip.solo }); }}
                      title="Solo strip"
                    >
                      S
                    </button>
                    {!strip.collapsed && (
                      <Knob
                        value={strip.pan}
                        min={-1}
                        max={1}
                        onChange={(v) => updateStrip(strip.id, { pan: v }, `sp:${strip.id}`)}
                        onGestureStart={() => pushHistory(`sp:${strip.id}`)}
                        size={22}
                        format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
                        defaultValue={0}
                        label=""
                        color={colorFor(strip)}
                      />
                    )}
                  </div>
                  <Meter stripId={strip.id} />
                  <Fader
                    value={strip.gain}
                    onChange={(v) => updateStrip(strip.id, { gain: v }, `sg:${strip.id}`)}
                    onGestureStart={() => pushHistory(`sg:${strip.id}`)}
                    color={colorFor(strip)}
                    label={strip.name}
                  />
                </div>
                {!strip.collapsed && (
                  <div className="strip-btns">
                    <button
                      className="tbtn small flat"
                      title="Collapse strip"
                      onClick={(e) => { e.stopPropagation(); updateStrip(strip.id, { collapsed: true }); }}
                    >
                      ‹
                    </button>
                    <button className="tbtn small flat" title="Add effect" onClick={(e) => { e.stopPropagation(); insertMenu(e, strip); }}>
                      fx
                    </button>
                  </div>
                )}
                {strip.collapsed && (
                  <button className="tbtn small flat" title="Expand strip" onClick={(e) => { e.stopPropagation(); updateStrip(strip.id, { collapsed: false }); }}>
                    ›
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="fx-rack">
        <div className="fx-rack-head">
          <span className="fx-rack-title">
            {selected.id === 0 ? 'Master' : `${selected.id}. ${selected.name}`} — inserts
          </span>
          <div className="automation-tabs" role="tablist" aria-label="Effects view">
            <button
              className={`tbtn small flat ${fxView === 'chain' ? 'active' : ''}`}
              role="tab"
              aria-selected={fxView === 'chain'}
              onClick={() => setFxView('chain')}
            >
              Chain
            </button>
            <button
              className={`tbtn small flat ${fxView === 'effects' ? 'active' : ''}`}
              role="tab"
              aria-selected={fxView === 'effects'}
              onClick={() => setFxView('effects')}
            >
              Effects
            </button>
          </div>
          <button className="tbtn small" onClick={(e) => insertMenu(e, selected)}>
            <IconPlus size={10} /> Effect
          </button>
          <button className="tbtn small" onClick={(e) => chainMenu(e, selected)} title="Save or load an insert chain template">
            Chains
          </button>
          {selected.id !== 0 && (
            <>
              <span className="lbl">route</span>
              <select className="mini-select" value={selected.route} onChange={(e) => setRoute(selected.id, Number(e.target.value))}>
                {project.strips
                  .filter((s) => s.id !== selected.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id === 0 ? 'Master' : `${s.id}. ${s.name}`}
                    </option>
                  ))}
              </select>
              <span className="lbl">send</span>
              <select
                className="mini-select"
                value=""
                onChange={(e) => {
                  const to = Number(e.target.value);
                  if (to >= 0) addSend(selected.id, to);
                  hint('Send added — set its level below.');
                }}
              >
                <option value="">add send…</option>
                {fxTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === 0 ? 'Master' : `${s.id}. ${s.name}`}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="spacer" />
          <span className="tiny-note">
            {channelsOnStrip(selected.id).length
              ? `fed by ${channelsOnStrip(selected.id).map((c) => c.name).join(', ')}`
              : 'no direct channel input — route a channel here from the channel rack'}
          </span>
        </div>

        {selected.sends.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            {selected.sends.map((send, i) => (
              <div key={`${send.to}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Knob
                  value={send.amount}
                  min={0}
                  max={1}
                  onChange={(v) => updateSend(selected.id, i, v)}
                  size={26}
                  label={`→ ${project.strips.find((s) => s.id === send.to)?.name ?? send.to}`}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <button className="tbtn small flat" title="Remove send" onClick={() => removeSend(selected.id, i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {fxView === 'effects' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <span className="tiny-note">
              Add a native insert to {selected.id === 0 ? 'Master' : selected.name || `Insert ${selected.id}`}. The same chain renders in the desktop engine and the WAV bounce.
            </span>
            {fxCategories.map((category) => (
              <div key={category}>
                <div className="lbl" style={{ marginBottom: 4 }}>{category}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
                  {Object.values(EFFECT_DEFS)
                    .filter((def) => def.category === category)
                    .map((def) => (
                      <button
                        key={def.type}
                        className="fx-card"
                        style={{ textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => {
                          addEffect(selected.id, def.type as EffectType);
                          setFxView('chain');
                        }}
                        title={`Add ${def.name} to ${selected.id === 0 ? 'Master' : selected.name}`}
                      >
                        <div className="fx-card-head">
                          <strong>{def.name}</strong>
                          <span className="tiny-note">{def.category}</span>
                        </div>
                        <span className="tiny-note">{def.blurb}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : selected.effects.length === 0 ? (
          <div className="tiny-note">
            No inserts yet — add an EQ, compressor, delay or reverb. Effects are native to OpenBeats, follow your theme and render into the WAV bounce.
          </div>
        ) : (
          <div className="fx-cards">
            {selected.effects.map((fx) => (
              <EffectCard key={fx.id} strip={selected} effect={fx} />
            ))}
          </div>
        )}
      </div>

      <div className="automation-rack" aria-label="Mixer automation">
        <div className="automation-head">
          <strong>Automation</strong>
          <span className="tiny-note">{selected.id === 0 ? 'Master' : `${selected.id}. ${selected.name}`}</span>
          <div className="automation-tabs" role="tablist" aria-label="Automation target">
            {(['volume', 'pan'] as const).map((target) => (
              <button
                key={target}
                className={`tbtn small flat ${automationTarget === target ? 'active' : ''}`}
                role="tab"
                aria-selected={automationTarget === target}
                onClick={() => setAutomationTarget(target)}
              >
                {target}
              </button>
            ))}
          </div>
          <span className="automation-badge">Web Audio only</span>
          <button
            className="tbtn small flat"
            disabled={laneFor(selected, automationTarget).points.length === 0}
            onClick={() => setAutomation(selected.id, automationTarget, [], `auto:${selected.id}:${automationTarget}`)}
          >
            Clear lane
          </button>
        </div>
        <AutomationEditor
          value={laneFor(selected, automationTarget).points}
          target={automationTarget}
          length={Math.max(16, songLengthSteps(project))}
          barSteps={project.beatsPerBar * 4}
          fallback={automationTarget === 'pan' ? selected.pan : selected.gain}
          onChange={(points) => setAutomation(selected.id, automationTarget, points, `auto:${selected.id}:${automationTarget}`)}
        />
        <span className="tiny-note">
          Volume/pan ramps are applied by Web Audio during playback and offline export. Native CPAL ignores them, so playback uses Web Audio while this project has automation points.
        </span>
      </div>
    </div>
  );
}
