process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3002/api';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Ionicons: (props: any) => <View {...props} />,
    MaterialIcons: (props: any) => <View {...props} />,
    FontAwesome: (props: any) => <View {...props} />,
  };
});

// Native storage isn't available under Jest: use the library's in-memory mock everywhere.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
