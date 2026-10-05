let currentRun=null;
function freeze(value) {
 if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 return value;
}
export function setRunContext(run,ownerId) {
 if(!run?.id || !run.participant_id || !run.parameter_snapshot?.confirmed_at || run.status!=='active' || !ownerId) throw new Error('A confirmed server-created run is required.');
 currentRun=freeze({run:structuredClone(run),ownerId});
}
export function getRunContext() {
 if(!currentRun) throw new Error('Confirm your settings and create an authenticated run before starting the experiment.');
 return currentRun;
}
export function clearRunContext(){currentRun=null;}
