import {getLocale} from './language.js';
export const formatNumber=(value,digits=0)=>Number.isFinite(value)?value.toLocaleString(getLocale(),{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
export const formatMoney=(value)=>Number.isFinite(value)?'$'+formatNumber(value,2):'—';
export const formatTime=(value)=>value?new Date(value).toLocaleTimeString(getLocale(),{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
