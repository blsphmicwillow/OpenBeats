import { useT } from '../i18n/useT';
import { useEffect, useState } from 'react';
import type { ClapPluginInsert } from '../model/types';
import {
  inspectNativeClapPlugin,
  setNativeClapParameter,
  setNativeClapPluginGui,
  type NativeClapParameter,
} from '../lib/nativeAudio';
import { useApp } from '../store';
import { Knob } from '../ui/Knob';
import { Modal } from '../ui/Modal';

export function ClapPluginEditor({
  stripId,
  plugin,
  onClose,
}: {
  stripId: number;
  plugin: ClapPluginInsert;
  onClose: () => void;
}) {
  const t = useT();
  const [parameters, setParameters] = useState<NativeClapParameter[]>([]);
  const [values, setValues] = useState<Record<number, number>>(plugin.parameters ?? {});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [nativeGuiOpen, setNativeGuiOpen] = useState(false);
  const [nativeGuiError, setNativeGuiError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void inspectNativeClapPlugin(plugin.id)
      .then((next) => {
        if (!active) return;
        setParameters(next.filter((parameter) => !parameter.hidden && !parameter.readonly));
        const saved = useApp.getState().project.strips
          .find((strip) => strip.id === stripId)
          ?.clapPlugin?.parameters ?? {};
        const initial = { ...saved };
        for (const parameter of next) {
          if (!parameter.hidden && !parameter.readonly && initial[parameter.id] === undefined) {
            initial[parameter.id] = parameter.value;
          }
        }
        setValues(initial);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not load plugin parameters');
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [plugin.id, stripId]);

  const updateParameter = (parameter: NativeClapParameter, value: number) => {
    setValues((current) => ({ ...current, [parameter.id]: value }));
    useApp.getState().patchProject((project) => {
      const strip = project.strips.find((candidate) => candidate.id === stripId);
      if (strip?.clapPlugin?.id === plugin.id) {
        strip.clapPlugin.parameters = {
          ...strip.clapPlugin.parameters,
          [parameter.id]: value,
        };
      }
    });
    void setNativeClapParameter(stripId, plugin.id, parameter.id, value).catch((cause: unknown) => {
      console.error('Could not update CLAP parameter', cause);
      useApp.getState().toast('Could not update the plugin parameter');
    });
  };

  const setNativeGui = async (open: boolean) => {
    setNativeGuiError('');
    try {
      const active = await setNativeClapPluginGui(stripId, plugin.id, open);
      if (!active && open) {
        setNativeGuiError('Start playback to open the plugin native editor.');
        return;
      }
      setNativeGuiOpen(open);
    } catch (cause) {
      setNativeGuiError(cause instanceof Error ? cause.message : 'Could not update the native editor');
    }
  };

  return (
    <Modal
      title={`${plugin.name || plugin.id} parameters`}
      subtitle={`CLAP · mixer strip ${stripId}`}
      onClose={onClose}
    >
      <div className="fx-card-head">
        <button className="tbtn small flat" onClick={() => void setNativeGui(true)}>
          Open native editor
        </button>
        <button
          className="tbtn small flat"
          disabled={!nativeGuiOpen}
          onClick={() => void setNativeGui(false)}
        >
          Close native editor
        </button>
        <span className="tiny-note">Native editor is a floating window; playback must be running.</span>
      </div>
      {nativeGuiError && <div className="plugin-warning">{nativeGuiError}</div>}
      {busy && <div className="tiny-note">Loading plugin parameters…</div>}
      {error && <div className="plugin-warning">{error}</div>}
      {!busy && !error && parameters.length === 0 && (
        <div className="tiny-note">{t('This plugin exposes no editable CLAP parameters.')}</div>
      )}
      {!busy && !error && parameters.length > 0 && (
        <div className="fx-card-body">
          {parameters.map((parameter) => {
            const value = values[parameter.id] ?? parameter.value;
            const span = parameter.max_value - parameter.min_value;
            const step = parameter.stepped ? 1 : Math.max(span / 1000, 0.000001);
            return (
              <Knob
                key={parameter.id}
                value={value}
                min={parameter.min_value}
                max={parameter.max_value}
                step={step}
                label={parameter.name || `Parameter ${parameter.id}`}
                size={38}
                defaultValue={parameter.default_value}
                format={(current) =>
                  parameter.stepped ? String(Math.round(current)) : String(Number(current.toPrecision(4)))
                }
                onGestureStart={() =>
                  useApp.getState().pushHistory(`clap:${stripId}:${plugin.id}:${parameter.id}`)
                }
                onChange={(next) => updateParameter(parameter, next)}
              />
            );
          })}
        </div>
      )}
    </Modal>
  );
}
