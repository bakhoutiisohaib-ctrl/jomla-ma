import {render,screen,fireEvent,act,waitFor} from '@testing-library/react';
import DirectConversationPanel,{DirectProductDialog,DirectNoticeDialog} from './DirectConversation';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {apiRequest} from '../../api/config';
import {setSession} from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
const actor='1'.repeat(24),productId='2'.repeat(24),thread='3'.repeat(24),token='synthetic-token',now='2026-11-28T09:00:00Z',user={_id:actor,role:'buyer'},summary={_id:thread,productId,productName:'Synthetic product',counterpartName:'Synthetic counterpart',lastMessageAt:now};
const slot='jomla:direct-message:v1:'+actor+':buyer:'+productId;
const empty={actorId:actor,role:'buyer',productId,conversation:null,messages:[],canSend:true};
const history=(messages,extra={})=>({...empty,conversation:summary,messages,...extra});
const message=body=>({clientId:body.clientId,role:'buyer',content:body.content,sentAt:now});
const show=(u=user)=>render(<LanguageProvider><DirectProductDialog user={u} productId={productId} onClose={jest.fn()}/></LanguageProvider>);
const inbox=(u=user)=>render(<LanguageProvider><DirectConversationPanel user={u}/></LanguageProvider>);
const input=()=>screen.getByLabelText('رسالتك'),submit=()=>fireEvent.submit(input().closest('form'));
const type=content=>fireEvent.change(input(),{target:{value:content}});
const posts=()=>apiRequest.mock.calls.filter(([,o])=>o?.method==='POST');
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setSession(token);apiRequest.mockReset();});
test('new message single flight, exact receipt and readback; only opaque key stored',async()=>{
 let resolve,m;apiRequest.mockImplementation((p,o)=>{if(o.method==='POST'){m=message(o.body);return new Promise(r=>{resolve=r})}return Promise.resolve(p.includes('/product/')?empty:history([m]));});
 show();await screen.findByLabelText('رسالتك');type('Synthetic question');submit();submit();
 expect(posts()).toHaveLength(1);expect(posts()[0][1].body).toEqual({productId,clientId:JSON.parse(sessionStorage.getItem(slot)).key,content:'Synthetic question'});
 expect(sessionStorage.getItem(slot)).not.toContain('Synthetic question');expect(sessionStorage.getItem(slot)).not.toContain(token);
 await act(async()=>resolve({actorId:actor,role:'buyer',conversation:summary,message:m,replayed:false}));
 await screen.findByText('تأكد حفظ الرسالة.');expect(screen.getByText('Synthetic question')).toBeInTheDocument();expect(sessionStorage.getItem(slot)).toBeNull();expect(input()).toHaveValue('');
});
test('lost acknowledgement recovered on reopen via history, without resending',async()=>{
 let m;apiRequest.mockImplementation((p,o)=>{if(o.method==='POST'){m=message(o.body);return Promise.reject(Error('lost'))}return Promise.resolve(m?history([m]):empty)});
 const view=show();await screen.findByLabelText('رسالتك');type('Synthetic saved text');submit();await screen.findByRole('alert');expect(input()).toBeDisabled();view.unmount();
 show();await screen.findByText('تأكد حفظ الرسالة.');expect(posts()).toHaveLength(1);expect(sessionStorage.getItem(slot)).toBeNull();
});
test('foreign or unconfirmed write does not clear attempt; retry exact key and content',async()=>{
 let body;apiRequest.mockImplementation((p,o)=>{if(o.method==='POST'){body=o.body;return Promise.resolve({actorId:'foreign',role:'buyer',conversation:summary,message:message(body),replayed:false})}return Promise.resolve(empty)});
 show();await screen.findByLabelText('رسالتك');type('Synthetic retry');submit();await screen.findByRole('alert');
 const first=posts()[0][1].body;expect(input()).toBeDisabled();expect(sessionStorage.getItem(slot)).not.toBeNull();submit();await waitFor(()=>expect(posts()).toHaveLength(2));expect(posts()[1][1].body).toEqual(first);
});
test('late response after account switch cannot expose old history',async()=>{
 let resolve;apiRequest.mockImplementation(()=>new Promise(r=>{resolve=r}));const view=show();await waitFor(()=>expect(resolve).toBeDefined());
 act(()=>setSession('replacement-token'));view.unmount();
 await act(async()=>resolve(history([{clientId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'buyer',content:'Old private text',sentAt:now}])));
 expect(screen.queryByText('Old private text')).not.toBeInTheDocument();
});
test('wrong scoped history does not enable composer',async()=>{
 apiRequest.mockResolvedValue({...empty,actorId:'foreign'});show();await screen.findByRole('alert');expect(screen.queryByLabelText('رسالتك')).not.toBeInTheDocument();
});
test('supplier inbox opens scoped read-only history and does not offer a send action',async()=>{
 const supplier={_id:actor,role:'supplier'},m={clientId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'buyer',content:'Synthetic inquiry',sentAt:now};
 apiRequest.mockImplementation(p=>Promise.resolve(p.includes('?page=')?{actorId:actor,role:'supplier',page:1,hasNext:false,data:[summary]}:history([m],{role:'supplier',canSend:false})));
 inbox(supplier);fireEvent.click(await screen.findByRole('button',{name:'فتح المحادثة'}));await screen.findByText('Synthetic inquiry');expect(screen.getByText('المحادثة للقراءة فقط حالياً.')).toBeInTheDocument();expect(screen.queryByLabelText('رسالتك')).not.toBeInTheDocument();
});
test('staff cannot load private inbox',()=>{inbox({_id:actor,role:'staff'});expect(apiRequest).not.toHaveBeenCalled();});

