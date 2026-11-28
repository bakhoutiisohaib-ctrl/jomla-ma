const keyPattern=/^[A-Za-z0-9_-]{16,128}$/;
export const validRevision=v=>Number.isSafeInteger(v)&&v>=0&&v<999999999999999;
export const updateSlot=(actor,id)=>'jomla:product-edit:v1:'+encodeURIComponent(actor)+':'+encodeURIComponent(id);
export function loadAttempt(slot){
 const raw=sessionStorage.getItem(slot);
 if(raw===null)return null;
 const a=JSON.parse(raw);
 if(!a||!keyPattern.test(a.key)||!validRevision(a.baseRevision)||typeof a.isDraft!=='boolean'||Object.keys(a).sort().join(',')!=='baseRevision,isDraft,key')throw Error('INVALID_EDIT_ATTEMPT');
 return a;
}
export function persistAttempt(slot,a){
 const raw=JSON.stringify({key:a.key,baseRevision:a.baseRevision,isDraft:a.isDraft});
 sessionStorage.setItem(slot,raw);
 if(sessionStorage.getItem(slot)!==raw)throw Error('INVALID_EDIT_ATTEMPT');
}
export function clearAttempt(slot,a){
 const old=loadAttempt(slot);
 if(!old||old.key!==a.key||old.baseRevision!==a.baseRevision||old.isDraft!==a.isDraft)throw Error('INVALID_EDIT_ATTEMPT');
 sessionStorage.removeItem(slot);
}
export const updateHeaders=a=>({'Idempotency-Key':a.key,'X-Product-Revision':String(a.baseRevision)});
export function confirmUpdateStatus(data,a,id,actor){
 if(data?.version!==1||data.productId!==id||data.actorId!==actor||data.baseRevision!==a.baseRevision||!validRevision(data.currentRevision)||
 !['absent','saved','superseded'].includes(data.phase)||
 (data.phase==='absent'&&data.currentRevision!==a.baseRevision)||
 (data.phase==='saved'&&data.currentRevision!==a.baseRevision+1)||
 (data.phase==='superseded'&&data.currentRevision<=a.baseRevision))throw Error('UNCONFIRMED_EDIT');
 return data;
}
export function confirmUpdateAck(data,a,id){
 const p=data?.product,u=data?.update;
 if(p?._id!==id||p.isDraft!==a.isDraft||p.editRevision!==a.baseRevision+1||u?.version!==1||u.baseRevision!==a.baseRevision||u.revision!==p.editRevision||typeof u.replayed!=='boolean'||!['queued','unavailable'].includes(data.visualIndex?.status))throw Error('UNCONFIRMED_EDIT');
 return p;
}
