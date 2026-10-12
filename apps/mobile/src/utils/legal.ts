import { Linking } from 'react-native';
import { WEB_URL } from '../config';
import { getLocale } from '../i18n';

export type LegalPage = 'privacy' | 'terms' | 'delete-account';

/** Urdu has its own pages; Arabic readers get the English ones until someone translates them (doc 28). */
export const legalUrl = (page: LegalPage, locale = getLocale()) => `${WEB_URL}/${locale === 'ur' ? 'ur/' : ''}${page}`;

export const openLegal = (page: LegalPage) => Linking.openURL(legalUrl(page));
