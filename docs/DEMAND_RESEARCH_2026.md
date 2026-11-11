# DAW demand research — November 2026

What FL Studio, Ableton Live and open-source DAW users ask for most, what they use most,
and where OpenBeats 1.0.6 already stands.

**Research date:** 2026-11-11
**Scope:** public official forums, release notes, vendor manuals and public GitHub issues/discussions.
**Method and limits:** pages were read through a search index without signing in. This is a
high-signal sample of the busiest current threads and shipped release notes, **not** an exhaustive
crawl of every post. Image-Line and Ableton show only part of a thread to logged-out readers, and
forum view counts include years of history, so the tiers below are based on **recurrence across
independent threads and products**, not on a scraped vote count. Quotes are short excerpts used for
evidence; no forum content is copied wholesale.

---

## 1. OpenBeats 1.0.6 baseline

Compiled from `CHANGELOG.md`, `README.md` and `git log` (1.0.0 → 1.0.6). This is what the demand
map is measured against.

| Area | Shipped by 1.0.6 | Engine |
| --- | --- | --- |
| Channels & instruments | Channel Rack, step sequencer, 15 instrument engines (incl. Glass Keys, Velvet Choir, FM Bass) | Rust/CPAL + Web Audio |
| Piano roll | Draw, move, resize, velocity lane, scales, chord tools, strum/arpeggiate/flam, humanize | Rust + UI |
| Playlist | Pattern clips, audio clips, markers, section loops, fades, crossfade, inspector | UI; audio clips Web Audio only |
| Clip editing | Split at playhead, reverse, normalize, slip, copy/cut/paste, Shift+Arrow nudge | Web Audio for audio clips |
| Mixer | Routing to buses/master with cycle refusal, sends, mute/solo, **no insert-count cap**, 14 built-in effects | Routing/voices Rust; inserts Web Audio |
| Automation | Volume/pan lanes with linear/hold/smooth and tempo-synced presets | Web Audio only |
| Recording | Native input capture, monitoring, take recording, Hum to Melody | Rust (desktop) |
| Export | WAV 16/24-bit, FLAC, MP3; OGG/M4A via ffmpeg; mastering targets | Rust |
| Interchange | MIDI, Ableton `.als` import, REAPER `.rpp` import/export, `.obeats` | Rust |
| Workflow | Fully remappable keyboard, command palette, **Learn workspace**, guided tour | UI |
| Plugin hosting | Browser/download only; inserts not routed into the audio callback | Rust, not wired |

Known 1.0.6 gaps that matter below: **no PDC**, **no stem separation**, **no score/notation**,
**no clip launcher/scenes**, **single-clip selection only**, **audio clips are Web Audio only**, and
**native CPAL ignores mixer automation**.

---

## 2. What users demand most

Grouped by how often the same ask appears across FL, Ableton and open-source projects.

### Tier A — recurring across all three ecosystems