const directNotice={_id:'4'.repeat(24),type:'direct_message',resourceType:'direct_conversation',resourceId:thread,createdAt:now,readAt:null};
const incoming={clientId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'supplier',content:'Synthetic notified reply',sentAt:now};
const openNotice=(onRead=jest.fn(),u=user,n=directNotice)=>render(<LanguageProvider><DirectNoticeDialog user={u} notice={n} onClose={jest.fn()} onRead={onRead}/></LanguageProvider>);
test('direct notice verifies scoped history before marking exact notification and shows the conversation',async()=>{
 const onRead=jest.fn(),ack={...directNotice,readAt:now};
 apiRequest.mockImplementation((p,o)=>Promise.resolve(o.method==='PUT'?{notification:ack}:history([incoming])));
 openNotice(onRead);await screen.findByText(incoming.content);await waitFor(()=>expect(onRead).toHaveBeenCalledWith(ack));
 expect(apiRequest.mock.calls.map(([p])=>p)).toEqual(['/direct-conversations/'+thread,'/notifications/'+directNotice._id+'/read']);
});
test.each(['actor','thread','no incoming','unavailable'])('invalid notification target (%s) remains unread',async kind=>{
 const response=kind==='actor'?history([incoming],{actorId:'foreign'}):kind==='thread'?history([incoming],{conversation:{...summary,_id:'5'.repeat(24)}}):history([{...incoming,role:'buyer'}]);
 apiRequest.mockImplementation(()=>kind==='unavailable'?Promise.reject(Error('404')):Promise.resolve(response));
 openNotice();await screen.findByText('تعذر تأكيد المحادثة المرتبطة بهذا الإشعار.');
 expect(apiRequest.mock.calls.some(([,o])=>o.method==='PUT')).toBe(false);expect(screen.queryByText(incoming.content)).not.toBeInTheDocument();
});
test('wrong read receipt keeps verified conversation open with warning; retry verifies again',async()=>{
 const onRead=jest.fn();let good=false;
 apiRequest.mockImplementation((p,o)=>Promise.resolve(o.method==='PUT'?{notification:{...directNotice,resourceId:good?thread:'5'.repeat(24),readAt:now}}:history([incoming])));
 openNotice(onRead);await screen.findByText('تم فتح المحادثة، لكن لم يتأكد تعليم الإشعار كمقروء.');expect(await screen.findByText(incoming.content)).toBeInTheDocument();expect(onRead).not.toHaveBeenCalled();
 good=true;fireEvent.click(screen.getByRole('button',{name:'إعادة التحقق من الإشعار'}));await waitFor(()=>expect(onRead).toHaveBeenCalledTimes(1));expect(apiRequest.mock.calls.filter(([,o])=>o.method==='PUT')).toHaveLength(2);
});
test('session change during lookup does not mark notice or reveal old text',async()=>{
 let finish;apiRequest.mockImplementation(()=>new Promise(r=>{finish=r}));openNotice();await waitFor(()=>expect(finish).toBeDefined());
 act(()=>setSession('replacement-token'));await act(async()=>finish(history([incoming])));
 expect(apiRequest.mock.calls.some(([,o])=>o.method==='PUT')).toBe(false);expect(screen.queryByText(incoming.content)).not.toBeInTheDocument();
});
test('staff cannot open a direct notice even with a syntactically valid reference',()=>{openNotice(jest.fn(),{...user,role:'staff'});expect(apiRequest).not.toHaveBeenCalled();});
