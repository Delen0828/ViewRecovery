import {escapeHtml as e} from './auth/ui.js';
import {COLORS} from './portal-metrics.js';
const opacity=value=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;
// Inline SVG keeps charts available in production without a CDN dependency.
export function chart(title, series, {xLabel='Session',yLabel='Accuracy (%)',max=100,format=v=>`${Math.round(v)}`,categories=null}={}) {
  const sessionAxis=[xLabel,yLabel].some(label=>/\bsessions?\b/i.test(label));
  const displayOpacity=value=>sessionAxis?1:opacity(value);
  const points=series.flatMap(s=>s.values).filter(p=>Number.isFinite(p.y));
  if(!points.length)return `<div class="chart-card"><h3>${e(title)}</h3><p class="note">No response data for this selection.</p></div>`;
  const xs=categories||[...new Set(points.map(p=>String(p.x)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const top=Math.max(1,max ?? Math.max(...points.map(p=>p.y))*1.15);
  const width=560,height=300,left=70,right=30,bottom=65,plotHeight=height-25-bottom;
  const x=v=>left+(xs.length===1?.5:xs.indexOf(String(v))/(xs.length-1))*(width-left-right);
  const y=v=>25+plotHeight*(1-v/top);
  const grid=Array.from({length:5},(_,i)=>{const v=top*i/4;return `<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" stroke="#e2e8f0"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${e(format(v))}</text>`;}).join('');
  const ticks=xs.map((v,i)=>xs.length>16 && i%Math.ceil(xs.length/12)!==0?'':`<text x="${x(v)}" y="${height-bottom+22}" text-anchor="middle">${e(v)}</text>`).join('');
  return `<div class="chart-card"><h3>${e(title)}</h3><svg class="data-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(title)}"><title>${e(title)}</title>${grid}${ticks}<text x="${width/2}" y="${height-10}" text-anchor="middle">${e(xLabel)}</text><text transform="translate(17 ${height/2}) rotate(-90)" text-anchor="middle">${e(yLabel)}</text>${series.map((s,i)=>{
    const color=s.color||COLORS[s.name]||['#2563eb','#059669','#d97706','#7c3aed','#db2777'][i%5];
    const values=s.values.filter(p=>Number.isFinite(p.y)).sort((a,b)=>xs.indexOf(String(a.x))-xs.indexOf(String(b.x)));
    return `<g data-series="${e(s.name)}" style="color:${color}"><g opacity="${displayOpacity(s.opacity)}">${values.slice(1).map((p,j)=>`<line x1="${x(values[j].x)}" y1="${y(values[j].y)}" x2="${x(p.x)}" y2="${y(p.y)}" stroke="currentColor" stroke-width="2.5" stroke-opacity="${displayOpacity(p.opacity)}"/>`).join('')}${values.map(p=>`<circle tabindex="0" cx="${x(p.x)}" cy="${y(p.y)}" r="5" fill="currentColor" fill-opacity="${displayOpacity(p.opacity)}"><title>${e(`${s.name}, ${xLabel} ${p.x}: ${format(p.y)}${p.detail?' — '+p.detail:''}`)}</title></circle>`).join('')}</g></g>`;
  }).join('')}</svg><div class="chart-legend">${series.map((s,i)=>`<button type="button" aria-pressed="false" data-highlight="${e(s.name)}"><span style="background:${s.color||COLORS[s.name]||['#2563eb','#059669','#d97706','#7c3aed','#db2777'][i%5]};opacity:${displayOpacity(s.opacity)}"></span>${e(s.name)}</button>`).join('')}</div></div>`;
}
export function bindCharts(container) {
  container.querySelectorAll('[data-highlight]').forEach(button=>{
    const card=button.closest('.chart-card'),series=[...card.querySelectorAll('[data-series]')];
    button.addEventListener('click',()=>{
      const active=button.getAttribute('aria-pressed')!=='true';
      card.querySelectorAll('[data-highlight]').forEach(b=>{
        b.setAttribute('aria-pressed',String(active&&b===button));
      });
      series.forEach(g=>g.toggleAttribute('hidden',active&&g.dataset.series!==button.dataset.highlight));
    });
  });
}
