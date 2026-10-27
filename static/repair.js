'use strict';
let targetRect=null, donorRect=null, repairToken=null, selecting=null, selectionStart=null, repairPage=-1;
const targetCanvas=document.createElement('canvas'), donorCanvas=document.createElement('canvas');
targetCanvas.id='targetCanvas';donorCanvas.id='donorCanvas';
targetCanvas.setAttribute('aria-label','Select damaged word in cleaned page');
donorCanvas.setAttribute('aria-label','Select clean word on source page');
$('after').parentElement.append(targetCanvas);$('originalPaper').append(donorCanvas);
function clearRepairPreview(){repairToken=null;$('repairPreview').hidden=true;$('confirmRepair').checked=false;$('applyRepair').disabled=true;}
function repairReady(){return job&&!['overlay','polarity'].includes($('method').value)&&!['overlay','polarity'].includes((job.options||{}).method)&&['review','done'].includes(job.state)&&results.length===job.count;}
function syncRepair(){
 const ready=repairReady(); if(typeof syncAutomatic==='function')syncAutomatic(ready);
 for(const id of ['selectTarget','selectDonor','findWord','readWord','previewRepair','repairText','repairMethod','donorPage','repairFont','repairDarkness'])$(id).disabled=busy||!ready;
 $('undoRepair').disabled=busy||!ready||!(results.find(r=>r.page===page)?.repairs);
 $('applyRepair').disabled=busy||!ready||!repairToken||!$('confirmRepair').checked;
 $('repairLog').hidden=!ready;if(job)$('repairLog').href=`/api/repair/${job.id}/history`;
 if(!ready)$('repairHelp').textContent='Process all pages first, then select a damaged word in the cleaned preview.';
 else if(!targetRect)$('repairHelp').textContent='Select a damaged word in the cleaned preview. Include all letter strokes and a small margin, without touching neighbouring words.';
 targetCanvas.style.pointerEvents=!busy&&selecting==='target'?'auto':'none';
 donorCanvas.style.pointerEvents=!busy&&selecting==='donor'?'auto':'none';
 $('brushCanvas').style.pointerEvents=!busy&&!selecting&&!$('wordRepair').open&&$('method').value==='manual'?'auto':'none';
}
function repairPageLoaded(){
 selecting=null;selectionStart=null;targetRect=null;donorRect=null;repairPage=page;clearRepairPreview();
 $('donorHelp').textContent='Choose a clean occurrence on the source page, or find an exact match with Windows OCR.'; $('donorPage').value=page+1;$('donorPage').max=job.count;$('donorMatches').replaceChildren();
 drawSelection(targetCanvas,null);drawSelection(donorCanvas,null);syncRepair();if(typeof renderOverlaps==='function')renderOverlaps();
}
function drawSelection(canvas,rect){
 canvas.width=canvas===targetCanvas?$('after').naturalWidth:$('before').naturalWidth;
 canvas.height=canvas===targetCanvas?$('after').naturalHeight:$('before').naturalHeight;
 if(!canvas.width||!canvas.height){canvas.width=$('before').naturalWidth;canvas.height=$('before').naturalHeight;}
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 if(rect){const [x,y,xx,yy]=rect;ctx.fillStyle='rgba(21,132,104,.15)';ctx.strokeStyle='#008467';ctx.lineWidth=2;ctx.fillRect(x*canvas.width,y*canvas.height,(xx-x)*canvas.width,(yy-y)*canvas.height);ctx.strokeRect(x*canvas.width,y*canvas.height,(xx-x)*canvas.width,(yy-y)*canvas.height);}
}
function selectionPoint(e,canvas){const b=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))];}
for(const [canvas,kind] of [[targetCanvas,'target'],[donorCanvas,'donor']]){
 canvas.onpointerdown=e=>{if(busy||selecting!==kind)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);selectionStart=selectionPoint(e,canvas);clearRepairPreview();};
 canvas.onpointermove=e=>{if(!selectionStart||selecting!==kind)return;const p=selectionPoint(e,canvas);const rect=[Math.min(p[0],selectionStart[0]),Math.min(p[1],selectionStart[1]),Math.max(p[0],selectionStart[0]),Math.max(p[1],selectionStart[1])];if(kind==='target')targetRect=rect;else donorRect=rect;drawSelection(canvas,rect);};
 canvas.onpointerup=e=>{if(!selectionStart)return;canvas.onpointermove(e);selectionStart=null;selecting=null;syncRepair();$(kind==='target'?'repairHelp':'donorHelp').textContent=kind==='target'?'Damaged word selected. Confirm its exact wording, choose a reconstruction method, and preview.':'Clean source occurrence selected. Check that it is the same word and style, then preview.';};
 canvas.onpointercancel=()=>{selectionStart=null;selecting=null;syncRepair();};
}
$('after').addEventListener('load',()=>drawSelection(targetCanvas,targetRect));
$('selectTarget').onclick=()=>{if(!repairReady()||busy)return;$('showMask').checked=false;$('after').src=imageURL('after');selecting='target';syncRepair();$('repairHelp').textContent='Drag a tight rectangle around the damaged word on the right. Zoom 100% helps with precise edges.';$('previewGrid').scrollIntoView({block:'center',behavior:'smooth'});};
async function donorImage(){const p=Number($('donorPage').value)-1;if(!Number.isInteger(p)||p<0||p>=job.count)throw Error('Choose a valid source page.');await new Promise((resolve,reject)=>{ $('before').onload=resolve;$('before').onerror=()=>reject(Error('Could not load source page.'));$('before').src=`/api/page/${job.id}/${p}/before?v=${revision}`;});$('paintLabel').textContent=`WORD SOURCE · PAGE ${p+1}`;$('originalPaper').style.setProperty('--natural-width',$('before').naturalWidth+'px');$('brushCanvas').getContext('2d').clearRect(0,0,$('brushCanvas').width,$('brushCanvas').height);drawSelection(donorCanvas,donorRect);}
$('selectDonor').onclick=async()=>{if(busy)return;try{await donorImage();selecting='donor';syncRepair();$('donorHelp').textContent='Drag around the intact word on the left, using the same small margin as the damaged word.';$('previewGrid').scrollIntoView({block:'center',behavior:'smooth'});}catch(e){notice(e.message,true);}};
$('repairMethod').onchange=()=>{clearRepairPreview();$('donorTools').hidden=$('repairMethod').value!=='donor';$('fontTools').hidden=$('repairMethod').value!=='text';$('previewRepair').textContent=$('repairMethod').value==='lama'?'Preview LaMa reconstruction':'Preview word repair';};
for(const id of ['repairText','repairFont','repairDarkness'])$(id).addEventListener('input',clearRepairPreview);
$('donorPage').onchange=()=>{donorRect=null;clearRepairPreview();$('donorMatches').replaceChildren();drawSelection(donorCanvas,null);};
$('findWord').onclick=async()=>{if(busy)return;setBusy(true);clearRepairPreview();$('donorHelp').textContent='Looking for exact matches with Windows OCR…';try{
 const data=await api(`/api/repair/${job.id}/find`,{page,donor_page:Number($('donorPage').value)-1,text:$('repairText').value});
 $('donorMatches').replaceChildren();$('donorHelp').textContent=data.matches.length?'Choose an intact occurrence below. OCR matches still need a visual check.':'No clear exact match found. Try another source page, select a clean word manually, or render confirmed text.';
 for(const [i,match] of data.matches.entries()){const b=document.createElement('button');b.className='donor-match';b.title=`Use matching occurrence ${i+1}`;const im=document.createElement('img');im.src=match.image;im.alt=`Matching occurrence ${i+1}`;b.append(im);b.onclick=async()=>{if(busy)return;donorRect=match.rect;clearRepairPreview();for(const el of $('donorMatches').children)el.classList.toggle('selected',el===b);try{await donorImage();$('donorHelp').textContent='Matching occurrence selected. Preview it in the damaged word’s position.';}catch(e){notice(e.message,true);}};$('donorMatches').append(b);}
 }catch(e){notice(e.message,true);$('donorHelp').textContent=e.message;}finally{setBusy(false);}};
