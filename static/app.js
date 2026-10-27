'use strict';
history.replaceState(null, '', '/');
const $ = id => document.getElementById(id);
let job = null, page = 0, strokes = [], activeStroke = null, erasing = false, busy = false;
let keep = new Set(), results = [], previewed = new Set(), polling = null, revision = 0;
let noticeTimer, loadingPage = 0;
function notice(message, error=false) { if(!$('notice'))return; $('notice').textContent=message; $('notice').classList.toggle('error',error); $('notice').hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>{if($('notice'))$('notice').hidden=true;},8000); }
async function api(path, body, raw=false) {
 const options=body===undefined?{}:{method:'POST',headers:{'X-ClearPage':'local'},body:raw?body:JSON.stringify(body)};
 if(body!==undefined&&!raw) options.headers['Content-Type']='application/json';
 const response=await fetch(path,options); const data=await response.json();
 if(!response.ok) throw Error(data.error||'The operation could not be completed.'); return data;
}
function setBusy(value) { busy=value; for(const id of ['method','mode','preview','process','reset','erase','undo','clearBrush','brushSize','export','allOriginal','allCleaned','previous','next','pageNumber','useReviewed','importReviewed','autoRestore','scanInversion','restoreNow','clearAutomatic']) $(id).disabled=value; if(!value&&job){$('previous').disabled=page===0;$('next').disabled=page===job.count-1;} $('brushCanvas').style.pointerEvents=value?'none':($('method').value==='manual'?'auto':'none'); syncOverlayControls(); syncSimpleView(); if(typeof syncRepair==='function')syncRepair(); }
function syncOverlayControls() {
 const overlay=$('method').value==='overlay';
 for(const id of ['mode','useReviewed','importReviewed','autoRestore','scanInversion'])$(id).disabled=busy||overlay;
 $('aiHelp').hidden=overlay||$('mode').value!=='lama';
 $('wordRepair').hidden=overlay;$('repairTools').hidden=overlay;
 if(overlay){$('modeHelp').textContent='Original scan data is preserved. No pixel reconstruction or word replacement is applied.';$('methodHelp').textContent='Removes recognized Cook County and OKCountyRecords overlays. Unknown layouts remain unchanged.';}
 else {$('modeHelp').textContent={lama:'Local LaMa AI reconstructs selected watermark pixels. Review generated letters before export.',careful:'Preserves detected text lines and connected strokes. Some watermark fragments may remain.',light:'Only cleans lighter pixels, preserving dark strokes and nearby edges.'}[$('mode').value]||'';}
}
function options() { return {method:$('method').value,mode:$('mode').value,strokes,page,use_reviewed:$('useReviewed').checked,auto_restore:$('autoRestore').checked,scan_inversion:$('scanInversion').checked}; }
function invalidate() { if(!job)return; sessionStorage.removeItem('keep-'+job.id); revision++; previewed.clear(); results=[]; keep.clear(); $('review').hidden=true; $('keepLabel').hidden=true; $('download').hidden=true; $('export').hidden=false; $('previewState').textContent='SETTINGS CHANGED'; $('pageResult').textContent='Preview again to see these settings.'; loadPage(); }
async function upload(file) {
 if(!file||busy)return;
 if(file.size>150*1024*1024) return notice('Maximum PDF size is 150 MB.',true);
 if(!file.name.toLowerCase().endsWith('.pdf')) return notice('Choose a PDF file.',true);
 setBusy(true); $('dropzone').querySelector('strong').textContent='Opening your PDF…';
 try {
  const response=await fetch('/api/upload',{method:'POST',headers:{'X-ClearPage':'local','X-Filename':encodeURIComponent(file.name),'Content-Type':'application/pdf'},body:file});
  const data=await response.json(); if(!response.ok)throw Error(data.error);
  job=data; $('method').value=job.overlays?.some(r=>r.overlays)?'overlay':'preset'; $('method').onchange(); page=0; strokes=[]; previewed.clear(); results=[]; keep.clear();
  $('welcome').hidden=true; $('workspace').hidden=false; $('controls').hidden=false;
  $('step1').classList.remove('active'); $('step2').classList.add('active');
  $('filename').textContent=file.name; $('filemeta').textContent=`${job.count} pages · ${(file.size/1024/1024).toFixed(1)} MB · Original retained`;
  $('total').textContent=`of ${job.count}`; $('pageNumber').max=job.count;
  await loadPage();
 } catch(error) {notice(error.message,true);} finally {setBusy(false);$('dropzone').querySelector('strong').textContent='Choose a PDF';$('file').value='';}
}
function imageURL(kind) { return `/api/page/${job.id}/${page}/${kind}?v=${revision}`; }
async function loadPage() {
 if(!job)return; const current=++loadingPage; if(typeof repairPageLoaded==='function')repairPageLoaded(); $('paintLabel').textContent=$('method').value==='manual'?'PAINT THE WATERMARK':'SOURCE COPY';
 $('pageNumber').value=page+1; $('previous').disabled=page===0; $('next').disabled=page===job.count-1;
 const src=imageURL('before');
 await new Promise(resolve=>{ $('before').onload=resolve;$('before').onerror=()=>{notice('Could not load this page.',true);resolve();};$('before').src=src; });
 if(current!==loadingPage)return;
 $('after').src=imageURL(previewed.has(page)?($('showMask').checked?'mask':'after'):'before');
 $('previewState').textContent=previewed.has(page)?($('showMask').checked?'SELECTION OVERLAY':'PREVIEW READY'):'NOT PROCESSED';
 $('originalPaper').style.setProperty('--natural-width',$('before').naturalWidth+'px');
 $('after').parentElement.style.setProperty('--natural-width',$('before').naturalWidth+'px');
 draw(); updatePageResult(); renderPageList(); if(typeof syncRepair==='function')syncRepair();
}
function draw() {
 const c=$('brushCanvas');c.width=$('before').naturalWidth||1192;c.height=$('before').naturalHeight||1684;
 const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
 if($('method').value!=='manual')return;
 for(const stroke of [...strokes,...(activeStroke?[activeStroke]:[])]) {
  ctx.globalCompositeOperation=stroke.erase?'destination-out':'source-over';ctx.strokeStyle='#ed6e43';ctx.fillStyle='#ed6e43';ctx.lineWidth=stroke.width*c.width;ctx.lineCap='round';ctx.lineJoin='round';
  if(stroke.points.length===1){ctx.beginPath();ctx.arc(stroke.points[0][0]*c.width,stroke.points[0][1]*c.height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
  else{ctx.beginPath();stroke.points.forEach(([x,y],i)=>i?ctx.lineTo(x*c.width,y*c.height):ctx.moveTo(x*c.width,y*c.height));ctx.stroke();}
 }
 c.style.opacity='.42';
}
function point(event) {const rect=$('brushCanvas').getBoundingClientRect();return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];}
$('brushCanvas').addEventListener('pointerdown',event=>{if(busy)return;event.preventDefault();event.target.setPointerCapture(event.pointerId);activeStroke={points:[point(event)],width:Number($('brushSize').value)/100,erase:erasing};draw();});
$('brushCanvas').addEventListener('pointermove',event=>{if(!activeStroke)return;if(activeStroke.points.length<2999)activeStroke.points.push(point(event));draw();});
function endStroke(){if(activeStroke){strokes.push(activeStroke);activeStroke=null;invalidate();draw();}}
$('brushCanvas').addEventListener('pointerup',endStroke);$('brushCanvas').addEventListener('pointercancel',endStroke);
$('erase').onclick=()=>{erasing=!erasing;$('erase').textContent=`Eraser: ${erasing?'on':'off'}`;};
$('undo').onclick=()=>{strokes.pop();invalidate();draw();};$('clearBrush').onclick=()=>{strokes=[];invalidate();draw();};
$('brushSize').oninput=()=>$('brushValue').textContent=$('brushSize').value+'%';
$('method').onchange=()=>{const manual=$('method').value==='manual';if(manual)$('scanInversion').checked=false;$('brushTools').hidden=!manual;$('originalPaper').classList.toggle('painting',manual);$('paintLabel').textContent=manual?'PAINT THE WATERMARK':'SOURCE COPY';$('methodHelp').textContent=manual?'Select an area yourself. Best for marks on blank backgrounds.':'Detects the recurring “IMAGES/COPY PROPERTY…” mark. Pages without a confident match stay unchanged.';invalidate();setBusy(false);};
$('mode').onchange=()=>{const ai=$('mode').value==='lama';$('aiHelp').hidden=!ai;if(ai)$('scanInversion').checked=false;$('modeHelp').textContent={lama:'Local LaMa AI reconstructs selected watermark pixels. Review generated letters before export.',careful:'Preserves detected text lines and connected strokes. Some watermark fragments may remain.',light:'Only cleans lighter pixels, preserving dark strokes and nearby edges.',strong:'Replaces every selected pixel. This can erase words, numbers, or signatures inside the selection. Review closely.'}[$('mode').value];invalidate();};
$('preview').onclick=async()=>{if(!job||busy)return;setBusy(true);$('previewState').textContent='PROCESSING';try{const result=await api(`/api/preview/${job.id}`,options());revision++;results=[];keep.clear();$('review').hidden=true;previewed=new Set([page]);await loadPage();showResult(result);}catch(error){notice(error.message,true);}finally{setBusy(false);}};
function showTechnicalResult(result){if(!result)return;if(result.structural){$('pageResult').textContent=result.matched?`${result.providers.join(' / ')}: ${result.overlays} watermark overlays removed. Original scan data preserved; no words reconstructed.`:'No recognized website overlay on this page. Original page retained.';return;}$('pageResult').textContent=(result.inversion_note?`${result.inverted||0} pixels reverse-blended · ${result.inversion_note} `:'')+(result.automatic?`${result.automatic} automatically reconstructed words/phrases · `:'')+(result.repairs?`${result.repairs} confirmed word repairs · `:'')+(result.reviewed?'Exact source-page match: using your imported reviewed repairs.':!result.matched?(result.repairs?'Watermark cleanup left the source unchanged; confirmed word repairs are included.':'No confident watermark match. This page stays unchanged.'):`${result.uncertain?(result.ai?'AI RECONSTRUCTION: kept original by default. Check affected words before selecting this page. ':'UNCERTAIN PLACEMENT: kept original by default. Inspect the selected pixels before accepting. '):''}${result.changed.toLocaleString()} pixels cleaned · ${result.protected.toLocaleString()} selected pixels protected${result.confidence!==null?' · Watermark alignment '+Math.round(result.confidence*100)+'% (not text accuracy)':''}. Check any overlap with text.`);}
function updatePageResult(){const result=results.find(r=>r.page===page);$('keepLabel').hidden=!result;$('keepPage').checked=keep.has(page);$('keepPage').disabled=!result?.changed;showResult(result);}
$('process').onclick=async()=>{if(!job||busy)return;setBusy(true);try{job=await api(`/api/process/${job.id}`,options());sessionStorage.removeItem('keep-'+job.id);results=[];keep=new Set();$('review').hidden=true;$('keepLabel').hidden=true;$('progressBox').hidden=false;$('cancel').hidden=false;poll();}catch(error){notice(error.message,true);setBusy(false);}};
async function poll(){clearTimeout(polling);if(!job)return;try{const state=await api(`/api/job/${job.id}`);job=state;$('statusText').textContent=state.message;$('progress').value=state.progress;$('progress').max=state.count;
 if(['processing','exporting','learning','restoring'].includes(state.state)){polling=setTimeout(poll,650);return;}
 setBusy(false);$('cancel').hidden=true;
 if(state.state==='review'||state.state==='done'){
  results=state.results;previewed=new Set(results.map(r=>r.page));
  if(!keep.initialized){const saved=sessionStorage.getItem('keep-'+job.id);keep=new Set(saved?JSON.parse(saved):results.filter(r=>r.changed>0&&!r.uncertain).map(r=>r.page));keep.initialized=true;}
  revision++;$('review').hidden=false;$('step2').classList.remove('active');$('step3').classList.add('active');
  $('reviewSummary').textContent=`${results.filter(r=>r.changed>0).length} cleanup previews · ${results.filter(r=>r.structural&&r.matched).length} pages with website overlays removed · ${results.filter(r=>r.reviewed).length} reviewed matches · ${results.reduce((n,r)=>n+(r.automatic||0),0)} automatic word repairs · ${results.reduce((n,r)=>n+(r.inverted||0),0).toLocaleString()} PureScan pixels · ${results.filter(r=>r.uncertain).length} uncertain placements · ${results.filter(r=>!r.changed).length} unchanged`;
  const downloadable=state.state==='done'&&!sessionStorage.getItem('dirty-'+job.id);$('download').hidden=!downloadable;$('export').hidden=downloadable;$('download').href=`/api/download/${job.id}`;
  await loadPage();
 }else notice(state.message,state.state==='error');
 }catch(error){setBusy(false);notice(error.message,true);}}
function changedReview(){ sessionStorage.setItem('keep-'+job.id,JSON.stringify([...keep]));sessionStorage.setItem('dirty-'+job.id,'yes');$('download').hidden=true;$('export').hidden=false;updatePageResult();renderPageList(); }
function renderPageList(){syncSimpleView();const container=$('pageList');container.replaceChildren();for(const result of results){const chip=document.createElement('div');chip.className='page-chip'+(page===result.page?' current':'')+(!result.changed?' unchanged':'');const check=document.createElement('input');check.type='checkbox';check.checked=keep.has(result.page);check.disabled=!result.changed;check.setAttribute('aria-label',`Use cleaned page ${result.page+1}`);check.onchange=()=>{check.checked?keep.add(result.page):keep.delete(result.page);changedReview();};const button=document.createElement('button');button.textContent=String(result.page+1);button.title=result.changed?'Review cleaned page':'Original page retained';button.onclick=()=>{page=result.page;loadPage();};chip.append(check,button);container.append(chip);}}
$('keepPage').onchange=()=>{$('keepPage').checked?keep.add(page):keep.delete(page);changedReview();};
$('allOriginal').onclick=()=>{keep.clear();changedReview();};$('allCleaned').onclick=()=>{results.filter(r=>r.changed).forEach(r=>keep.add(r.page));changedReview();};
$('export').onclick=async()=>{setBusy(true);try{await api(`/api/export/${job.id}`,{keep:[...keep]});sessionStorage.removeItem('dirty-'+job.id);$('progressBox').hidden=false;$('cancel').hidden=false;poll();}catch(error){notice(error.message,true);setBusy(false);}};
$('cancel').onclick=async()=>{try{await api(`/api/cancel/${job.id}`,{});$('statusText').textContent='Stopping after the current operation…';}catch(error){notice(error.message,true);}};
$('reset').onclick=async()=>{if(!job||busy)return;try{await api(`/api/clear/${job.id}`,{});location.reload();}catch(error){notice(error.message,true);}};
$('quit').onclick=async()=>{try{await api('/api/quit',{});clearTimeout(polling);document.body.replaceChildren();const message=document.createElement('p');message.textContent='ClearPage is closed. You can close this browser tab.';document.body.append(message);}catch(error){notice(error.message,true);}};
$('previous').onclick=()=>{if(page>0){page--;loadPage();}};$('next').onclick=()=>{if(page<job.count-1){page++;loadPage();}};
$('pageNumber').onchange=()=>{page=Math.max(0,Math.min(job.count-1,(parseInt($('pageNumber').value,10)||1)-1));loadPage();};
$('showMask').onchange=loadPage;$('zoom').onclick=()=>{const on=$('previewGrid').classList.toggle('zoomed');$('zoom').textContent=on?'Fit to screen':'Zoom in';};
$('file').onchange=()=>upload($('file').files[0]);
for(const event of ['dragover','dragenter'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('drag'));
$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');upload(e.dataTransfer.files[0]);});
async function restoreSession(){
 try{
  const saved=await api('/api/session');if(!saved)return;job=saved;if(!job.options)$('method').value=job.overlays?.some(r=>r.overlays)?'overlay':'preset';
  $('welcome').hidden=true;$('workspace').hidden=false;$('controls').hidden=false;
  $('filename').textContent=job.name;$('filemeta').textContent=`${job.count} pages · ${(job.size/1024/1024).toFixed(1)} MB · Original retained`;
  $('total').textContent=`of ${job.count}`;$('pageNumber').max=job.count;
  $('step1').classList.remove('active');$('step2').classList.add('active');
  if(job.options){$('method').value=job.options.method;$('mode').value=job.options.mode==='strong'?'careful':job.options.mode;$('aiHelp').hidden=job.options.mode!=='lama';$('useReviewed').checked=job.options.use_reviewed!==false;$('autoRestore').checked=job.options.auto_restore!==false;$('scanInversion').checked=!!job.options.scan_inversion;strokes=job.options.strokes;const manual=job.options.method==='manual';$('brushTools').hidden=!manual;$('originalPaper').classList.toggle('painting',manual);$('paintLabel').textContent=manual?'PAINT THE WATERMARK':'SOURCE COPY';}
  if(job.options){$('modeHelp').textContent={lama:'Local LaMa AI reconstructs selected watermark pixels. Review generated letters before export.',careful:'Preserves detected text lines and connected strokes. Some watermark fragments may remain.',light:'Only cleans lighter pixels, preserving dark strokes and nearby edges.',strong:'Replaces every selected pixel. This can erase words, numbers, or signatures inside the selection. Review closely.'}[job.options.mode];if(job.options.method==='manual')$('methodHelp').textContent='Select an area yourself. Best for marks on blank backgrounds.';}
  if(['processing','exporting','learning','restoring','review','done'].includes(job.state)){$('progressBox').hidden=false;setBusy(true);poll();}else{setBusy(false);await loadPage();}
 }catch(error){notice(error.message,true);}
}
restoreSession();
$('useReviewed').onchange=invalidate;
$('importReviewed').onclick=()=>$('reviewedFile').click();
$('reviewedFile').onchange=async()=>{
 const file=$('reviewedFile').files[0];if(!file||!job||busy)return;
 if(file.size>150*1024*1024){notice('Maximum PDF size is 150 MB.',true);return;}
 setBusy(true);$('progressBox').hidden=false;$('statusText').textContent='Opening the reviewed copy…';
 try{await api('/api/reviewed/'+job.id,file,true);results=[];keep=new Set();previewed.clear();sessionStorage.removeItem('keep-'+job.id);$('review').hidden=true;$('keepLabel').hidden=true;$('cancel').hidden=false;poll();}catch(error){notice(error.message,true);setBusy(false);}finally{$('reviewedFile').value='';}
};
$('dropzone').tabIndex=0;$('dropzone').setAttribute('role','button');$('dropzone').setAttribute('aria-label','Open a PDF');
$('dropzone').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('file').click();}};

