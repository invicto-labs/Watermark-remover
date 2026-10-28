'use strict';
let objectCandidates=[], objectContext='';
function resetObjectChoices(){objectCandidates=[];$('objectBoxes').replaceChildren();$('objectChoices').replaceChildren();$('objectHint').textContent='Find separate text objects, then click the watermark on Before or choose its text. Scanned marks require image cleanup.';}
const objectLoadPage=loadPage;
loadPage=async function(){const context=job?.id+':'+page;if(context!==objectContext){resetObjectChoices();objectContext=context;}await objectLoadPage();showScanRisks();};
const objectSetBusy=setBusy;
setBusy=function(value){objectSetBusy(value);for(const id of ['findObjects','clearObjects','objectsAll'])$(id).disabled=value;for(const b of $('objectChoices').querySelectorAll('button'))b.disabled=value;for(const b of $('objectBoxes').children)b.disabled=value;};
function showScanRisks(){const result=results.find(r=>r.page===page);const regions=result?.scan_overlap_regions||[];$('scanRisk').hidden=!regions.length;$('scanRisk').textContent=regions.length?`Possible text overlap in ${regions.length} areas. Faint connected strokes were protected; watermark fragments may remain. Review the text before checking “Use this cleaned page”.`:'';}
async function chooseObject(item){
 if(busy||queueRunning)return;
 try{await flushView();setBusy(true);const result=await api('/api/objects/'+job.id+'/select',{page,id:item.id,all_pages:$('objectsAll').checked});
   resetObjectChoices();await activateJob(result.job);$('objectHint').textContent=`Selected “${result.text}” on page${result.pages.length===1?'':'s'} ${result.pages.join(', ')}. Try this page, then clean and review. Changed pages start unchecked.`;
   notice('Selection saved. Preview before accepting any cleaned page.');
 }catch(e){notice(e.message,true);}finally{setBusy(false);}
}
$('findObjects').onclick=async()=>{
 if(!job||busy||queueRunning)return;
 try{await flushView();resetObjectChoices();setBusy(true);$('objectHint').textContent='Finding isolated text and checking its visible area…';
   const data=await api('/api/objects/'+job.id+'/'+page,{});objectCandidates=data.items;
   $('objectHint').textContent=data.items.length?data.note:'No selectable text objects on this page. The mark may be scanned, use an embedded font, or share a block with document text. Try image cleanup.';
   for(const item of objectCandidates){
    const choice=document.createElement('button');choice.className='small';choice.textContent='Select “'+item.text+'”';choice.onclick=()=>chooseObject(item);$('objectChoices').append(choice);
    const box=document.createElement('button');box.type='button';box.className='object-hit';box.title='Select “'+item.text+'”';box.setAttribute('aria-label',box.title);
    const [x,y,right,bottom]=item.box;Object.assign(box.style,{left:x*100+'%',top:y*100+'%',width:(right-x)*100+'%',height:(bottom-y)*100+'%'});box.onclick=()=>chooseObject(item);$('objectBoxes').append(box);
   }
 }catch(e){$('objectHint').textContent=e.message;notice(e.message,true);}finally{setBusy(false);}
};
$('clearObjects').onclick=async()=>{if(!job||busy||queueRunning)return;try{await flushView();setBusy(true);const result=await api('/api/objects/'+job.id+'/clear',{});resetObjectChoices();await activateJob(result);notice('Selection cleared. The original PDF is retained. Choose a cleanup method to continue.');}catch(e){notice(e.message,true);}finally{setBusy(false);}};
