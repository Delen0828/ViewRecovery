import test from 'node:test';
import assert from 'node:assert/strict';
import {setRunContext,getRunContext,clearRunContext} from '../src/experiment/context.js';
test('experiment entry requires a confirmed run and isolates its snapshot from editable defaults',()=>{
 clearRunContext();assert.throws(()=>getRunContext(),/Confirm your settings/);
 assert.throws(()=>setRunContext({id:'fixture',status:'active'},'fixture-owner'),/confirmed server-created run/);
 const run={id:'fixture-run',participant_id:'fixture-participant',status:'active',parameter_snapshot:{confirmed_at:'2026-10-04T00:00:00Z',training:{x_deg:5}}};
 setRunContext(run,'fixture-owner');run.parameter_snapshot.training.x_deg=10;
 assert.equal(getRunContext().run.parameter_snapshot.training.x_deg,5);
 assert.throws(()=>{getRunContext().run.parameter_snapshot.training.x_deg=15},TypeError);
 clearRunContext();assert.throws(()=>getRunContext());
});