$('previewRepair').onclick=async()=>{if(busy)return;if(!targetRect)return notice('Select the damaged word on the cleaned page first.',true);setBusy(true);clearRepairPreview();try{const data=await api(`/api/repair/${job.id}/preview`,{page,rect:targetRect,text:$('repairText').value,method:$('repairMethod').value,font:$('repairFont').value,darkness:Number($('repairDarkness').value),donor_rect:donorRect,donor_page:Number($('donorPage').value)-1});repairToken=data.token;$('repairBefore').src=data.before;$('repairAfter').src=data.after;$('repairMessage').textContent=data.message;$('repairPreview').hidden=false;$('repairPreview').scrollIntoView({block:'nearest',behavior:'smooth'});}catch(e){notice(e.message,true);}finally{setBusy(false);}};
$('readWord').onclick=async()=>{if(busy)return;if(!targetRect)return notice('Select a damaged word first.',true);setBusy(true);try{
 const data=await api(`/api/repair/${job.id}/read`,{page,rect:targetRect});
 $('repairHelp').textContent=`Offline OCR reads original: “${data.original.text||'(unreadable)'}”; cleaned: “${data.cleaned.text||'(unreadable)'}”. These are unverified readings. Enter the exact wording after checking the original or a reliable copy.`;
 }catch(e){notice(e.message,true);}finally{setBusy(false);}};