1. **Unified track / routing workflow.** FL users keep asking for the Channel Rack, Playlist and
   Mixer to behave as one track: automatic insert creation, linked naming/colour and routing.
   A August 2026 thread calls the separation "the single biggest bottleneck for large-scale
   arrangement", and a July 2026 Gopher thread complains that "route all channels to mixer inserts"
   produced one insert instead of one per channel.
   Sources: [Playlist & Mixer Unification](https://forum.image-line.com/viewtopic.php?p=2069597),
   [Gopher routing thread](https://forum.image-line.com/viewtopic.php?t=341325),
   [FL workflow manual: Instrument Channel > Playlist Track > Mixer Track](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/basics_workflow.htm).
   Ableton solved part of this with **Mixer in Arrangement** in Live 12.
2. **Batch / multi-clip editing.** Ableton's wishlist has repeat threads for fades on multiple clips,
   multi-clip envelope/CC editing, and per-clip effects. FL users ask for Playlist subgroups.
   Sources: [multi-clip fades](https://forum.ableton.com/viewtopic.php?t=251186),
   [multi-clip envelope/CC batch editing](https://forum.ableton.com/viewforum.php?f=3),
   [Playlist subgroups request](https://forum.image-line.com/viewtopic.php?t=340517).
3. **Performance, latency and stability.** FL's 2026 releases lead with Windows CPU-throttling
   changes, and its hotfix list is dominated by browser re-indexing CPU, plugin-picker freezes and
   preview crashes. Ableton's wishlist carries "Total Latency of a Live Set" and a per-set latency
   manager; Ardour's roadmap prioritises dropout reduction and in-place editing.
   Sources: [FL 2026.1.1 release](https://forum.image-line.com/viewtopic.php?t=341401),
   [FL 2026.1.7 changelog](https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/WhatsNew.htm),
   [Ableton latency manager wish](https://forum.ableton.com/viewforum.php?f=3&start=50),
   [Ardour roadmap](https://ardour.org/future.html).
4. **Plugin hosting that actually loads into the mixer.** This is the number-one open-source parity
   gap: Zrythm's 2.0 alphas are largely native VST3/LV2 hosting with preset browsing; LMMS is blocked
   on multi-channel plugin support; Ardour keeps expanding plugin pin/routing. OpenBeats ships a
   plugin browser but does not route plugin inserts.
   Sources: [Zrythm changelog](https://github.com/zrythm/zrythm/blob/master/CHANGELOG.md),
   [LMMS progress report](https://github.com/LMMS/lmms/discussions/7676),
   [Ardour 9.0](https://ardour.org/news/9.0.html).
5. **Audio recording and comping.** "Audio recording is a frequently requested feature" in LMMS;
   Ardour 9 adds clip recording and playlist comping; Ableton users ask to disable comping and to
   consolidate in Session. FL 2026 reframed its mixer audio logger as "audio editor and record".
   Sources: [LMMS report](https://lmms.io/forum/viewtopic.php?t=34614&view=previous),
   [Ardour features](https://ardour.org/features.html),
   [Ableton comping toggle](https://forum.ableton.com/viewforum.php?f=3).
6. **Browser speed and preview.** FL's 2026 cycle added inline sample waveforms and longer plugin
   search, while its fixes target browser re-indexing and preview crashes; Ableton's wishlist asks
   for an info view, waveform scaling and better preview rhythm options.
   Sources: [FL 2026.1.3 release](https://forum.image-line.com/viewtopic.php?t=341668),
   [Ableton info view wish](https://forum.ableton.com/viewforum.php?f=3&start=50).

### Tier B — strong, repeated, but narrower asks

7. **Stem separation.** Now table stakes in the commercial market: Ableton 12.3 shipped it in
   November 2025 and 12.4 added time-selection stems and merge-to-single-track; FL 2026 ships a
   Remix tool built on stem separation.
   Sources: [Ableton Live 12 features](https://www.ableton.com/en/live/all-new-features),
   [Ableton 12 beta notes](https://www.ableton.com/fr/release-notes/live-12-beta),
   [FL Studio 2026](https://www.image-line.com/fl-studio/release/2026).
8. **Musical mode / tempo-following audio.** Zrythm added global and per-clip tempo stretch with
   source BPM detection; FL added audio clip gain controls and playlist stretching work.
   Source: [Zrythm changelog](https://github.com/zrythm/zrythm/blob/master/CHANGELOG.md).
9. **Notation / score view.** Ableton's notation thread has run since 2007 with ~140k views; Ardour
   keeps chord-track work on its roadmap. This is a long-tail ask, not a first-purchase driver.
   Source: [Ableton Feature Wishlist index](https://forum.ableton.com/viewforum.php?f=3).
10. **Clip launching / scenes.** Ableton's Session View remains its identity; Ardour 9 built a cue
    page and clip recording to compete; FL has Performance Mode and Clip Columns.
    Sources: [Ableton: what is Live](https://www.ableton.com/en/live/what-is-live),
    [Ardour 9.0](https://ardour.org/news/9.0.html).
11. **Custom keyboard shortcuts.** A June 2026 Ableton wishlist request; FL routes most actions
    through scripts and a fixed map. OpenBeats already remaps every action, which is a real
    differentiator rather than a backlog item.
    Source: [Ableton custom shortcuts request](https://forum.ableton.com/viewforum.php?f=3&start=50).
12. **Loudness analysis and metering.** Ableton users ask for clip LUFS values; Ardour threads cover
    LUFS export and dynamic range; OpenBeats has Fix My Mix and mastering targets but no per-clip
    LUFS readout.

### Tier C — visible but niche

- Tempo-track editing flexibility (Ardour, October 2026).
- Surround panners, video timecode/SMPTE, film-scoring workflows (Ableton).
- Cloud sync of preferences/user library (Ableton wishlist; FL Cloud backup shipped in 2026).
- AI assistance that actually performs edits (FL Gopher, 2026). Users are sceptical when it claims
  work it did not do.
- GUI scaling and accessibility (LMMS issue #6353; OpenBeats already ships scale, contrast,
  reduced motion and focus rings).

---

## 3. What people use most

Ranked by where each product invests its tutorials, default workspaces and release notes:

1. **Piano roll / step sequencer.** FL's manual calls the Channel Rack and Piano roll the main
   creation windows; FL 2026 adds note labels and chord voice-leading; Ardour 9.1 added a dedicated
   piano-roll window in response to "a major user request".
   Sources: [FL workflow](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/basics_workflow.htm),
   [CDM on Ardour 9.2](https://cdm.link/ardour-9-2-free-and-open-daw).
2. **Arrangement / playlist.** Every wishlist cluster (subgroups, multi-clip fades, consolidate,
   marker actions) is arrangement work. This is where users spend the longest sessions.
3. **Browser and sample audition.** Both vendors now ship waveform previews, search and cloud sample
   integration; FL's 2026 release rebuilt FLEX, described as "FL Studio's most popular plugin", with
   an expanded browser.
4. **Mixer and inserts.** FL's 10-slot limit is the subject of a 2026 request for 20 slots; Ableton
   added Mixer in Arrangement; Ardour markets unlimited inserts/sends.
5. **Export and sharing.** Loudness targets, stems and cloud backup are the recurring finishing asks.

---

## 4. Gap map against OpenBeats 1.0.6

| Demand | 1.0.6 today | Gap | Engine to change |
| --- | --- | --- | --- |
| Unified channel → playlist track → mixer strip | Manual routing; separate channel/mixer/track entities | **Missing.** No one-click "create linked track" flow | Project model + Rust and Web Audio routing |
| Insert chain depth | No cap; mixer shows first 4 then "+N more" | **Already ahead** of FL's 10-slot limit | — |
| Batch clip editing | Single `selectedClip`; inspector edits one clip | **Missing** multi-select, batch fades/gain/quantize | UI + project model |
| Custom shortcuts | Fully remappable keymap | **Already solved** | — |
| Browser preview/search | Audition, tagging, pack import, search | Inline waveform previews and large-library indexing not verified as present | UI + Web Audio |
| Stem separation | Absent | **Missing**, heavy DSP | Offline (Web Audio/WASM or bundled native), not CPAL callback |
| Tempo-following audio clips | Audio clips play with fixed media offset; no warp | **Missing** | Web Audio first; Rust pending audio-clip voice |
| Recording / comping | Native capture, monitoring, takes, Hum to Melody | **Partial**: no comping lanes or loop recording | Rust |
| Plugin hosting into mixer | Browser/download only | **Missing** routing; host exists out-of-process | Rust (wire existing host) |
| PDC / latency compensation | Not implemented | **Missing** | Rust engine + Web Audio graph |
| Score / notation | Absent | **Missing**, niche | New editor |
| Clip launcher / scenes | Pattern mode + playlist loops | **Missing** launcher | UI + both engines |
| Per-clip LUFS / loudness | Fix My Mix and mastering targets only | **Partial** | Web Audio analysis |
| Tempo map flexibility | Fixed BPM + swing | **Missing** | Project model + Rust |

---

## 5. Recommended next six (ranked, with effort)

1. **Linked track creation and auto-routing** — the most repeated FL ask, and it fits our model
   cleanly: create channel, playlist track and mixer strip together, share name/colour, route
   automatically, and keep manual routing available. *Engine: project model + Rust and Web Audio
   routing. Effort: medium.*
2. **Multi-clip selection and batch edits** — fades, gain, quantize, split and delete across a
   selection. Directly answers Ableton's multi-clip threads and FL's subgroup request.
   *Engine: UI/model only. Effort: medium.*
3. **Browser waveform previews and library indexing** — inline peaks, faster search, sort order and
   keyboard audition. Cheap parity with FL 2026 and Ableton's browser asks. *Engine: UI + Web Audio.
   Effort: small.*
4. **PDC and native insert parity** — measure and compensate plugin/insert latency, then route the
   existing Rust effect graph into the CPAL callback so desktop playback and bounce stop diverging.
   *Engine: Rust. Effort: large, highest honesty value.*
5. **Musical mode for audio clips** — tempo-following playback with source-BPM detection, Web Audio
   first and labelled as such. *Engine: Web Audio, Rust pending. Effort: medium.*
6. **Recording comping and loop recording** — takes, lanes, comp selection; builds on the existing
   native capture path. *Engine: Rust. Effort: large.*

Deferred deliberately: stem separation (large model/runtime cost, unclear licence path), notation
(not a purchase driver for this audience), cloud sync (conflicts with the local-first promise), and
generative AI that performs edits (FL's Gopher shows the trust cost when it overclaims).

---

## 6. Sources

Official forums and release notes:

- [Image-Line: Playlist & Mixer Unification](https://forum.image-line.com/viewtopic.php?p=2069597)
- [Image-Line: mixer FX slot limit request](https://forum.image-line.com/viewtopic.php?p=2062704)
- [Image-Line: A Manifesto for FL Studio 2026](https://forum.image-line.com/viewtopic.php?t=340392)
- [Image-Line: FL Studio 2026 Beta 7 thread](https://forum.image-line.com/viewtopic.php?t=340517)
- [Image-Line: FL Studio 2026.1.1 release](https://forum.image-line.com/viewtopic.php?t=341401)
- [Image-Line: FL Studio 2026.1.3 release](https://forum.image-line.com/viewtopic.php?t=341668)
- [Image-Line: Gopher routing thread](https://forum.image-line.com/viewtopic.php?t=341325)
- [FL Studio 2026 release page](https://www.image-line.com/fl-studio/release/2026)
- [FL Studio what's new changelog](https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/WhatsNew.htm)
- [FL Studio browser manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/browser.htm)
- [Ableton: Feature Wishlist index](https://forum.ableton.com/viewforum.php?f=3)
- [Ableton: Feature Wishlist page 2](https://forum.ableton.com/viewforum.php?f=3&start=50)
- [Ableton: feature wishlist thread](https://forum.ableton.com/viewtopic.php?t=253011)
- [Ableton: fade on multiple clips](https://forum.ableton.com/viewtopic.php?t=251186)
- [Ableton: Live 12 features](https://www.ableton.com/en/live/all-new-features)
- [Ableton: Live 12 beta release notes](https://www.ableton.com/fr/release-notes/live-12-beta)

Open source:

- [LMMS progress report (audio recording, multi-channel plugins)](https://github.com/LMMS/lmms/discussions/7676)
- [LMMS issue: live instrument usage and snap/trim requests](https://github.com/LMMS/lmms/issues/8577)
- [LMMS issue: GUI scaling](https://github.com/LMMS/lmms/issues/6353)
- [Ardour 9.0 release notes](https://ardour.org/news/9.0.html)
- [Ardour features](https://ardour.org/features.html)
- [Ardour roadmap](https://ardour.org/future.html)
- [Ardour UX pain points thread](https://discourse.ardour.org/t/i-designed-some-fixes-for-a-few-ux-interaction-pain-points-in-ardour-not-a-whole-redesign/113591)
- [Ardour tempo-track thread](https://discourse.ardour.org/t/problems-whit-tempo-track/113721)
- [Zrythm changelog](https://github.com/zrythm/zrythm/blob/master/CHANGELOG.md)
- [CDM: Ardour 9.2](https://cdm.link/ardour-9-2-free-and-open-daw)
