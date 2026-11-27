import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

const all=Array.from({length:105},(_,i)=>({_id:(i+1).toString(16).padStart(24,'0'),name:'Synthetic store '+(i+1),supplierId:{businessTypes:['manufacturer']}}));
const other={_id:'f'.repeat(24),name:'Synthetic importer',supplierId:{businessTypes:['importer']}};
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
let source, pending, delayPage, failPage, malformed, seen;
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/stores');
 source=[...all,other];pending=null;delayPage=null;failPage=null;malformed=false;seen=[];
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost');
  if(u.pathname.endsWith('/stores')){
   const page=Number(u.searchParams.get('page')),limit=Number(u.searchParams.get('limit')),type=u.searchParams.get('businessType');
   seen.push({page,limit,type,signal:opt.signal});
   const items=source.filter(s=>!type||s.supplierId.businessTypes.includes(type));
   const pages=Math.ceil(items.length/limit);
   const result={data:items.slice((page-1)*limit,page*limit),pagination:{page,limit,pages,total:items.length,hasNextPage:page<pages,hasPrevPage:page>1}};
   if(malformed)return reply({data:[]});
   if(failPage===page)return reply({},503);
   if(delayPage===page){delayPage=null;return new Promise(resolve=>{pending=()=>resolve(reply(result))})}
   return reply(result);
  }
  return reply({data:[],unreadCount:0,pagination:{pages:0,total:0}});
 });
});
const pager=()=>screen.getByRole('navigation',{name:'صفحات دليل المتاجر'});
const next=()=>fireEvent.click(within(pager()).getByRole('button',{name:'التالي'}));
const prev=()=>fireEvent.click(within(pager()).getByRole('button',{name:'السابق'}));
const choose=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}));
test('reaches all 106 stores in bounded pages and preserves previous navigation',async()=>{
 render(<App/>);await screen.findByText('Synthetic store 1');
 expect(screen.getByText('106 متجر')).toBeInTheDocument();
 expect(within(pager()).getByRole('button',{name:'السابق'})).toBeDisabled();
 for(let page=2;page<=9;page++){
  next();await screen.findByText('Synthetic store '+((page-1)*12+1));
  expect(within(pager()).getByText(page+' / 9')).toBeInTheDocument();
 }
 expect(screen.getByText('Synthetic store 105')).toBeInTheDocument();
 expect(screen.getByText(other.name)).toBeInTheDocument();
 expect(within(pager()).getByRole('button',{name:'التالي'})).toBeDisabled();
 prev();await screen.findByText('Synthetic store 85');
 expect(screen.getByRole('heading',{name:'المتاجر المعتمدة'})).toHaveFocus();
 expect(seen.every(r=>r.limit===12)).toBe(true);
 expect(seen.map(r=>r.page)).toEqual([1,2,3,4,5,6,7,8,9,8]);
});
test('activity change aborts delayed page and resets to first page without stale rows',async()=>{
 render(<App/>);await screen.findByText('Synthetic store 1');
 choose('المصنعون');await waitFor(()=>expect(seen.at(-1).type).toBe('manufacturer'));await screen.findByText('105 متجر');
 delayPage=2;next();await waitFor(()=>expect(pending).not.toBeNull());
 const stale=seen.at(-1);
 choose('المستوردون');await screen.findByText(other.name);
 expect(stale.signal.aborted).toBe(true);
 expect(seen.at(-1)).toMatchObject({page:1,type:'importer'});
 await act(async()=>pending());
 expect(screen.queryByText('Synthetic store 13')).toBeNull();
 expect(screen.queryByRole('navigation',{name:'صفحات دليل المتاجر'})).toBeNull();
 choose('كل الموردين');await screen.findByText('Synthetic store 1');
 expect(seen.at(-1)).toMatchObject({page:1,type:null});
});
test('page error remains distinct from empty and retry reloads the same page',async()=>{
 render(<App/>);await screen.findByText('Synthetic store 1');
 failPage=2;next();await screen.findByRole('alert');
 expect(screen.queryByText('لا توجد متاجر معتمدة بعد')).toBeNull();
 failPage=null;choose('إعادة المحاولة');await screen.findByText('Synthetic store 13');
 expect(within(pager()).getByText('2 / 9')).toBeInTheDocument();
 expect(seen.at(-1).page).toBe(2);
});
test('shrinking directory corrects an out-of-range page; malformed metadata is not empty success',async()=>{
 render(<App/>);await screen.findByText('Synthetic store 1');
 source=source.slice(0,3);next();await screen.findByText('3 متجر');
 expect(seen.map(r=>r.page)).toEqual([1,2,1]);
 expect(screen.queryByRole('navigation',{name:'صفحات دليل المتاجر'})).toBeNull();
 malformed=true;choose('المصنعون');await screen.findByRole('alert');
 expect(screen.queryByText('لا توجد متاجر مطابقة لهذا النشاط حالياً.')).toBeNull();
});