$('scanInversion').onchange=()=>{if($('scanInversion').checked&&$('method').value!=='preset'){$('scanInversion').checked=false;notice('Choose the Huntington preset to use PureScan.',true);return;}if($('scanInversion').checked&&$('mode').value==='lama'){$('mode').value='careful';$('mode').onchange();}invalidate();};

syncOverlayControls();

// Presentation only: request payloads, cleanup defaults and export selection are unchanged.
function syncSimpleView() {
 const reviewed=!$('review').hidden;
 document.body.classList.toggle('review-ready',reviewed);
 $('pageChoices').hidden=!reviewed;
 if(!busy&&(job?.state==='done'||(job?.state==='review'&&job.message==='Review the results, then save your complete PDF.')))$('progressBox').hidden=true;
 const method=$('method').value;
 $('simpleMethod').textContent=method==='overlay'?'Supported website PDF detected. The original scan will be preserved.':method==='manual'?'Paint the watermark on the Before page, then try the cleanup.':'Huntington cleanup selected. For a different PDF type, use More options.';
 $('selectionSummary').textContent=job?`${keep.size} of ${job.count} pages selected`:'';
 $('saveTitle').textContent=!$('download').hidden?'Your PDF is ready':'Check the pages, then save';
 $('saveHelp').textContent=!$('download').hidden?'Download the new copy to your computer.':job?`All ${job.count} pages will be included. Only checked pages use the cleaned version.`:'All pages will be included.';
 $('step1').classList.toggle('active',!job);
 $('step2').classList.toggle('active',!!job&&!reviewed);
 $('step3').classList.toggle('active',reviewed);
 $('file').disabled=busy;
 $('previewAgain').disabled=busy;$('cleanAgain').disabled=busy;
 updateOptionExamples();
}
function showResult(result) {
 showTechnicalResult(result);
 let message='Click “Try this page” to see a preview, or clean all pages.';
 let warning=false;
 if(result){
  if(result.structural)message=result.matched?'Watermark removed. The original scan is unchanged.':'No supported watermark found. This page is unchanged.';
  else if(result.uncertain){message=keep.has(page)?'You selected this cleaned page. Check the altered text carefully before saving.':'Check the text carefully. The original will be kept unless you select this cleaned page.';warning=true;}
  else if(!result.matched)message=result.repairs?'Word repairs applied. Check the wording before saving.':'No watermark match found. This page is unchanged.';
  else message='Cleanup ready. Check the words and numbers in the After page.';
  if(!result.uncertain&&result.changed&&results.some(r=>r.page===page)&&!keep.has(page))message='The saved PDF will keep the original page. Check the box to use this cleaned preview.';
 } else if(previewed.has(page)) message='Preview ready. Compare Before and After, then clean all pages.';
 $('simpleResult').textContent=message;
 $('simpleResult').classList.toggle('needs-review',warning);
}
syncSimpleView();
$('previewAgain').onclick=()=>$('preview').click();
$('cleanAgain').onclick=()=>$('process').click();

