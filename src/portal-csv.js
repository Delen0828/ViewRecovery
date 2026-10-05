// RFC 4180 cells are rendered as text; stored HTML is never executed.
export function parseCsv(text) {
 text=text.replace(/^\uFEFF/,'');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(quoted) {
   if(c==='"' && text[i+1]==='"'){cell+='"';i++;}
   else if(c==='"'){quoted=false;closed=true;}
   else cell+=c;
  } else if(c===',' || c==='\n' || c==='\r') {
   row.push(cell);cell='';closed=false;
   if(c!==',') {rows.push(row);row=[];if(c==='\r' && text[i+1]==='\n')i++;}
  } else if(c==='"' && cell==='' && !closed) quoted=true;
  else if(c==='"' || closed) throw new Error('Malformed CSV quoting. Download the original for review.');
  else cell+=c;
 }
 if(quoted) throw new Error('Unterminated CSV cell. Download the original for review.');
 if(cell!=='' || row.length || closed) {row.push(cell);rows.push(row);}
 if(!rows.length) return {header:[],rows:[]};
 const [header,...data]=rows;
 if(new Set(header).size!==header.length || data.some(r=>r.length!==header.length)) throw new Error('CSV row shape mismatch. Download the original for review.');
 return {header,rows:data};
}
