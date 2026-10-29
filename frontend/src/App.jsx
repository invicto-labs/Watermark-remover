import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CircleHelp, FileText, Layers3, LoaderCircle, LockKeyhole, Maximize2, Plus, ScanLine, ShieldCheck, Upload, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import './styles.css';
import HuntingtonReview from './HuntingtonReview';
import CleanupProgress from './CleanupProgress';
import PdfReview from './PdfReview';

const presets = [
  { id: 'dotted_document', title: 'Dotted document', description: 'Diagonal dotted lettering on scanned documents.', image: 'dotted-document', tag: 'Documents' },
  { id: 'dotted_map', title: 'Maps & surveys', description: 'Dotted lettering across plats and survey maps.', image: 'dotted-map', tag: 'Maps' },
  { id: 'unofficial_copy', title: 'Unofficial copy', description: 'Gray “Unofficial Copy” marks on scans.', image: 'unofficial-copy', tag: 'Scans' },
  { id: 'overlay', title: 'Text & website marks', description: 'Separate PDF text, website names, and stamps.', image: 'overlay', tag: 'Digital PDFs' },
  { id: 'preset', title: 'Huntington County', description: 'The county watermark across scanned text.', image: 'huntington', tag: 'County scans' },
  { id: 'huntington_background', title: 'Huntington - step by step', description: 'Refine cleanup, then repair confirmed words.', image: 'huntington', tag: 'Text review' },
  { id: 'repeated_diagonal', title: 'Repeated diagonal', description: 'Repeated lines of diagonal watermark text.', image: 'repeated-diagonal', tag: 'Scans' },
  { id: 'polarity', title: 'Dark page to white', description: 'Turn negative scans into readable white pages.', image: 'polarity', tag: 'Restoration' },
];
const steps = ['Upload PDF', 'Preview & clean', 'Review & export'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, body, filename) {
  const options = body === undefined ? {} : {
    method: 'POST',
    headers: { 'X-ClearPage': 'local', 'Content-Type': filename ? 'application/pdf' : 'application/json', ...(filename ? { 'X-Filename': encodeURIComponent(filename) } : {}) },
    body: filename ? body : JSON.stringify(body),
  };
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('The connection to ClearPage was interrupted. Make sure the app is running, then try again.');
  }
  const data = await response.json().catch(() => {
    throw new Error('The local PDF service did not respond correctly. Restart the app and try again.');
  });
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function Button({ children, variant = 'primary', className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

function Brand() {
  return <span className="brand"><span className="brand-mark"><Layers3 size={23} strokeWidth={1.7} /></span>clearpage<span className="brand-dot">.</span></span>;
}

function HelpDialog({ onClose }) {
  const closeRef = useRef(null);
  useEffect(() => { const previous = document.activeElement; closeRef.current?.focus(); return () => previous?.focus(); }, []);
  return <div className="modal-backdrop" onClick={onClose}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
  }}><button ref={closeRef} className="icon-button close-help" aria-label="Close guide" onClick={onClose}><X size={20} /></button>
    <span className="eyebrow">A LITTLE GUIDANCE</span><h2 id="help-title">From cluttered to clear.</h2>
    {[
      ['Add your document', 'Choose one PDF up to 150 MB. Your file is processed on your computer.'],
      ['Choose a matching preset', 'Select the example closest to your watermark. Preview the first page before cleaning the full document.'],
      ['Review before you export', 'Compare original and cleaned pages. Selected pages use the cleaned result; unchecked pages keep the original. Every page stays in your PDF.'],
    ].map(([title, body], index) => <div className="help-step" key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}
    <div className="note"><ShieldCheck size={20} /><p>Flattened marks can overlap original text. Check the results carefully, especially names and numbers.</p></div>
  </section></div>;
}

function PdfTypeDialog({ item, selected, onSelect, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => { const previous = document.activeElement; dialogRef.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={dialogRef} className="pdf-type-dialog" aria-labelledby="pdf-type-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="pdf-type-dialog-content">
    <button autoFocus className="icon-button close-help" aria-label="Close PDF type" onClick={onClose}><X size={20} /></button>
    <div className="pdf-type-example"><img src={`/static/type-${item.image}.${item.image === 'polarity' ? 'svg' : 'webp'}`} alt={`${item.title} example`} /></div>
    <div className="pdf-type-details"><span className="eyebrow">{item.tag}</span><h2 id="pdf-type-title">{item.title}</h2><p>{item.description}</p><Button onClick={() => { onSelect(item.id); onClose(); }}>{selected ? <Check size={17} /> : <ArrowRight size={17} />}{selected ? 'Keep this PDF type' : 'Use this PDF type'}</Button></div>
  </div></dialog>;
}

export default function App() {
  const [view, setView] = useState('upload');
  const [job, setJob] = useState(null);
  const [method, setMethod] = useState('dotted_document');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const [pdfType, setPdfType] = useState(null);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [previewed, setPreviewed] = useState(new Set());
  const [results, setResults] = useState([]);
  const [huntingtonPreview, setHuntingtonPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [progress, setProgress] = useState(null);
  const [cleanupProgress, setCleanupProgress] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [downloaded, setDownloaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const fileRef = useRef(null);
  const uploadLock = useRef(false);
  const titleRef = useRef(null);
  const stage = job && view === 'review' ? 2 : job && view === 'workspace' ? 1 : 0;

  useEffect(() => {
    const handleKey = event => { if (event.key === 'Escape') { if (pdfType) return; else if (help) setHelp(false); else if (!busy && view !== 'upload') setView(view === 'review' ? 'workspace' : 'upload'); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [help, pdfType, busy, view]);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [view]);
  useEffect(() => {
    // A refresh or hot reload must not hide a cleanup already running locally.
    let active = true;
    async function reconnect() {
      let current;
      try { current = await request('/api/session'); } catch { return; }
      if (!active || uploadLock.current || current?.state !== 'processing') return;
      setJob(current); setMethod(current.options?.method || 'dotted_document');
      setView('workspace'); begin(); updateCleanupProgress(current);
      try {
        const finished = await waitForJob('review', updateCleanupProgress, current.id, () => active);
        if (finished) finishCleanup(finished);
      } catch (failure) {
        if (active) {
          setError(failure.message);
          setCleanupProgress(previous => ({ ...previous, status: 'error', message: failure.message }));
        }
      } finally { if (active) setBusy(false); }
    }
    reconnect();
    return () => { active = false; };
  }, []);

  function begin() { setBusy(true); setError(''); setProgress(null); setDownloaded(false); }
  function choosePreset(id) {
    if (busy || method === id) return;
    setMethod(id); setResults([]); setPreviewed(new Set()); setSelected(new Set()); setDownloaded(false); setError(''); setMessage('Preset updated. Preview the first page to check the result.');
  }
  function settings() { return { method, mode: 'careful', strokes: [], page: 0, use_reviewed: false, auto_restore: false, scan_inversion: false, fix_negative: false, polarity_pages: [] }; }
  async function upload(file) {
    if (!file || busy || uploadLock.current) return;
    setError('');
    if (!/\.pdf$/i.test(file.name)) { setError('Please choose a PDF file.'); return; }
    if (file.size > 150 * 1024 * 1024) { setError('Please choose a PDF under 150 MB.'); return; }
    uploadLock.current = true; begin(); setMessage('Opening your document…');
    try {
      const previous = job;
      const next = await request('/api/upload', file, file.name);
      setJob({ ...next, name: file.name, size: file.size }); setPage(0); setRevision(value => value + 1); setPreviewed(new Set()); setResults([]); setSelected(new Set()); setZoom(100); setPreviewError(false);
      setView('workspace'); setMessage('Choose the preset that matches your document, then preview the first page.');
      if (previous) await request(`/api/clear/${previous.id}`, {}).catch(() => {});
    } catch (failure) { setError(failure.message); setMessage(''); }
    finally { setBusy(false); uploadLock.current = false; if (fileRef.current) fileRef.current.value = ''; }
  }
  async function waitForJob(expected, onProgress, identifier = job.id, isCurrent = () => true) {
    for (;;) {
      if (!isCurrent()) return null;
      const state = await request(`/api/job/${identifier}`);
      if (!isCurrent()) return null;
      onProgress?.(state);
      setProgress(state.count ? Math.min(100, Math.round((state.progress || 0) / state.count * 100)) : null);
      if (['processing', 'exporting', 'learning', 'restoring'].includes(state.state)) { setMessage(state.message || 'Working on your document…'); await pause(600); continue; }
      if (state.state !== expected) throw new Error(state.message || 'The operation could not be completed. Please try again.');
      setJob(previous => ({ ...previous, ...state })); return state;
    }
  }
  function updateCleanupProgress(current) {
    const total = current.count;
    const completed = Math.min(total, Math.max(0, current.results?.length ?? current.progress ?? 0));
    setCleanupProgress({ completed, total, status: 'running', message: current.message || '' });
  }
  function finishCleanup(state) {
    const next = state.results || [];
    setResults(next); setPreviewed(new Set(next.map(item => item.page))); setSelected(new Set(next.filter(item => item.changed && !item.uncertain).map(item => item.page))); setPage(0); setRevision(value => value + 1); setPreviewError(false);
    setMessage(next.some(item => item.changed) ? 'Cleanup complete. Review your pages and choose which cleaned results to keep. Pages needing review start unchecked.' : 'No supported watermarks found. Try another preset or export the original pages.');
    setCleanupProgress({ completed: state.count, total: state.count, status: 'complete', message: '' });
  }
  async function preview() {
    if (busy || !job) return;
    begin(); setMessage('Creating a preview of the first page…');
    try {
      const result = await request(`/api/preview/${job.id}`, settings());
      setHuntingtonPreview(result);
      setResults([]); setSelected(new Set()); setPage(0); setRevision(value => value + 1); setPreviewed(new Set([0])); setPreviewError(false);
      setMessage(result.changed ? 'Your preview is ready. Compare both pages, then clean the full PDF.' : 'No supported watermark was found on page 1. Try another preset, or check the full PDF.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function cleanAll() {
    if (busy || !job) return;
    begin(); setMessage('Cleaning your document…'); setResults([]); setSelected(new Set());
    setCleanupProgress({ completed: 0, total: job.count, status: 'running', message: '' });
    try {
      await request(`/api/process/${job.id}`, settings());
      const state = await waitForJob('review', updateCleanupProgress);
      finishCleanup(state);
    } catch (failure) {
      setError(failure.message);
      setCleanupProgress(previous => ({ ...previous, status: 'error', message: failure.message }));
    }
    finally { setBusy(false); }
  }
  async function download() {
    if (busy || !job || !results.length) return;
    begin(); setMessage('Preparing your PDF…');
    try {
      await request(`/api/export/${job.id}`, { keep: [...selected] }); await waitForJob('done');
      const link = document.createElement('a'); link.href = `/api/download/${job.id}`; link.download = ''; document.body.append(link); link.click(); link.remove();
      setDownloaded(true); setMessage('Your PDF is ready. The download has started.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function togglePage(index) { setSelected(previous => { const next = new Set(previous); next.has(index) ? next.delete(index) : next.add(index); return next; }); }
  function navigate(next) { if (!busy) { setView(next); setError(''); } }
  const comparing = previewed.has(page);

  return <div className={`app-shell ${view === 'review' ? 'review-mode' : view === 'workspace' ? 'workspace-mode' : ''}`}>
    <div className="main-shell">
      <header className="navbar">
        <a className="brand-link" href="/" onClick={event => { event.preventDefault(); navigate('upload'); }} aria-label="ClearPage home"><Brand /></a>
        <nav aria-label="Main navigation" className="navbar-links">
          <button disabled={busy} className="navbar-link active" aria-current="page" onClick={() => navigate(job ? (results.length ? 'review' : 'workspace') : 'upload')}><WandSparkles size={17} /><span>PDF cleanup</span></button>
        </nav>
        <div className="navbar-actions"><span className="navbar-private"><LockKeyhole size={14} />Processed locally</span><button className="navbar-help" onClick={() => setHelp(true)}><CircleHelp size={18} /><span>Help</span></button></div>
      </header>
      <main className={view === 'review' ? 'main-content review-content' : view === 'workspace' ? 'main-content workspace-content' : 'main-content'}>
        {view !== 'review' && <div className="stepper" aria-label="Cleanup progress">{steps.map((label, index) => <React.Fragment key={label}>{index > 0 && <span className={`step-line ${stage >= index ? 'complete' : ''}`} />}<span className={`step ${stage === index ? 'current' : stage > index ? 'done' : ''}`} aria-current={stage === index ? 'step' : undefined}><b>{stage > index ? <Check size={12} /> : `0${index + 1}`}</b><span>{label}</span></span></React.Fragment>)}</div>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" aria-label="Choose a PDF" className="sr-only" disabled={busy} onChange={event => upload(event.target.files?.[0])} />

        {view === 'upload' && <>
          <div className="upload-layout"><section className="upload-card"><div className="card-topline"><span><Upload size={16} />ADD YOUR DOCUMENT</span><span className="file-type">.PDF</span></div>
            <button disabled={busy} className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length > 1) setError('Please add one PDF at a time.'); else upload(event.dataTransfer.files[0]); }}>
              <span className="upload-art"><span className="upload-art-back" /><span className="upload-art-front"><FileText size={37} strokeWidth={1.1} /></span><span className="upload-art-plus"><Plus size={16} /></span></span>
              <h2>{busy ? 'Opening your document…' : dragging ? 'Drop it here. We’ve got it.' : 'Good things start with a drop.'}</h2><p>Drag your PDF here, or browse to upload</p><span className="button button-primary">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={17} />}Choose a PDF<ArrowRight size={16} /></span><small>PDF files only <span>·</span> Up to 150 MB</small>
            </button><div className="upload-card-footer"><LockKeyhole size={14} /><span>Your files stay yours. Your original stays untouched.</span></div>
          </section>
          </div>
          {(error || busy) && <div role={error ? 'alert' : 'status'} className={`status-banner ${error ? 'error' : ''}`}>{busy && <LoaderCircle size={17} className="animate-spin" />}{error || message}</div>}
          {job && <div className="resume-bar"><FileText size={18} /><span>Your document <strong>{job.name}</strong> is still open.</span><button className="text-button" onClick={() => navigate(results.length ? 'review' : 'workspace')}>Continue editing<ArrowRight size={16} /></button></div>}

        </>}


        {view === 'workspace' && job && <>
          <div className="editor-heading"><div className="editor-file"><button className="icon-button" aria-label="Back to upload" disabled={busy} onClick={() => navigate('upload')}><ArrowLeft size={18} /></button><FileText size={22} /><div><h1 ref={titleRef} tabIndex={-1}>{job.name}</h1><p>{job.count} {job.count === 1 ? 'page' : 'pages'}<span>·</span>{(job.size / 1024 / 1024).toFixed(1)} MB<span>·</span><LockKeyhole size={12} />Local document</p></div></div><Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}><Plus size={16} />New PDF</Button></div>
          <div className={`editor-layout ${!comparing ? 'initial-preview' : ''}`}><section className="document-viewer" aria-label="Document preview"><div className="viewer-toolbar"><span><span className="live-dot" />{comparing ? 'Compare your result' : 'Original document'}</span><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => value - 25)}><ZoomOut size={16} /></button><span>{zoom}%</span><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => setZoom(value => value + 25)}><ZoomIn size={16} /></button><button className="icon-button" aria-label="Reset zoom" onClick={() => setZoom(100)}><Maximize2 size={15} /></button></div></div>
            <div className={`page-canvas ${comparing ? 'comparing' : ''} zoom-${zoom}`}>
              <figure className="comparison-before"><figcaption><strong>{comparing ? 'Before' : 'Original'}</strong><span>Original PDF</span></figcaption><div className="page-image"><img src={`/api/page/${job.id}/${page}/before?v=${revision}`} alt={`Original document page ${page + 1}`} onError={() => setPreviewError(true)} /></div></figure>
              {comparing && <figure className="comparison-after"><figcaption><strong>After</strong><span><Check size={13} />Cleaned preview</span></figcaption><div className="page-image"><img src={`/api/page/${job.id}/${page}/after?v=${revision}`} alt={`Cleaned document page ${page + 1}`} onError={() => setPreviewError(true)} /></div></figure>}
            </div>
            {previewError && <div role="alert" className="status-banner error">Could not load the page preview.<button className="text-button" onClick={() => { setPreviewError(false); setRevision(value => value + 1); }}>Retry</button></div>}
            <div className="page-navigation"><button className="icon-button" aria-label="Previous page" disabled={busy || page === 0} onClick={() => { setPage(value => value - 1); setPreviewError(false); }}><ChevronLeft size={17} /></button><label>Page <select aria-label="Preview page" value={page} disabled={busy} onChange={event => { setPage(Number(event.target.value)); setPreviewError(false); }}>{Array.from({ length: job.count }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select> of {job.count}</label><button className="icon-button" aria-label="Next page" disabled={busy || page === job.count - 1} onClick={() => { setPage(value => value + 1); setPreviewError(false); }}><ChevronRight size={17} /></button></div>
          </section>
          <aside className="cleanup-panel" aria-label="Cleanup settings"><div className="panel-title"><span className="feature-icon"><WandSparkles size={20} /></span><div><h2>Choose your PDF type</h2><p>Select a card to see an example.</p></div></div>
            <fieldset disabled={busy} className="preset-fieldset"><legend className="sr-only">PDF type</legend><div className="pdf-type-grid">{presets.map(item => <button type="button" key={item.id} className={'pdf-type-card ' + (method === item.id ? 'selected' : '')} aria-label={'View ' + item.title + ' PDF type'} aria-haspopup="dialog" onClick={() => setPdfType(item)}><span className="pdf-type-thumbnail"><img src={'/static/type-' + item.image + '.' + (item.image === 'polarity' ? 'svg' : 'webp')} alt="" />{method === item.id && <span className="pdf-type-check"><Check size={13} /></span>}</span><span className="pdf-type-card-title">{item.title}<ArrowRight size={14} /></span><span className="pdf-type-tag">{item.tag}</span><span className="sr-only">{method === item.id ? 'Selected' : ''}</span></button>)}</div></fieldset>
            <div className="panel-actions"><Button className="preview-action" onClick={preview} disabled={busy}><ScanLine size={16} />Preview first page</Button><Button className="clean-action" onClick={cleanAll} disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <WandSparkles size={16} />}Clean all {job.count} {job.count === 1 ? 'page' : 'pages'}<ArrowRight size={16} /></Button><span className="panel-footnote"><ShieldCheck size={13} />Your original is always preserved.</span></div>
          </aside></div>
          <div aria-live="polite" role={error ? 'alert' : 'status'} className={`status-banner ${error ? 'error' : ''}`}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{error || message}</span>{busy && progress !== null && <span className="progress-value">{progress}%</span>}</div>
          {busy && <progress className="work-progress" aria-label="Document processing progress" {...(progress !== null ? { value: progress, max: 100 } : {})} />}
          {method==='huntington_background'&&previewed.size>0&&<HuntingtonReview key={job.id} job={job} results={results} page={page} revision={revision} preview={huntingtonPreview} busy={busy} request={request} waitForJob={waitForJob} begin={begin} end={()=>setBusy(false)} onPage={setPage} update={state=>{setJob(previous=>({...previous,...state}));setResults(state.results||[]);setRevision(value=>value+1);setSelected(new Set());setDownloaded(false);setMessage(state.message||'Review the updated text.');}}/>}
          {!!results.length && <Button className="open-review-button" disabled={busy} onClick={() => navigate('review')}>Review pages<ArrowRight size={16} /></Button>}
        </>}
        {view === 'review' && job && <PdfReview job={job} results={results} selected={selected} page={page} revision={revision} busy={busy} error={error} message={message} downloaded={downloaded} onPage={setPage} onToggle={togglePage} onSelectAll={() => setSelected(selected.size === job.count ? new Set() : new Set(Array.from({ length: job.count }, (_, index) => index)))} onDownload={download} onBack={() => navigate('workspace')} />}
      </main>
    </div>
    {pdfType && <PdfTypeDialog item={pdfType} selected={method === pdfType.id} onSelect={choosePreset} onClose={() => setPdfType(null)} />}
    {help && <HelpDialog onClose={() => setHelp(false)} />}
    {cleanupProgress && <CleanupProgress filename={job.name} {...cleanupProgress} onClose={() => {
      const complete = cleanupProgress.status === 'complete';
      setCleanupProgress(null);
      if (complete) { setPage(0); setView('review'); }
    }} />}
  </div>;
}

