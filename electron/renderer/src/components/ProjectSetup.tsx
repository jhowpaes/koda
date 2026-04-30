import React from 'react';
import { FolderOpen } from 'lucide-react';

interface Props {
  workspaceName: string;
  onOpenProject: () => void;
}

export default function ProjectSetup({ workspaceName, onOpenProject }: Props) {
  return (
    <div className="project-setup">
      <div className="project-setup-card">
        <div className="project-setup-icon">
          <FolderOpen size={52} strokeWidth={1.25} />
        </div>
        <h2 className="project-setup-title">Open a project</h2>
        <p className="project-setup-desc">
          Select a folder to start working in <strong>{workspaceName}</strong>.
        </p>
        <button className="project-setup-btn" onClick={onOpenProject}>
          <FolderOpen size={14} strokeWidth={2} /> Choose folder…
        </button>
      </div>
    </div>
  );
}
