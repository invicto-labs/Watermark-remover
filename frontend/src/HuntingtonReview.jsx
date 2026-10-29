import React, { useEffect, useRef, useState } from 'react';
import './HuntingtonReview.css';

function Crop({src, box, onSize}) {
  const ref=useRef(null);
  useEffect(()=>{
    let active=true;const im=new Image();
    im.onload=()=>{if(!active||!ref.current)return;const [x,y,xx,yy]=box,left=Math.max(0,x-20),top=Math.max(0,y-12),w=Math.min(im.width,xx+20)-left,h=Math.min(im.height,yy+12)-top;
      const canvas=ref.current;canvas.width=w*3;canvas.height=h*3;canvas.getContext('2d').drawImage(im,left,top,w,h,0,0,w*3,h*3);onSize?.([im.width,im.height]);};
    im.src=src;return()=>{active=false;};
  },[src,box]);
  return <canvas ref={ref} aria-label="Zoomed document detail"/>;
}

export default function HuntingtonReview({job,results,page,revision,preview,busy,request,waitForJob,begin,end,update,onPage}) {
  const [offset,setOffset]=useState(0),[target,setTarget]=useState(null),[size,setSize]=useState(null);
  const [text,setText]=useState(''),[method,setMethod]=useState('fit'),[font,setFont]=useState('serif');
  const [donorPage,setDonorPage]=useState(1),[donors,setDonors]=useState([]),[donor,setDonor]=useState(null);
  const [proposal,setProposal]=useState(null),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
  const items=results.flatMap(r=>(r.overlaps||[]).map(item=>({...item,page:r.page})));
  const result=results.find(r=>r.page===page)||preview;
  const ready=results.length>0&&!busy;
  useEffect(()=>{setTarget(null);setProposal(null);setConfirmed(false);setOffset(0);},[job.id,revision]);
  function invalidate(){setProposal(null);setConfirmed(false);}
  function select(item){if(busy)return;setTarget(item);setSize(null);setText('');setDonor(null);setDonors([]);setDonorPage(item.page+1);invalidate();onPage(item.page);setMessage('Enter the exact wording, preview the repair, and check every letter before applying.');}
  async function run(action){begin();try{await action();}catch(error){setMessage(error.message);}finally{end();}}
  async function restore(){if(!ready)return;await run(async()=>{setMessage('Finding exact scanned-word matches and collecting remaining overlaps...');await request(`/api/restore/${job.id}`,{});const state=await waitForJob('review');update(state);setMessage(state.message);});}
  async function find(){if(!target||busy)return;invalidate();await run(async()=>{const sourcePage=Number(donorPage)-1;const reply=await request(`/api/repair/${job.id}/find`,{page:target.page,donor_page:sourcePage,text});setDonors(reply.matches.map(match=>({...match,page:sourcePage})));setMessage(reply.matches.length?'Select an intact occurrence with matching lettering.':'No exact clean match on this page. Try another source page.');});}
  async function previewRepair(){if(!target||!size||busy)return;invalidate();await run(async()=>{
    if(method==='donor'&&!donor)throw Error('Find and select a clean scanned occurrence first.');
    const [x,y,xx,yy]=target.box,[w,h]=size;
    const reply=await request(`/api/repair/${job.id}/preview`,{page:target.page,rect:[Math.max(0,x-2)/w,Math.max(0,y-2)/h,Math.min(w,xx+2)/w,Math.min(h,yy+2)/h],text,method,font,darkness:90,donor_page:donor?.page,donor_rect:donor?.rect});
    setProposal(reply);setMessage(reply.message);
  });}
  async function apply(){if(!proposal||!confirmed||busy)return;await run(async()=>{update(await request(`/api/repair/${job.id}/apply`,{page:target.page,token:proposal.token,confirmed:true}));setMessage('Confirmed repair applied. Review the page before selecting it for export.');});}
  async function undo(){if(!ready)return;await run(async()=>{update(await request(`/api/repair/${job.id}/undo`,{page}));setMessage('Last confirmed word repair undone.');});}
  return <details className="huntington-panel" open>
    <summary>Huntington: cleanup steps and text review</summary><div className="hunt-body">
    <p>Clear the background, refine gaps beside text, then restore verified words. Repeated erasing stops when it would risk the lettering.</p>
    <ol>{(result?.steps||[]).map((step,i)=><li key={i}>Pass {step.iteration}: {step.stage==='background'?'background':'text-line gaps'} - {step.changed_pixels.toLocaleString()} pixels changed</li>)}</ol>
    {!!result?.steps?.length&&<p>These passes have converged. Marks merged with text may remain.</p>}
    <div className="hunt-actions"><button className="button button-secondary" disabled={!ready} onClick={restore}>Find matching words</button><button className="button button-secondary" disabled={!ready||!result?.repairs} onClick={undo}>Undo last word repair</button></div>
    <h3>Remaining words across all pages</h3><p>{items.length?`${offset+1}-${Math.min(items.length,offset+40)} of ${items.length} possible overlaps. OCR readings are unverified.`:'Clean all pages, then find matching words to collect the remaining overlaps.'}</p>
    <div className="hunt-list">{items.slice(offset,offset+40).map((item,i)=><button className="button button-secondary" key={`${item.page}-${i}`} disabled={busy} onClick={()=>select(item)}>Page {item.page+1}: {item.text}</button>)}</div>
    {!!items.length&&<div className="hunt-actions"><button className="button button-secondary" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-40))}>Previous 40</button><button className="button button-secondary" disabled={busy||offset+40>=items.length} onClick={()=>setOffset(offset+40)}>Next 40</button></div>}
    {target&&<section id="huntEditor"><h3>Page {target.page+1} - unverified reading: {target.text}</h3>
      <div className="hunt-pair"><figure><figcaption>Original</figcaption><Crop src={`/api/page/${job.id}/${target.page}/before?v=${revision}`} box={target.box} onSize={setSize}/></figure><figure><figcaption>Current cleanup</figcaption><Crop src={`/api/page/${job.id}/${target.page}/after?v=${revision}`} box={target.box}/></figure></div>
      <label>Exact wording <input maxLength={80} value={text} disabled={busy} placeholder="Confirm every word and number" onChange={e=>{setText(e.target.value);setDonor(null);setDonors([]);invalidate();}}/></label>
      <label>Repair method <select disabled={busy} value={method} onChange={e=>{setMethod(e.target.value);invalidate();}}><option value="fit">Fit confirmed text to surviving letters</option><option value="donor">Copy an intact scanned occurrence</option><option value="text">Render confirmed text</option></select></label>
      {method==='text'&&<label>Font <select disabled={busy} value={font} onChange={e=>{setFont(e.target.value);invalidate();}}><option value="serif">Serif</option><option value="serif-bold">Serif bold</option><option value="sans">Sans serif</option><option value="sans-bold">Sans serif bold</option></select></label>}
      <div className="hunt-actions"><label>Clean source page <input disabled={busy} type="number" min={1} max={job.count} value={donorPage} onChange={e=>setDonorPage(e.target.value)}/></label><button className="button button-secondary" disabled={busy||!text.trim()} onClick={find}>Find clean occurrence</button></div>
      <div id="huntDonors" className="hunt-list">{donors.map((match,i)=><button className="button button-secondary" disabled={busy} key={i} onClick={()=>{setDonor({rect:match.rect,page:match.page});setMethod('donor');invalidate();setMessage('Clean occurrence selected. Preview the repair.');}}><img src={match.image} alt={`Clean occurrence ${i+1}`}/></button>)}</div>
      <button className="button button-secondary" disabled={busy||!size||!text.trim()} onClick={previewRepair}>Preview this repair</button>
      {proposal&&<div><div className="hunt-pair"><figure><figcaption>Before repair</figcaption><img src={proposal.before} alt="Before word repair"/></figure><figure><figcaption>Proposed repair</figcaption><img src={proposal.after} alt="Proposed word repair"/></figure></div>
        <label className="hunt-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm the exact wording and the preview.</label><button className="button button-primary" disabled={busy||!confirmed} onClick={apply}>Apply confirmed repair</button></div>}
    </section>}
    <p role="status">{message}</p>
    </div>
  </details>;
}