$('confirmRepair').onchange=syncRepair;
async function acceptedRepair(state){job=state;results=state.results; $('reviewSummary').textContent=`${results.filter(r=>r.changed>0).length} changed pages · ${results.reduce((n,r)=>n+(r.repairs||0),0)} confirmed word repairs · ${results.filter(r=>!r.changed).length} unchanged`; $('statusText').textContent=state.message;revision++;previewed.add(page);keep.add(page);clearRepairPreview();changedReview();await loadPage();syncRepair();}
$('applyRepair').onclick=async()=>{if(busy||!repairToken)return;setBusy(true);try{await acceptedRepair(await api(`/api/repair/${job.id}/apply`,{page,token:repairToken,confirmed:$('confirmRepair').checked}));notice('Word repair applied. Build the complete PDF to save it.');}catch(e){notice(e.message,true);}finally{setBusy(false);}};
$('undoRepair').onclick=async()=>{if(busy)return;setBusy(true);try{await acceptedRepair(await api(`/api/repair/${job.id}/undo`,{page}));notice('Last word repair undone.');}catch(e){notice(e.message,true);}finally{setBusy(false);}};
syncRepair();

$('wordRepair').ontoggle=()=>{if($('wordRepair').open){$('brushCanvas').getContext('2d').clearRect(0,0,$('brushCanvas').width,$('brushCanvas').height);syncRepair();}else if(job)loadPage();};

$('repairText').addEventListener('input',()=>{donorRect=null;$('donorMatches').replaceChildren();drawSelection(donorCanvas,null);});

function syncAutomatic(ready){
 $('automaticPanel').hidden=!ready;
 $('restoreNow').disabled=busy||!ready;
 const count=results.reduce((n,r)=>n+(r.automatic||0),0);
 const fits=results.reduce((n,r)=>n+(r.fitted_words||0),0);
 const flecks=results.reduce((n,r)=>n+(r.background_pixels||0),0);$('clearAutomatic').disabled=busy||!ready||(!count&&!flecks);
 $('automaticSummary').textContent=(count||flecks)?`${count-fits} scanned word matches and ${fits} OCR-checked font fits; ${flecks.toLocaleString()} background pixels cleaned. Inspect all repaired words and remaining overlaps before saving.`:'Find intact words, cross-check original text with offline OCR, and fit missing letters to surviving ink. Names, numbers and uncertain readings remain for review.';
}
function renderOverlaps(){
 const container=$('overlapList');container.replaceChildren();
 const items=results.find(r=>r.page===page)?.overlaps||[];
 $('overlapReview').hidden=!items.length;
 for(const item of items){
  const button=document.createElement('button');button.className='small';button.textContent=item.suggested_text?`${item.text} → ${item.suggested_text}`:item.text;button.disabled=busy;
  button.title='Inspect this OCR reading; wording is not verified';
  button.onclick=async()=>{if(busy)return;const w=$('after').naturalWidth,h=$('after').naturalHeight;
   const [x,y,xx,yy]=item.box;targetRect=[Math.max(0,x-2)/w,Math.max(0,y-2)/h,Math.min(w,xx+2)/w,Math.min(h,yy+2)/h];
   donorRect=null;clearRepairPreview();$('repairText').value='';$('repairText').placeholder='Confirm the wording before repair';
   $('wordRepair').open=true;$('showMask').checked=false;$('after').src=imageURL('after');drawSelection(targetCanvas,targetRect);
   $('repairHelp').textContent=`Selected overlap. OCR reading: “${item.text}”. Check the original or a reliable copy, then enter the exact wording.`;
   if(item.suggested_method==='fit'){
    $('repairText').value=item.suggested_text;$('repairMethod').value='fit';$('repairMethod').onchange();
    $('repairHelp').textContent=`OCR readings disagree. Suggested reading: “${item.suggested_text}”. Check the wording against the original, then preview a font fit.`;
   }else if(item.suggested_text){
    $('repairText').value=item.suggested_text;donorRect=item.donor_rect;$('donorPage').value=item.donor_page+1;
    $('repairMethod').value='donor';$('donorTools').hidden=false;$('fontTools').hidden=true;
    $('repairHelp').textContent=`OCR read “${item.text}”. Suggested match: “${item.suggested_text}”. This may change wording. Preview and verify it against the original before applying.`;
    try{await donorImage();}catch(e){notice(e.message,true);}
   }
   $('wordRepair').scrollIntoView({block:'start',behavior:'smooth'});
  };container.append(button);
 }
}
async function runRestoration(clear){
 if(!job||busy)return;setBusy(true);clearRepairPreview();
 try{job=await api(`/api/restore/${job.id}`,{clear});sessionStorage.setItem('dirty-'+job.id,'yes');$('download').hidden=true;$('export').hidden=false;$('progressBox').hidden=false;$('cancel').hidden=false;poll();}
 catch(e){notice(e.message,true);setBusy(false);}
}
$('restoreNow').onclick=()=>runRestoration(false);
$('clearAutomatic').onclick=()=>runRestoration(true);
