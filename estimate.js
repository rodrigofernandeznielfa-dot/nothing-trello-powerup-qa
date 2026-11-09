import {ESTIMATE_KEY,itemsOf,summarize,validHours,hoursInName} from "./core.js?v=2";
const t=window.TrelloPowerUp.iframe();
const box=document.getElementById("items");
const error=document.getElementById("error");
const summary=document.getElementById("summary");
const button=document.getElementById("save");
let allItems=[],initial={};
function inputs() {return [...box.querySelectorAll("input[data-item-id]")];}
function extract() {
  const next={...initial};
  for (const field of inputs()) {
    const raw=field.value.trim().replace(",",".");
    if (raw==="") {delete next[field.dataset.itemId];continue;}
    const value=Number(raw);
    if (!validHours(value)) throw Error("Introduce entre 0 y 999 horas por criterio.");
    next[field.dataset.itemId]=value;
  }
  return next;
}
function refreshPreview() {
  try {
    const s=summarize([{checkItems:allItems.map(x=>({id:x.id,state:x.done?"complete":"incomplete"}))}],extract());
    summary.textContent=s.remainingHours===null?"Sin estimar · "+s.unestimated+" pendientes":"Quedan "+s.remainingHours+" h estimadas";
    error.textContent="";
  } catch(e) {error.textContent=e.message;}
}
function render() {
  box.replaceChildren();
  for (const item of allItems) {
    const label=document.createElement("label");
    if(item.done)label.classList.add("done");
    const text=document.createElement("span");text.textContent=item.name;
    const input=document.createElement("input");
    input.dataset.itemId=item.id;input.type="number";input.min="0";input.max="999";input.step="0.5";
    input.placeholder="Horas";input.setAttribute("aria-label","Horas estimadas para "+item.name);
    const guess=hoursInName(item.name);
    if(validHours(initial[item.id]))input.value=String(initial[item.id]);
    else if(validHours(guess))input.value=String(guess);
    input.title="Horas aproximadas; puedes corregirlas aquí o en el nombre del criterio";
    input.addEventListener("input",refreshPreview);
    label.append(text,input);box.append(label);
  }
  if (!allItems.length) {const p=document.createElement("p");p.textContent="Añade primero una checklist a la tarjeta.";box.append(p);button.disabled=true;}
  refreshPreview();
}
async function start() {
  try {
    const [card,data]=await Promise.all([t.card("checklists"),t.get("card","shared",ESTIMATE_KEY,{})]);
    allItems=itemsOf(card.checklists);initial=data&&typeof data==="object"&&!Array.isArray(data)?data:{};
    render();await t.sizeTo("#items");
  } catch (e) {error.textContent="No se pudieron leer los criterios de la tarjeta.";}
}
button.addEventListener("click",async ()=>{
  button.disabled=true;error.textContent="";
  try {
    const value=extract();
    const latest=await t.get("card","shared",ESTIMATE_KEY,{});
    if(JSON.stringify(latest||{})!==JSON.stringify(initial))throw Error("Las estimaciones cambiaron en otra sesión. Vuelve a abrir el editor.");
    await t.set("card","shared",ESTIMATE_KEY,value);
    await t.closePopup();
  } catch(e) {error.textContent=e.message;button.disabled=false;}
});
start();
