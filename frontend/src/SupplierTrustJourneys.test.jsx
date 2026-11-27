import {structuredFixture} from './structuredSearchFixture';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
const supplier={_id:'2'.repeat(24),name:'Synthetic verified owner',isVerified:true,verificationStatus:'verified',businessTypes:['manufacturer']};
const pending={...supplier,_id:'3'.repeat(24),name:'Synthetic pending owner',verificationStatus:'pending'};
const product={_id:'4'.repeat(24),name:'Synthetic verified item',category:'Textile',price:20,currency:'MAD',moq:1,unit:'piece',availability:'in_stock',supplierId:supplier,storeId:'5'.repeat(24)};
const other={...product,_id:'6'.repeat(24),name:'Synthetic pending item',supplierId:pending,storeId:'7'.repeat(24)};
const stores=[{_id:product.storeId,name:'Synthetic verified store',supplierId:supplier},{_id:other.storeId,name:'Synthetic pending store',supplierId:pending}];
const response=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
let seen, pendingReply, delayUnfiltered, noVerifiedStores;
const requestBody=opt=>typeof opt.body==='string'?JSON.parse(opt.body):opt.body;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');
 seen=[];pendingReply=null;delayUnfiltered=false;noVerifiedStores=false;
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost'),p=u.pathname,b=requestBody(opt);
  const trust=u.searchParams.get('supplierTrust')||b?.supplierTrust||b?.get?.('supplierTrust')||'';
  const page=Number(u.searchParams.get('page')||b?.page||1);
  const type=u.searchParams.get('businessType')||b?.businessType||b?.get?.('businessType')||'';
  seen.push({p,trust,page,type,signal:opt.signal});
  const filter=items=>trust==='verified'?items.slice(0,1):items;
  const result=data=>({data,pagination:{page,limit:12,total:data.length,pages:data.length?1:0,hasNextPage:false,hasPrevPage:false}});
  if(p.endsWith('/stores')){
   const data=result(trust && noVerifiedStores ? [] : filter(stores));
   if(delayUnfiltered&&!trust){delayUnfiltered=false;return new Promise(resolve=>{pendingReply=()=>resolve(response(data))})}
   return response(data);
  }
  if(p.endsWith('/products/categories'))return response(result([{category:'Textile',count:trust?1:2}]));
  if(p.endsWith('/products/search')||p.endsWith('/ai-search')||p.endsWith('/image-search')){
   if(p.endsWith('/ai-search'))return response(structuredFixture(b,filter([product,other])));
   return response({...result(filter([product,other])),externalDiscovery:{enabled:true,results:[{url:'https://example.invalid',title:'Unverified external item'}]}});
  }
  return response({data:[],unreadCount:0});
 });
});
const choose=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}));
const trust=()=>screen.getByRole('group',{name:'فلاتر الثقة'});
test('verified is optional and unavailable signals cannot be selected; verified filter reaches all search paths',async()=>{
 render(<App/>);await screen.findByText(other.name);
 const toggle=within(trust()).getByRole('button',{name:'موردون موثقون'});
 expect(toggle).toHaveAttribute('aria-pressed','false');
 for(const label of ['الأعلى تقييماً','سرعة الاستجابة','داخل المغرب'])expect(within(trust()).getByRole('button',{name:label})).toBeDisabled();
 choose('المصنعون');choose('موردون موثقون');
 await waitFor(()=>expect(screen.queryByText(other.name)).toBeNull());
 await screen.findByText(product.name);
 expect(screen.queryByText('Unverified external item')).toBeNull();
 await waitFor(()=>expect(seen.some(r=>r.p.endsWith('/products/categories')&&r.trust==='verified'&&r.type==='manufacturer')).toBe(true));
 fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:'shoe'}});
 fireEvent.submit(screen.getByRole('search'));
 await waitFor(()=>expect(seen.some(r=>r.p.endsWith('/ai-search')&&r.trust==='verified'&&r.type==='manufacturer')).toBe(true));
 fireEvent.change(screen.getByLabelText('صورة البحث'),{target:{files:[new File(['synthetic'],'sample.png',{type:'image/png'})]}});
 await waitFor(()=>expect(seen.some(r=>r.p.endsWith('/image-search')&&r.trust==='verified'&&r.type==='manufacturer')).toBe(true));
 choose('إلغاء فلترة الثقة');await screen.findByText(other.name);
 expect(toggle).toHaveAttribute('aria-pressed','false');
 expect(seen.filter(r=>r.p.endsWith('/image-search')).at(-1)).toMatchObject({trust:'',type:'manufacturer',page:1});
});
test('directory scopes verified supplier status, clears stale responses and resets page',async()=>{
 window.history.replaceState({},'','/stores');delayUnfiltered=true;
 render(<App/>);await waitFor(()=>expect(pendingReply).not.toBeNull());
 const stale=seen.find(r=>r.p.endsWith('/stores'));
 choose('موردون موثقون');await screen.findByText(stores[0].name);
 expect(screen.getByText('مورد موثق')).toBeInTheDocument();
 expect(stale.signal.aborted).toBe(true);
 await act(async()=>pendingReply());
 expect(screen.queryByText(stores[1].name)).toBeNull();
 expect(seen.filter(r=>r.p.endsWith('/stores')).at(-1)).toMatchObject({page:1,trust:'verified'});
 choose('إلغاء فلترة الثقة');await screen.findByText(stores[1].name);
 expect(screen.getAllByText('مورد موثق')).toHaveLength(1);
});


test('empty verified directory does not claim that all approved stores are absent',async()=>{
 window.history.replaceState({},'','/stores');noVerifiedStores=true;
 render(<App/>);await screen.findByText(stores[1].name);
 choose('موردون موثقون');
 await screen.findByText('لا توجد متاجر لموردين موثقين تطابق هذا الاختيار حالياً.');
 expect(screen.queryByText('لا توجد متاجر معتمدة بعد')).toBeNull();
 choose('إلغاء فلترة الثقة');await screen.findByText(stores[1].name);
});
