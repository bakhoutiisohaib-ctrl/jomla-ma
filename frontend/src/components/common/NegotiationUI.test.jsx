import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { NegotiationMessages } from './NegotiationUI';

const offer = { _id: '6af84ac72f1dc52ae4764f99', unitPrice: 34, currency: 'MAD', deliveryDays: 3, notes: 'ملاحظة المورد / supplier note' };
const prefix = 'عرض سعر: 34 MAD؛ التسليم 3 أيام. ';
const message = { _id: offer._id, senderRole: 'supplier', senderName: 'Test supplier', content: prefix + offer.notes };
const show = (messages=[message], offers=[offer], lang='en') => {
  localStorage.setItem('jomla_lang', lang);
  return render(<LanguageProvider><NegotiationMessages messages={messages} offers={offers}/></LanguageProvider>);
};
beforeEach(()=>localStorage.clear());

test.each([['ar','عرض سعر'],['fr','Offre de prix'],['en','Price quote']])('automatic offer introduction follows %s without translating supplier notes', (lang,label)=>{
  const before = JSON.stringify({message,offer});
  const {container}=show(undefined,undefined,lang);
  expect(container.querySelector('li p').textContent).toMatch(new RegExp('^'+label+':'));
  expect(container.querySelector('li p').textContent.endsWith(offer.notes)).toBe(true);
  expect(JSON.stringify({message,offer})).toBe(before);
});

test('ordinary supplier text with the exact same wording is preserved without an offer-id link', ()=>{
  show([{...message,_id:'6af84ac72f1dc52ae4764f98'}]);
  expect(screen.getByText(message.content)).toBeInTheDocument();
});

test('buyer messages and legacy messages with absent offers are never rewritten', ()=>{
  const {rerender}=show([{...message,senderRole:'buyer'}]);
  expect(screen.getByText(message.content)).toBeInTheDocument();
  rerender(<LanguageProvider><NegotiationMessages messages={[message]} offers={[]}/></LanguageProvider>);
  expect(screen.getByText(message.content)).toBeInTheDocument();
});

test('a mismatching offer cannot replace the historical price or notes', ()=>{
  show(undefined,[{...offer,unitPrice:35}]);
  expect(screen.getByText(message.content)).toBeInTheDocument();
});

test('only the original stored portion of a long note is displayed', ()=>{
  const longOffer={...offer,notes:'N'.repeat(6000)};
  const stored={...message,content:(prefix+longOffer.notes).slice(0,5000)};
  const {container}=show([stored],[longOffer]);
  const text=container.querySelector('li p').textContent;
  expect(text.startsWith('Price quote:')).toBe(true);
  expect(text.match(/N/g)).toHaveLength(5000-prefix.length);
});

test('missing price data leaves the original message intact', ()=>{
  show(undefined,[{...offer,unitPrice:null}]);
  expect(screen.getByText(message.content)).toBeInTheDocument();
});

test('an automatic offer without notes still translates after server trimming', ()=>{
  show([{...message,content:prefix.trim()}],[{...offer,notes:''}]);
  expect(screen.getByText(/^Price quote:/)).toHaveTextContent('Delivery in days: 3.');
});
