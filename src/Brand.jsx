import {t} from './language.js';
import React from 'react';
export default function Brand({ compact = false }) {
  return <div className={'brand' + (compact ? ' brand-compact' : '')} aria-label={t("AltCrate")}><svg width="36" height="36" viewBox="0 0 72 72" fill="none" aria-hidden="true"><path fill="currentColor" d="M8 23 29 11 43 19 36 27 29 23 18 29v15l11 6 11-6v-9l10-10v25L29 62 8 50Z"/><path fill="currentColor" d="M39 4h25v25H54V21L40 35l-7-7 14-14h-8Z"/></svg><div><strong>{t("AltCrate")}</strong><small>{t("Centro de operações")}</small></div></div>;
}
