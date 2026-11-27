import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App from './App';
import {structuredFixture} from './structuredSearchFixture';
const item={_id:'1'.repeat(24),name:'Synthetic ceramic cups',category:'Kitchen',price:40,currency:'MAD',moq:10,unit:'piece',pricingMode:'fixed',priceTiers:[{minQty:10,maxQty:49,price:35},{minQty:50,price:20}],effectiveUnitPrice:35,availability:'in_stock',supplierId:{_id:'2'.repeat(24),name:'Synthetic supplier'},storeId:'3'.repeat(24)};
const reply=data=>Promise.resolve({ok:true,status:200,json:async()=>data});
const phrase='ceramic cups in Tanger under 30 MAD';
let requests,delayed,handler;
function response(body,options={}){
 const result=structuredFixture(body,options.products||[]);
 result.searchIntent={...result.searchIntent,terms:['أكواب','خزف'],city:'طنجة',maxPrice:30,strictMax:true,currency:'MAD',removable:['terms','city','maxPrice'],...options.intent};
 return {...result,...options.extra};
}
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');requests=[];delayed=null;
 handler=body=>response(body,{products:[],extra:{searchAlternatives:[{key:'maxPrice',total:1}]}});
 global.fetch=jest.fn((url,opt={})=>{
  const path=new URL(url,'http://localhost').pathname;
  if(path.endsWith('/ai-search')){const body=JSON.parse(opt.body);requests.push(body);const r=handler(body);return r instanceof Promise?r:reply(r);}
  if(path.endsWith('/products/search'))return reply({data:[item],pagination:{page:1,pages:1,total:1}});
  if(path.endsWith('/products/'+item._id))return reply({product:item});
  return reply({data:[],pagination:{page:1,limit:12,pages:0,total:0},unreadCount:0});
 });
});
const submit=q=>{fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:q}});fireEvent.submit(screen.getByRole('search'));};
const panel=()=>screen.getByRole('region',{name:'شروط البحث'});
test('real UI wiring never automatically relaxes a condition; alternative uses original phrase and other filters',async()=>{
 handler=body=>body.intentRemovals.includes('maxPrice')?response(body,{products:[item],intent:{maxPrice:null,strictMax:false,currency:null,removable:['terms','city']},extra:{searchPriceContext:{basis:'base',quantity:null}}}):response(body,{extra:{searchAlternatives:[{key:'maxPrice',total:1}]}});
 render(<App/>);await screen.findByRole('heading',{name:item.name});
 fireEvent.change(screen.getByLabelText('المدينة'),{target:{value:'Tanger'}});
 submit(phrase);await screen.findByRole('region',{name:'شروط البحث'});
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();
 expect(within(panel()).getByText('نتائج البحث · 0')).toBeInTheDocument();
 expect(requests.at(-1)).toMatchObject({query:phrase,intentVersion:'v49-1',intentRemovals:[],city:'Tanger',includeAlternatives:true});
 fireEvent.click(within(panel()).getByRole('button',{name:/ثمن الوحدة.*1 بديل/}));
 await screen.findByRole('heading',{name:item.name});expect(requests.at(-1)).toMatchObject({query:phrase,intentRemovals:['maxPrice'],city:'Tanger',page:1});
 expect(screen.getByRole('heading',{name:item.name}).closest('article').querySelector('.price')).toHaveAttribute('data-price-kind','range');
 expect(within(panel()).queryByRole('button',{name:/إزالة ثمن الوحدة/})).toBeNull();
 fireEvent.submit(screen.getByRole('search'));await waitFor(()=>expect(requests.at(-1).intentRemovals).toEqual([]));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:item.name})).toBeNull());
 fireEvent.click(within(await screen.findByRole('region',{name:'شروط البحث'})).getByRole('button',{name:'مسح البحث'}));
 await screen.findByRole('heading',{name:item.name});expect(screen.getByLabelText('البحث في الكتالوج')).toHaveValue('');
});
test('stale and mismatched search responses cannot expose old products or alternatives',async()=>{
 handler=body=>body.query===phrase?new Promise(resolve=>{delayed=()=>resolve(reply(response(body,{products:[item]})))}):response(body,{intent:{raw:'wrong phrase'}});
 render(<App/>);await screen.findByRole('heading',{name:item.name});submit(phrase);
 await waitFor(()=>expect(delayed).not.toBeNull());expect(screen.queryByRole('heading',{name:item.name})).toBeNull();
 submit('new query');await screen.findByText('تعذر تأكيد نتائج البحث. أعد المحاولة.');
 await act(async()=>delayed());
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();expect(screen.queryByRole('region',{name:'شروط البحث'})).toBeNull();
});
test('unknown delivery shows explicit warning and never offers sourcing until user removes it',async()=>{
 handler=body=>response(body,{intent:{delivery:true,issues:['delivery_unknown'],removable:['terms','city','maxPrice','delivery']},extra:{searchAlternatives:[{key:'delivery',total:1}],sourcingOffer:{canRequestSourcing:false}}});
 render(<App/>);await screen.findByRole('heading',{name:item.name});submit(phrase+' with delivery');
 await screen.findByText(/تكلفة التوصيل غير متوفرة/);
 expect(within(panel()).getByRole('button',{name:/إزالة شامل التوصيل/})).toBeEnabled();
 expect(screen.queryByRole('heading',{name:item.name})).toBeNull();
 expect(document.querySelector('.panel.empty')).toBeNull();
 expect(requests).toHaveLength(1);
});

test('confirmed MOQ and quantity price contexts stay visible with multilingual chips',async()=>{
 handler=body=>response(body,{products:[item],intent:{maxPrice:40,strictMax:true},extra:{searchPriceContext:{basis:'moq',quantity:null}}});
 render(<App/>);await screen.findByRole('heading',{name:item.name});submit('ceramic cups in Tanger under 40 MAD');
 await screen.findByText('عند الحد الأدنى: 10 piece');
 expect(screen.getByRole('heading',{name:item.name}).closest('article').querySelector('.price')).toHaveAttribute('data-price-kind','moq');
 fireEvent.change(screen.getByLabelText('لغة الواجهة'),{target:{value:'fr'}});
 const french=await screen.findByRole('region',{name:'Critères de recherche'});
 expect(within(french).getByRole('button',{name:/Retirer Tasses · Céramique/})).toBeInTheDocument();
 expect(screen.getByText('Au minimum : 10 piece')).toBeInTheDocument();
});
test('invalid numeric quantity is a confirmed zero-result clarification, not a network failure',async()=>{
 handler=body=>response(body,{intent:{quantity:0,issues:['quantity'],removable:[]},extra:{sourcingOffer:{canRequestSourcing:false}}});
 render(<App/>);await screen.findByRole('heading',{name:item.name});submit('cups quantity 0');
 await screen.findByText(/بعض الشروط متعارضة/);
 expect(screen.queryByText('تعذر تأكيد نتائج البحث. أعد المحاولة.')).toBeNull();
 expect(document.querySelector('.panel.empty')).toBeNull();
});
