(function(){
"use strict";
const t=window.TrelloPowerUp.iframe();
const workflowLabel={done:"Hecho",todo:"Por hacer",doing:"En curso",ideas:"Ideas",intake:"Entrada"};
const KEY="nothing_estimates_v1";
const SNAP="nothing_work_snapshot_v1";
const RECOMMENDATION="nothing_next_task_decision_v1";
const el=id=>document.getElementById(id);
let recommendationBusy=false,currentRecommendation=null;
function readRecommendationDecision(){
 return new Promise(resolve=>{
  const timer=window.setTimeout(()=>resolve({unavailable:true}),900);
  Promise.resolve().then(()=>t.get("card","shared",RECOMMENDATION,{})).then(value=>{
   window.clearTimeout(timer);resolve(value);
  },()=>{window.clearTimeout(timer);resolve({unavailable:true})});
 });
}
function renderRecommendation(card,decision,dependencies,lists){
 const box=el("recommendation"),proposal=window.NBDependencies.recommendationFor(card,decision,lists);
 currentRecommendation=proposal?{cardId:card.id,proposal}:null;
 box.hidden=!proposal;
 if(!proposal)return;
 const waiting=Boolean(dependencies&&(dependencies.blocked||dependencies.unavailable||(dependencies.missing||[]).length));
 const decided=proposal.choice==="accepted"||proposal.choice==="dismissed";
 const writable=typeof t.memberCanWriteToModel==="function"&&t.memberCanWriteToModel("card")===true;
 box.className="recommendation"+(proposal.choice==="accepted"?" accepted":proposal.choice==="dismissed"?" dismissed":"");
 setText("recommendation-title",proposal.choice==="accepted"?"Próxima tarea acordada":proposal.choice==="dismissed"?"Propuesta aparcada":"Propuesta · siguiente tarea");
 setText("recommendation-action",proposal.action);
 setText("recommendation-reason",proposal.reason);
 setText("recommendation-outcome",proposal.outcome);
 setText("recommendation-date","Revisión del proyecto: "+proposal.reviewed);
 el("recommendation-actions").hidden=decided;
 el("recommendation-reconsider-wrap").hidden=!decided;
 for(const id of ["recommendation-accept","recommendation-dismiss","recommendation-reconsider"]){
  el(id).disabled=recommendationBusy||!writable||proposal.choice==="unavailable";
 }
 setText("recommendation-status",recommendationBusy?"Guardando tu decisión…":proposal.choice==="unavailable"?"No se ha podido comprobar tu decisión. Reabre la tarjeta antes de responder.":!writable?"Puedes leer la propuesta; para decidir necesitas permiso de edición.":waiting?"Hay dependencias pendientes o sin comprobar. Esta propuesta queda en espera; elegirla no elimina el bloqueo.":proposal.choice==="accepted"?"Has elegido esta como próxima. Para empezar, muévela a EN CURSO y dime «Mira Trello».":proposal.choice==="dismissed"?"Has aparcado esta propuesta. Puedes volver a valorarla cuando quieras.":"Tú decides. Ningún botón mueve tarjetas ni inicia trabajo.");
}
async function decideRecommendation(choice){
 if(recommendationBusy||!currentRecommendation||!["accepted","dismissed","pending"].includes(choice))return;
 if(currentRecommendation.proposal.choice==="unavailable")return;
 if(typeof t.memberCanWriteToModel!=="function"||!t.memberCanWriteToModel("card"))return;
 const selected=currentRecommendation;
 recommendationBusy=true;
 for(const id of ["recommendation-accept","recommendation-dismiss","recommendation-reconsider"])el(id).disabled=true;
 setText("recommendation-status","Guardando tu decisión…");
 try{
  // Check the current proposal before saving a decision made from an older view.
  const [card,lists]=await Promise.all([t.card("id","idList","desc","closed"),window.NBDependencies.readBoardLists(t)]);
  const latest=window.NBDependencies.recommendationFor(card,{},lists);
  if(card.id!==selected.cardId||!latest||latest.source!==selected.proposal.source){
   throw new Error("proposal changed");
  }
  await t.set("card","shared",RECOMMENDATION,{source:latest.source,choice,updatedAt:new Date().toISOString()});
  recommendationBusy=false;
  await load();
 }catch(error){
  recommendationBusy=false;
  setText("recommendation-status",error.message==="proposal changed"?"La propuesta ha cambiado. Reabre la tarjeta para revisar la versión actual.":"No se ha podido confirmar el guardado. Reabre la tarjeta antes de reintentar; tu decisión no se dará por guardada aquí.");
  // Leave controls disabled: no automatic retry after an uncertain write.
  console.warn("NOTHING recommendation decision",error);
 }
}
el("recommendation-accept").addEventListener("click",()=>decideRecommendation("accepted"));
el("recommendation-dismiss").addEventListener("click",()=>decideRecommendation("dismissed"));
el("recommendation-reconsider").addEventListener("click",()=>decideRecommendation("pending"));
function asHours(n){return Number.isFinite(n)?String(Math.round(n*10)/10).replace(".",",")+" h":"—"}
function historic(desc){
  const value=window.NBDependencies.readHistoricHours(desc);
  if(!value)return null;
  const a=value.min,b=value.max;
  return a===b?"≈ "+asHours(a):"≈ "+asHours(a)+"–"+asHours(b);
}
function setText(id,value){el(id).textContent=value}
function extract(card,estimate,cached){
  const checklists=Array.isArray(card.checklists)?card.checklists:[];
  const items=checklists.flatMap(c=>(Array.isArray(c.checkItems)?c.checkItems:[]).map(i=>({id:i.id,name:i.name||"Criterio sin título",done:String(i.state).toLowerCase()==="complete"})));
  const native=card.badges||{},itemDone=items.filter(i=>i.done).length;
  const nativeKnown=Number.isInteger(native.checkItems)&&Number.isInteger(native.checkItemsChecked)&&native.checkItems>=0&&native.checkItemsChecked>=0&&native.checkItemsChecked<=native.checkItems;
  const total=nativeKnown?native.checkItems:items.length,completed=nativeKnown?native.checkItemsChecked:itemDone;
  const detailedCurrent=items.length>0&&items.length===total&&itemDone===completed;
  const live=detailedCurrent?window.NBDependencies.readTimePlan(checklists,estimate||{}):null;
  const summary=window.NBDependencies.readTimeSummary(card.desc);
  const valid=p=>p&&Number.isFinite(p.planned)&&Number.isFinite(p.remaining)&&p.planned>=p.remaining&&p.remaining>=0&&Number.isInteger(p.done)&&Number.isInteger(p.total)&&p.total>0&&p.done>=0&&p.done<=p.total;
  const current=p=>valid(p)&&p.total===total&&p.done===completed;
  let plan=live,source=live?"criteria":null,stale=false;
  if(!plan){
    if(current(cached)){plan=cached;source="snapshot"}
    else if(current(summary)){plan=summary;source="summary"}
    else if(valid(summary)||valid(cached)){plan=valid(summary)?summary:cached;source="stale";stale=true}
  }
  return {items,total,completed,remaining:plan&&!stale?plan.remaining:null,plan,source,stale,
    live,hasDetailedItems:items.length>0};
}
function previewSummary(desc){
 const summary=window.NBDependencies.readPreview(desc);
 if(!summary)return "Resumen breve pendiente de preparar.";
 const clean=summary.replace(/\s+/g," ").trim();
 return clean.length<=110?clean:clean.slice(0,107).trimEnd()+"…";
}
function previewTitle(name){
 const match=String(name||"").match(/NOTHING Studio\s+\d+/i);
 return match?match[0]:String(name||"Tarjeta relacionada");
}
function addHoverPreview(link,card,lists){
 const popup=el("dependency-preview");
 if(!popup)return;
 const show=(e)=>{
  popup.replaceChildren();
  const title=document.createElement("div");title.className="preview-title";title.textContent=previewTitle(card.name);
  const state=document.createElement("div");state.className="preview-state";state.textContent=workflowLabel[window.NBDependencies.workflowState(card.idList,lists)]||"En seguimiento";
  const desc=document.createElement("div");desc.className="preview-desc";desc.textContent=previewSummary(card.desc);
  const hint=document.createElement("div");hint.className="preview-hint";hint.textContent="Clic para abrir la tarjeta";
  popup.append(title,state,desc,hint);popup.hidden=false;
  place(e);
 };
 const place=(e)=>{
  if(popup.hidden)return;
  const rect=popup.getBoundingClientRect();
  const x=Math.min(Math.max(8,(e.clientX||link.getBoundingClientRect().right)+14),Math.max(8,window.innerWidth-rect.width-8));
  const y=Math.min(Math.max(8,(e.clientY||link.getBoundingClientRect().top)+14),Math.max(8,window.innerHeight-rect.height-8));
  popup.style.left=x+"px";popup.style.top=y+"px";
 };
 const hide=()=>{popup.hidden=true};
 link.addEventListener("pointerenter",show);
 link.addEventListener("pointermove",place);
 link.addEventListener("pointerleave",hide);
 link.addEventListener("focus",show);
 link.addEventListener("blur",hide);
 link.setAttribute("aria-describedby","dependency-preview");
}
function cardReferences(card){
 const id=String(card.id||"");
 const items=window.NBReferenceCatalog&&window.NBReferenceCatalog[id];
 const allowed=url=>typeof url==="string"&&/^https:\/\/(?:github\.com|trello\.com)\/[A-Za-z0-9._~/%?#=&+:-]+$/.test(url);
 const catalog=Array.isArray(items)?items.filter(ref=>ref&&allowed(ref.url)&&ref.label&&ref.summary):[];
 // Editorial 3S v3 keeps the canonical links in a dedicated Markdown footer.
 // Only that footer is parsed; never turn incidental links into references.
 const footer=String(card.desc||"").replace(/\r/g,"").split("\n")
   .map(line=>line.trim()).find(line=>/^\*?Referencias\s*·\s*/i.test(line))||"";
 const editorial=Array.from(footer.slice(0,2500).matchAll(/\[([^\]\n]{1,75})\]\((https:\/\/(?:github\.com|trello\.com)\/[^)\s<>"']{1,500})\)/g),
   match=>({label:match[1].trim(),url:match[2],summary:"Referencia incluida en la descripción de la tarjeta"}))
   .filter(ref=>ref.label&&allowed(ref.url));
 const seen=new Set();
 return [...catalog,...editorial].filter(ref=>{
   if(seen.has(ref.url))return false;
   seen.add(ref.url);return true;
 }).slice(0,5).map(ref=>({...ref,host:ref.url.startsWith("https://github.com/")?"github.com":"trello.com"}));
}
function addReferenceHover(link,ref){
 const popup=el("dependency-preview");
 const show=e=>{
  popup.replaceChildren();
  const title=document.createElement("div");title.className="preview-title";title.textContent=ref.label;
  const source=document.createElement("div");source.className="preview-state";source.textContent=ref.host==="github.com"?"GitHub":"Trello";
  const summary=document.createElement("div");summary.className="preview-desc";summary.textContent=ref.summary;
  const hint=document.createElement("div");hint.className="preview-hint";hint.textContent="Clic para abrir la referencia";
  popup.append(title,source,summary,hint);
  popup.hidden=false;move(e);
 };
 const move=e=>{
  if(popup.hidden)return;
  const box=popup.getBoundingClientRect(),anchor=link.getBoundingClientRect();
  const x=Math.min(Math.max(8,(e.clientX||anchor.left)+14),Math.max(8,innerWidth-box.width-8));
  const y=Math.min(Math.max(8,(e.clientY||anchor.top)+14),Math.max(8,innerHeight-box.height-8));
  popup.style.left=x+"px";popup.style.top=y+"px";
 };
 const hide=()=>popup.hidden=true;
 link.addEventListener("pointerenter",show);
 link.addEventListener("pointermove",move);
 link.addEventListener("pointerleave",hide);
 link.addEventListener("focus",show);
 link.addEventListener("blur",hide);
 link.setAttribute("aria-describedby","dependency-preview");
}
function renderReferences(card){
 const refs=cardReferences(card);
 const section=el("references"),wrap=el("reference-links");
 wrap.replaceChildren();section.hidden=refs.length===0;
 for(const ref of refs){
  const a=document.createElement("a");
  a.textContent=ref.label;a.href=ref.url;a.target="_blank";a.rel="noopener noreferrer";
  addReferenceHover(a,ref);wrap.append(a);
 }
}
function explicitNextDecision(desc){
 const lines=String(desc||"").replace(/\r/g,"").split("\n");
 for(let i=0;i<lines.length;i++){
  if(/^\*\*SIGUIENTE (?:DECISIÓN|DECISION|PASO)\*\*$/i.test(lines[i].trim())){
   const next=lines.slice(i+1).find(x=>x.trim().length>0);
   if(next && !next.startsWith("**") && !next.startsWith("NB_"))return next.trim();
  }
 }
 const compact=lines.find(line=>/\*\*(?:PRÓXIMO|PROXIMO|SIGUIENTE|SIGUIENTE PASO)\*\*\s*[·:—-]/i.test(line));
 if(compact)return compact.replace(/^.*?\*\*(?:PRÓXIMO|PROXIMO|SIGUIENTE|SIGUIENTE PASO)\*\*\s*[·:—-]\s*/i,"").trim();
 return null;
}
function render(card,estimate,dependencies,cached,decision,lists){
 const s=extract(card,estimate||{},cached);
 const state=window.NBDependencies.workflowState(card.idList,lists);
 const finished=state==="done",progress=s.total?Math.round(s.completed*100/s.total):null;
 const blocked=!finished&&dependencies&&dependencies.blocked;
 const unknown=!finished&&dependencies&&Boolean(dependencies.unavailable||(dependencies.missing||[]).length);
 setText("state",blocked?"Bloqueada":unknown?"Dependencias sin verificar":(workflowLabel[state]||"En seguimiento"));
 el("state").classList.toggle("blocked",!!blocked);
 el("state").classList.toggle("needs-check",!!unknown&&!blocked);
 const blocker=el("blocker");blocker.replaceChildren();
 if(blocked){
  const heading=document.createElement("strong");heading.textContent="Depende de:";
  const details=document.createElement("p");
  dependencies.dependencies.forEach((dep,index)=>{
    if(index)details.append(document.createTextNode(" · "));
    const link=document.createElement("a");
    link.href=dep.url;link.target="_blank";link.rel="noopener noreferrer";
    link.textContent=dep.name.replace(/^[^A-Za-z0-9]* /,"").split(" — ")[0];
    details.append(link);
    addHoverPreview(link,dep,lists);
  });
  blocker.append(heading,details);blocker.hidden=false;
 }else blocker.hidden=true;
 renderRecommendation(card,decision,dependencies,lists);
 renderReferences(card);
 setText("percent",progress===null?"—":progress+"%");
 setText("done",s.total?s.completed+" completados":"Sin criterios");
 setText("left",s.total?(s.total-s.completed)+" pendientes":"");
 const bar=el("track");bar.replaceChildren();
 if(s.total){for(let i=0;i<Math.min(s.total,20);i++){const seg=document.createElement("span");seg.className="segment"+(i<Math.round((s.completed/s.total)*Math.min(s.total,20))?" done":"");bar.append(seg)}}
 const historical=historic(card.desc);
 const editorial=window.NBDependencies.readEditorialEstimate(card.desc);
 const partial=window.NBDependencies.hasUnestimatedCompleted(s.plan,s.completed);
 setText("planned",partial?"Sin cerrar":s.plan?"≈ "+asHours(s.plan.planned):finished?"Sin estimación inicial":editorial?"≈ "+asHours(editorial.hours):"Sin estimar");
 setText("plannedCaption",partial?"Falta estimar trabajo ya completado":s.plan?s.source==="summary"?"Estimación registrada en la tarjeta":s.source==="snapshot"?"Estimación guardada para este progreso":"Estimación total de los criterios con horas":!finished&&editorial?"Estimación orientativa sin desglose; no son horas medidas":"No hay un plan de horas registrado");
 const completedEffort=s.plan&&!s.stale?Math.round((s.plan.planned-s.plan.remaining)*10)/10:null;
 setText("spentLabel",historical?"Dedicación":"Completado");
 setText("spent",historical||(completedEffort!==null&&(!partial||completedEffort>0)?"≈ "+asHours(completedEffort):"Sin estimar"));
 setText("spentCaption",historical?"Dedicación retrospectiva, no cronometrada":partial?completedEffort>0?"Solo tareas con horas; quedan avances previos sin estimar":"Los avances previos no tienen horas asignadas":completedEffort!==null?"Esfuerzo estimado de las tareas completadas; no cronometrado":"Sin estimación verificable del trabajo completado");
 setText("remaining",finished?"0 h":s.stale?"Revisar estimación":s.remaining===null?"Sin estimar":"≈ "+asHours(s.remaining));
 setText("remainCaption",finished?"Tarjeta cerrada":s.stale?"El resumen no coincide con el progreso actual":s.remaining===null&&editorial?"La referencia anterior no calcula trabajo restante":s.remaining===null?"Faltan estimaciones por criterio":partial?"Estimación del trabajo pendiente con horas":"Se descuentan las tareas marcadas como completadas");
 const list=el("steps");list.replaceChildren();
 if(s.hasDetailedItems){s.items.slice(0,12).forEach(item=>{
   const li=document.createElement("li"),mark=document.createElement("span"),text=document.createElement("span");
   mark.className=item.done?"mark":"todo";mark.textContent=item.done?"✓":"○";
   text.className="grow";text.textContent=item.name;
   li.append(mark,text);
   if(!item.done&&typeof estimate[item.id]==="number"){const h=document.createElement("span");h.className="small";h.textContent=asHours(estimate[item.id]);li.append(h)}
   list.append(li);
 });if(s.items.length>12){const li=document.createElement("li");li.className="small";li.textContent="Y "+(s.items.length-12)+" criterios más en la checklist de Trello";list.append(li)}}
 else{const li=document.createElement("li");li.className="muted";li.textContent=s.total?"Hay "+s.total+" criterios; el detalle no está disponible en esta vista.":"Esta tarjeta todavía no tiene checklist.";list.append(li)}
 const next=s.items.find(item=>!item.done);
 setText("next",finished?"Trabajo cerrado. Consulta la descripción y las evidencias de la tarjeta.":blocked?"Continuaremos cuando se complete la dependencia.":unknown?"Verifica las dependencias antes de empezar.":explicitNextDecision(card.desc)||(next?next.name:"Revisar la descripción de la tarjeta para elegir el siguiente paso."));
 const warnings=[];
 if(unknown)warnings.push("Hay dependencias que Trello no ha podido comprobar. No las consideres resueltas hasta verificar sus tarjetas.");
 if(!finished&&s.total&&s.completed===s.total)warnings.push("Checklist completa, pero la tarjeta todavía no está cerrada.");
 if(!finished&&s.stale)warnings.push("Las horas registradas corresponden a otro progreso. Revisa el resumen de estimación o vuelve a abrir cuando Trello muestre el detalle de las casillas.");
 else if(!finished&&s.remaining===null)warnings.push("Tiempo restante sin calcular: añade horas aproximadas a las tareas de la checklist.");
 const warning=el("warning");warning.replaceChildren();
 warnings.forEach(w=>{const p=document.createElement("p");p.className="notice small";p.textContent=w;warning.append(p)});
 el("status").hidden=true;el("content").hidden=false;
 resizePanel();
}
function resizePanel(){
 if(typeof t.sizeTo==="function"){
  Promise.resolve(t.sizeTo(document.body)).catch(function(e){console.warn("NOTHING resize",e)});
 }
}
let loaded=false;
const loadingTimeout=window.setTimeout(function(){
 if(!loaded){
  el("status").textContent="La conexión con Trello está tardando demasiado. Cierra y vuelve a abrir la tarjeta.";
  setText("state","Sin conexión");
  resizePanel();
 }
},9000);
async function load(){
 try{
  const [card,estimate,cached,decision,lists]=await Promise.all([
    t.card("id","idList","desc","checklists","badges","closed"),
    t.get("card","shared",KEY,{}).catch(()=>({})),
    t.get("card","shared",SNAP,{}).catch(()=>({})),
    readRecommendationDecision(),
    window.NBDependencies.readBoardLists(t)
  ]);
  let dependencies={blocked:false,dependencies:[],missing:[]};
  if(window.NBDependencies.workflowState(card.idList,lists)!=="done" && window.NBDependencies.readDependencyIds(card.desc).length){
    try{
      const cards=await t.cards("id","name","shortLink","idList","desc");
      dependencies=window.NBDependencies.resolve(card.desc,cards,lists);
      dependencies.dependencies.forEach(dep=>{const source=cards.find(c=>c.shortLink===dep.id);if(source){dep.desc=source.desc;dep.idList=source.idList}});
    }catch(error){dependencies.unavailable=true;console.warn("NOTHING dependency lookup failed",error)}
  }
  // In a card-detail iframe Trello normally supplies checkItems even when
  // card-badges on the board does not. Cache a verified snapshot for badges.
  const state=extract(card,estimate||{},cached);
  const live=state.live;
  if(live){
    const current={
      planned:live.planned,remaining:live.remaining,
      done:state.completed,total:state.total,
      estimatedCompletedCount:live.estimatedCompletedCount,
      unestimatedCompletedCount:live.unestimatedCompletedCount
    };
    if(JSON.stringify(cached)!==JSON.stringify(current)){
      t.set("card","shared",SNAP,current).catch(err=>console.warn("NOTHING estimate cache",err));
    }
  }
  render(card,estimate||{},dependencies,cached,decision,lists);
  loaded=true;window.clearTimeout(loadingTimeout);
 }catch(err){
  loaded=true;window.clearTimeout(loadingTimeout);
  el("status").textContent="No se pudo leer la tarjeta. Cierra y vuelve a abrirla.";
  setText("state","Error");
  resizePanel();
  console.error("NOTHING panel",err);
 }
}
t.render(load);
load();
})();
