import {visualFixture} from './visualSearchFixture';
import {structuredFixture} from './structuredSearchFixture';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import ProductEditor from './components/suppliers/ProductEditor';
import { LanguageProvider } from './i18n/LanguageContext';
import { parseTaxonomy } from './components/common/ProductTaxonomy';

const labels = (ar, en = ar) => [ar, en, en];
const sector = (key, name, children) => ({ key, labels: labels(name), children: children.map(([leaf, label]) => ({path:key+'/'+leaf,labels:labels(label)})) });
const directory = {version:'v49-1',sectors:[
 sector('textile','النسيج والملابس',[['kids','ملابس الأطفال'],['shoes','الأحذية']]),
 sector('home','المنزل والديكور',[['fixtures','الأبواب والنوافذ'],['decor','الديكور']]),
 sector('building','البناء والتجهيز',[['fixtures','الأبواب والنوافذ'],['tools','الأدوات']]),
 ...Array.from({length:7},(_,i)=>sector('fixture'+i,'Fixture '+i,Array.from({length:i===0?6:4},(_,n)=>['leaf'+n,'Leaf '+n])))
]};
const item = {_id:'111111111111111111111111',name:'Synthetic product',category:'Original label',taxonomyPath:'textile/kids',price:20,currency:'MAD',moq:1,unit:'piece',availability:'in_stock',supplierId:{_id:'222222222222222222222222',name:'Synthetic supplier'},storeId:'333333333333333333333333'};
const reply=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
const requests=path=>fetch.mock.calls.filter(([url])=>new URL(url,'http://localhost').pathname.endsWith(path));
const params=url=>new URL(url,'http://localhost').searchParams;
let failTaxonomy, delayed, delayCategory, writes, failSave;
const originalCrypto=globalThis.crypto;
beforeAll(()=>Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:a=>require('crypto').randomFillSync(a)}}));
afterAll(()=>Object.defineProperty(globalThis,'crypto',{configurable:true,value:originalCrypto}));
beforeEach(()=>{
 localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/');
 failTaxonomy=false;delayed=null;delayCategory=false;writes=[];failSave=false;
 global.fetch=jest.fn((url,opt={})=>{
  const u=new URL(url,'http://localhost'),p=u.pathname;
  if(p.endsWith('/products/taxonomy')) return failTaxonomy?reply({},503):reply(directory);
  if(p.endsWith('/products/categories')){
   const scope=u.searchParams.get('taxonomyPath');
   const result={data:[{category:scope?'Scoped label':'Original label',count:1}],pagination:{page:1,limit:12,total:1,pages:1,hasNextPage:false,hasPrevPage:false}};
   if(delayCategory&&!scope){delayCategory=false;return new Promise(resolve=>{delayed=()=>resolve(reply(result))})}
   return reply(result);
  }
  if(p.endsWith('/products/search')||p.endsWith('/ai-search')||p.endsWith('/image-search')){
   const body=typeof opt.body==='string'?JSON.parse(opt.body):{};
   const scope=u.searchParams.get('taxonomyPath')||body.taxonomyPath||opt.body?.get?.('taxonomyPath');
   const data=scope==='building/fixtures'?[]:[item];
   if(p.endsWith('/ai-search'))return reply(structuredFixture(body,data));
   if(p.endsWith('/image-search'))return reply(visualFixture(data,Number(u.searchParams.get('page'))));
   return reply({data,pagination:{page:1,pages:1,total:data.length},externalDiscovery:{enabled:false}});
  }
  if((p.endsWith('/products')||p.endsWith('/products/'+item._id))&&['POST','PUT'].includes(opt.method)){
   writes.push({body:JSON.parse(opt.body),key:opt.headers['Idempotency-Key'],method:opt.method});
   if(failSave){failSave=false;return reply({},503)}
   return reply({product:{_id:opt.method==='PUT'?item._id:'synthetic-taxonomy-draft',isDraft:true}},201);
  }
  return reply({data:[],unreadCount:0});
 });
});
const choose=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}));
const editorOpen=()=>choose('اختيار القطاع والفئة الفرعية (اختياري)');
const change=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
test('taxonomy parser rejects duplicate paths and accepts identical child keys in distinct sectors',()=>{
 expect(parseTaxonomy(directory)).toHaveLength(10);
 const broken=JSON.parse(JSON.stringify(directory));
 broken.sectors[1].children[0].path='building/fixtures';
 expect(()=>parseTaxonomy(broken)).toThrow();
 expect(()=>parseTaxonomy({version:'bad',sectors:directory.sectors})).toThrow();
});
test('buyer chooses sector and scoped leaf, combines activity, text and image then resets',async()=>{
 render(<App/>);await screen.findByRole('button',{name:'النسيج والملابس'});
 choose('النسيج والملابس');choose('ملابس الأطفال');choose('المصنعون');
 await waitFor(()=>expect(requests('/products/search').some(([url])=>params(url).get('taxonomyPath')==='textile/kids'&&params(url).get('businessType')==='manufacturer')).toBe(true));
 await waitFor(()=>expect(requests('/products/categories').some(([url])=>params(url).get('taxonomyPath')==='textile/kids'&&params(url).get('businessType')==='manufacturer')).toBe(true));
 change('البحث في الكتالوج','shoe');fireEvent.submit(screen.getByRole('search'));
 await waitFor(()=>expect(requests('/ai-search').some(([,o])=>JSON.parse(o.body).taxonomyPath==='textile/kids')).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'بحث بالصورة'}));
 fireEvent.change(screen.getByLabelText('صورة البحث'),{target:{files:[new File(['test'],'synthetic.png',{type:'image/png'})]}});
 await waitFor(()=>expect(requests('/image-search').some(([,o])=>o.body.get('taxonomyPath')==='textile/kids'&&o.body.get('businessType')==='manufacturer')).toBe(true));
 choose('إعادة ضبط البحث');
 await waitFor(()=>expect(screen.getByRole('button',{name:'كل القطاعات'})).toHaveAttribute('aria-pressed','true'));
 expect(screen.queryByRole('button',{name:'ملابس الأطفال'})).toBeNull();
});
test('sector transition clears stale free-text category and directory responses',async()=>{
 delayCategory=true;render(<App/>);await screen.findByRole('button',{name:'البناء والتجهيز'});await waitFor(()=>expect(delayed).not.toBeNull());
 change('الفئة','Old free text');choose('البناء والتجهيز');choose('الأبواب والنوافذ');
 await waitFor(()=>expect(requests('/products/search').some(([url])=>params(url).get('taxonomyPath')==='building/fixtures'&&!params(url).has('category'))).toBe(true));
 await screen.findByRole('button',{name:'Scoped label'});
 await act(async()=>delayed());
 expect(screen.queryByRole('button',{name:'Original label'})).toBeNull();
 choose('المنزل والديكور');choose('الأبواب والنوافذ');
 await waitFor(()=>expect(requests('/products/search').some(([url])=>params(url).get('taxonomyPath')==='home/fixtures')).toBe(true));
});
test('taxonomy service failure preserves ordinary catalog and retries without invented sectors',async()=>{
 failTaxonomy=true;render(<App/>);await screen.findByText('تعذر تحميل التصنيف.');
 expect(screen.queryByRole('button',{name:'النسيج والملابس'})).toBeNull();
 await screen.findByRole('button',{name:'Original label'});
 failTaxonomy=false;choose('إعادة تحميل القطاعات');await screen.findByRole('button',{name:'النسيج والملابس'});
});
test('supplier explicitly selects a leaf, retains legacy label and replays same taxonomy save identity',async()=>{
 const saved=jest.fn();
 render(<LanguageProvider><ProductEditor stores={[]} onSaved={saved} onCancel={()=>{}}/></LanguageProvider>);
 expect(requests('/products/taxonomy')).toHaveLength(0);
 change('الفئة','Original label');editorOpen();await screen.findByLabelText('القطاع الرئيسي');
 change('القطاع الرئيسي','textile');change('الفئة الفرعية','textile/kids');
 choose('التالي');choose('التالي');
 expect(screen.getByText('النسيج والملابس / ملابس الأطفال')).toBeInTheDocument();
 expect(screen.getByText('Original label')).toBeInTheDocument();
 failSave=true;choose('حفظ مسودة خاصة');await screen.findByRole('button',{name:'استكمال محاولة الحفظ'});
 expect(writes[0].body).toMatchObject({category:'Original label',taxonomyPath:'textile/kids',isDraft:true});
 choose('استكمال محاولة الحفظ');await waitFor(()=>expect(saved).toHaveBeenCalledWith(true));
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
});
test('supplier editing retains existing path on load failure and can explicitly clear it',async()=>{
 failTaxonomy=true;const saved=jest.fn();
 const product={...item,category:'Original label',storeId:''};
 render(<LanguageProvider><ProductEditor product={product} stores={[]} onSaved={saved} onCancel={()=>{}}/></LanguageProvider>);
 editorOpen();await screen.findByText('تعذر تحميل التصنيف.');
 expect(screen.getByLabelText('الفئة')).toHaveValue('Original label');
 choose('إزالة التصنيف الهرمي');choose('حفظ مسودة خاصة');
 await waitFor(()=>expect(saved).toHaveBeenCalledWith(true));
 expect(writes[0]).toMatchObject({method:'PUT',body:{taxonomyPath:'',category:'Original label'}});
});

