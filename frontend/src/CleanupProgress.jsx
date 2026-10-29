import { useEffect, useRef } from 'react';
import { ArrowRight, Check, CircleHelp, FileText, LoaderCircle, ShieldCheck } from 'lucide-react';

export default function CleanupProgress({ filename, completed, total, status, message, onClose }) {
  const dialogRef = useRef(null);
  const actionRef = useRef(null);
  const running = status === 'running';
  const failed = status === 'error';
  const percentage = total ? Math.floor(completed / total * 100) : 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog.showModal();
    dialog.focus();
    return () => { dialog.close(); previousFocus?.focus(); };
  }, []);

  useEffect(() => { if (!running) actionRef.current?.focus(); }, [running]);

  return <dialog ref={dialogRef} className="cleanup-progress-dialog" tabIndex={-1}
    aria-labelledby="cleanup-progress-title" aria-describedby="cleanup-progress-description"
    onCancel={event => { event.preventDefault(); if (!running) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!running) onClose();
      }
    }}>
    <div className="cleanup-progress-heading">
      <span className={`cleanup-progress-icon ${failed ? 'failed' : ''}`}>
        {running ? <LoaderCircle size={25} className="animate-spin" /> : failed ? <CircleHelp size={25} /> : <Check size={25} />}
      </span>
      <span className="eyebrow">{running ? 'CLEANUP IN PROGRESS' : failed ? 'CLEANUP INTERRUPTED' : 'READY TO REVIEW'}</span>
    </div>
    <h2 id="cleanup-progress-title">{running ? 'Cleaning your PDF' : failed ? 'Cleanup could not finish' : 'All pages processed'}</h2>
    <p className="cleanup-progress-file"><FileText size={15} /><span title={filename}>{filename}</span></p>
    <div className="cleanup-progress-count" role="status" aria-live="polite" aria-atomic="true">
      <span><strong>{completed}</strong> of <strong>{total}</strong> pages completed</span>
      <span className="cleanup-progress-percentage">{percentage}%</span>
    </div>
    <progress className="cleanup-progress-bar" value={completed} max={total || 1}
      aria-label="Pages completed" aria-valuetext={`${completed} of ${total} pages completed`} />
    <p id="cleanup-progress-description" className={`cleanup-progress-description ${failed ? 'failed' : ''}`}>
      {running ? 'Please keep this window open. Progress updates as each page finishes.' : failed ? message : 'Review the results and choose which cleaned pages to keep.'}
    </p>
    <div className="cleanup-progress-footer"><ShieldCheck size={15} /><span>Your original PDF stays unchanged.</span></div>
    {!running && <button ref={actionRef} className={`button button-${failed ? 'secondary' : 'primary'} cleanup-progress-action`} onClick={onClose}>
      {failed ? 'Back to document' : 'Review pages'}{!failed && <ArrowRight size={16} />}
    </button>}
  </dialog>;
}
