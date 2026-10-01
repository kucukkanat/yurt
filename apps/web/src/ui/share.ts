import { useApp } from '../store';
import { messageOf } from './must';

/** The system share sheet (phones, some desktops). Closing it without sharing isn't an error; anything else is said. */
export function share(url: string, title: string) {
  navigator.share({ title, url }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    useApp.getState().toast({ tone: 'danger', title: 'Couldn’t share', description: messageOf(e) });
  });
}
