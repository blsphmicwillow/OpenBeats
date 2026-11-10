import { useState } from 'react';
import { useApp } from '../store';
import { Modal } from '../ui/Modal';
import { IconFolder, IconPlus, IconSave } from '../ui/icons';

/** New project / old project library. The Tutorial project is seeded on first run. */
export function ProjectHub() {
  const open = useApp((s) => s.ui.projectHubOpen);
  const saved = useApp((s) => s.savedProjects);
  const current = useApp((s) => s.project);
  const [name, setName] = useState('');
  const { setUI, saveCurrentProject, openSavedProject, deleteSavedProject, newProject } = useApp.getState();

  if (!open) return null;
  const close = () => setUI({ projectHubOpen: false });

  return (
    <Modal
      title="Projects"
      subtitle="Saved on this device · open an old project, start a new one, or keep the current song"
      onClose={close}
      footer={
        <>
          <input
            className="select"
            style={{ minWidth: 220 }}
            value={name}
            placeholder="Project name"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn ghost"
            onClick={() => {
              saveCurrentProject(name.trim() || current.name);
              setName('');
            }}
          >
            <IconSave size={12} /> Save current
          </button>
          <div className="spacer" />
          <button
            className="btn"
            onClick={() => {
              newProject('blank');
              setTimeout(() => useApp.getState().saveCurrentProject(name.trim() || 'Untitled'), 0);
              setName('');
              close();
            }}
          >
            <IconPlus size={12} /> New project
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="project-list">
        {saved.map((entry) => {
          const active = entry.name === current.name;
          return (
            <div className={`project-row ${active ? 'active' : ''}`} key={entry.id}>
              <div className="project-icon" aria-hidden="true">
                <IconFolder size={16} />
              </div>
              <div className="project-meta">
                <b>{entry.name}</b>
                <span>
                  {entry.project.channels.length} channels · {entry.project.patterns.length} patterns ·{' '}
                  {new Date(entry.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <button className="btn ghost" onClick={() => openSavedProject(entry.id)} aria-label={`Open ${entry.name}`}>
                Open
              </button>
              <button
                className="btn ghost"
                disabled={entry.id === 'tutorial'}
                title={entry.id === 'tutorial' ? 'The Tutorial project is part of the app' : `Delete ${entry.name}`}
                onClick={() => deleteSavedProject(entry.id)}
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
      <p className="hinttext" style={{ marginTop: 14 }}>
        First run opens <b>Tutorial</b>, not a blank song. The current song is also restored automatically the next time you
        launch OpenBeats.
      </p>
    </Modal>
  );
}
