import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const item = {_id:'111111111111111111111111',name:'Synthetic catalog item',category:'Textile test',price:20,currency:'MAD',moq:10,unit:'piece',availability:'in_stock',supplierId:{_id:'222222222222222222222222',name:'Synthetic supplier'},storeId:'222222222222222222222222'};
const reply = data => Promise.resolve({ok:true,status:200,json:async()=>data});
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({},'','/');
  global.fetch = jest.fn((url) => {
    const path = new URL(url,'http://localhost').pathname;
    if(path.endsWith('/products/categories')) return reply({data:[{category:item.category,count:1}],pagination:{page:1,limit:12,total:1,pages:1,hasNextPage:false,hasPrevPage:false}});
    if(path.endsWith('/products/search') || path.endsWith('/ai-search')) return reply({data:[item],pagination:{pages:1,total:1}});
    return reply({data:[],unreadCount:0});
  });
});
test('the real catalog search removes the introductory banner and reset restores it', async () => {
  render(<App/>);
  await screen.findByRole('button',{name:'معاينة سريعة: '+item.name});
  expect(document.querySelector('.atlas-home-intro')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('البحث في الكتالوج'),{target:{value:'textile'}});
  expect(document.querySelector('.atlas-home-intro')).toBeInTheDocument();
  fireEvent.submit(screen.getByRole('search'));
  expect(document.querySelector('.atlas-home-intro')).not.toBeInTheDocument();
  await waitFor(()=>expect(fetch.mock.calls.some(([url,options])=>String(url).includes('/ai-search') && JSON.parse(options.body).query==='textile')).toBe(true));
  fireEvent.click(screen.getByRole('button',{name:'إعادة ضبط البحث'}));
  expect(document.querySelector('.atlas-home-intro')).toBeInTheDocument();
});
test('category choice still filters the real catalog without inventing categories',async()=>{
  render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:item.category}));
  expect(document.querySelector('.atlas-home-intro')).not.toBeInTheDocument();
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>new URL(url,'http://localhost').searchParams.get('category')===item.category)).toBe(true));
  expect(screen.getByRole('button',{name:item.category})).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getByRole('button',{name:'كل الفئات'}));
  expect(document.querySelector('.atlas-home-intro')).toBeInTheDocument();
});
