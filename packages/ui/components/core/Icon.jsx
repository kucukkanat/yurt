import React from 'react';
import { ICONS } from './icons-data.js';

export function Icon({ name, size = 20, strokeWidth = 2, label, color = 'currentColor', style, ...rest }) {
  const inner = ICONS[name];
  if (!inner && typeof console !== 'undefined') console.warn('Icon: unknown name "' + name + '"');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false"
      style={{ flexShrink: 0, display: 'block', ...style }}
      dangerouslySetInnerHTML={{ __html: inner || '' }}
      {...rest}
    />
  );
}

