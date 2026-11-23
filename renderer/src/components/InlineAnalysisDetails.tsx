import { useEffect, useId, useState, type ReactNode } from "react";

/** Compact disclosure: content opens beside its trigger and wraps without page overflow. */
export function InlineAnalysisDetails({children,title="分析参数",defaultOpen=false,hint}: {children:ReactNode;title?:string;defaultOpen?:boolean;hint?:string}) {
 const [open,setOpen]=useState(defaultOpen),id=useId();
 useEffect(()=>setOpen(defaultOpen),[defaultOpen]);
 return <section className="analysis-inline-details analysis-runtime-details" data-open={open}>
  <button type="button" className="secondary" aria-expanded={open} aria-controls={id} title={hint} onClick={()=>setOpen(value=>!value)}>{title}<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 6 6-6 6"/></svg></button>
  {open&&<div id={id} className="analysis-inline-details__body">{children}</div>}
 </section>;
}