test('all sectors directory opens the scoped subcategory dialog and restores focus',async()=>{
 render(<App/>);
 const all=await screen.findByRole('button',{name:'عرض جميع القطاعات'});
 fireEvent.click(all);
 const directoryDialog=screen.getByRole('dialog',{name:'عرض جميع القطاعات'});
 expect(within(directoryDialog).getAllByRole('button').length).toBe(11);
 fireEvent.click(within(directoryDialog).getByRole('button',{name:'النسيج والملابس'}));
 const sub=screen.getByRole('dialog',{name:'النسيج والملابس'});
 expect(within(sub).getByRole('button',{name:'كل فئات القطاع'})).toHaveFocus();
 fireEvent.click(within(sub).getByRole('button',{name:'ملابس الأطفال'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(all).toHaveFocus();
 await waitFor(()=>expect(requests('/products/search').some(([url])=>params(url).get('taxonomyPath')==='textile/kids')).toBe(true));
 const trigger=screen.getByRole('button',{name:'المنزل والديكور'});
 fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:'المنزل والديكور'})).toBeInTheDocument();
 fireEvent.keyDown(document,{key:'Escape'});
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(trigger).toHaveFocus();
 await waitFor(()=>expect(requests('/products/search').some(([url])=>params(url).get('taxonomyPath')==='home')).toBe(true));
});
