import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { setSession, clearSession } from './api/session';
import { parseRoute, safeReturnTo } from './navigation';
import { FavoritesProvider, useFavorites } from './components/favorites/FavoritesContext';

const a='111111111111111111111111', b='222222222222222222222222', pid='333333333333333333333333', sid='444444444444444444444444';
const token = id => 'test.' + btoa(JSON.stringify({ id, exp: 9999999999 })) + '.signature';
const item = { _id:pid, name:'منتج المفضلة', category:'Test', price:20, currency:'MAD', unit:'قطعة', moq:10, availability:'in_stock', supplierId:{_id:sid,name:'مورد اختبار'}, storeId:sid };
const reply=(body,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>body});
let lists, role, missing, loseResponse, writes;
beforeEach(()=>{
  window.history.replaceState({},'','/'); localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  lists={[a]:[],[b]:[]}; role='buyer'; missing=false; loseResponse=false; writes=0;
  global.fetch=jest.fn((url,options={})=>{
    const path=new URL(url,'http://localhost').pathname.replace(/^\/api/,'');
    const id=options.headers?.Authorization?.includes(token(a))?a:b;
    if(path==='/suppliers/me/profile')return reply({_id:id,role,name:'Synthetic'});
    if(path==='/favorites')return reply({productIds:lists[id],limit:100});
    if(path==='/favorites/'+pid){writes++; if(options.method==='PUT')lists[id]=[pid];else lists[id]=[];
      if(loseResponse)return Promise.reject(new Error('offline after commit'));
      return reply({productId:pid,saved:options.method==='PUT'});}
    if(path==='/products/'+pid)return missing?reply({},404):reply({product:item});
    return reply({data:[item],pagination:{total:1,pages:1},unreadCount:0});
  });
});
const heart = name => screen.findByRole('button',{name:name+': '+item.name});
const saved = () => heart('إزالة من المفضلة');
const unsaved = () => heart('إضافة إلى المفضلة');
test('visitor can browse and heart opens login without creating a favorite',async()=>{
  render(<App/>);
  fireEvent.click(await heart('سجل الدخول لحفظ المنتج'));
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/products/'+pid);
  expect(writes).toBe(0);
  expect(fetch.mock.calls.some(([url])=>String(url).endsWith('/favorites'))).toBe(false);
});
test('buyer saves, reloads, visits favorites and removes using the real API contract',async()=>{
  setSession(token(a)); const view=render(<App/>);
  await waitFor(async()=>expect(await unsaved()).toBeEnabled());
  fireEvent.click(await unsaved());
  expect(await saved()).toHaveAttribute('aria-pressed','true');
  expect(lists[a]).toEqual([pid]);
  view.unmount(); render(<App/>);
  expect(await saved()).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getAllByRole('link',{name:'المفضلة'})[0]);
  expect(await screen.findByRole('heading',{name:'منتجاتي المفضلة'})).toBeInTheDocument();
  await waitFor(async()=>expect(await saved()).toBeEnabled());
  fireEvent.click(await saved());
  expect(await screen.findByText('لم تحفظ أي منتج بعد.')).toBeInTheDocument();
  expect(lists[a]).toEqual([]);
});
test('account switching never renders previous saved heart or list',async()=>{
  lists[a]=[pid]; setSession(token(a)); render(<App/>);
  expect(await saved()).toHaveAttribute('aria-pressed','true');
  act(()=>setSession(token(b)));
  await waitFor(async()=>expect(await unsaved()).toBeEnabled());
  expect(screen.queryByRole('button',{name:'إزالة من المفضلة: '+item.name})).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('link',{name:'المفضلة'})[0]);
  expect(await screen.findByText('لم تحفظ أي منتج بعد.')).toBeInTheDocument();
  act(()=>setSession(token(a)));
  expect(await saved()).toHaveAttribute('aria-pressed','true');
});
test('withdrawn saved product exposes no stale details and remains removable',async()=>{
  lists[a]=[pid]; missing=true; setSession(token(a)); window.history.replaceState({},'','/favorites'); render(<App/>);
  expect(await screen.findByText('لم يعد متاحاً في الكتالوج.')).toBeInTheDocument();
  expect(screen.queryByText(item.name)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'إزالة من المفضلة'}));
  expect(await screen.findByText('لم تحفظ أي منتج بعد.')).toBeInTheDocument();
});
test('lost mutation response is not represented as success and reload reconciles the server state',async()=>{
  setSession(token(a)); loseResponse=true; render(<App/>);
  await waitFor(async()=>expect(await unsaved()).toBeEnabled());
  fireEvent.click(await unsaved());
  expect(await screen.findByText('تعذر تأكيد الحفظ. أعد تحميل المفضلة للتحقق.')).toBeInTheDocument();
  expect((await heart('إعادة تحميل المفضلة'))).not.toHaveAttribute('aria-pressed');
  fireEvent.click(screen.getByRole('button',{name:'إعادة التحميل'}));
  expect(await saved()).toHaveAttribute('aria-pressed','true');
  expect(writes).toBe(1);
});
test('supplier cannot load private favorites or get a save control',async()=>{
  role='supplier'; setSession(token(a)); window.history.replaceState({},'','/favorites'); render(<App/>);
  expect(await screen.findByText('المفضلة متاحة لحساب المشتري فقط.')).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url])=>String(url).endsWith('/favorites'))).toBe(false);
});
test('favorites route is a buyer-only authentication return',()=>{
  expect(parseRoute('/favorites').page).toBe('favorites');
  expect(safeReturnTo('?returnTo=%2Ffavorites','buyer')).toBe('/favorites');
  expect(safeReturnTo('?returnTo=%2Ffavorites','supplier')).toBe('');
});
function Probe(){const f=useFavorites();return <><output>{f.ids===null?'unknown':f.ids.join(',')||'empty'}</output><button onClick={()=>f.toggle(pid)} disabled={f.busy||!f.ids}>toggle</button></>;}
test('late read after logout/account switch cannot populate the replacement session',async()=>{
  let finish;
  global.fetch=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(()=>reply({productIds:[],limit:100}));
  setSession(token(a)); const view=render(<FavoritesProvider token={token(a)} user={{role:'buyer'}}><Probe/></FavoritesProvider>);
  await waitFor(()=>expect(finish).toBeDefined());
  act(()=>setSession(token(b)));
  view.rerender(<FavoritesProvider token={token(b)} user={{role:'buyer'}}><Probe/></FavoritesProvider>);
  await screen.findByText('empty');
  await act(async()=>finish(await reply({productIds:[pid],limit:100})));
  expect(screen.getByText('empty')).toBeInTheDocument();
  expect(screen.queryByText(pid)).not.toBeInTheDocument();
});
test('late mutation after account switch cannot mark another account saved',async()=>{
  let finish;
  global.fetch=jest.fn((url,options)=>options.method==='PUT'?new Promise(resolve=>{finish=resolve}):reply({productIds:[],limit:100}));
  setSession(token(a)); const view=render(<FavoritesProvider token={token(a)} user={{role:'buyer'}}><Probe/></FavoritesProvider>);
  await screen.findByText('empty'); fireEvent.click(screen.getByText('toggle'));
  await waitFor(()=>expect(finish).toBeDefined());
  act(()=>setSession(token(b)));
  view.rerender(<FavoritesProvider token={token(b)} user={{role:'buyer'}}><Probe/></FavoritesProvider>);
  await screen.findByText('empty');
  await act(async()=>finish(await reply({productId:pid,saved:true})));
  expect(screen.getByText('empty')).toBeInTheDocument();
  act(()=>clearSession());
});
