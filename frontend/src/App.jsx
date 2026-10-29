import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, FileCheck2, FileText, Files, FolderOpen, Layers3, LoaderCircle, LockKeyhole, Maximize2, Plus, ScanLine, ShieldCheck, Sparkles, Upload, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import './styles.css';
import HuntingtonReview from './HuntingtonReview';
import CleanupProgress from './CleanupProgress';

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

export default function App() {
  const [view, setView] = useState('upload');
  const [job, setJob] = useState(null);
  const [method, setMethod] = useState('dotted_document');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
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
  const stage = job && view === 'workspace' ? (results.length ? 2 : 1) : 0;

  useEffect(() => {
    const handleKey = event => { if (event.key === 'Escape') { if (help) setHelp(false); else if (!busy && view !== 'upload') setView('upload'); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [help, busy, view]);
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

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand-link" href="/" onClick={event => { event.preventDefault(); navigate('upload'); }} aria-label="ClearPage home"><Brand /></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation" className="main-nav">
        <button disabled={busy} className={view === 'upload' || view === 'workspace' ? 'nav-item active' : 'nav-item'} onClick={() => navigate(job ? 'workspace' : 'upload')}><WandSparkles size={19} />PDF cleanup<span className="nav-active-dot" /></button>
        <button disabled={busy} className={view === 'documents' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('documents')}><Files size={19} />My document{job && <span className="nav-count">1</span>}</button>
      </nav>
      <div className="sidebar-tip"><span className="tip-icon"><Sparkles size={20} /></span><h3>A fresh start for your files.</h3><p>A little less noise.<br />A lot more clarity.</p><span className="tip-line" /></div>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-indicator" /><div><strong>Private by design</strong><span>Processed on your computer</span></div><LockKeyhole size={15} /></div><button className="nav-item help-link" onClick={() => setHelp(true)}><CircleHelp size={18} />Help & quick guide<ArrowRight size={15} /></button><div className="sidebar-footer">MADE FOR A CLEARER VIEW <span>↗</span></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{view === 'documents' ? 'My document' : 'PDF cleanup'}</strong></div><div className="topbar-right"><span className="local-pill"><span />Local workspace</span><span className="avatar" aria-label="Personal workspace">CP</span></div></header>
      <main className={view === 'workspace' ? 'main-content workspace-content' : 'main-content'}>
        {view !== 'documents' && <div className="stepper" aria-label="Cleanup progress">{steps.map((label, index) => <React.Fragment key={label}>{index > 0 && <span className={`step-line ${stage >= index ? 'complete' : ''}`} />}<span className={`step ${stage === index ? 'current' : stage > index ? 'done' : ''}`} aria-current={stage === index ? 'step' : undefined}><b>{stage > index ? <Check size={12} /> : `0${index + 1}`}</b><span>{label}</span></span></React.Fragment>)}</div>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" aria-label="Choose a PDF" className="sr-only" disabled={busy} onChange={event => upload(event.target.files?.[0])} />

        {view === 'upload' && <>
          <div className="page-heading"><div><span className="eyebrow"><span />A CLEAN SLATE STARTS HERE</span><h1 ref={titleRef} tabIndex={-1}>Your document.<br /><span>Just a little clearer.</span></h1><p>Remove the distractions. Keep what matters.<br className="mobile-break" /> Give your PDFs a fresh start, right on your computer.</p></div><div className="heading-badge"><ShieldCheck size={15} />100% local. Always private.</div></div>
          <div className="upload-layout"><section className="upload-card"><div className="card-topline"><span><Upload size={16} />ADD YOUR DOCUMENT</span><span className="file-type">.PDF</span></div>
            <button disabled={busy} className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length > 1) setError('Please add one PDF at a time.'); else upload(event.dataTransfer.files[0]); }}>
              <span className="upload-art"><span className="upload-art-back" /><span className="upload-art-front"><FileText size={37} strokeWidth={1.1} /></span><span className="upload-art-plus"><Plus size={16} /></span></span>
              <h2>{busy ? 'Opening your document…' : dragging ? 'Drop it here. We’ve got it.' : 'Good things start with a drop.'}</h2><p>Drag your PDF here, or browse to upload</p><span className="button button-primary">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={17} />}Choose a PDF<ArrowRight size={16} /></span><small>PDF files only <span>·</span> Up to 150 MB</small>
            </button><div className="upload-card-footer"><LockKeyhole size={14} /><span>Your files stay yours. Your original stays untouched.</span></div>
          </section>
          </div>
          {(error || busy) && <div role={error ? 'alert' : 'status'} className={`status-banner ${error ? 'error' : ''}`}>{busy && <LoaderCircle size={17} className="animate-spin" />}{error || message}</div>}
          <section className="preset-section"><div className="section-heading"><div><span className="eyebrow">A LITTLE HELP, BUILT IN</span><h2>Different documents. The right cleanup.</h2></div><button className="text-button" onClick={() => setHelp(true)}>How it works<ArrowRight size={15} /></button></div><div className="preset-highlights">{[
            [ScanLine, 'Scanned documents', 'Soften the noise, bring back the detail.', 'dotted_document'],
            [Layers3, 'Watermarks & overlays', 'Clear supported text and website marks.', 'overlay'],
            [FileCheck2, 'A finish you control', 'Preview, compare, and choose what stays.', null],
          ].map(([Icon, title, description, id]) => <button key={title} className={`feature-card ${method === id ? 'chosen' : ''}`} onClick={() => id ? choosePreset(id) : setHelp(true)}><span className="feature-icon"><Icon size={21} strokeWidth={1.5} /></span><div><h3>{title}</h3><p>{description}</p></div><ArrowRight size={16} /></button>)}</div></section>
          {job && <div className="resume-bar"><FileText size={18} /><span>Your document <strong>{job.name}</strong> is still open.</span><button className="text-button" onClick={() => navigate('workspace')}>Continue editing<ArrowRight size={16} /></button></div>}
          <footer className="main-footer"><span><ShieldCheck size={14} />Thoughtful cleanup. No cloud required.</span><span>ClearPage <span className="footer-divider">/</span> A clearer view.</span></footer>
        </>}

        {view === 'documents' && <><div className="page-heading document-heading"><div><span className="eyebrow">YOUR CURRENT SESSION</span><h1 ref={titleRef} tabIndex={-1}>My document<span>.</span></h1><p>Your open PDF, ready when you are. Files are kept only for this local session.</p></div><Button onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={17} />Add a PDF</Button></div>{job ? <button className="document-row" onClick={() => navigate('workspace')}><span className="document-icon"><FileText size={27} /></span><div><h2>{job.name}</h2><p>{job.count} pages · {(job.size / 1024 / 1024).toFixed(1)} MB · {results.length ? 'Ready for review' : 'Ready to clean'}</p></div><span className="text-button">Open document<ArrowRight size={17} /></span></button> : <div className="empty-state"><FolderOpen size={43} strokeWidth={1} /><h2>A little room for clarity.</h2><p>Add your first PDF to get started.</p><Button onClick={() => fileRef.current?.click()}><Plus size={17} />Choose a PDF</Button></div>}{error && <div role="alert" className="status-banner error">{error}</div>}</>}

        {view === 'workspace' && job && <>
          <div className="editor-heading"><div><button className="text-button back-button" disabled={busy} onClick={() => navigate('upload')}><ArrowLeft size={14} />Back to upload</button><h1 ref={titleRef} tabIndex={-1}>{job.name}</h1><p>{job.count} {job.count === 1 ? 'page' : 'pages'}<span>·</span>{(job.size / 1024 / 1024).toFixed(1)} MB<span>·</span><LockKeyhole size={12} />Local document</p></div><Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}><Plus size={16} />New PDF</Button></div>
          <div className="editor-layout"><section className="document-viewer" aria-label="Document preview"><div className="viewer-toolbar"><span><span className="live-dot" />{comparing ? 'Compare your result' : 'Original document'}</span><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => value - 25)}><ZoomOut size={16} /></button><span>{zoom}%</span><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => setZoom(value => value + 25)}><ZoomIn size={16} /></button><button className="icon-button" aria-label="Reset zoom" onClick={() => setZoom(100)}><Maximize2 size={15} /></button></div></div>
            <div className={`page-canvas ${comparing ? 'comparing' : ''} zoom-${zoom}`}>
              <figure><figcaption>Original<span>Unchanged</span></figcaption><div className="page-image"><img src={`/api/page/${job.id}/${page}/before?v=${revision}`} alt={`Original document page ${page + 1}`} onError={() => setPreviewError(true)} /></div></figure>
              {comparing && <figure><figcaption>Cleaned<span><Check size={11} />Preview</span></figcaption><div className="page-image"><img src={`/api/page/${job.id}/${page}/after?v=${revision}`} alt={`Cleaned document page ${page + 1}`} onError={() => setPreviewError(true)} /></div></figure>}
            </div>
            {previewError && <div role="alert" className="status-banner error">Could not load the page preview.<button className="text-button" onClick={() => { setPreviewError(false); setRevision(value => value + 1); }}>Retry</button></div>}
            <div className="page-navigation"><button className="icon-button" aria-label="Previous page" disabled={busy || page === 0} onClick={() => { setPage(value => value - 1); setPreviewError(false); }}><ChevronLeft size={17} /></button><label>Page <select aria-label="Preview page" value={page} disabled={busy} onChange={event => { setPage(Number(event.target.value)); setPreviewError(false); }}>{Array.from({ length: job.count }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select> of {job.count}</label><button className="icon-button" aria-label="Next page" disabled={busy || page === job.count - 1} onClick={() => { setPage(value => value + 1); setPreviewError(false); }}><ChevronRight size={17} /></button></div>
          </section>
          <aside className="cleanup-panel" aria-label="Cleanup settings"><div className="panel-title"><span className="feature-icon"><WandSparkles size={20} /></span><div><h2>{results.length ? 'Ready for a closer look.' : 'Make room for clarity.'}</h2><p>{results.length ? 'Your pages. Your final say.' : 'Find the right fit for your PDF.'}</p></div></div>
            <fieldset disabled={busy} className="preset-fieldset"><legend>Choose a cleanup preset</legend><p>Pick the example closest to your document.</p><div className="preset-options">{presets.map(item => <label key={item.id} className={`preset-option ${method === item.id ? 'selected' : ''}`}><input type="radio" name="preset" value={item.id} checked={method === item.id} onChange={() => choosePreset(item.id)} /><img src={`/static/type-${item.image}.${item.image === 'polarity' ? 'svg' : 'webp'}`} alt="" /><span><strong>{item.title}</strong><small>{item.description}</small></span><span className="radio-indicator">{method === item.id && <Check size={11} />}</span></label>)}</div></fieldset>
            <div className="panel-actions"><Button variant="secondary" onClick={preview} disabled={busy}><ScanLine size={16} />Preview first page</Button><Button onClick={cleanAll} disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <WandSparkles size={16} />}Clean all {job.count} {job.count === 1 ? 'page' : 'pages'}<ArrowRight size={16} /></Button><span className="panel-footnote"><ShieldCheck size={13} />Your original is always preserved.</span></div>
          </aside></div>
          <div aria-live="polite" role={error ? 'alert' : 'status'} className={`status-banner ${error ? 'error' : ''}`}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{error || message}</span>{busy && progress !== null && <span className="progress-value">{progress}%</span>}</div>
          {busy && <progress className="work-progress" aria-label="Document processing progress" {...(progress !== null ? { value: progress, max: 100 } : {})} />}
          {method==='huntington_background'&&previewed.size>0&&<HuntingtonReview key={job.id} job={job} results={results} page={page} revision={revision} preview={huntingtonPreview} busy={busy} request={request} waitForJob={waitForJob} begin={begin} end={()=>setBusy(false)} onPage={setPage} update={state=>{setJob(previous=>({...previous,...state}));setResults(state.results||[]);setRevision(value=>value+1);setSelected(new Set());setDownloaded(false);setMessage(state.message||'Review the updated text.');}}/>}
          {!!results.length && <section className="review-section"><div className="section-heading"><div><span className="eyebrow">THE FINISHING TOUCH</span><h2>Choose what makes the cut.</h2><p>Selected pages use the cleaned version. Unchecked pages keep the original.</p></div><Button variant="secondary" disabled={busy} onClick={() => setSelected(selected.size === job.count ? new Set() : new Set(Array.from({ length: job.count }, (_, index) => index)))}><CheckCheck size={16} />{selected.size === job.count ? 'Clear selection' : 'Select all pages'}</Button></div>
            <div className="review-grid">{Array.from({ length: job.count }, (_, index) => { const result = results.find(item => item.page === index); return <div key={index} className={`review-card ${selected.has(index) ? 'is-selected' : ''}`}><label><input type="checkbox" aria-label={`Use cleaned page ${index + 1}`} checked={selected.has(index)} disabled={busy} onChange={() => togglePage(index)} /><span className="review-check">{selected.has(index) && <Check size={12} />}</span><div className="review-thumbnail"><img loading="lazy" src={`/api/page/${job.id}/${index}/after?v=${revision}`} alt={`Cleaned page ${index + 1} thumbnail`} onError={event => { event.currentTarget.hidden = true; }} /><span>Page {index + 1}</span></div><div className="review-caption"><strong>Page {index + 1}</strong><small className={result?.uncertain ? 'needs-review' : ''}>{result?.changed ? result.uncertain ? 'Review carefully' : 'Cleaned' : 'Unchanged'}</small></div></label><button className="review-inspect" disabled={busy} onClick={() => { setPage(index); setPreviewError(false); document.querySelector('.document-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Compare page<ArrowRight size={12} /></button></div>; })}</div>
            <div className="export-bar"><div><span className="check-circle"><Check size={15} /></span><div><strong>{selected.size} of {job.count} cleaned pages selected</strong><p>All {job.count} pages stay in your PDF.</p></div></div><Button onClick={download} disabled={busy}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : downloaded ? <Check size={17} /> : <ArrowDownToLine size={17} />}{downloaded ? 'Download again' : 'Download PDF'}</Button></div>
          </section>}
        </>}
      </main>
    </div>
    {help && <HelpDialog onClose={() => setHelp(false)} />}
    {cleanupProgress && <CleanupProgress filename={job.name} {...cleanupProgress} onClose={() => {
      const complete = cleanupProgress.status === 'complete';
      setCleanupProgress(null);
      if (complete) requestAnimationFrame(() => document.querySelector('.review-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }} />}
  </div>;
}

