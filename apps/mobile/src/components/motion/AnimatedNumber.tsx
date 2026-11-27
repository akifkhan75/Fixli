import React, { useEffect, useRef, useState } from 'react';
import { motion } from '../../theme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Text, TextProps } from '../ds/Text';

/**
 * Counts to a new value (earnings, prices). `format` receives whole numbers only, so money stays in
 * integer minor units. Screen readers always hear the final value, never the in-between ones.
 */
export function AnimatedNumber({ value, format, ...textProps }: { value: number; format: (n: number) => string } & Omit<TextProps, 'children'>) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (reduce || start === value) { from.current = value; setShown(value); return; }
    let frame = 0;
    let began: number | undefined;
    const step = (now: number) => {
      began ??= now;
      const p = Math.min(1, (now - began) / motion.duration.slow);
      const next = p === 1 ? value : Math.round(start + (value - start) * (1 - (1 - p) ** 3));
      from.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);

  return <Text tabular {...textProps} accessibilityLabel={format(value)}>{format(shown)}</Text>;
}
