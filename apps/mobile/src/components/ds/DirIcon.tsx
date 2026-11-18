import React from 'react';
import { I18nManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Name = React.ComponentProps<typeof Ionicons>['name'];

/** Icons that point "forward" or "back" must mirror in right-to-left languages (Urdu, Arabic). */
const MIRROR: Partial<Record<string, Name>> = {
  'chevron-forward': 'chevron-back',
  'chevron-back': 'chevron-forward',
  'arrow-back': 'arrow-forward',
  'arrow-forward': 'arrow-back',
};

export function mirroredName(name: Name, rtl: boolean): Name {
  return rtl ? MIRROR[name as string] ?? name : name;
}

export function DirIcon({ name, ...rest }: React.ComponentProps<typeof Ionicons>) {
  return <Ionicons name={mirroredName(name, I18nManager.isRTL)} {...rest} />;
}
