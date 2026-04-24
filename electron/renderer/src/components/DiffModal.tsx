import React from 'react';

interface Props {
  filePath: string;
  original: string;
  modified: string;
  onAccept: () => void;
  onReject: () => void;
}

function buildDiff(original: string, modified: string): Array<{ type: 'added' | 'removed' | 'normal' | 'meta'; text: string }> {
  // simple line-by-line diff using LCS
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const result: Array<{ type: 'added' | 'removed' | 'normal' | 'meta'; text: string }> = [];

  result.push({ type: 'meta', text: `--- original` });
  result.push({ type: 'meta', text: `+++ modified` });

  // naive diff: show removed then added blocks
  const maxLen = Math.max(oldLines.length, newLines.length);
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: 'normal', text: `  ${oldLines[i]}` });
      i++; j++;
    } else {
      // collect consecutive diffs
      const removedBlock: string[] = [];
      const addedBlock: string[] = [];
      while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
        removedBlock.push(oldLines[i++]);
        if (removedBlock.length > 50) break;
      }
      while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
        addedBlock.push(newLines[j++]);
        if (addedBlock.length > 50) break;
      }
      for (const l of removedBlock) result.push({ type: 'removed', text: `- ${l}` });
      for (const l of addedBlock) result.push({ type: 'added', text: `+ ${l}` });
    }
  }
  return result;
}

export default function DiffModal({ filePath, original, modified, onAccept, onReject }: Props) {
  const lines = buildDiff(original, modified);
  const shortPath = filePath.split('/').slice(-2).join('/');

  return (
    <div className="modal-overlay" onClick={onReject}>
      <div className="diff-modal" onClick={e => e.stopPropagation()}>
        <div className="diff-modal-header">
          <span className="diff-modal-title">{shortPath}</span>
          <div className="diff-modal-actions">
            <button className="btn-reject" onClick={onReject}>Reject</button>
            <button className="btn-accept" onClick={onAccept}>Accept changes</button>
          </div>
        </div>
        <div className="diff-content">
          {lines.map((l, i) => (
            <div key={i} className={`diff-line ${l.type}`}>{l.text}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
