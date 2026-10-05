import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv} from '../src/portal-csv.js';
import {normalizeUsername} from '../supabase/functions/_shared/auth-handler.js';
test('CSV preserves multiline HTML, escaped quotes, CRLF, blanks and BOM as text',()=>{
 const csv=parseCsv('\uFEFFid,stimulus,correct\r\nTest1,"<p>line\n""quoted""</p>",true\r\nTest1,,\r\n');
 assert.deepEqual(csv,{header:['id','stimulus','correct'],rows:[['Test1','<p>line\n"quoted"</p>','true'],['Test1','','']]});
});
test('CSV rejects malformed cells and duplicate headers without hiding raw records',()=>{
 for(const text of ['id,id\nx,y','a,b\nx','a\n"unterminated','a\n"closed"x']) assert.throws(()=>parseCsv(text));
 assert.deepEqual(parseCsv(''),{header:[],rows:[]});
});
test('legacy login accepts short identifiers while new registration keeps its minimum',()=>{
 assert.deepEqual(normalizeUsername(' X ',true),{label:'X',normalized:'x'});
 assert.throws(()=>normalizeUsername('X'));
 for(const name of ['../X','<script>','x'.repeat(33)]) assert.throws(()=>normalizeUsername(name,true));
});
