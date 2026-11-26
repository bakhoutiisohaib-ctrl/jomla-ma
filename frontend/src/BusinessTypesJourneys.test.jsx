import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import RegisterPage from './components/auth/RegisterPage';
import BusinessTypeEditor from './components/suppliers/BusinessTypeEditor';
import { LanguageProvider } from './i18n/LanguageContext';
import { setSession, clearSession } from './api/session';

const typed = {_id:'111111111111111111111111',name:'Typed synthetic item',category:'Textile',price:20,currency:'MAD',moq:1,unit:'piece',availability:'in_stock',supplierId:{_id:'222222222222222222222222',name:'Typed supplier',businessTypes:['manufacturer']},storeId:'222222222222222222222222'};
const legacy = {...typed,_id:'333333333333333333333333',name:'Legacy synthetic item',supplierId:{_id:'444444444444444444444444',name:'Legacy supplier'}};
const store = {_id:'555555555555555555555555',name:'Typed synthetic store',supplierId:typed.supplierId};
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
let declaration, lost, failedStore;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');
 declaration=['manufacturer'];lost=false;failedStore=false;
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost'),p=u.pathname;
  if(p.endsWith('/suppliers/me/profile')) return reply({role:'supplier',businessTypes:declaration,name:'Synthetic owner'});
  if(p.endsWith('/suppliers/me/business-types')){declaration=JSON.parse(opt.body).businessTypes;return lost?Promise.reject(Error('offline')):reply({businessTypes:declaration});}
  if(p.endsWith('/suppliers/register'))return reply({token:'synthetic-token',supplier:{role:JSON.parse(opt.body).role,_id:typed.supplierId._id}},201);
  if(p.endsWith('/stores')) return failedStore?reply({},503):reply({data:u.searchParams.get('businessType')==='wholesaler'?[]:[store]});
  if(p.endsWith('/products/search')||p.endsWith('/ai-search')||p.endsWith('/image-search')){
   const type=u.searchParams.get('businessType') || (typeof opt.body==='string'?JSON.parse(opt.body).businessType:opt.body?.get('businessType'));
   const data=type==='manufacturer'?[typed]:type?[]:[typed,legacy];
   return reply({data,pagination:{pages:1,total:data.length},externalDiscovery:{enabled:true,results:[{url:'https://example.invalid',title:'External unclassified item'}]}});
  }
  return reply({data:[],unreadCount:0});
 });
});
const choose=name=>fireEvent.click(screen.getByRole('button',{name}));
const loadItem= name=>screen.findByRole('button',{name:'معاينة سريعة: '+name});
const wrap=child=>render(<LanguageProvider>{child}</LanguageProvider>);
test('catalog type selection filters real API, preserves legacy general browse, and reset restores results',async()=>{
 render(<App/>);await loadItem(legacy.name);
 choose('المصنعون');await loadItem(typed.name);
 expect(screen.getByRole('button',{name:'المصنعون'})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('button',{name:'معاينة سريعة: '+legacy.name})).toBeNull();
 expect(screen.queryByText('External unclassified item')).toBeNull();
 expect(fetch.mock.calls.some(([u])=>String(u).includes('businessType=manufacturer'))).toBe(true);
 choose('تجار الجملة');
 await waitFor(()=>expect(screen.queryByRole('button',{name:'معاينة سريعة: '+typed.name})).toBeNull());
 choose('إعادة ضبط البحث');await loadItem(legacy.name);
 expect(screen.getByRole('button',{name:'المصنعون'})).toHaveAttribute('aria-pressed','false');
});
test('text and image search retain the selected activity',async()=>{
 render(<App/>);await loadItem(legacy.name);choose('المصنعون');await loadItem(typed.name);
 fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:'shoe'}});
 fireEvent.submit(screen.getByRole('search'));
 await waitFor(()=>expect(fetch.mock.calls.some(([u,o])=>String(u).includes('/ai-search')&&JSON.parse(o.body).businessType==='manufacturer')).toBe(true));
 fireEvent.change(screen.getByLabelText('صورة البحث'),{target:{files:[new File(['synthetic'],'test.png',{type:'image/png'})]}});
 await waitFor(()=>expect(fetch.mock.calls.some(([u,o])=>String(u).includes('/image-search')&&o.body.get('businessType')==='manufacturer')).toBe(true));
});
test('directory filters declared activity and distinguishes empty from failure',async()=>{
 window.history.replaceState({},'','/stores');render(<App/>);await screen.findByText(store.name);
 expect(screen.getByText('نشاط مصرح به: مصنّع')).toBeInTheDocument();
 choose('تجار الجملة');await screen.findByText('لا توجد متاجر مطابقة لهذا النشاط حالياً.');
 failedStore=true;choose('المصنعون');await screen.findByRole('alert');
 expect(screen.queryByText('لا توجد متاجر مطابقة لهذا النشاط حالياً.')).toBeNull();
 failedStore=false;choose('إعادة المحاولة');await screen.findByText(store.name);
});
test('supplier registration sends only explicit selected activities',async()=>{
 const onRegister=jest.fn();wrap(<RegisterPage initialRole="supplier" onRegister={onRegister}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'مصنّع'}));fireEvent.click(screen.getByRole('checkbox',{name:'مستورد'}));
 const form=document.querySelector('form');
 for(const [name,value] of Object.entries({name:'Synthetic owner',email:'test@local.test',password:'Synthetic123!',confirmPassword:'Synthetic123!',phone:'0611111111',city:'Fes'}))fireEvent.change(form.elements[name],{target:{value}});
 fireEvent.submit(form);await waitFor(()=>expect(onRegister).toHaveBeenCalled());
 expect(JSON.parse(fetch.mock.calls.find(([u])=>String(u).endsWith('/suppliers/register'))[1].body).businessTypes).toEqual(['manufacturer','importer']);
});
test('buyer registration does not send supplier declaration',async()=>{
 const view=wrap(<RegisterPage initialRole="supplier" onRegister={jest.fn()}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'مصنّع'}));
 fireEvent.change(screen.getByLabelText('نوع الحساب'),{target:{value:'buyer'}});
 expect(screen.queryByRole('checkbox',{name:'مصنّع'})).toBeNull();
 const form=document.querySelector('form');
 for(const [name,value] of Object.entries({email:'test@local.test',password:'Synthetic123!',confirmPassword:'Synthetic123!'}))fireEvent.change(form.elements[name],{target:{value}});
 fireEvent.submit(form);await screen.findByText('حسابك واجد');
 expect(JSON.parse(fetch.mock.calls.find(([u])=>String(u).endsWith('/suppliers/register'))[1].body)).not.toHaveProperty('businessTypes');
 view.unmount();
});
test('owner saves, clears and reconciles a lost response without false confirmation',async()=>{
 setSession('synthetic-owner-a');wrap(<BusinessTypeEditor/>);
 const manufacturer=await screen.findByRole('checkbox',{name:'مصنّع'});
 expect(manufacturer).toBeChecked();
 fireEvent.click(screen.getByRole('checkbox',{name:'مستورد'}));choose('حفظ النشاط التجاري');
 await screen.findByText('تم حفظ النشاط التجاري');expect(declaration).toEqual(['manufacturer','importer']);
 lost=true;fireEvent.click(manufacturer);fireEvent.click(screen.getByRole('checkbox',{name:'مستورد'}));choose('حفظ النشاط التجاري');
 await screen.findByRole('alert');expect(screen.queryByText('تم حفظ النشاط التجاري')).toBeNull();expect(declaration).toEqual([]);
 lost=false;choose('إعادة تحميل النشاط');expect(await screen.findByRole('checkbox',{name:'مصنّع'})).not.toBeChecked();
 act(()=>clearSession());
});
test('late owner response cannot populate a replacement session',async()=>{
 let resolve;
 setSession('synthetic-a');
 fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 wrap(<BusinessTypeEditor/>);
 await waitFor(()=>expect(resolve).toBeDefined());
 declaration=['wholesaler'];act(()=>setSession('synthetic-b'));
 expect(await screen.findByRole('checkbox',{name:'تاجر جملة'})).toBeChecked();
 await act(async()=>resolve(await reply({role:'supplier',businessTypes:['manufacturer']})));
 expect(screen.getByRole('checkbox',{name:'مصنّع'})).not.toBeChecked();
 act(()=>clearSession());
});
