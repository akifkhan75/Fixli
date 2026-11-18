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
