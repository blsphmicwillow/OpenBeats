/** Audio targets offered by the export dialog. */
export type ExportFormatId = 'wav16' | 'wav24' | 'flac' | 'mp3' | 'ogg' | 'm4a';

export interface ExportFormatOption {
  id: ExportFormatId;
  name: string;
  ext: string;
  detail: string;
  /** Encoded through ffmpeg rather than the bundled encoders. */
  lossy: boolean;
  /** The browser build can only write 16-bit WAV. */
  desktopOnly: boolean;
}

export const EXPORT_FORMATS: ExportFormatOption[] = [
  {
    id: 'wav16',
    name: 'WAV',
    ext: '.wav',
    detail: '16-bit PCM stereo. Opens in every player and editor.',
    lossy: false,
    desktopOnly: false,
  },
  {
    id: 'wav24',
    name: 'WAV 24-bit',
    ext: '.wav',
    detail: '24-bit PCM for mixing or mastering in another DAW.',
    lossy: false,
    desktopOnly: true,
  },
  {
    id: 'flac',
    name: 'FLAC',
    ext: '.flac',
    detail: 'Lossless compression at roughly half the WAV size.',
    lossy: false,
    desktopOnly: true,
  },
  {
    id: 'mp3',
    name: 'MP3',
    ext: '.mp3',
    detail: 'Plays anywhere; 128, 192 or 320 kbps by quality.',
    lossy: true,
    desktopOnly: true,
  },
  {
    id: 'ogg',
    name: 'OGG Vorbis',
    ext: '.ogg',
    detail: 'Clean lossy audio for games and the web.',
    lossy: true,
    desktopOnly: true,
  },
  {
    id: 'm4a',
    name: 'M4A (AAC)',
    ext: '.m4a',
    detail: 'Apple-friendly AAC at 192 or 256 kbps.',
    lossy: true,
    desktopOnly: true,
  },
];

export function exportFormat(id: ExportFormatId): ExportFormatOption {
  return EXPORT_FORMATS.find((format) => format.id === id) ?? EXPORT_FORMATS[0];
}

/** Human-readable bitrate/quality for the lossy encoders. */
export function qualityLabel(id: ExportFormatId, quality: number): string {
  const q = Math.max(1, Math.min(10, quality));
  switch (id) {
    case 'mp3':
      return q <= 2 ? '128 kbps' : q <= 5 ? '192 kbps' : '320 kbps';
    case 'ogg':
      return `quality ${q} of 10`;
    case 'm4a':
      return q >= 7 ? '256 kbps' : '192 kbps';
    default:
      return '';
  }
}
