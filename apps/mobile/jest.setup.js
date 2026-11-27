process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3002/api';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Ionicons: (props) => <View {...props} />,
    MaterialIcons: (props) => <View {...props} />,
    FontAwesome: (props) => <View {...props} />,
  };
});

// Native storage does not exist under jest. Tests that need specific behaviour mock it themselves.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Reanimated 4's stock mock calls native CSS handlers that do not exist under Jest.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, Image, ScrollView } = require('react-native');
  const passthrough = (v) => v;
  const chain = () => {
    const api = {
      duration: () => api,
      delay: () => api,
      springify: () => api,
      damping: () => api,
      stiffness: () => api,
      mass: () => api,
      reduceMotion: () => api,
      build: () => ({}),
    };
    return api;
  };
  const Animated = {
    View,
    Text,
    Image,
    ScrollView,
    createAnimatedComponent: (C) => C,
    addWhitelistedUIProps: () => {},
  };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    FadeIn: chain(),
    FadeInDown: chain(),
    ZoomIn: chain(),
    ReduceMotion: { System: 'system', Never: 'never', Always: 'always' },
    Easing: { linear: passthrough, ease: passthrough, quad: passthrough, out: passthrough, in: passthrough, inOut: passthrough },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => (typeof fn === 'function' ? fn() : {}),
    useAnimatedProps: (fn) => (typeof fn === 'function' ? fn() : {}),
    withTiming: passthrough,
    withSpring: passthrough,
    withDelay: (_d, v) => v,
    withRepeat: passthrough,
    withSequence: (...args) => args[0],
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    interpolate: passthrough,
    Extrapolation: { CLAMP: 'clamp' },
  };
});
