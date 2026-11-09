(function(root){
"use strict";
function headingKey(value){
 return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
}
const legacyStates=new Map([
 ["6aec66eb5ff8ae196d37b7ca","ideas"],
 ["6aec66ed3137d17f84ce7a3c","todo"],
 ["6aec66f02d325131dd44f8d8","doing"],
 ["6aec66f2b6df305a261abb0b","done"]
]);
const namedStates=new Map([["ideas","ideas"],["entrada","intake"],["por hacer","todo"],["en curso","doing"],["hecho","done"]]);
function workflowState(id,lists){
 const list=Array.isArray(lists)?lists.find(item=>item&&item.id===id):null;
 if(list){
  const name=headingKey(list.name).replace(/^[^\p{L}\p{N}]+/u,"");
  return namedStates.get(name)||"other";
 }
 return legacyStates.get(id)||"unknown";
}
function readBoardLists(t){
 if(typeof t.lists!=="function")return Promise.resolve([]);
 return new Promise(resolve=>{
  const timer=setTimeout(()=>resolve([]),750);
  Promise.resolve().then(()=>t.lists("id","name")).then(value=>{
   clearTimeout(timer);
   resolve(Array.isArray(value)?value:[]);
  },()=>{clearTimeout(timer);resolve([])});
 });
}
function readSection(desc,heading){
 const lines=String(desc||"").replace(/\r/g,"").split("\n");
 const start=lines.findIndex(line=>{
  const found=line.trim().match(/^\*\*([^*]+)\*\*$/);
  return found && headingKey(found[1])===headingKey(heading);
 });
 if(start<0)return "";
 const result=[];
 for(const line of lines.slice(start+1)){
  if(/^\*\*[^*]+\*\*\s*$/.test(line.trim()))break;
  // A final separator and the reference footer are not part of a section.
  if(/^(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())||/^\*?Referencias\s*[·:—-]/i.test(line.trim()))break;
  result.push(line);
 }
 return result.join("\n").trim();
}
function readDependencyIds(desc){
 const source=String(desc||"");
 const legacy=source.match(/^NB_DEPENDENCIES_V1:\s*([A-Za-z0-9,\s-]+)$/m);
 const stored=legacy?legacy[1].split(",").map(x=>x.trim()):[];
 const linkIds=text=>Array.from(String(text||"").matchAll(/https:\/\/trello\.com\/c\/([A-Za-z0-9]{8})(?=[/)\s]|$)/g),m=>m[1]);
 // Legacy dependency sections and inline compact cards remain supported.
 const section=[...linkIds(readSection(source,"Depende de")),...linkIds(readSection(source,"Dependencias"))];
 const visible=source.split("\n").filter(line=>/\*\*(?:BLOQUEO|DEPENDE DE)\*\*\s*[·:—-]?\s*(?:Depende de|Requiere)\b/i.test(line));
 // Editorial 3S v3 displays the explicit blocker on the next line:
 // **Bloqueo**\nDepende de [Studio](https://trello.com/c/...).
 // Only parse lines which DECLARE a dependency: never infer it from references.
 const blocker=readSection(source,"Bloqueo").split("\n").map(line=>line.trim())
  .filter(line=>/^(?:[-*]\s*)?(?:Depende de|Requiere)\b/i.test(line));
 const inline=[...visible,...blocker].flatMap(linkIds);
 return [...new Set([...stored,...section,...inline].filter(x=>/^[A-Za-z0-9]{8}$/.test(x)))].slice(0,12);
}
function readHistoricHours(desc){
 const legacy=String(desc||"").match(/NB_TIME_HISTORIC_ESTIMATE_V1 min=(\d+(?:\.\d+)?) max=(\d+(?:\.\d+)?)/);
 const section=readSection(desc,"Dedicación")||readSection(desc,"Histórico de dedicación");
 const readable=section.match(/^Aproximadamente\s+(\d+(?:[.,]\d+)?)(?:[–-](\d+(?:[.,]\d+)?))?\s+h(?=\s*[,.;]|\s*$)/i);
 const m=legacy||readable;
 if(!m)return null;
 const min=Number(m[1].replace(",",".")),max=Number((m[2]||m[1]).replace(",","."));
 return Number.isFinite(min)&&Number.isFinite(max)&&min>=0&&max>=min?{min,max}:null;
}
function readPreview(desc){
 const old=String(desc||"").match(/^NB_PREVIEW_V1:\s*(.+)$/m);
 if(old)return old[1];
 const section=readSection(desc,"Resumen");
 if(section)return section.split(/\n\s*\n/)[0].trim();
 const parts=String(desc||"").replace(/\r/g,"").split("\n");
 // A compact card has an inline heading rather than a paragraph below it.
 const compact=parts.find(line=>/\*\*(?:META|OBJETIVO|CONCEPTO|PROPÓSITO|PROPOSITO|QUÉ ES|QUE ES)\*\*\s*[·:—-]/i.test(line));
 if(compact)return compact.replace(/^.*?\*\*(?:META|OBJETIVO|CONCEPTO|PROPÓSITO|PROPOSITO|QUÉ ES|QUE ES)\*\*\s*[·:—-]\s*/i,"").trim();
 // Editorial 3S v3 starts with a short, standalone italic lead paragraph.
 const first=(parts.find(line=>line.trim())||"").trim();
 if(first.length<=240 && /^\*[^*].+[^*]\*$/.test(first) && !/^\*(?:Referencias|Estimaci[oó]n)\b/i.test(first) && !/https?:\/\//i.test(first))return first.slice(1,-1).trim();
 if(/^\*\*[^*]+\*\*$/.test((parts[0]||"").trim()))return (parts[1]||"").trim();
 return "";
}
// One human-authored editorial estimate is a rough reference only.
// It is not a measured total or a calculation of work remaining.
function readEditorialEstimate(desc){
 const match=String(desc||"").replace(/\r/g,"").match(/^\*Estimaci[oó]n(?:\s+previa)?\s*·\s*≈\s*(\d+(?:[.,]\d+)?)\s*h\b[^\n*]*\*$/im);
 if(!match)return null;
 const hours=Number(match[1].replace(",","."));
 return Number.isFinite(hours)&&hours>=0&&hours<=999?{hours}:null;
}
function readCriterionHours(name){
 // Editable, visible work estimate on a native Trello check item:
 // "Revisar el diseño · ≈ 2,5 h". No other numbers are treated as hours.
 const m=String(name||"").match(/\s[·•]\s≈\s*(\d+(?:[.,]\d+)?)\s*h\s*$/i);
 if(!m)return null;
 const h=Number(m[1].replace(",","."));
 return Number.isFinite(h)&&h>=0&&h<=999?h:null;
}
function readTimePlan(checklists,estimates){
 const manual=estimates&&typeof estimates==="object"&&!Array.isArray(estimates)?estimates:{};
 const items=(Array.isArray(checklists)?checklists:[]).flatMap(c=>
   (Array.isArray(c.checkItems)?c.checkItems:[]).map(item=>({id:item.id,name:item.name,
     done:String(item.state).toLowerCase()==="complete"}))
 );
 let planned=0,remaining=0,estimatedCount=0,estimatedCompletedCount=0,unestimatedCompletedCount=0;
 for(const item of items){
  // Existing Power-Up values take precedence. We never overwrite saved edits.
  const explicit=manual[item.id];
  const hours=typeof explicit==="number"&&Number.isFinite(explicit)&&explicit>=0&&explicit<=999
    ?explicit:readCriterionHours(item.name);
  if(hours===null){if(item.done)unestimatedCompletedCount++;continue}
  estimatedCount++;
  planned+=hours;
  if(!item.done)remaining+=hours;
  else estimatedCompletedCount++;
 }
 if(!estimatedCount)return null;
 const rounded=x=>Math.round(x*10)/10;
 return {planned:rounded(planned),remaining:rounded(remaining),estimatedCount,totalItems:items.length,
   completedEffort:rounded(planned-remaining),estimatedCompletedCount,unestimatedCompletedCount};
}
// Human-readable summary stored in the card description as a fallback for
// Trello's card-badges context, where checkItems may not be provided.
function readTimeSummary(desc){
 const section=readSection(desc,"ESTIMACIÓN DE TRABAJO");
 if(!section)return null;
 const match=section.match(/Previsto:\s*≈?\s*(\d+(?:[.,]\d+)?)\s*h\s*[·|/]\s*Pendiente:\s*≈?\s*(\d+(?:[.,]\d+)?)\s*h/i);
 const pendingOnly=section.match(/^Pendiente:\s*≈?\s*(\d+(?:[.,]\d+)?)\s*h\s*$/im);
 const progress=section.match(/(?:Referencia:\s*)?(\d+)\s*\/\s*(\d+)\s*criterios/i);
 if((!match&&!pendingOnly)||!progress)return null;
 const planned=Number((match?match[1]:pendingOnly[1]).replace(",",".")),remaining=Number((match?match[2]:pendingOnly[1]).replace(",","."));
 const done=Number(progress[1]),total=Number(progress[2]);
 if(![planned,remaining,done,total].every(Number.isFinite) || planned<0 || remaining<0 || remaining>planned || done<0 || total<1 || done>total)return null;
 return match?{planned,remaining,done,total}:{planned,remaining,done,total,unestimatedCompletedCount:done,estimatedCompletedCount:0};
}
function hasUnestimatedCompleted(plan,done){
 if(!plan)return false;
 if(Number.isInteger(plan.unestimatedCompletedCount))return plan.unestimatedCompletedCount>0;
 // Older summaries/cache only contain the future-work subtotal. Zero difference
 // cannot prove zero effort for already-completed criteria without cost coverage.
 return done>0&&plan.planned===plan.remaining&&plan.estimatedCompletedCount!==done;
}
// A recommendation is authored after a project review, never inferred from
// progress percentages, age, labels or a card's position. Decisions belong to
// that exact text, so changing the proposal requires a new human decision.
function readRecommendation(desc){
 const source=readSection(desc,"PROPUESTA DE SIGUIENTE TAREA");
 if(!source||source.length>1600)return null;
 const fields={};
 for(const line of source.split("\n")){
  const match=line.match(/^([^:]+):\s*(.+)$/);
  if(match)fields[headingKey(match[1])]=match[2].trim();
 }
 if(!fields.accion||!fields.motivo||!fields.resultado||!/^\d{4}-\d{2}-\d{2}$/.test(fields.revision||""))return null;
 return {source,action:fields.accion,reason:fields.motivo,outcome:fields.resultado,reviewed:fields.revision};
}
function recommendationFor(card,decision,lists){
 if(!card||workflowState(card.idList,lists)!=="todo"||card.closed)return null;
 const proposal=readRecommendation(card.desc);
 if(!proposal)return null;
 const choice=decision&&decision.source===proposal.source&&["accepted","dismissed"].includes(decision.choice)
  ?decision.choice:"pending";
 return {...proposal,choice:decision&&decision.unavailable?"unavailable":choice};
}
function recommendationBadge(card,decision,waiting,lists){
 const proposal=recommendationFor(card,decision,lists);
 if(!proposal||proposal.choice==="dismissed")return null;
 if(proposal.choice==="unavailable")return {text:"Propuesta · revisar decisión",color:"yellow"};
 if(waiting)return {text:proposal.choice==="accepted"?"Elegida · en espera":"Propuesta · en espera",color:"yellow"};
 return proposal.choice==="accepted"?{text:"Próxima acordada",color:"green"}
  :{text:"Propuesta · siguiente tarea",color:"yellow"};
}
function resolve(desc,cards,lists){
 const ids=readDependencyIds(desc);
 if(!ids.length)return {blocked:false,dependencies:[],missing:[]};
 const mapped=new Map((Array.isArray(cards)?cards:[]).filter(Boolean).map(card=>[card.shortLink,card]));
 const unresolved=[],missing=[];
 for(const id of ids){
  const card=mapped.get(id);
  const state=card?workflowState(card.idList,lists):"unknown";
  if(state==="unknown"){missing.push(id);continue}
  if(state!=="done")unresolved.push({id,name:card.name||"Tarjeta "+id,url:"https://trello.com/c/"+id});
 }
 return {blocked:unresolved.length>0,dependencies:unresolved,missing};
}
root.NBDependencies={workflowState,readBoardLists,readSection,readDependencyIds,resolve,readHistoricHours,readPreview,readEditorialEstimate,readCriterionHours,readTimePlan,readTimeSummary,hasUnestimatedCompleted,readRecommendation,recommendationFor,recommendationBadge};
})(typeof window!=="undefined"?window:globalThis);
