'use strict';

// Navigation opens existing sections; it never starts cleanup or changes settings.
function navigateWorkspaceSection(id){
 const target=$(id);if(!target||target.hidden)return;
 document.body.classList.remove('overview-mode');
 if(!$('workspace').hidden)$('welcome').hidden=true;
 document.querySelectorAll('[data-section]').forEach(control=>{
  const active=control.dataset.section===id;
  control.classList.toggle('active',active);
  if(active)control.setAttribute('aria-current','location');
  else control.removeAttribute('aria-current');
 });
 document.querySelector('[data-home]')?.classList.remove('active');
 for(let parent=target;parent&&parent!==$('workspace');parent=parent.parentElement){
  if(parent.tagName==='DETAILS')parent.open=true;
 }
 target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 const heading=target.querySelector('h2,summary')||target;
 if(!heading.hasAttribute('tabindex'))heading.tabIndex=-1;
 heading.focus({preventScroll:true});
}

document.querySelectorAll('[data-section]').forEach(control=>control.addEventListener('click',event=>{
 event.preventDefault();navigateWorkspaceSection(control.dataset.section);
}));

function syncSectionAvailability(){
 const showPages=!$('pageChoices').hidden||!$('reviewTools').hidden;
 $('pageSidebar').hidden=!showPages;
 $('workspace').classList.toggle('has-page-sidebar',showPages);
}
// Only watch section visibility, avoiding page-image loads and review interactions.
const sectionVisibility=new MutationObserver(syncSectionAvailability);
for(const id of ['pageChoices','reviewTools']){
 sectionVisibility.observe($(id),{attributes:true,attributeFilter:['hidden']});
}
syncSectionAvailability();
