import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App from './App';
import {visualFixture} from './visualSearchFixture';
import {structuredFixture} from './structuredSearchFixture';
const item={_id:'1'.repeat(24),name:'Synthetic product',category:'Textile',price:20,currency:'MAD',moq:10,unit:'piece',pricingMode:'fixed',availability:'in_stock',supplierId:{_id:'2'.repeat(24),name:'Supplier'},storeId:'3'.repeat(24)};
const picture=()=>new File(['synthetic'],'fixture.png',{type:'image/png'});
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
let requests,handler;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');requests=[];
 handler=()=>reply(visualFixture([item]));
 global.fetch=jest.fn((url,opt={})=>{
   const u=new URL(url,'http://localhost'),p=u.pathname;
   if(p.endsWith('/image-search')){requests.push({u,body:opt.body,signal:opt.signal});return handler();}
   if(p.endsWith('/ai-search'))return reply(structuredFixture(JSON.parse(opt.body),[item]));
   if(p.endsWith('/products/search'))return reply({data:[item],pagination:{page:1,pages:1,total:1}});
   return reply({data:[],pagination:{page:1,limit:12,pages:0,total:0},unreadCount:0});
 });
});
const open=()=>fireEvent.click(screen.getByRole('button',{name:'بحث بالصورة'}));
const upload=(file,label='صورة البحث')=>fireEvent.change(screen.getByLabelText(label),{target:{files:[file]}});
const submitText=()=>{fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:'shoe'}});fireEvent.submit(screen.getByRole('search'));};
test('reference dialog has separate file and rear-camera inputs, validates selection and can cancel without request',async()=>{
 render(<App/>);await screen.findByRole('heading',{name:item.name});open();
 const dialog=screen.getByRole('dialog',{name:'البحث بالصورة'});
 expect(within(dialog).getByLabelText('التقط صورة')).toHaveAttribute('capture','environment');
 expect(within(dialog).getByLabelText('صورة البحث')).not.toHaveAttribute('capture');
 upload(new File(['bad'],'bad.txt',{type:'text/plain'}));expect(within(dialog).getByRole('alert')).toBeInTheDocument();
 expect(requests).toHaveLength(0);
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(requests).toHaveLength(0);
});
test('camera selection replaces text, retains chosen filters and confirms visual counts; clear image preserves filters',async()=>{
 render(<App/>);await screen.findByRole('heading',{name:item.name});
 fireEvent.change(screen.getByLabelText('المدينة'),{target:{value:'Tanger'}});
 submitText();await screen.findByRole('region',{name:'شروط البحث'});
 open();upload(picture(),'التقط صورة');
 const summary=await screen.findByRole('region',{name:'نتائج البحث بالصورة'});
 expect(requests.at(-1).body.get('visualVersion')).toBe('v49-1');
 expect(requests.at(-1).body.get('city')).toBe('Tanger');
 expect(requests.at(-1).u.searchParams.get('q')).toBe('');
 expect(screen.getByLabelText('البحث في الكتالوج')).toHaveValue('');
 expect(screen.queryByRole('region',{name:'شروط البحث'})).toBeNull();
 expect(within(summary).getByText('الملف نفسه · 1')).toBeInTheDocument();
 fireEvent.click(within(summary).getByRole('button',{name:'مسح الصورة'}));
 await screen.findByRole('heading',{name:item.name});expect(screen.getByLabelText('المدينة')).toHaveValue('Tanger');
 expect(screen.queryByRole('region',{name:'نتائج البحث بالصورة'})).toBeNull();
});
test('insufficient detail and inconsistent visual responses are not presented as empty catalog matches',async()=>{
 handler=()=>reply({code:'VISUAL_INSUFFICIENT_DETAIL'},422);
 render(<App/>);await screen.findByRole('heading',{name:item.name});open();upload(picture());
 await screen.findByText('الصورة فارغة أو تفاصيلها غير كافية. جرّب صورة واضحة للمنتج.');
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();expect(document.querySelector('.panel.empty')).toBeNull();
 handler=()=>reply({...visualFixture([item]),visualIdentityVerified:true});
 open();upload(picture());await screen.findByText('تعذر تأكيد نتائج البحث. أعد المحاولة.');
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();
});
test('late visual response cannot replace a newer text search',async()=>{
 let resolve;handler=()=>new Promise(r=>{resolve=r});
 render(<App/>);await screen.findByRole('heading',{name:item.name});open();upload(picture());
 await waitFor(()=>expect(resolve).toBeDefined());submitText();
 await screen.findByRole('region',{name:'شروط البحث'});
 expect(requests[0].signal.aborted).toBe(true);
 await act(async()=>resolve(await reply(visualFixture([{...item,name:'Stale visual item'}]))));
 expect(screen.queryByText('Stale visual item')).toBeNull();expect(screen.queryByRole('region',{name:'نتائج البحث بالصورة'})).toBeNull();
});
test('zero visual matches with incomplete index explicitly distinguishes insufficient coverage from absence',async()=>{
 handler=()=>{const d=visualFixture([]);d.visualSearch.unindexedCount=2;return reply(d)};
 render(<App/>);await screen.findByRole('heading',{name:item.name});open();upload(picture());
 const summary=await screen.findByRole('region',{name:'نتائج البحث بالصورة'});
 expect(within(summary).getByText(/البحث لا يشمل بعض الصور/)).toHaveTextContent('2');
 expect(within(summary).getByText(/لم نجد تشابهاً بصرياً كافياً/)).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();
});
