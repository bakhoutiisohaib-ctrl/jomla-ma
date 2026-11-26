import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import App from '../App';
import { LanguageProvider, useTranslation } from './LanguageContext';
import LanguageSwitch from './LanguageSwitch';
import { labelFor, statusLabel, notificationLabel, localizeCopy } from './useLabels';

beforeEach(() => {
  window.history.replaceState({}, '', '/'); localStorage.clear(); sessionStorage.clear();
  global.fetch = jest.fn(async url => {
    const categoryDirectory = new URL(url, 'http://localhost').pathname.endsWith('/products/categories');
    return { ok: true, status: 200, json: async () => ({
      data: [], pagination: categoryDirectory
        ? { page: 1, limit: 12, total: 0, pages: 0, hasNextPage: false, hasPrevPage: false }
        : { page: 1, pages: 1, total: 0 }
    }) };
  });
});
afterEach(() => jest.restoreAllMocks());

function Probe() {
  const { lang, t } = useTranslation();
  return <><LanguageSwitch /><output>{lang}</output><p>{t('loading')}</p></>;
}
test('all three languages persist, restore and set the correct reading direction', () => {
  const rendered = render(<LanguageProvider><Probe /></LanguageProvider>);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
  expect(localStorage.getItem('jomla_lang')).toBe('en');
  expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  rendered.unmount(); render(<LanguageProvider><Probe /></LanguageProvider>);
  expect(screen.getByRole('combobox')).toHaveValue('en');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });
  expect(document.documentElement.dir).toBe('ltr');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ar' } });
  expect(document.documentElement.dir).toBe('rtl');
});
test('English covers dynamic status and notification labels and grouped form copy', () => {
  expect(statusLabel('accepted','en')).toBe('Accepted');
  expect(notificationLabel('message_received','en')).toBe('New message in the conversation');
  expect(localizeCopy({ ar:{send:'إرسال'}, fr:{send:'Envoyer'} },'en')).toEqual({send:'Send'});
  expect(labelFor('en','ع','Unknown','Explicit English')).toBe('Explicit English');
});
test('English catalog, navigation, cart and sign-in remain reachable without changing a cart selection', async () => {
  localStorage.setItem('jomla_lang','en');
  const selection = JSON.stringify(['111111111111111111111111']);
  sessionStorage.setItem('jomla:quote-selection:v1:guest',selection);
  render(<App />);
  const nav = screen.getByRole('navigation',{name:'Mobile navigation'});
  expect(within(nav).getAllByRole('link').map(a=>a.getAttribute('href'))).toEqual(['/','/stores','/cart','/favorites']);
  await screen.findByText('No published categories for this selection currently.');
  expect(screen.getByLabelText('Interface language')).toHaveValue('en');
  fireEvent.click(within(nav).getByRole('link',{name:/Quote cart/}));
  await waitFor(()=>expect(window.location.pathname).toBe('/cart'));
  fireEvent.change(screen.getByLabelText('Interface language'),{target:{value:'ar'}});
  expect(window.location.pathname).toBe('/cart');
  fireEvent.change(screen.getByLabelText('لغة الواجهة'),{target:{value:'en'}});
  expect(sessionStorage.getItem('jomla:quote-selection:v1:guest')).toBe(selection);
  fireEvent.click(within(screen.getByRole('navigation',{name:'Mobile navigation'})).getByRole('button',{name:'My account'}));
  await waitFor(()=>expect(window.location.pathname).toBe('/login'));
  expect(screen.getByLabelText('Interface language')).toHaveValue('en');
});
