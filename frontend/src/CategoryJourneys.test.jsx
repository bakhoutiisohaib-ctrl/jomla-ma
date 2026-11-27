import {structuredFixture} from './structuredSearchFixture';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
const item={_id:'111111111111111111111111',name:'Synthetic first product',category:'Textile',price:20,currency:'MAD',moq:1,unit:'piece',availability:'in_stock',supplierId:{_id:'222222222222222222222222',name:'Synthetic supplier'},storeId:'222222222222222222222222'};
const labels=['Textile',...Array.from({length:11},(_,i)=>'Category '+i),'Beyond first page'];
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
const directory=(page,names)=>({data:names.slice((page-1)*12,page*12).map(category=>({category,count:1})),pagination:{page,limit:12,total:names.length,pages:Math.ceil(names.length/12),hasNextPage:page*12<names.length,hasPrevPage:page>1}});
let fail, deferred, requestDelay, scopeNames;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');
 fail=false;deferred=null;requestDelay=false;scopeNames=['Factory category'];
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost'),p=u.pathname;
  if(p.endsWith('/products/categories')){
   if(fail)return reply({},503);
   const page=Number(u.searchParams.get('page')),type=u.searchParams.get('businessType');
   if(requestDelay&&!type){requestDelay=false;return new Promise(resolve=>{deferred=resolve})}
   return reply(directory(page,type==='manufacturer'?scopeNames:type?[]:labels));
  }
  if(p.endsWith('/products/search')||p.endsWith('/ai-search')||p.endsWith('/image-search')){
   const category=u.searchParams.get('category')||(typeof opt.body==='string'?JSON.parse(opt.body).category:opt.body?.get('category'));
   const data=category&&category!=='Textile'?[]:[item];if(p.endsWith('/ai-search'))return reply(structuredFixture(JSON.parse(opt.body),data));return reply({data,pagination:{pages:1,total:data.length}});
  }
  return reply({data:[],unreadCount:0});
 });
});
const choose=name=>fireEvent.click(screen.getByRole('button',{name}));
const rail=()=>screen.getByRole('region',{name:'استكشف حسب الفئة'});
const queries=()=>fetch.mock.calls.filter(([u])=>String(u).includes('/products/categories')).map(([u])=>new URL(u,'http://localhost').searchParams);
test('directory pagination exposes categories beyond current product page without refetching products',async()=>{
 render(<App/>);await screen.findByRole('button',{name:'Textile'});
 expect(screen.queryByRole('button',{name:'Beyond first page'})).toBeNull();
 const before=fetch.mock.calls.filter(([u])=>String(u).includes('/products/search')).length;
 choose('فئات أخرى');await screen.findByRole('button',{name:'Beyond first page'});
 expect(fetch.mock.calls.filter(([u])=>String(u).includes('/products/search'))).toHaveLength(before);
 choose('Beyond first page');
 await waitFor(()=>expect(fetch.mock.calls.some(([u])=>String(u).includes('/products/search')&&new URL(u,'http://localhost').searchParams.get('category')==='Beyond first page'&&new URL(u,'http://localhost').searchParams.get('categoryMode')==='exact')).toBe(true));
 expect(screen.getByRole('button',{name:'Beyond first page'})).toHaveAttribute('aria-pressed','true');
 choose('الفئات السابقة');await screen.findByRole('button',{name:'Textile'});
 expect(within(rail()).getByText(/الفئة المفلترة: Beyond first page/)).toBeInTheDocument();
 choose('كل الفئات');await screen.findByRole('button',{name:'معاينة سريعة: '+item.name});
});
test('directory is independent of search results, text/image requests retain exact selection',async()=>{
 render(<App/>);await screen.findByRole('button',{name:'Textile'});choose('Textile');
 fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:'shoe'}});
 fireEvent.submit(screen.getByRole('search'));
 await waitFor(()=>expect(fetch.mock.calls.some(([u,o])=>String(u).includes('/ai-search')&&JSON.parse(o.body).categoryMode==='exact')).toBe(true));
 expect(screen.getByRole('button',{name:'Category 0'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('صورة البحث'),{target:{files:[new File(['synthetic'],'test.png',{type:'image/png'})]}});
 await waitFor(()=>expect(fetch.mock.calls.some(([u,o])=>String(u).includes('/image-search')&&o.body.get('categoryMode')==='exact')).toBe(true));
 fireEvent.change(screen.getByLabelText('الفئة'),{target:{value:'Text'}});
 await waitFor(()=>expect(fetch.mock.calls.some(([u,o])=>String(u).includes('/image-search')&&o.body.get('category')==='Text'&&!o.body.has('categoryMode'))).toBe(true));
 expect(screen.getByRole('button',{name:'Textile'})).toHaveAttribute('aria-pressed','false');
});
test('activity scope hides old categories immediately and discards a late directory response',async()=>{
 requestDelay=true;render(<App/>);await waitFor(()=>expect(deferred).not.toBeNull());
 choose('المصنعون');await screen.findByRole('button',{name:'Factory category'});
 expect(queries().some(p=>p.get('businessType')==='manufacturer'&&p.get('page')==='1')).toBe(true);
 await act(async()=>deferred(await reply(directory(1,labels))));
 expect(screen.queryByRole('button',{name:'Textile'})).toBeNull();
 choose('تجار الجملة');await screen.findByText('لا توجد فئات منشورة لهذا الاختيار حالياً.');
 expect(screen.queryByRole('button',{name:'Factory category'})).toBeNull();
 choose('إعادة ضبط البحث');await screen.findByRole('button',{name:'Textile'});
});
test('directory error is not shown as empty, retries independently and never invents a category from products',async()=>{
 fail=true;render(<App/>);await screen.findByText('تعذر تحميل دليل الفئات.');
 expect(within(rail()).queryByRole('button',{name:'Textile'})).toBeNull();
 expect(screen.queryByText('لا توجد فئات منشورة لهذا الاختيار حالياً.')).toBeNull();
 await screen.findByRole('button',{name:'معاينة سريعة: '+item.name});
 fail=false;choose('إعادة تحميل الفئات');await screen.findByRole('button',{name:'Textile'});
 choose('فئات أخرى');await screen.findByRole('button',{name:'Beyond first page'});
 choose('Beyond first page');choose('إعادة ضبط البحث');
 await screen.findByRole('button',{name:'Textile'});
 expect(screen.queryByRole('button',{name:'Beyond first page'})).toBeNull();
});
test('malformed directory response is rejected without exposing its labels',async()=>{
 const original=fetch.getMockImplementation();
 fetch.mockImplementation((url,opt)=>String(url).includes('/products/categories')?reply({data:[{category:'Private-looking label',count:-1}],pagination:{page:1,limit:12,total:1,pages:1,hasNextPage:false,hasPrevPage:false}}):original(url,opt));
 render(<App/>);await screen.findByText('تعذر تحميل دليل الفئات.');
 expect(screen.queryByRole('button',{name:'Private-looking label'})).toBeNull();
});
