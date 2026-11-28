import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import RfqMessageComposer,{messageAttemptStorageKey} from './RfqMessageComposer';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {apiRequest} from '../../api/config';
import {setSession} from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
const actor='actor-1',rfq='rfq-1',token='synthetic-token',id='1'.repeat(24),otherId='2'.repeat(24),content='Synthetic private text',slot=messageAttemptStorageKey(actor,rfq);
const submission=(phase='completed',messageId=id)=>({version:1,phase,...(phase==='absent'?{}:{messageId})});
const lookup=(phase='completed',messageId=id,who=actor)=>({rfqId:rfq,actorId:who,submission:submission(phase,messageId)});
const history=(text=content,who=actor,messageId=id,role='buyer')=>({thread:{rfqId:rfq,messages:[{_id:messageId,senderId:who,senderRole:role,content:text}]}});
const ack=(text=content,who=actor,messageId=id,role='buyer')=>({...history(text,who,messageId,role),submission:{...submission('completed',messageId),replayed:true}});
const show=(props={})=>render(<LanguageProvider><RfqMessageComposer actorId={actor} rfqId={rfq} token={token} role="buyer" open label="Message" sendLabel="Send" {...props}/></LanguageProvider>);
const input=()=>screen.getByLabelText('Message');
const type=(value=content)=>fireEvent.change(input(),{target:{value}});
const submit=()=>fireEvent.submit(input().closest('form'));
const check=()=>fireEvent.click(screen.getByRole('button',{name:'التحقق من محاولة الإرسال'}));
const posts=()=>apiRequest.mock.calls.filter(([p])=>p.endsWith('/messages'));
const seed=()=>sessionStorage.setItem(slot,'a'.repeat(48));
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setSession(token);apiRequest.mockReset();});
afterEach(()=>jest.restoreAllMocks());
test.each(['buyer','supplier'])('single-flight %s send uses stored key, verifies acknowledgement by keyed read, removes key only after confirmation',async role=>{
 let resolve;apiRequest.mockImplementation(p=>p.endsWith('/messages')?new Promise(r=>{resolve=r}):Promise.resolve(lookup()));
 show({role});type();submit();submit();expect(posts()).toHaveLength(1);
 const key=sessionStorage.getItem(slot);expect(key).toMatch(/^[a-f0-9]{48}$/);
 expect(posts()[0][1]).toMatchObject({headers:{'Idempotency-Key':key},body:{content},token});
 expect(JSON.stringify(sessionStorage)).not.toContain(content);expect(JSON.stringify(sessionStorage)).not.toContain(token);
 await act(async()=>resolve(ack(content,actor,id,role)));
 expect(await screen.findByText('تأكد إرسال الرسالة وحفظ إشعارها.')).toBeInTheDocument();
 expect(sessionStorage.getItem(slot)).toBeNull();expect(input()).toHaveValue('');
 expect(apiRequest.mock.calls.at(-1)[1].headers['Idempotency-Key']).toBe(key);
});
test('lost response survives reload without text storage, completed lookup never sends twice',async()=>{
 apiRequest.mockRejectedValueOnce(Error('Synthetic response loss'));
 const view=show();type();submit();await screen.findByRole('alert');
 const key=sessionStorage.getItem(slot);expect(input()).toBeDisabled();view.unmount();
 apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/attempt')?lookup():history()));
 show();expect(input()).toHaveValue('');expect(input()).toBeDisabled();
 expect(posts()).toHaveLength(1);check();
 expect(await screen.findByText('تأكد إرسال الرسالة وحفظ إشعارها.')).toBeInTheDocument();
 expect(posts()).toHaveLength(1);expect(sessionStorage.getItem(slot)).toBeNull();
 expect(apiRequest.mock.calls.find(([p])=>p.endsWith('/attempt'))[1].headers['Idempotency-Key']).toBe(key);
});
test('pending message on a closed thread can be recovered by exact saved text and original key',async()=>{
 seed();let phase='pending';apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/attempt')?lookup(phase):p.endsWith('/thread')?history():ack()));
 show({open:false,blocked:true});check();
 expect(await screen.findByText('الرسالة محفوظة؛ الإشعار قيد الاستكمال.')).toBeInTheDocument();
 expect(input()).toHaveValue(content);expect(input()).toBeDisabled();phase='completed';
 fireEvent.click(screen.getByRole('button',{name:'استكمال نفس الإرسال'}));
 await screen.findByText('تأكد إرسال الرسالة وحفظ إشعارها.');
 expect(posts()[0][1]).toMatchObject({headers:{'Idempotency-Key':'a'.repeat(48)},body:{content}});expect(sessionStorage.getItem(slot)).toBeNull();
});
test('absent is not a new attempt; on reload retype and resume the same key',async()=>{
 seed();let phase='absent';apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/attempt')?lookup(phase):ack()));
 show();check();await screen.findByText(/لم تظهر المحاولة في الخادم بعد/);
 expect(input()).toBeEnabled();type();phase='completed';submit();
 await screen.findByText('تأكد إرسال الرسالة وحفظ إشعارها.');
 expect(posts()[0][1].headers['Idempotency-Key']).toBe('a'.repeat(48));
});
test('wrong acknowledgement or keyed lookup never clears a pending identity',async()=>{
 apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/messages')?ack(content,actor,otherId):lookup()));
 show();type();submit();expect(await screen.findByRole('alert')).toHaveTextContent(/لم يتأكد إرسال الرسالة/);
 expect(sessionStorage.getItem(slot)).not.toBeNull();expect(input()).toHaveValue(content);expect(input()).toBeDisabled();
 submit();expect(posts()).toHaveLength(1);
});
test('foreign actor receipt is rejected before reading history',async()=>{
 seed();apiRequest.mockResolvedValue(lookup('completed',id,'foreign'));
 show();check();await screen.findByRole('alert');expect(apiRequest).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(slot)).not.toBeNull();
});
test('after a retyped text conflict, show saved content rather than claiming new text was sent',async()=>{
 seed();let phase='absent';apiRequest.mockImplementation(p=>p.endsWith('/attempt')?Promise.resolve(lookup(phase)):p.endsWith('/thread')?Promise.resolve(history('Original saved text')):Promise.reject(Error('Conflict')));
 show();check();await screen.findByText(/لم تظهر المحاولة في الخادم بعد/);type('Different retyped text');submit();await screen.findByRole('alert');
 phase='completed';check();expect(await screen.findByText(/لم نؤكد إرسال النص الجديد/)).toBeInTheDocument();expect(sessionStorage.getItem(slot)).toBeNull();expect(posts()).toHaveLength(1);
});
test('storage write failure prevents sending and a foreign scope never reads another attempt',async()=>{
 seed();const other=messageAttemptStorageKey('actor-2',rfq);show({actorId:'actor-2'});expect(input()).toBeEnabled();type();
 jest.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw Error('Storage blocked')});
 submit();await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());
 expect(posts()).toHaveLength(0);expect(sessionStorage.getItem(other)).toBeNull();expect(sessionStorage.getItem(slot)).toBe('a'.repeat(48));
});
test('late response after session replacement cannot clear stored identity or read status',async()=>{
 let resolve;apiRequest.mockImplementation(()=>new Promise(r=>{resolve=r}));
 const view=show();type();submit();const key=sessionStorage.getItem(slot);
 setSession('replacement-token');view.unmount();await act(async()=>resolve(ack()));
 expect(apiRequest).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(slot)).toBe(key);
});
