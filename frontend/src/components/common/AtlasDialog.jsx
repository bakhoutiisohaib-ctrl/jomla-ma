import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLabels } from '../../i18n/useLabels';
import '../../styles/atlas-negotiation.css';

export default function AtlasDialog({ title, label, subtitle, onClose, busy=false, children }) {
  const l=useLabels(), id=useId(), dialog=useRef(null), close=useRef(null), state=useRef({onClose,busy});
  state.current={onClose,busy};
  useEffect(()=>{
    const trigger=document.activeElement, overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';close.current?.focus();
    function key(event) {
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!state.current.busy)state.current.onClose();}
      if(event.key==='Tab'){
        const items=[...dialog.current.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')].filter(e=>!e.disabled && e.tabIndex>=0 && !e.closest('[hidden]') && e.getClientRects().length);
        const first=items[0],last=items[items.length-1];
        if(!first){event.preventDefault();dialog.current.focus();}
        else if(event.shiftKey && (document.activeElement===first || !dialog.current.contains(document.activeElement))){event.preventDefault();last.focus();}
        else if(!event.shiftKey && (document.activeElement===last || !dialog.current.contains(document.activeElement))){event.preventDefault();first.focus();}
      }
    }
    document.addEventListener('keydown',key,true);
    return ()=>{document.removeEventListener('keydown',key,true);document.body.style.overflow=overflow;if(trigger?.isConnected)trigger.focus();};
  },[]);
  return createPortal(<div className="atlas-trade-backdrop"><section ref={dialog} tabIndex="-1" role="dialog" aria-modal="true" aria-label={label} aria-labelledby={label?undefined:id} className="atlas-trade-dialog">
    <header className="trade-dialog-header"><div><small>{subtitle ?? l('التفاوض وعرض السعر','Négociation et devis')}</small><h2 id={id}>{title}</h2></div><button ref={close} type="button" disabled={busy} onClick={onClose}>{l('إغلاق','Fermer')}</button></header>
    <div className="trade-dialog-body">{children}</div>
  </section></div>,document.body);
}
