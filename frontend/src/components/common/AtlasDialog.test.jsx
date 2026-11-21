import {render,screen,fireEvent} from '@testing-library/react';
import AtlasDialog from './AtlasDialog';
import {LanguageProvider} from '../../i18n/LanguageContext';

test('Tab cycles inside the dialog, Escape closes and focus returns to the trigger',()=>{
  const trigger=document.createElement('button');document.body.appendChild(trigger);trigger.focus();
  const rect=jest.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}]);
  const close=jest.fn();const view=render(<LanguageProvider><AtlasDialog title="اختبار" onClose={close}><input aria-label="رسالة"/><button>آخر إجراء</button></AtlasDialog></LanguageProvider>);
  const first=screen.getByRole('button',{name:'إغلاق'}), last=screen.getByRole('button',{name:'آخر إجراء'});
  expect(first).toHaveFocus();last.focus();fireEvent.keyDown(document,{key:'Tab'});expect(first).toHaveFocus();
  fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(last).toHaveFocus();fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledTimes(1);
  view.unmount();expect(trigger).toHaveFocus();trigger.remove();rect.mockRestore();
});

test('an in-flight action disables close and Escape cannot discard it',()=>{
  const close=jest.fn();render(<LanguageProvider><AtlasDialog title="اختبار" busy onClose={close}>انتظار</AtlasDialog></LanguageProvider>);
  expect(screen.getByRole('button',{name:'إغلاق'})).toBeDisabled();fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();
});
