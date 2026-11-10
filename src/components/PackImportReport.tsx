import { useState } from 'react';
import { Modal } from '../ui/Modal';
import type { NativePack, NativePackFormat, NativePackReport } from '../lib/nativeAudio';

const FORMAT_LABEL: Record<NativePackFormat, string> = {
  open_beats: 'OpenBeats native pack',
  fl_studio: 'FL-style category folders',
  generic: 'One-shot zip',
  flat: 'Flat sample dump',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The import report promised by README: what landed, what was skipped and why. */
export function PackImportReport({
  pack,
  report,
  onClose,
}: {
  pack: NativePack;
  report: NativePackReport;
  onClose: () => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const categories = Object.entries(report.categories).sort((a, b) => b[1] - a[1]);
  const previewOnly = (pack.presets ?? []).filter((preset) => !preset.playable).length;
  const playable = report.presets - previewOnly;

  return (
    <Modal
      title={`Imported ${pack.name}`}
      subtitle={`${FORMAT_LABEL[report.format] ?? report.format} · ${pack.root}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setShowLog((value) => !value)}>
            {showLog ? 'Hide log' : 'Show log'}
          </button>
          <span className="tiny-note">
            {report.archive_bytes
              ? `${formatBytes(report.archive_bytes)} archive → ${formatBytes(report.extracted_bytes)} extracted`
              : `${formatBytes(pack.samples.reduce((sum, sample) => sum + sample.bytes, 0))} of samples`}
          </span>
          <div className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="pack-report">
        <div className="pack-report-row ok">
          <strong>✓ {report.samples}</strong> sample{report.samples === 1 ? '' : 's'} imported
        </div>
        {categories.length > 0 && (
          <div className="pack-categories">
            {categories.map(([category, count]) => (
              <span className="pack-badge" key={category}>
                {category} · {count}
              </span>
            ))}
          </div>
        )}
        <div className={`pack-report-row ${playable ? 'ok' : 'muted'}`}>
          <strong>✓ {playable}</strong> playable preset{playable === 1 ? '' : 's'} registered
          {previewOnly > 0 && (
            <span className="pack-note"> · {previewOnly} preview-only</span>
          )}
        </div>
        {previewOnly > 0 && (
          <div className="pack-report-row warn">
            <strong>⚠ {previewOnly}</strong> preset{previewOnly === 1 ? '' : 's'} are metadata
            only (VST2/FST/FLP content is not executed)
          </div>
        )}
        {report.skipped_count > 0 && (
          <div className="pack-report-row warn">
            <strong>⚠ {report.skipped_count}</strong> file
            {report.skipped_count === 1 ? '' : 's'} skipped or failed validation
          </div>
        )}
        {report.warnings.map((warning) => (
          <div className="pack-report-row warn" key={warning}>
            {warning}
          </div>
        ))}

        {(pack.presets ?? []).length > 0 && (
          <>
            <div className="browser-group">Preset metadata</div>
            {pack.presets?.map((preset, index) => (
              <div className="pack-preset" key={`${preset.source}-${index}`}>
                <div>
                  <b>{preset.name}</b>{' '}
                  <span className="tiny-note">
                    {preset.plugin} · {preset.kind}
                  </span>
                </div>
                <div className="tiny-note">{preset.notes}</div>
              </div>
            ))}
          </>
        )}

        {report.skipped.length > 0 && (
          <>
            <div className="browser-group">Skipped files</div>
            {report.skipped.map((skip) => (
              <div className="pack-skip" key={`${skip.file}-${skip.reason}`}>
                <span>{skip.file}</span>
                <span className="tiny-note">{skip.reason}</span>
              </div>
            ))}
            {report.skipped_count > report.skipped.length && (
              <div className="pack-note">
                …and {report.skipped_count - report.skipped.length} more; see the log.
              </div>
            )}
          </>
        )}

        {showLog && (
          <pre className="pack-log">{report.log.join('\n') || 'No per-file log was produced.'}</pre>
        )}
      </div>
    </Modal>
  );
}
