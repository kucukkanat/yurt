/** What `attentive` reads of a document: the real `document` in the app, a plain object in unit tests. */
export interface AttentionDoc {
  readonly hidden: boolean;
  hasFocus(): boolean;
}

/**
 * Whether I'm looking at the app: its tab is visible and its window has focus. A visible window behind another
 * app's counts as away, so messages there still notify and stay unread.
 */
export const attentive = (doc: AttentionDoc): boolean => !doc.hidden && doc.hasFocus();

/** My presence while I'm looking at the app ('online') or not ('away'). */
export const presenceNow = (): 'online' | 'away' => (attentive(document) ? 'online' : 'away');

/** Calls `cb` whenever `attentive` may have changed (tab shown or hidden, window focused or blurred); returns the unsubscribe. */
export function onAttentionChange(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  window.addEventListener('focus', cb);
  window.addEventListener('blur', cb);
  return () => {
    document.removeEventListener('visibilitychange', cb);
    window.removeEventListener('focus', cb);
    window.removeEventListener('blur', cb);
  };
}