// Help text only. These examples never change the selected settings.
function updateOptionExamples() {
 const method=$('method').value;
 const types={
  overlay:'Use for supported Cook County or OKCountyRecords PDFs. Example: a grey “NOT AN OFFICIAL COPY” overlay on a downloaded deed. This mode removes recognized overlays while keeping the original scan. If no supported watermark is found, the page stays unchanged.',
  preset:'Use for Huntington County scans with the diagonal “IMAGES/COPY PROPERTY…” mark. Example: large diagonal words crossing a scanned deed. Try Careful first and check the words beneath the mark.',
  manual:'Use for another watermark that you can paint over yourself. Example: a small mark in an empty corner. Select only the watermark on the Before page. Marks covering text are harder to remove, and the same selection is applied to every page.'
 };
 const modes={
  careful:'First choice for scanned watermarks near text. Example: a diagonal mark touches an address. Careful tries to protect the existing letters, so some watermark fragments may remain.',
  light:'Use for a faint watermark near dark text. Example: pale grey lettering behind black print. Light protects dark strokes; it will not remove a solid black watermark.',
  lama:'Try when image cleanup still leaves a mark and you can check the text against a reliable copy. Example: a dark line crosses “mortgage”. AI fills in the selected area, but may change letters. Review carefully and select only pages you accept.'
 };
 $('methodHelp').textContent=types[method]||'';
 $('modeHelp').textContent=method==='overlay'?'No cleanup method is needed for Website PDF. The app removes the separate overlay, so these image-cleanup choices are disabled.':modes[$('mode').value]||'';
 const repairs={
  donor:'Best when the same word is clear elsewhere. Example: “mortgage” is damaged on page 4 but clear on page 2. Copy that clean occurrence, matching spelling, capital letters and font.',
  fit:'Use when some original letters survive and you have confirmed the exact word. Example: part of “mortgage” is missing, but its remaining strokes are visible. The app fits replacement letters to those strokes; check the preview.',
  text:'Use when you have confirmed the exact wording from a reliable copy and cannot find a clean occurrence. Example: type the verified word “mortgage”, choose a matching font, and preview. The app uses what you type; it does not verify it.',
  lama:'Use to preview AI repair of a damaged letter shape. Example: a watermark breaks a letter in “mortgage”. Compare with a reliable copy before applying. AI may invent a stroke; it does not guarantee the word you entered.'
 };
 $('repairChoiceHelp').textContent=repairs[$('repairMethod').value]||'';
}
for(const id of ['method','mode','repairMethod'])$(id).addEventListener('change',updateOptionExamples);
updateOptionExamples();
