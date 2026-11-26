import { act, fireEvent, render, screen, within } from '@testing-library/react';
import MarketLayout from './MarketLayout';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { setSession, clearSession } from '../../api/session';

const draw = (props = {}) => render(<LanguageProvider><MarketLayout page="home" onSourcing={jest.fn()} onRegister={jest.fn()} {...props}><main id="market-main">Catalog content</main></MarketLayout></LanguageProvider>);
const trigger = () => screen.getByRole('button', { name: 'المزيد' });
const nav = () => screen.getByRole('navigation', { name: 'التنقل العام' });
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); });

test('secondary destinations are collapsed, with keyboard dismissal and restored focus', () => {
  draw(); expect(trigger()).toHaveAttribute('aria-expanded','false');
  expect(screen.queryByRole('navigation', { name: 'التنقل العام' })).toBeNull();
  fireEvent.click(trigger());
  expect(trigger()).toHaveAttribute('aria-expanded','true');
  expect(within(nav()).getByRole('link', { name: 'كل المنتجات' })).toHaveAttribute('aria-current','page');
  expect(within(nav()).getByRole('link', { name: 'فرص الجملة' })).toHaveAttribute('href','/opportunities');
  expect(within(nav()).getByRole('link', { name: 'المتاجر' })).toHaveAttribute('href','/stores');
  expect(within(nav()).getByRole('link', { name: 'المفضلة' })).toHaveAttribute('href','/favorites');
  within(nav()).getByRole('link', { name: 'فرص الجملة' }).focus();
  fireEvent.keyDown(document, {key:'Escape'});
  expect(trigger()).toHaveFocus();
  expect(trigger()).toHaveAttribute('aria-expanded','false');
});
test('choosing a real destination closes the disclosure and navigates', () => {
  draw(); fireEvent.click(trigger());
  fireEvent.click(within(nav()).getByRole('link',{name:'فرص الجملة'}));
  expect(window.location.pathname).toBe('/opportunities');
  expect(screen.queryByRole('navigation',{name:'التنقل العام'})).toBeNull();
});
test('outside pointer dismissal and sourcing preserve the explicit action', () => {
  const onSourcing=jest.fn(); draw({onSourcing});
  fireEvent.click(trigger()); fireEvent.pointerDown(screen.getByText('Catalog content'));
  expect(trigger()).toHaveAttribute('aria-expanded','false'); expect(onSourcing).not.toHaveBeenCalled();
  fireEvent.click(trigger()); fireEvent.click(within(nav()).getByRole('button',{name:'طلب توريد خاص'}));
  expect(onSourcing).toHaveBeenCalledTimes(1);
  expect(trigger()).toHaveAttribute('aria-expanded','false');
});
test('the mobile supplier entry invokes the existing registration callback', () => {
  const onRegister=jest.fn(); draw({onRegister}); fireEvent.click(trigger());
  // Styles select the mobile entry; the actual element and handler remain shared.
  const action=document.querySelector('.atlas-more-register');
  expect(action).toBeInTheDocument(); fireEvent.click(action);
  expect(onRegister).toHaveBeenCalledTimes(1); expect(trigger()).toHaveAttribute('aria-expanded','false');
});

test('late profile hydration preserves an open menu, real session change closes it', () => {
  const previousFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ unreadCount: 0 }) });
  const view = user => <LanguageProvider><MarketLayout page="home" user={user} onSourcing={jest.fn()} onRegister={jest.fn()}><main>Catalog content</main></MarketLayout></LanguageProvider>;
  setSession('synthetic-session-a');
  const rendered = render(view(null));
  try {
    fireEvent.click(trigger());
    rendered.rerender(view({ _id: 'buyer-a', role: 'buyer' }));
    expect(trigger()).toHaveAttribute('aria-expanded','true');
    expect(nav()).toBeInTheDocument();
    act(() => setSession('synthetic-session-b'));
    expect(trigger()).toHaveAttribute('aria-expanded','false');
  } finally {
    rendered.unmount(); clearSession(); global.fetch = previousFetch;
  }
});

test('the mobile More disclosure preserves explicit logout for the signed-in account', () => {
  const onLogout = jest.fn();
  draw({user:{_id:'buyer-a',role:'buyer'},onLogout});
  fireEvent.click(trigger());
  const action = within(nav()).getByRole('button',{name:'خروج'});
  fireEvent.click(action);
  expect(onLogout).toHaveBeenCalledTimes(1);
  expect(trigger()).toHaveAttribute('aria-expanded','false');
});
