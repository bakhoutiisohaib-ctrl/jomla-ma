import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App from './App';
import {comparisonFixture} from './comparisonFixture';
import {confirmComparable} from './components/products/ComparableOffersDialog';
const a={_id:'1'.repeat(24),name:'Ceramic cups A',category:'Kitchen',taxonomyPath:'home/decor',unit:'piece',currency:'MAD',moq:10,price:40,priceTiers:[{minQty:10,maxQty:49,price:35},{minQty:50,price:20}],pricingMode:'fixed',availability:'in_stock',supplierId:{_id:'a'.repeat(24),name:'Supplier A'}};
const b={...a,_id:'2'.repeat(24),name:'Ceramic cups B',price:25,priceTiers:[],supplierId:{_id:'b'.repeat(24),name:'Supplier B'}};
const c={...b,_id:'3'.repeat(24),name:'Ceramic cups C',moq:100};
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
let calls,handler;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');calls=[];
 handler=(id,qty,page)=>reply(comparisonFixture(id===b._id?b:a,qty,page,id===b._id?[a,c]:[b,c]));
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost'),p=u.pathname;
  if(p.endsWith('/comparable')){const id=p.split('/').at(-2),qty=Number(u.searchParams.get('quantity')),page=Number(u.searchParams.get('page'));calls.push({id,qty,page,opt});return handler(id,qty,page);}
  if(p.endsWith('/products/'+a._id))return reply({product:a});
  if(p.endsWith('/products/'+b._id))return reply({product:b});
  if(p.endsWith('/products/search'))return reply({data:[a],pagination:{pages:1,total:1}});
  return reply({data:[],pagination:{page:1,pages:0,total:0},unreadCount:0});
 });
});
const dialog=()=>screen.getByRole('dialog',{name:'مقارنة منتجات من النوع نفسه'});
const rows=()=>[...dialog().querySelectorAll('.atlas-comparison-row')];
async function open(){fireEvent.click(await screen.findByRole('button',{name:'معاينة سريعة: '+a.name}));fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button',{name:'مقارنة'}));}
function quantity(v){fireEvent.change(within(dialog()).getByLabelText('الكمية المطلوبة'),{target:{value:v}});fireEvent.click(within(dialog()).getByRole('button',{name:'احسب'}));}
test('comparison opens from preview, finds other suppliers outside current page, recalculates same quantity and navigates',async()=>{
 render(<App/>);await open();await waitFor(()=>expect(rows()).toHaveLength(3));
 expect(rows().map(r=>r.querySelector('strong').textContent)).toEqual([b.name,a.name,c.name]);
 expect(rows()[2]).toHaveAttribute('data-quote-kind','below_moq');
 expect(calls[0].opt.headers).toEqual({});
 quantity('50');await waitFor(()=>expect(rows()[0]).toHaveTextContent(a.name));
 expect(rows()[0]).toHaveTextContent(/1[.\s\u00a0\u202f]?000/);
 expect(calls.at(-1)).toMatchObject({id:a._id,qty:50,page:1});
 fireEvent.click(within(dialog()).getByRole('link',{name:'عرض '+b.name}));
 expect(await screen.findByRole('heading',{name:b.name,level:1})).toBeInTheDocument();expect(screen.queryByRole('dialog')).toBeNull();
});
test('detail entry uses chosen quantity; invalid input and stale responses cannot show old prices',async()=>{
 window.history.replaceState({},'','/products/'+a._id);render(<App/>);
 await screen.findByRole('heading',{name:a.name,level:1});
 fireEvent.change(screen.getByLabelText('اختر الكمية'),{target:{value:'20'}});
 let complete;handler=()=>new Promise(r=>{complete=r});
 fireEvent.click(within(screen.getByRole('region',{name:'إجراءات المنتج'})).getByRole('button',{name:'مقارنة'}));
 await waitFor(()=>expect(calls[0]?.qty).toBe(20));
 const old=complete;
 quantity('0');expect(within(dialog()).getByRole('alert')).toHaveTextContent('أدخل كمية صحيحة موجبة.');expect(rows()).toHaveLength(0);
 handler=(id,qty,page)=>reply(comparisonFixture(a,qty,page,[b,c]));
 quantity('50');await waitFor(()=>expect(rows()).toHaveLength(3));
 await act(async()=>old(await reply(comparisonFixture(a,20,1,[b,c]))));
 expect(calls[0].opt.signal.aborted).toBe(true);expect(rows()[0]).toHaveTextContent(a.name);
});
test('withdrawn anchor and unconfirmed context never retain old estimates',async()=>{
 render(<App/>);await open();await waitFor(()=>expect(rows()).toHaveLength(3));
 handler=()=>reply({message:'Product unavailable'},404);
 quantity('50');await within(dialog()).findByText('المنتج لم يعد متاحاً للمقارنة.');expect(rows()).toHaveLength(0);
 handler=()=>reply({...comparisonFixture(a,50,1,[b]),quantity:20});
 fireEvent.click(within(dialog()).getByRole('button',{name:'إعادة المحاولة'}));
 await within(dialog()).findByText('تعذر تأكيد المقارنة. أعد المحاولة.');expect(rows()).toHaveLength(0);
});
test('contract rejects mixed currency, bad total, duplicate row, and unconfirmed identity',()=>{
 const d=comparisonFixture(a,50,1,[b,c]);
 expect(confirmComparable(d,a._id,50,1)).toBe(d);
 for(const bad of [{...d,identityVerified:true},{...d,offers:d.offers.map((r,i)=>i===0?{...r,currency:'EUR'}:r)},{...d,offers:d.offers.map((r,i)=>i===0?{...r,quote:{...r.quote,total:3}}:r)},{...d,offers:[d.offers[0],d.offers[0],d.offers[2]]}])expect(()=>confirmComparable(bad,a._id,50,1)).toThrow('UNCONFIRMED_COMPARISON');
});

test('expanded product image leads to the same comparison without stacking dialogs',async()=>{
 window.history.replaceState({},'','/products/'+a._id);
 const old=fetch.getMockImplementation();
 fetch.mockImplementation((url,opt)=>{
   const path=new URL(url,'http://localhost').pathname;
   if(path.endsWith('/products/'+a._id))return reply({product:{...a,imageUrl:'/uploads/synthetic.png'}});
   if(path.includes('/media/'))return Promise.resolve({ok:true,status:200,blob:async()=>new Blob(['x'],{type:'image/png'})});
   return old(url,opt);
 });
 URL.createObjectURL=jest.fn(()=> 'blob:synthetic');
 URL.revokeObjectURL=jest.fn();
 render(<App/>);fireEvent.click(await screen.findByRole('button',{name:'تكبير صورة المنتج'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'صور المنتج'})).getByRole('button',{name:'مقارنة منتجات من النوع نفسه'}));
 await waitFor(()=>expect(rows()).toHaveLength(3));expect(screen.getAllByRole('dialog')).toHaveLength(1);
 expect(calls[0].id).toBe(a._id);
});
